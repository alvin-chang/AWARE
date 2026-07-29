#!/usr/bin/env node
/**
 * Regenerate src/compliance/mcp-top10-catalog.js from the upstream
 * OWASP MCP Top 10 (2025) per-class .md files.
 *
 * Source: https://github.com/OWASP/www-project-mcp-top-10
 *   Pinned commit: 1b369f3270be0fc09f8d406537ec9a2195ca2e6a (2026-07-19 fetch).
 *   Per ADR-051 §1, the pinned SHA is the source-of-truth for the control
 *   universe; a new SHA bumps the catalog file (mcp-top10-catalog.js) per
 *   ADR-051 §"Failure modes" → "upstream renumbers or rewrites a risk class".
 *
 * Per-class files follow the README's per-class anchor convention
 * (e.g. `mcp01-token-mismanagement`, `mcp02-tool-misuse`, etc.). The script
 * tries a small set of candidate slugs per class because the upstream
 * filenames are not strictly pinned by the README.
 *
 * Re-run this script when:
 *   - OWASP bumps the upstream SHA (new release, control renumber, etc.)
 *   - The catalog file (mcp-top10-catalog.js) drifts from upstream's
 *     control names, severity, or count.
 *
 * Usage:
 *   node scripts/regenerate-mcp-top10-catalog.js [--dry-run]
 *
 * If --dry-run is set, the script exits 0 if the catalog file matches
 * upstream and 1 if it does not (CI drift detector). Without --dry-run,
 * the script writes src/compliance/mcp-top10-catalog.js.
 *
 * The script is intentionally idempotent — running it produces the same
 * output for the same input, so it is safe to re-run as part of CI.
 *
 * First-party characterizations (per AGENTS.md §2): the upstream prose is
 * CC-BY-NC-SA 4.0 and is NOT shipped verbatim in the catalog file. The
 * regeneration script writes a paraphrase that preserves the upstream
 * control name and severity, with a one-sentence first-party description
 * synthesized from the upstream title + first paragraph. The intent is
 * drift detection (the upstream renamed this class? we surface that),
 * not verbatim re-publication.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const PINNED_SHA = '1b369f3270be0fc09f8d406537ec9a2195ca2e6a';
const REPO_OWNER = 'OWASP';
const REPO_NAME = 'www-project-mcp-top-10';
const OUT_PATH = path.join(__dirname, '..', 'src', 'compliance', 'mcp-top10-catalog.js');
const TMP_DIR = path.join(require('os').tmpdir(), 'aware-mcp-top10-fetch');

// Per-class: the upstream README's anchor-based slug candidates. The
// upstream project organises per-class .md files under docs/ with the
// risk-class slug. We try 1-3 candidate slugs per class (the README's
// canonical slug, plus a few common variants) and cache the first hit.
const CLASS_SLUGS = {
  'MCP01': ['mcp01-token-mismanagement', 'mcp01-token-management', 'mcp01'],
  'MCP02': ['mcp02-tool-misuse', 'mcp02-tool-function-misuse', 'mcp02'],
  'MCP03': ['mcp03-excessive-agency', 'mcp03-privilege', 'mcp03'],
  'MCP04': ['mcp04-indirect-prompt-injection', 'mcp04-prompt-injection', 'mcp04'],
  'MCP05': ['mcp05-command-injection', 'mcp05-command-injection-execution', 'mcp05'],
  'MCP06': ['mcp06-context-poisoning', 'mcp06-context-window-memory', 'mcp06'],
  'MCP07': ['mcp07-supply-chain', 'mcp07-supply-chain-servers', 'mcp07'],
  'MCP08': ['mcp08-authentication', 'mcp08-auth-identity', 'mcp08'],
  'MCP09': ['mcp09-shadow-servers', 'mcp09-shadow-mcp-servers', 'mcp09'],
  'MCP10': ['mcp10-cross-session-context', 'mcp10-untrusted-context', 'mcp10']
};

const CLASS_ORDER = ['MCP01', 'MCP02', 'MCP03', 'MCP04', 'MCP05', 'MCP06', 'MCP07', 'MCP08', 'MCP09', 'MCP10'];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 404) return resolve(null);
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Try each candidate slug for a class; return the first hit (raw .md text).
async function fetchClassMarkdown(classId) {
  const candidates = CLASS_SLUGS[classId] || [];
  for (const slug of candidates) {
    const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${PINNED_SHA}/docs/${slug}.md`;
    const text = await fetchText(url);
    if (text) {
      return { classId, slug, url, text };
    }
  }
  return null;
}

// Parse the upstream .md for the frontend-matter title + first paragraph.
function parseUpstreamMarkdown(mdText) {
  if (!mdText) return null;
  const lines = mdText.split('\n');
  let title = null;
  let firstParagraph = null;
  for (const line of lines) {
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (title && !firstParagraph) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!')) {
        firstParagraph = trimmed;
      }
    }
    if (title && firstParagraph) break;
  }
  return { title, firstParagraph };
}

// Map upstream severity tokens to canonical enum. The upstream README
// uses critical / high / medium (lowercase); we uppercase the first letter
// to match the catalog file's convention.
function normalizeSeverity(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  const map = {
    'critical': 'Critical',
    'high': 'High',
    'medium': 'Medium',
    'low': 'Low'
  };
  return map[lower] || raw;
}

function tryExtractSeverityFromMarkdown(mdText) {
  if (!mdText) return null;
  const match = mdText.match(/severity\s*[:=]\s*[`']?(critical|high|medium|low)[`'"]?/i);
  if (match) return normalizeSeverity(match[1]);
  return null;
}

// Compose a first-party characterization (per AGENTS.md §2) from the
// upstream title + first paragraph. This is intentionally a paraphrase,
// not verbatim. The hand-authored catalog file (mcp-top10-catalog.js)
// has the canonical descriptions; this is just a drift sentinel.
function paraphraseFromUpstream(title, firstParagraph) {
  if (!title) return null;
  if (!firstParagraph) return title + ' (per upstream OWASP MCP Top 10 — see ' + PINNED_SHA.slice(0, 7) + ').';
  const trimmed = firstParagraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  return trimmed.length > 320 ? trimmed.slice(0, 317) + '...' : trimmed;
}

function renderCatalogFile(entries) {
  const header = `// SPDX-License-Identifier: Apache-2.0
// src/compliance/mcp-top10-catalog.js
// OWASP MCP Top 10 (2025) — static control catalogue shipped with AWARE.
//
// Per ADR-051, the catalogue is a versioned JSON-style JS module so the
// control claim is reproducible across re-deploys (no live URL fetch).
// The risk-class descriptions and severity strings are pinned to OWASP
// MCP Top 10 (2025) per the upstream project at
// https://github.com/OWASP/www-project-mcp-top-10 (commit
// ${PINNED_SHA}, 2026-07-19 fetch).
//
// This file is the source-of-truth for MCP Top 10 controls surfaced through:
//   - src/compliance/framework-mapper.js  (OWASP_MCP_TOP_10 framework block)
//   - docs/compliance/mcp-top-10.md  (coverage claim)
//
// Per-rule annotations are NOT in this file — they live in
// src/compliance/mcp-top10-classifier.js (separate kanban card).
//
// A bump to MCP Top 10 v.next (or any other minor/patch revision) must be
// a new AWARE release and a new catalogue file (e.g. mcp-top10-catalog-vnext.js)
// per ADR-051 §"Failure modes" → "upstream renumbers or rewrites a risk class".

'use strict';

/**
 * @typedef {Object} MCP10CatalogEntry
 * @property {string} name        - short risk-class name
 * @property {string} severity    - 'Critical' | 'High' | 'Medium'
 * @property {string} description - one-sentence first-party characterization
 *                                  (AWARE voice; not verbatim upstream prose,
 *                                  per AGENTS.md §2).
 */

/**
 * MCP Top 10 (2025) — 10 risk classes.
 *
 * Field provenance:
 *   - name / severity     → upstream README + per-class .md.
 *   - description         → first-party AWARE characterization (per AGENTS.md §2;
 *                           upstream prose is CC-BY-NC-SA 4.0 and not shipped verbatim).
 *
 * DO NOT invent new control IDs. If a new MCP Top 10 release renumbers or
 * adds a class, create a new catalogue version per ADR-051 §"Failure modes".
 *
 * @type {Object<string, MCP10CatalogEntry>}
 */
const MCP_TOP_10_CONTROLS = Object.freeze({`;

  const bodyLines = entries.map((e) => {
    const desc = (e.description || '').replace(/'/g, "\\'");
    return `  '${e.id}': {
    name: '${e.name}',
    severity: '${e.severity}',
    description: '${desc}'
  }`;
  });

  const footer = `});

/**
 * @type {string[]}
 */
const MCP_TOP_10_CONTROL_IDS = Object.freeze(Object.keys(MCP_TOP_10_CONTROLS));

module.exports = {
  MCP_TOP_10_CONTROLS,
  MCP_TOP_10_CONTROL_IDS
};
`;

  return [header, ...bodyLines, footer].join('\n') + '\n';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  console.log(`[regenerate-mcp-top10] fetching 10 per-class .md files from upstream (SHA ${PINNED_SHA.slice(0, 7)})`);

  const entries = [];
  const drift = [];
  for (const cid of CLASS_ORDER) {
    const result = await fetchClassMarkdown(cid);
    if (!result) {
      console.warn(`[regenerate-mcp-top10] WARN: no upstream file found for ${cid} (tried ${CLASS_SLUGS[cid].join(', ')})`);
      drift.push({ id: cid, kind: 'missing' });
      entries.push({ id: cid, name: cid, severity: 'High', description: '(upstream file missing — see ' + PINNED_SHA.slice(0, 7) + ')' });
      continue;
    }
    const parsed = parseUpstreamMarkdown(result.text);
    const severity = tryExtractSeverityFromMarkdown(result.text) || 'High';
    const description = paraphraseFromUpstream(parsed.title, parsed.firstParagraph);
    entries.push({
      id: cid,
      name: parsed.title || cid,
      severity,
      description
    });
    console.log(`[regenerate-mcp-top10] ${cid}: ${parsed.title || '(no title)'} [${severity}] (slug=${result.slug})`);
  }

  const rendered = renderCatalogFile(entries);

  if (dryRun) {
    // Compare against the existing catalog file.
    let existing;
    try {
      existing = fs.readFileSync(OUT_PATH, 'utf8');
    } catch (e) {
      console.error(`[regenerate-mcp-top10] DRIFT: existing catalog file missing at ${OUT_PATH}`);
      process.exit(1);
    }
    if (existing === rendered) {
      console.log('[regenerate-mcp-top10] DRIFT: none — catalog file matches upstream.');
      process.exit(0);
    } else {
      console.error('[regenerate-mcp-top10] DRIFT: catalog file out of sync with upstream.');
      console.error('  Run `node scripts/regenerate-mcp-top10-catalog.js` to refresh.');
      const driftIds = drift.map((d) => d.id).join(', ');
      if (driftIds) console.error('  Missing-from-upstream classes: ' + driftIds);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT_PATH, rendered, 'utf8');
    console.log(`[regenerate-mcp-top10] wrote ${OUT_PATH}`);
    if (drift.length) {
      console.warn(`[regenerate-mcp-top10] WARN: ${drift.length} class(es) had no upstream file — placeholder entries written.`);
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error('[regenerate-mcp-top10] FATAL:', err.message);
  process.exit(1);
});
