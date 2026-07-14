// SPDX-License-Identifier: Apache-2.0
// src/compliance/atlas-mapper.js
// MITRE ATLAS v2026.06 — technique mapper (post-observation annotator)
//
// Per ADR-047. Reads events emitted by `src/audit/decision-logger.js`,
// classifies them against the 7 initial ATLAS rule functions, and writes
// a new decision-chain record tagged with the matched ATLAS technique ID(s).
//
// Contract (ADR-047 §"Module shape" + ADR-040 fail-open contract):
//   - READ-ONLY on the input event.
//   - WRITE-ONLY on the annotation chain (via decision-logger.logDecision).
//   - NOT a scanner, NOT a policy decision point.
//   - Per ADR-040 fail-open: a logDecision failure MUST NOT block the
//     originating tool call. The annotation is dropped and the source
//     event remains in the chain untouched.
//
// Initial rule set (ADR-047 §"Initial classification rules"):
//   indirect-injection-fetch          (AML.T0051.001, H)
//   multi-turn-baseline-drift         (AML.T0054, M; K=5/threshold=2σ defaults — untuned)
//   exfil-cookie-parameter            (AML.T0113, M)
//   cookie-replay-attempt             (AML.T0091.001, M)
//   web-ai-c2-relay                   (AML.T0114, M; configurable public-AI-host list)
//   tool-catalog-known-bad-destination (AML.T0108, H)
//   telemetry-c2-relay-indicator      (AML.M0024, H; annotates the M0024 telemetry provenance
//                                      on every other detection — satisfies v2026.06 M0024
//                                      "new required fields for C2-relay detection")
//
// Module docs cite ADR-047 so future maintainers find the spec.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  ATLAS_CATALOG,
  ATLAS_TECHNIQUE_IDS,
  ATLAS_DEFAULT_PUBLIC_AI_HOSTS
} = require('./atlas-catalog');

/**
 * ATLAS Technique Mapper. Per ADR-047.
 *
 * Consumes audit events emitted by `src/audit/decision-logger.js` and
 * emits annotation events tagged with matched MITRE ATLAS technique
 * IDs (e.g. ['AML.T0051.001', 'AML.T0113']). Read-only on the input
 * event; write-only on the output annotation chain.
 *
 * @module compliance/atlas-mapper
 * @license Apache-2.0
 */

// ----------------------------------------------------------------------------
// Types (JSDoc) — referenced from ADR-047 §"Module shape".
// ----------------------------------------------------------------------------

/**
 * @typedef {Object} ATLASAnnotation
 * @property {string} sourceDecisionId  decisionId of the input event
 * @property {string} eventType          e.g. 'tool_dispatch', 'tool_observation',
 *                                        'memory_write', 'identity_signing',
 *                                        'skill_load'
 * @property {string[]} matchedTechniques ATLAS technique IDs
 *                                        (e.g. ['AML.T0051.001','AML.T0113'])
 * @property {Object}  evidence          subset of the source event that
 *                                        triggered the match: { toolId?, target?,
 *                                        parametersHash?, agentId?, role?,
 *                                        parameterKeys? }
 * @property {Object}  classification    { rule: 'indirect-injection-fetch'|'...',
 *                                        confidence: 'H'|'M'|'L',
 *                                        reference: 'AML.Tnnnn#mitigation-Mmmmm' }
 * @property {Object[]} [c2RelayIndicators] v2026.06 M0024 addition: per-detection
 *                                          C2-relay signal descriptors
 *                                          [{ kind: 'public-ai-host', host: '...', ... }]
 * @property {string}  timestamp         ISO 8601
 *
 * @typedef {Object} ATLASCatalogEntry  (see atlas-catalog.js)
 *
 * @typedef {Object} ATLASMapperInstance
 * @property {ATLASCatalogEntry[]} catalog      loaded catalogue
 * @property {string[]}             techniqueIds  flat technique ID list
 * @property {Object}               config        { enableWrites, hostAllowlist,
 *                                                 publicAiHosts, driftWindow,
 *                                                 driftStddev, }
 * @property {Object}               defaultLogger module-level default logger
 * @property {string[]|null}        hostAllowlist  null ⇒ allow unknown host
 * @property {string[]}             publicAiHosts  public-AI-host list for
 *                                                 web-ai-c2-relay rule
 * @property {number}               driftK         Crescendo window (default 5)
 * @property {number}               driftSigma     Crescendo threshold (default 2σ)
 */

// ----------------------------------------------------------------------------
// Default audit logger — pinned to src/audit/decision-logger.js so
// production code resolves the live module. Lazy-required so a busted
// decision-logger (missing file, missing dep) doesn't prevent the
// mapper from being constructed — createATLASMapper treats the
// defaultLogger fetch the same as any other wiring failure: the
// mapper still classifies, but classifyAndLog() will surface the
// underlying error through the fail-open path.
// ----------------------------------------------------------------------------

let _defaultAuditLogger = null;

function defaultAuditLogger() {
  if (_defaultAuditLogger) return _defaultAuditLogger;
  // Lazy require so the module is only loaded if a caller uses the
  // production path (the tests pass their own auditLogger).
  _defaultAuditLogger = require('../audit/decision-logger');
  return _defaultAuditLogger;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Initialise the mapper with a technique-list snapshot.
 *
 * @param {Object} opts
 * @param {string} [opts.catalogPath='<bundled atlas-catalog.js>'] - path to a
 *        JSON-serialised ATLASCatalogEntry[] OR a JS module exporting
 *        ATLAS_CATALOG. When omitted, the bundled catalogue shipped with
 *        this AWARE release is used (per ADR-047 §"Negative / costs").
 * @param {Object} [opts.auditLogger] - override for decision-logger
 *        (used in unit tests with a no-op stub). When omitted the mapper
 *        uses src/audit/decision-logger.js.
 * @param {boolean} [opts.enableWrites=true] - when false, classify() returns
 *        annotations but classifyAndLog() does not write them. Defaults to
 *        true; the tool-observation-proxy gates writes via a separate
 *        `enableATLASAnnotation` config so the test suite can exercise
 *        classify() without disk I/O.
 * @param {string[]} [opts.hostAllowlist] - hosts the indirect-injection-fetch
 *        rule treats as allowlisted. When the rule sees a fetch to a host
 *        not in this list it matches. Empty array ⇒ all hosts match
 *        (default-deny posture); null/undefined ⇒ the rule never matches
 *        (no-op).
 * @param {string[]} [opts.publicAiHosts] - public AI host list for the
 *        web-ai-c2-relay rule (default: chat.openai.com / gemini.google.com
 *        / claude.ai / copilot.microsoft.com / perplexity.ai / you.com).
 *        Operators override this in `src/policies/atlas-host-policy.js`.
 * @param {number} [opts.driftK=5] - Crescendo window (tool-call count) for the
 *        multi-turn-baseline-drift rule. K=5 is the ADR-047 default; tuning
 *        is a v1.1 concern (ADR-047 §"Open questions for reviewer" #3).
 * @param {number} [opts.driftSigma=2] - Crescendo threshold (standard
 *        deviations from the agent's behavioral baseline). σ=2 is the
 *        ADR-047 default; UNTUNED until labelled data exists.
 * @returns {ATLASMapperInstance}
 * @throws {Error} with code 'ATLAS_CATALOG_UNAVAILABLE' if the catalogue
 *         cannot be loaded or is empty.
 */
function createATLASMapper(opts = {}) {
  const catalog = loadCatalog(opts.catalogPath);

  const hostAllowlist = (opts.hostAllowlist === undefined || opts.hostAllowlist === null)
    ? null
    : Array.isArray(opts.hostAllowlist) ? opts.hostAllowlist : null;

  const publicAiHosts = Array.isArray(opts.publicAiHosts) && opts.publicAiHosts.length > 0
    ? opts.publicAiHosts.slice()
    : ATLAS_DEFAULT_PUBLIC_AI_HOSTS.slice();

  return {
    catalog,
    techniqueIds: catalog.map((e) => e.id),
    config: {
      enableWrites: opts.enableWrites !== false,
      hostAllowlist: opts.hostAllowlist || null,
      publicAiHosts: publicAiHosts.slice(),
      driftK: Number.isFinite(opts.driftK) ? opts.driftK : 5,
      driftSigma: Number.isFinite(opts.driftSigma) ? opts.driftSigma : 2
    },
    defaultLogger: opts.auditLogger || defaultAuditLogger(),
    hostAllowlist,
    publicAiHosts,
    driftK: Number.isFinite(opts.driftK) ? opts.driftK : 5,
    driftSigma: Number.isFinite(opts.driftSigma) ? opts.driftSigma : 2
  };
}

// ----------------------------------------------------------------------------
// Catalogue load
// ----------------------------------------------------------------------------

function loadCatalog(catalogPath) {
  // Default: bundled catalogue.
  if (!catalogPath) {
    if (!Array.isArray(ATLAS_CATALOG) || ATLAS_CATALOG.length === 0) {
      throw withCode(
        new Error('Bundled ATLAS catalogue is empty (this AWARE build is misconfigured)'),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
    return ATLAS_CATALOG.slice();
  }

  // Resolve the file. Two flavours are accepted:
  //   - JSON: an array of ATLASCatalogEntry-like objects.
  //   - JS module: exports ATLAS_CATALOG (or ATLAS_CATALOG named export).
  let entries;
  const absolute = path.isAbsolute(catalogPath)
    ? catalogPath
    : path.resolve(process.cwd(), catalogPath);

  if (!fs.existsSync(absolute)) {
    throw withCode(
      new Error(`ATLAS catalogue not found at ${absolute}`),
      'ATLAS_CATALOG_UNAVAILABLE'
    );
  }

  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.json') {
    try {
      const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      entries = Array.isArray(raw) ? raw : raw.ATLAS_CATALOG;
    } catch (err) {
      throw withCode(
        new Error(`ATLAS catalogue JSON at ${absolute} is malformed: ${err.message}`),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
  } else {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(absolute);
      entries = Array.isArray(mod) ? mod : (mod.ATLAS_CATALOG || mod.default);
    } catch (err) {
      throw withCode(
        new Error(`ATLAS catalogue module at ${absolute} failed to load: ${err.message}`),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw withCode(
      new Error(`ATLAS catalogue at ${absolute} is empty or not an array`),
      'ATLAS_CATALOG_UNAVAILABLE'
    );
  }

  // Light validation — every entry needs id, name, platforms, maturity,
  // reference (the format v6.0.0 mandatory shape).
  const VALID_PLATFORMS = new Set(['Predictive AI', 'Generative AI', 'Agentic AI', 'Enterprise']);
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.reference !== 'string') {
      throw withCode(
        new Error(`ATLAS catalogue at ${absolute} has malformed entry (need id/name/reference)`),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
    if (!Array.isArray(e.platforms) || e.platforms.length === 0) {
      throw withCode(
        new Error(`ATLAS catalogue at ${absolute} entry ${e.id} missing required 'platforms' field (format v6.0.0 mandatory)`),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
    for (const p of e.platforms) {
      if (!VALID_PLATFORMS.has(p)) {
        throw withCode(
          new Error(`ATLAS catalogue at ${absolute} entry ${e.id} has unknown platform '${p}' (must be one of ${[...VALID_PLATFORMS].join(' / ')})`),
          'ATLAS_CATALOG_UNAVAILABLE'
        );
      }
    }
    if (typeof e.maturity !== 'string') {
      throw withCode(
        new Error(`ATLAS catalogue at ${absolute} entry ${e.id} missing 'maturity' field`),
        'ATLAS_CATALOG_UNAVAILABLE'
      );
    }
  }

  return entries;
}

function withCode(err, code) {
  err.code = code;
  return err;
}

// ----------------------------------------------------------------------------
// Pure classifier — runs the 7 rules.
// ----------------------------------------------------------------------------

/**
 * Classify a single audit event and return the matched annotations.
 * Pure function: no side effects. classifyAndLog() handles persistence.
 *
 * @param {ATLASMapperInstance} mapper
 * @param {Object} event  - a decision-chain record (shape per decision-logger.js)
 * @returns {ATLASAnnotation[]}
 */
function classify(mapper, event) {
  // Deep-copy nothing — the rule functions read structured fields only.
  if (!event || typeof event !== 'object') return [];

  const action = event.action || {};
  const actionType = action.type;
  const toolId = action.toolId || null;
  const target = action.target || null;
  const parameters = action.parameters || {};
  const parameterKeys = Object.keys(parameters || {});

  const matched = [];

  // Rule 1 — indirect-injection-fetch (AML.T0051.001, H).
  // tool_dispatch AND toolId is web_fetch/http_get AND parameters.url's
  // host is NOT in hostAllowlist. Twin of the AST10
  // untrusted-instruction-fetch rule (ADR-043); the same event triggers
  // both annotations, both pointing at the same parentDecisionId.
  if (actionType === 'tool_dispatch' && isFetchTool(toolId) && parameters.url) {
    const url = parseUrlSafe(parameters.url);
    if (url && hostAllowlistConfigured(mapper) && !isHostAllowlisted(mapper, url.hostname)) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'indirect-injection-fetch',
        techniques: ['AML.T0051.001'],
        confidence: 'H',
        reference: 'AML.T0051.001#mitigation-AML.M0020',
        evidence: {
          toolId,
          target,
          parametersHash: hashOf(parameters),
          parameterKeys
        }
      }));
    }
  }

  // Rule 2 — multi-turn-baseline-drift (AML.T0054, M; UNTUNED).
  // tool_dispatch AND the dispatched tool/parameters drift more than N
  // standard deviations from the agent's behavioral-baseline window AND
  // the drift trend is monotonic over the last K tool calls. Tuning K
  // (default 5) and the drift threshold (default 2σ) is a v1.1 concern
  // per ADR-047 §"Open questions for reviewer" #3 — UNTUNED until
  // labelled data exists.
  //
  // Signature for the rule:
  //   parameters.behavioralBaselineDrift: { magnitude: number, trend: 'up'|'down'|'flat' }
  //   event.context.recentDispatches: Array<{ magnitude: number, trend: 'up'|'down'|'flat' }>
  //
  // We intentionally do NOT synthesise the drift signal inside the mapper
  // — the behavioral-baseline component (src/policies/) is the producer.
  // The mapper consumes the producer's output and decides whether the
  // rule fires. If no producer ran (no `behavioralBaselineDrift` on
  // parameters AND no `recentDispatches` on context), the rule is a no-op.
  if (actionType === 'tool_dispatch' && isCrescendoSignalPresent(event)) {
    const k = mapper.driftK;
    const sigma = mapper.driftSigma;
    const recent = Array.isArray(event.context && event.context.recentDispatches)
      ? event.context.recentDispatches
      : [];
    if (passesCrescendoGate(event, recent, sigma, k)) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'multi-turn-baseline-drift',
        techniques: ['AML.T0054'],
        confidence: 'M',
        reference: 'AML.T0054#mitigation-AML.M0020',
        evidence: {
          toolId,
          target,
          parametersHash: hashOf(parameters),
          driftMagnitude: (parameters.behavioralBaselineDrift && parameters.behavioralBaselineDrift.magnitude) || null,
          driftTrend: (parameters.behavioralBaselineDrift && parameters.behavioralBaselineDrift.trend) || null,
          windowSize: recent.length,
          windowSizeCap: k,
          sigma,
          note: 'UNTUNED — defaults per ADR-047 §"Open questions" #3'
        }
      }));
    }
  }

  // Rule 3 — exfil-cookie-parameter (AML.T0113, M).
  // tool_dispatch AND parameters contain a key matching
  // /^(cookie|set-cookie|session_?id|auth_?token)$/i AND toolId is NOT
  // in the `network` capability set. Tool-call surface only — actual
  // cookie theft (browser memory scrape, XSS) is above the observation
  // layer.
  if (actionType === 'tool_dispatch' && matchesCookieParameterKey(parameterKeys) && !isNetworkTool(toolId)) {
    matched.push(buildAnnotation({
      mapper,
      event,
      rule: 'exfil-cookie-parameter',
      techniques: ['AML.T0113'],
      confidence: 'M',
      reference: 'AML.T0113#mitigation-AML.M0024',
      evidence: {
        toolId,
        target,
        parametersHash: hashOf(parameters),
        parameterKeys: parameterKeys.filter(matchesCookieParameterKey)
      }
    }));
  }

  // Rule 4 — cookie-replay-attempt (AML.T0091.001, M).
  // tool_dispatch AND parameters contain a `Cookie` or `Authorization`
  // header AND the request host is not in the agent's origin set. Same
  // shape as untrusted-instruction but on a different field. We treat
  // the agent's "origin set" as the hostAllowlist (operators configure
  // it; when absent, the rule is a no-op).
  if (actionType === 'tool_dispatch' && hasAuthorizationHeader(parameters)) {
    const url = parseUrlSafe(parameters.url || target);
    if (url && hostAllowlistConfigured(mapper) && !isHostAllowlisted(mapper, url.hostname)) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'cookie-replay-attempt',
        techniques: ['AML.T0091.001'],
        confidence: 'M',
        reference: 'AML.T0091.001#mitigation-AML.M0024',
        evidence: {
          toolId,
          target,
          parametersHash: hashOf(parameters),
          parameterKeys,
          host: url.hostname
        }
      }));
    }
  }

  // Rule 5 — web-ai-c2-relay (AML.T0114, M).
  // tool_dispatch AND target host matches the public-AI-host list AND
  // the calling agent is not on the policy allowlist for that host.
  // Operators override the publicAiHosts list via
  // `src/policies/atlas-host-policy.js`.
  if (actionType === 'tool_dispatch' && parameters.url) {
    const url = parseUrlSafe(parameters.url);
    if (url && isPublicAiHost(mapper, url.hostname)) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'web-ai-c2-relay',
        techniques: ['AML.T0114'],
        confidence: 'M',
        reference: 'AML.T0114#mitigation-AML.M0024',
        evidence: {
          toolId,
          target,
          parametersHash: hashOf(parameters),
          host: url.hostname
        },
        c2RelayIndicators: [{ kind: 'public-ai-host', host: url.hostname }]
      }));
    }
  }

  // Rule 6 — tool-catalog-known-bad-destination (AML.T0108, H).
  // tool_dispatch AND target is on the tool-catalog known-bad
  // destination list. The tool-catalog is the authoritative source;
  // the rule signals via parameters.knownBadDestination === true OR
  // event.context.toolCatalogDecision === 'BLOCKED_KNOWN_BAD'. When
  // neither flag is set, the rule is a no-op (we don't duplicate the
  // tool-catalog machinery here — we just emit the annotation).
  if (actionType === 'tool_dispatch' && isKnownBadDestination(event, parameters, target)) {
    matched.push(buildAnnotation({
      mapper,
      event,
      rule: 'tool-catalog-known-bad-destination',
      techniques: ['AML.T0108'],
      confidence: 'H',
      reference: 'AML.T0108#mitigation-tool-access-control',
      evidence: {
        toolId,
        target,
        parametersHash: hashOf(parameters),
        source: (parameters.knownBadDestination && 'parameters.knownBadDestination')
          || ((event.context && event.context.toolCatalogDecision === 'BLOCKED_KNOWN_BAD') && 'context.toolCatalogDecision')
          || 'unknown'
      }
    }));
  }

  // Rule 7 — telemetry-c2-relay-indicator (AML.M0024, H).
  // Per ADR-047 §"Initial classification rules": "this is not a
  // detector — it's an 'annotate the M0024 telemetry provenance on
  // every other detection' rule, satisfying the v2026.06 M0024 update
  // requirement that C2-relay detections carry the telemetry context".
  //
  // Implementation: when ANY of the rules 1-6 fires on the same event,
  // emit an additional M0024 annotation carrying the C2-relay
  // indicators aggregated across the upstream detections.
  if (matched.length > 0) {
    const c2RelayIndicators = collectC2RelayIndicators(matched);
    matched.push(buildAnnotation({
      mapper,
      event,
      rule: 'telemetry-c2-relay-indicator',
      techniques: ['AML.M0024'],
      confidence: 'H',
      reference: 'AML.M0024#mitigation-telemetry-context',
      evidence: {
        toolId,
        target,
        parametersHash: hashOf(parameters),
        upstreamRuleCount: matched.length
      },
      c2RelayIndicators
    }));
  }

  return matched;
}

// ----------------------------------------------------------------------------
// Rule helpers
// ----------------------------------------------------------------------------

function isFetchTool(toolId) {
  if (!toolId) return false;
  return /^(web_fetch|http_get|fetch_url|http_request|curl|web_get)$/i.test(String(toolId));
}

function isNetworkTool(toolId) {
  // Conservative: anything explicitly named as a network tool. Operators
  // can extend this list. Per ADR-047 §"Initial classification rules",
  // the rule is "toolId is NOT in the `network` capability set" — when
  // unknown, default to "not network" so the rule fires (fail-open
  // posture; false positives are surfaceable via the `confidence` field).
  if (!toolId) return false;
  return /^(http_get|web_fetch|http_post|http_request|fetch_url|curl|wget|httpie|socket|sockets|http_client)$/i.test(String(toolId));
}

function matchesCookieParameterKey(keys) {
  if (!Array.isArray(keys)) return false;
  const re = /^(cookie|set-cookie|session_?id|auth_?token)$/i;
  return keys.some((k) => re.test(String(k)));
}

function hasAuthorizationHeader(parameters) {
  if (!parameters || typeof parameters !== 'object') return false;
  // Direct top-level `headers` shape (most common).
  if (parameters.headers && typeof parameters.headers === 'object') {
    const h = parameters.headers;
    if (h.Cookie || h.cookie || h.Authorization || h.authorization) return true;
  }
  // Some tool wrappers flatten the header into `Cookie`/`Authorization`
  // top-level keys. Match those too.
  if (parameters.Cookie || parameters.cookie || parameters.Authorization || parameters.authorization) return true;
  return false;
}

function isPublicAiHost(mapper, hostname) {
  if (!hostname || !Array.isArray(mapper.publicAiHosts)) return false;
  return mapper.publicAiHosts.includes(hostname);
}

function isKnownBadDestination(event, parameters, target) {
  if (parameters && parameters.knownBadDestination === true) return true;
  if (event && event.context && event.context.toolCatalogDecision === 'BLOCKED_KNOWN_BAD') return true;
  // Target string match against a small embedded list of obvious-bad
  // forms — operators override via parameters.knownBadDestination /
  // context.toolCatalogDecision when the full tool-catalog is wired.
  if (typeof target === 'string') {
    const lower = target.toLowerCase();
    if (lower.includes('malicious') || lower.includes('c2-channel') || lower.includes('known-bad')) return true;
  }
  return false;
}

function hostAllowlistConfigured(mapper) {
  // Allowlist is opt-in: when no list is configured the rule never
  // fires (the mapper's hostAllowlist property is null).
  return mapper && Array.isArray(mapper.hostAllowlist);
}

function isHostAllowlisted(mapper, hostname) {
  if (!mapper || !Array.isArray(mapper.hostAllowlist)) return false;
  return mapper.hostAllowlist.includes(hostname);
}

function parseUrlSafe(url) {
  try {
    return new URL(String(url));
  } catch (_) {
    return null;
  }
}

function isCrescendoSignalPresent(event) {
  // The producer (behavioral-baseline component) attaches the drift
  // signal either on `parameters.behavioralBaselineDrift` (single
  // tool_dispatch) OR on `context.recentDispatches` (window view).
  if (!event || typeof event !== 'object') return false;
  const params = (event.action && event.action.parameters) || {};
  if (params.behavioralBaselineDrift && typeof params.behavioralBaselineDrift === 'object') return true;
  if (event.context && Array.isArray(event.context.recentDispatches) && event.context.recentDispatches.length > 0) return true;
  return false;
}

function passesCrescendoGate(event, recent, sigma, k) {
  const params = (event.action && event.action.parameters) || {};
  const drift = params.behavioralBaselineDrift || {};
  const magnitude = Number(drift.magnitude);
  const trend = String(drift.trend || '').toLowerCase();
  if (!Number.isFinite(magnitude)) return false;
  if (magnitude < sigma) return false;
  // Monotonic trend over the last K dispatches. When the producer
  // attached recentDispatches, we verify the trend direction matches
  // the gate; when it didn't, we trust the producer's per-event
  // `trend` annotation as the monotone verdict.
  if (recent.length >= 2) {
    const slice = recent.slice(-Math.max(2, k));
    const dir = monotonicDirection(slice);
    if (trend === 'up' && dir !== 'up') return false;
    if (trend === 'down' && dir !== 'down') return false;
  } else {
    if (trend !== 'up' && trend !== 'down') return false;
  }
  return true;
}

function monotonicDirection(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  let up = true;
  let down = true;
  for (const s of samples) {
    const m = Number(s && s.magnitude);
    if (!Number.isFinite(m)) return null;
  }
  for (let i = 1; i < samples.length; i++) {
    const prev = Number(samples[i - 1].magnitude);
    const cur = Number(samples[i].magnitude);
    if (cur <= prev) up = false;
    if (cur >= prev) down = false;
  }
  if (up) return 'up';
  if (down) return 'down';
  return 'flat';
}

function collectC2RelayIndicators(matchedAnnotations) {
  const out = [];
  for (const ann of matchedAnnotations) {
    if (Array.isArray(ann.c2RelayIndicators)) {
      for (const ind of ann.c2RelayIndicators) out.push(ind);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Annotation builder
// ----------------------------------------------------------------------------

function buildAnnotation({ mapper, event, rule, techniques, confidence, reference, evidence, c2RelayIndicators }) {
  const ann = {
    sourceDecisionId: event.decisionId,
    eventType: event.action && event.action.type ? event.action.type : 'unknown',
    matchedTechniques: techniques.slice(),
    evidence: Object.assign({}, evidence, {
      agentId: (event.actor && event.actor.agentId) || undefined,
      role: (event.actor && event.actor.role) || undefined
    }),
    classification: { rule, confidence, reference },
    timestamp: new Date().toISOString()
  };
  if (Array.isArray(c2RelayIndicators) && c2RelayIndicators.length > 0) {
    ann.c2RelayIndicators = c2RelayIndicators.slice();
  }
  return ann;
}

function hashOf(obj) {
  // Cheap, deterministic, hash-free fingerprint. Real fingerprints live in
  // decision-logger.js; this is just so the route can group by parameter shape
  // without exposing the raw parameter object (PII risk).
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || {});
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 32);
}

// ----------------------------------------------------------------------------
// Write path — classifyAndLog.
// ----------------------------------------------------------------------------

/**
 * Convenience: classify + log to the decision chain.
 * Returns the annotations that were successfully written.
 *
 * Fail-open contract (ADR-040, ADR-047 §"Failure modes"):
 *   - Each annotation is written via mapper.defaultLogger.logDecision().
 *   - A failure to write ONE annotation does NOT block the others AND does
 *     NOT throw to the caller. The annotation is dropped, the source event
 *     remains in the chain (the mapper never mutates source events).
 *   - Errors are caught and surfaced via the optional onError hook (so a
 *     caller can log metrics) without breaking the fail-open contract.
 *
 * @param {ATLASMapperInstance} mapper
 * @param {Object} event
 * @param {Object} [hooks] - { onError?: (annotation, error) => void,
 *                              actor?: { agentId, trustScore } }
 * @returns {Promise<ATLASAnnotation[]>}
 */
async function classifyAndLog(mapper, event, hooks = {}) {
  const annotations = classify(mapper, event);
  if (!mapper.config.enableWrites) return [];
  if (annotations.length === 0) return [];

  const logger = mapper.defaultLogger;
  if (!logger || typeof logger.logDecision !== 'function') {
    // No audit logger wired — fail-open: drop the annotations, don't throw.
    if (typeof hooks.onError === 'function') {
      for (const a of annotations) {
        hooks.onError(a, new Error('No audit logger configured on mapper'));
      }
    }
    return [];
  }

  const written = [];
  let prevHash = null;

  for (const ann of annotations) {
    // Build the decision-chain record. We omit hash; the real
    // decision-logger computes it from the canonical serialisation.
    // We DO pass parentDecisionId = source event's id, as ADR-047
    // §"Module shape" requires.
    const decisionRecord = {
      decisionId: generateUUID(),
      parentDecisionId: ann.sourceDecisionId,
      timestamp: ann.timestamp,
      actor: hooks.actor || {
        agentId: (ann.evidence && ann.evidence.agentId) || 'atlas-mapper',
        trustScore: 1.0
      },
      action: {
        type: 'atlas_annotation',
        target: ann.matchedTechniques.join(','),
        reason: ann.classification.rule,
        annotation: ann
      },
      context: {
        pheromoneScores: {},
        heuristicWeights: {},
        policyId: 'atlas-mapper',
        policyVersion: '1.0.0'
      },
      outcome: {
        success: true,
        latencyMs: 0,
        errorMessage: null
      }
    };
    if (prevHash) {
      decisionRecord.prevHash = prevHash;
    }

    try {
      await logger.logDecision(decisionRecord);
      // For the next iteration, capture whatever the logger assigned.
      // The real logger mutates decisionRecord.hash in place (it sets
      // record.hash = computedHash); we read it back.
      prevHash = decisionRecord.hash || prevHash;
      written.push({
        ...ann,
        decisionId: decisionRecord.decisionId,
        parentDecisionId: decisionRecord.parentDecisionId,
        hash: decisionRecord.hash || null
      });
    } catch (err) {
      // Fail-open: log annotation dropped; source event in chain. No throw.
      if (typeof hooks.onError === 'function') {
        hooks.onError(ann, err);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[atlas-mapper] dropped annotation ${ann.classification.rule}: ${err.message}`);
      }
      // Don't push to `written`; don't update prevHash (chain stays anchored
      // on the last successfully written hash).
    }
  }

  return written;
}

// ----------------------------------------------------------------------------
// Chain-segment backfill — used by the /api/compliance/atlas route to
// attach annotations to historical events.
// ----------------------------------------------------------------------------

/**
 * Bulk-classify a chain segment (between two decisionIds). Used by the
 * /api/compliance/atlas route to backfill annotations for a session.
 *
 * Reads the segment via `mapper.defaultLogger.getChainBetween`. Each event
 * is re-classified through `classify`, then written through `logDecision`
 * with `parentDecisionId` = that event's decisionId. The mapper never
 * mutates the source events it reads.
 *
 * @param {ATLASMapperInstance} mapper
 * @param {string} fromDecisionId
 * @param {string} toDecisionId
 * @returns {Promise<ATLASAnnotation[]>} all annotations written
 */
async function classifyChainSegment(mapper, fromDecisionId, toDecisionId) {
  if (!mapper || !mapper.defaultLogger || typeof mapper.defaultLogger.getChainBetween !== 'function') {
    throw new Error('classifyChainSegment requires a defaultLogger with getChainBetween()');
  }

  const segment = await mapper.defaultLogger.getChainBetween(fromDecisionId, toDecisionId);
  if (!Array.isArray(segment) || segment.length === 0) return [];

  const allWritten = [];
  for (const event of segment) {
    const written = await classifyAndLog(mapper, event);
    allWritten.push(...written);
  }
  return allWritten;
}

// ----------------------------------------------------------------------------
// UUID — keep the mapper self-contained so unit tests don't have to
// patch the real decision-logger just to get fresh ids.
// ----------------------------------------------------------------------------

function generateUUID() {
  // crypto.randomUUID is available in Node ≥ 19; this module targets ≥ 22.
  return crypto.randomUUID();
}

// ----------------------------------------------------------------------------
// Module exports
// ----------------------------------------------------------------------------

module.exports = {
  // Public API (per ADR-047)
  createATLASMapper,
  classify,
  classifyAndLog,
  classifyChainSegment,

  // Helpers exposed for unit tests + future rules.
  loadCatalog,
  ATLAS_TECHNIQUE_IDS,
  ATLAS_DEFAULT_PUBLIC_AI_HOSTS
};