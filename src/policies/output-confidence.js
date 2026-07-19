// SPDX-License-Identifier: Apache-2.0
// src/policies/output-confidence.js
//
// LLM09:2025 (Misinformation) — output-confidence heuristic. Per ADR-050 §5
// GAP-6. Ships the producer-side half of LLM09 that v1.1's "overreliance"
// framing lacked.
//
// Purpose: score a model output's claim confidence. When a claim is
// confidently stated but lacks the supporting evidence the producer side
// should be able to surface, the heuristic tags it so downstream code can
// emit a `review_required` annotation on the audit chain. The reviewer is
// the operator — this is a flag, NOT a deny (per ADR-050 §6 LLM09:2025,
// "reviewer is the operator, not the model").
//
// v0 detection rules (per body spec):
//   (a) numeric claims without source citation
//       e.g. "Revenue grew 47% in Q3" with no nearby citation/source token.
//   (b) date claims against current date
//       e.g. "Today is 2026-07-19" or "as of yesterday" when the current
//       date is materially different from the date literal in the claim.
//       Heuristic-only — uses date literals (YYYY-MM-DD, MMM YYYY, "Q1
//       2026") parsed from the output text.
//   (c) entity claims not in the retrieval result set
//       e.g. the output mentions "Acme Corp" but the retrievalResult set
//       passed in contains no document referencing that entity.
//
// Gating: the heuristic is process-level feature-flagged via
// AWARE_LLM09_DETECTION_ENABLED. Default OFF. This matches the AST10
// AST07/AST08 pattern (enableWrites=false at deploy until corpus-validated).
// The flag check lives in `isDetectionEnabled()` so a caller can defer the
// decision to module-load or per-call.
//
// The module is intentionally pure (no I/O, no audit-chain writes). The
// caller (typically the LLM09 mapper at src/compliance/llm09-mapper.js) is
// responsible for turning the heuristic result into a `review_required`
// audit-chain annotation. This separation matches ADR-043's "READ-ONLY on
// the input event, WRITE-ONLY on the annotation chain" contract that the
// AST10 mapper follows.
//
// Per APTS discipline (AGENTS.md): no new dependencies.

'use strict';

const HEURISTIC_VERSION = '0.1.0';

// ----------------------------------------------------------------------------
// Env-var gating
// ----------------------------------------------------------------------------

/**
 * Resolve the detection-enabled flag.
 *
 * Truthy values: '1', 'true', 'TRUE', 'True', 'yes', 'on'.
 * Anything else (including unset) → false.
 *
 * Read on every call (not at module load) so a long-running process can be
 * reconfigured by toggling the env var without a restart. The mapper layer
 * caches per-call but always re-reads.
 *
 * @returns {boolean}
 */
function isDetectionEnabled() {
  const raw = process.env.AWARE_LLM09_DETECTION_ENABLED;
  if (raw === undefined || raw === null || raw === '') return false;
  const norm = String(raw).trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on';
}

// ----------------------------------------------------------------------------
// Citation detection (rule a)
// ----------------------------------------------------------------------------

// Patterns that look like an inline citation. We intentionally keep this
// list narrow — a false negative on "no citation" is acceptable because
// the output is a flag for the operator, not a deny.
const CITATION_PATTERNS = [
  // [1], [12], [smith2024], etc.
  /\[[0-9]{1,3}\]/,
  /\[[A-Za-z][A-Za-z0-9_-]{2,30}\]/,
  // (Smith et al., 2024) / (Source: foo) / (per foo) / (see bar)
  /\(\s*(?:[A-Z][A-Za-z0-9-]+(?:\s+et\s+al\.)?(?:,\s*\d{4})?|Source\s*:[^)]+|per\s+[^)]+|see\s+[^)]+)\s*\)/,
  // URL — http(s):// or arxiv: or doi:
  /\bhttps?:\/\/\S+/,
  /\barxiv:\S+/i,
  /\bdoi:\S+/i
];

function hasCitationNearby(text, claimStart, claimEnd, window = 200) {
  // Look at the preceding window (the claim's "supporting context") for a
  // citation marker. Citations typically precede the claim ("[1] Revenue
  // grew 47%…") rather than follow it. We also peek at the trailing
  // window in case the citation trails the number ("…grew 47% [1].").
  const lo = Math.max(0, claimStart - window);
  const hi = Math.min(text.length, claimEnd + 80);
  const slice = text.slice(lo, hi);
  for (const pat of CITATION_PATTERNS) {
    if (pat.test(slice)) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Numeric-claim detection (rule a)
// ----------------------------------------------------------------------------

// Match numbers like 47%, 1.2M, $4.5B, 100k, 3,200. The match captures the
// position so we can check the surrounding context for citations.
const NUMERIC_CLAIM_RE = /\b(\$?\d+(?:[,._]\d+)*\s?(?:%|k|m|b|bn|mn|million|billion|thousand)?)\b/gi;

function findNumericClaims(text) {
  const claims = [];
  // Reset regex state by re-creating it (lastIndex is mutable on /g regexes).
  const re = new RegExp(NUMERIC_CLAIM_RE.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] || m[0];
    // Skip pure ordinals like "1st" / "2nd" — those rarely carry the
    // weight that warrants a citation check. We match the trailing ordinal
    // suffix and bail.
    if (/^\d+(st|nd|rd|th)$/i.test(raw.trim())) continue;
    // Skip 4-digit years that appear in date claims — the date-claim rule
    // owns those.
    if (/^\d{4}$/.test(raw.trim())) continue;
    claims.push({ start: m.index, end: m.index + m[0].length, raw });
  }
  return claims;
}

// ----------------------------------------------------------------------------
// Date-claim detection (rule b)
// ----------------------------------------------------------------------------

// Match date literals. We anchor on tokens that strongly suggest a temporal
// claim so we don't false-flag prose like "module 47" (no year/quarter).
const DATE_PATTERNS = [
  // 2026-07-19 / 2026/07/19
  { re: /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/g, kind: 'iso_date' },
  // 19 July 2026 / July 19, 2026
  { re: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,)?\s+(20\d{2})\b/gi, kind: 'long_date' },
  { re: /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi, kind: 'eu_long_date' },
  // Q1 2026, Q3 2026, etc.
  { re: /\bQ[1-4]\s+(20\d{2})\b/g, kind: 'quarter' },
  // "as of <date>" / "today is <date>" / "yesterday was <date>"
  // The relative-date claim does NOT require a year — any of these
  // phrases without an anchor is a soft concern, even when the surrounding
  // context is innocuous (the heuristic can't verify temporal anchoring).
  // Case-insensitive — "Today is" / "TODAY" / "Today, ..." should all fire.
  { re: /\b(?:as of|today(?:'s| is)?|yesterday|currently|right now|at the moment)\b/gi, kind: 'relative_date' }
];

function findDateClaims(text) {
  const claims = [];
  for (const { re, kind } of DATE_PATTERNS) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      const yearStr = (m[1] && /^\d{4}$/.test(m[1])) ? m[1] : (m[2] || null);
      const year = yearStr ? parseInt(yearStr, 10) : null;
      claims.push({ start: m.index, end: m.index + m[0].length, raw: m[0], kind, year });
    }
  }
  return claims;
}

// ----------------------------------------------------------------------------
// Entity-claim detection (rule c)
// ----------------------------------------------------------------------------

/**
 * Extract entity-like tokens from the output text.
 *
 * v0 heuristic: capitalized noun phrases of 1-4 tokens. This is intentionally
 * crude — false positives on common nouns ("United States", "Open Source")
 * are OK because the operator is the reviewer. We don't need to disambiguate
 * people/orgs/products; we just need a candidate set that the retrieval
 * check can prune.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractEntities(text) {
  const re = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3})\b/g;
  const out = new Set();
  const r = new RegExp(re.source, re.flags);
  let m;
  while ((m = r.exec(text)) !== null) {
    out.add(m[1]);
  }
  return Array.from(out);
}

// ----------------------------------------------------------------------------
// Numeric-claim evaluation
// ----------------------------------------------------------------------------

function evaluateNumericClaims(text) {
  const claims = findNumericClaims(text);
  const flagged = [];
  for (const c of claims) {
    if (!hasCitationNearby(text, c.start, c.end)) {
      flagged.push({ ...c, rule: 'LLM09_2025_CITATION_MISSING' });
    }
  }
  return flagged;
}

// ----------------------------------------------------------------------------
// Date-claim evaluation
// ----------------------------------------------------------------------------

const YEAR_TOLERANCE_YEARS = 1;

/**
 * @param {string} text
 * @param {Date}  [now]  - injected for testing; defaults to new Date()
 */
function evaluateDateClaims(text, now = new Date()) {
  const claims = findDateClaims(text);
  const currentYear = now.getUTCFullYear();
  const flagged = [];
  for (const c of claims) {
    // Relative-date claims don't carry a year — they fire RELATIVE_DATE on
    // their own (the heuristic can't verify temporal anchoring at all).
    if (c.kind === 'relative_date') {
      flagged.push({ ...c, rule: 'LLM09_2025_RELATIVE_DATE' });
      continue;
    }
    if (!c.year) continue;
    const delta = Math.abs(currentYear - c.year);
    if (delta > YEAR_TOLERANCE_YEARS) {
      flagged.push({ ...c, rule: 'LLM09_2025_FACTUAL_CONFLICT' });
    }
  }
  return flagged;
}

// ----------------------------------------------------------------------------
// Entity-claim evaluation
// ----------------------------------------------------------------------------

/**
 * @param {string} text
 * @param {string[]} retrievalEntities - entities present in the retrieval
 *   result set (caller is responsible for extraction on the retrieval side).
 *   If empty/omitted, entity checking is skipped (the v0 heuristic is
 *   conservative — no retrieval context means we can't claim a violation).
 */
function evaluateEntityClaims(text, retrievalEntities = []) {
  if (!Array.isArray(retrievalEntities) || retrievalEntities.length === 0) {
    return [];
  }
  const retrievalSet = new Set(retrievalEntities.map((e) => String(e).toLowerCase()));
  const outputEntities = extractEntities(text);
  const flagged = [];
  for (const ent of outputEntities) {
    const lower = ent.toLowerCase();
    if (!retrievalSet.has(lower)) {
      flagged.push({
        rule: 'LLM09_2025_UNSUPPORTED_ENTITY',
        entity: ent
      });
    }
  }
  return flagged;
}

// ----------------------------------------------------------------------------
// Aggregate evaluate()
// ----------------------------------------------------------------------------

/**
 * Evaluate a model output for confidence concerns.
 *
 * Returns an array of "concern" records. Each concern has:
 *   { rule, [raw|entity] }   - rule discriminator + minimal context
 *
 * An empty array means "no concerns surfaced by the v0 heuristic".
 *
 * @param {Object} input
 * @param {string} input.text             - the model output text
 * @param {Date}   [input.now]            - current date (for date claims)
 * @param {string[]} [input.retrievalEntities] - entities in retrieval set
 * @returns {Array<{rule: string, [raw]: string, [entity]: string}>}
 */
function evaluate(input) {
  if (!input || typeof input.text !== 'string') {
    return [];
  }
  const text = input.text;
  const now = input.now instanceof Date ? input.now : new Date();
  const retrievalEntities = Array.isArray(input.retrievalEntities) ? input.retrievalEntities : [];

  const numeric = evaluateNumericClaims(text);
  const date = evaluateDateClaims(text, now);
  const entity = evaluateEntityClaims(text, retrievalEntities);

  return [...numeric, ...date, ...entity];
}

/**
 * Convenience: return the highest-priority rule for the concerns.
 * Used by the LLM09 mapper to set triggerSource on the audit record.
 * Order: FACTUAL_CONFLICT > CITATION_MISSING > UNSUPPORTED_ENTITY >
 * RELATIVE_DATE. Empty → null.
 */
function primaryRule(concerns) {
  if (!Array.isArray(concerns) || concerns.length === 0) return null;
  const priority = [
    'LLM09_2025_FACTUAL_CONFLICT',
    'LLM09_2025_CITATION_MISSING',
    'LLM09_2025_UNSUPPORTED_ENTITY',
    'LLM09_2025_RELATIVE_DATE'
  ];
  for (const rule of priority) {
    if (concerns.some((c) => c.rule === rule)) return rule;
  }
  return concerns[0].rule || null;
}

/**
 * Map a concerns array to a 0.0–1.0 confidence score.
 * Lower score = lower confidence in the output's veracity.
 *
 * v0 formula: start at 1.0; subtract 0.3 for each concern; floor at 0.0.
 * Caller can apply a threshold (e.g. < 0.7 → emit review_required).
 */
function confidenceScore(concerns) {
  if (!Array.isArray(concerns) || concerns.length === 0) return 1.0;
  const score = Math.max(0, 1.0 - 0.3 * concerns.length);
  return Math.round(score * 1000) / 1000; // 3 dp
}

// ----------------------------------------------------------------------------
// Module exports
// ----------------------------------------------------------------------------

module.exports = {
  // Public API
  isDetectionEnabled,
  evaluate,
  primaryRule,
  confidenceScore,

  // Version
  HEURISTIC_VERSION,

  // Lower-level (exposed for testability; not part of the stable surface)
  findNumericClaims,
  findDateClaims,
  extractEntities,
  hasCitationNearby,
  evaluateNumericClaims,
  evaluateDateClaims,
  evaluateEntityClaims
};
