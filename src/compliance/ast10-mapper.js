// SPDX-License-Identifier: Apache-2.0
// src/compliance/ast10-mapper.js
// OWASP AST10 v1.0-2026 — risk-class mapper (post-observation annotator)
//
// Per ADR-043. Reads events emitted by `src/audit/decision-logger.js`,
// classifies them against the 7 initial AST10 rule functions, and writes
// a new decision-chain record tagged with the matched AST10 risk class.
//
// Contract (ADR-043 §"Decision"):
//   - READ-ONLY on the input event.
//   - WRITE-ONLY on the annotation chain (via decision-logger.logDecision).
//   - NOT a scanner, NOT a policy decision point.
//   - Per ADR-040 fail-open contract: a logDecision failure MUST NOT
//     block the originating tool call. The annotation is dropped and
//     the source event remains in the chain untouched.
//
// Initial rule set (ADR-043 §"Classification rules"):
//   over-privilege-write           (AST03, H)
//   untrusted-instruction-fetch    (AST05, H)
//   manifest-undeclared-network    (AST04, M)
//   denied-before-dispatch         (AST09, H)
//   cross-platform-skill-load      (AST10, M)
//   update-without-pinning         (AST07, M)
//   supply-chain-unknown-publisher (AST02, M)
//
// ADR-048 additions (gap closure — keep the 7 above UNCHANGED):
//   sandbox-boundary-violation     (AST06, H) — `sandbox_policy_decision`
//                                           source events; fires on
//                                           `AWARE_SANDBOX_DENY:` or a
//                                           verified requested/effective
//                                           isolation mismatch.
//   skill-scan-finding             (AST08, H) — `skill_scan_result` source
//                                           events with verdict != clean
//                                           OR scanner=failed. Pinned
//                                           scanner/ruleset/version +
//                                           artifact hash required.
//   malicious-or-unproven-skill    (AST01, H) — same `skill_scan_result`
//                                           event as AST08, distinct
//                                           rule: verdict in {malicious,
//                                           unproven} or finding kind
//                                           matches AST01 taxonomy.
//
// Module docs cite ADR-043 and ADR-048 so future maintainers find the spec.

'use strict';

const fs = require('fs');
const path = require('path');

const { AST10_CATALOG, AST10_CONTROL_IDS } = require('./ast10-catalog');

/**
 * AST10 Risk-Class Mapper. Per ADR-043.
 *
 * Consumes audit events emitted by `src/audit/decision-logger.js` and
 * emits annotation events tagged with the matched OWASP AST10 risk
 * class(es). Read-only on the input event; write-only on the output
 * annotation chain.
 *
 * @module compliance/ast10-mapper
 * @license Apache-2.0
 */

// ----------------------------------------------------------------------------
// Types (JSDoc) — referenced from ADR-043 §"Module shape".
// ----------------------------------------------------------------------------

/**
 * @typedef {Object} AST10Annotation
 * @property {string} sourceDecisionId  decisionId of the input event
 * @property {string} eventType          e.g. 'tool_dispatch', 'tool_observation',
 *                                       'memory_write', 'identity_signing',
 *                                       'skill_load'
 * @property {string[]} matchedClasses   AST10 risk-class IDs (e.g. ['AST03','AST06'])
 * @property {Object}  evidence          { toolId?, target?, parametersHash?,
 *                                        agentId?, role? } — the subset of
 *                                        the source event that triggered the match
 * @property {Object}  classification    { rule: 'over-privilege-write'|...,
 *                                        confidence: 'H'|'M'|'L',
 *                                        reference: 'astNN.md#mitigation-M' }
 * @property {string}  timestamp         ISO 8601
 *
 * @typedef {Object} AST10CatalogEntry  (see ast10-catalog.js)
 *
 * @typedef {Object} AST10MapperInstance
 * @property {AST10CatalogEntry[]} catalog      loaded catalogue
 * @property {string[]}             controlIds   AST10 control IDs
 * @property {Object}               config       { enableWrites, hostAllowlist, auditLogger }
 * @property {Object}               defaultLogger module-level default logger
 * @property {string[]|null}        hostAllowlist null ⇒ allow unknown host
 */

// ----------------------------------------------------------------------------
// Default audit logger — pinned to src/audit/decision-logger.js so
// production code resolves the live module. Lazy-required so a busted
// decision-logger (missing file, missing dep) doesn't prevent the
// mapper from being constructed — createAST10Mapper treats the
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
 * Initialise the mapper with a control-list snapshot.
 *
 * @param {Object} opts
 * @param {string} [opts.catalogPath='<bundled ast10-catalog.js>'] - path to a
 *        JSON-serialised AST10CatalogEntry[] OR a JS module exporting
 *        AST10_CATALOG. When omitted, the bundled catalogue shipped with
 *        this AWARE release is used (per ADR-043 §"Negative / costs").
 * @param {Object} [opts.auditLogger] - override for decision-logger
 *        (used in unit tests with a no-op stub). When omitted the mapper
 *        uses src/audit/decision-logger.js.
 * @param {boolean} [opts.enableWrites=true] - when false, classify()
 *        returns annotations but classifyAndLog() does not write them.
 *        Defaults to true; the tool-observation-proxy gates writes via a
 *        separate `enableAST10Annotation` config so the test suite can
 *        exercise classify() without disk I/O.
 * @param {string[]} [opts.hostAllowlist] - hosts the untrusted-instruction-
 *        fetch rule treats as allowlisted. When the rule sees a fetch to a
 *        host not in this list it matches. Empty array ⇒ all hosts match
 *        (i.e. default-deny posture for the rule); null/undefined ⇒ the
 *        rule never matches (no-op).
 * @returns {AST10MapperInstance}
 * @throws {Error} with code 'AST10_CATALOG_UNAVAILABLE' if the catalogue
 *         cannot be loaded or is empty.
 */
function createAST10Mapper(opts = {}) {
  const catalog = loadCatalog(opts.catalogPath);

  const hostAllowlist = (opts.hostAllowlist === undefined || opts.hostAllowlist === null)
    ? null
    : Array.isArray(opts.hostAllowlist) ? opts.hostAllowlist : null;

  return {
    catalog,
    controlIds: catalog.map((e) => e.id),
    config: {
      enableWrites: opts.enableWrites !== false,
      hostAllowlist: opts.hostAllowlist || null
    },
    defaultLogger: opts.auditLogger || defaultAuditLogger(),
    hostAllowlist
  };
}

// ----------------------------------------------------------------------------
// Catalogue load
// ----------------------------------------------------------------------------

function loadCatalog(catalogPath) {
  // Default: bundled catalogue.
  if (!catalogPath) {
    if (!Array.isArray(AST10_CATALOG) || AST10_CATALOG.length === 0) {
      throw withCode(
        new Error('Bundled AST10 catalogue is empty (this AWARE build is misconfigured)'),
        'AST10_CATALOG_UNAVAILABLE'
      );
    }
    return AST10_CATALOG.slice();
  }

  // Resolve the file. Two flavours are accepted:
  //   - JSON: an array of AST10CatalogEntry-like objects.
  //   - JS module: exports AST10_CATALOG (or AST10_CATALOG named export).
  let entries;
  const absolute = path.isAbsolute(catalogPath)
    ? catalogPath
    : path.resolve(process.cwd(), catalogPath);

  if (!fs.existsSync(absolute)) {
    throw withCode(
      new Error(`AST10 catalogue not found at ${absolute}`),
      'AST10_CATALOG_UNAVAILABLE'
    );
  }

  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.json') {
    try {
      const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      entries = Array.isArray(raw) ? raw : raw.AST10_CATALOG;
    } catch (err) {
      throw withCode(
        new Error(`AST10 catalogue JSON at ${absolute} is malformed: ${err.message}`),
        'AST10_CATALOG_UNAVAILABLE'
      );
    }
  } else {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(absolute);
      entries = Array.isArray(mod) ? mod : (mod.AST10_CATALOG || mod.default);
    } catch (err) {
      throw withCode(
        new Error(`AST10 catalogue module at ${absolute} failed to load: ${err.message}`),
        'AST10_CATALOG_UNAVAILABLE'
      );
    }
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw withCode(
      new Error(`AST10 catalogue at ${absolute} is empty or not an array`),
      'AST10_CATALOG_UNAVAILABLE'
    );
  }

  // Light validation — every entry needs id, name, severity.
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.severity !== 'string') {
      throw withCode(
        new Error(`AST10 catalogue at ${absolute} has malformed entry (need id/name/severity)`),
        'AST10_CATALOG_UNAVAILABLE'
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
 * @param {AST10MapperInstance} mapper
 * @param {Object} event  - a decision-chain record (shape per decision-logger.js)
 * @returns {AST10Annotation[]}
 */
function classify(mapper, event) {
  // Deep-copy nothing — the rule functions read structured fields only.
  if (!event || typeof event !== 'object') return [];

  const action = event.action || {};
  const actionType = action.type;
  const toolId = action.toolId || null;
  const target = action.target || null;
  const parameters = action.parameters || {};

  const matched = [];

  // Rule 1 — over-privilege-write (AST03, H).
  if (actionType === 'tool_dispatch' && matchesSensitiveWriteTarget(target)) {
    matched.push(buildAnnotation({
      mapper,
      event,
      rule: 'over-privilege-write',
      classes: ['AST03'],
      confidence: 'H',
      reference: 'ast03.md#mitigation-3',
      evidence: { toolId, target, parametersHash: hashOf(parameters) }
    }));
  }

  // Rule 2 — untrusted-instruction-fetch (AST05, H).
  if (actionType === 'tool_dispatch' && isFetchTool(toolId) && parameters.url) {
    const url = parseUrlSafe(parameters.url);
    if (url && hostAllowlistConfigured(mapper) && !isHostAllowlisted(mapper, url.hostname)) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'untrusted-instruction-fetch',
        classes: ['AST05'],
        confidence: 'H',
        reference: 'ast05.md#mitigation-fetch-allowlist',
        evidence: { toolId, target, parametersHash: hashOf(parameters) }
      }));
    }
  }

  // Rule 3 — manifest-undeclared-network (AST04, M).
  if (actionType === 'tool_dispatch' && isShellTool(toolId)) {
    const cmdText = String(parameters.command || parameters.script || '');
    if (referencesNetworkTool(cmdText)) {
      const skill = parameters.skill || {};
      const declaredNetwork = (skill.permissions && skill.permissions.network === true);
      if (!declaredNetwork) {
        matched.push(buildAnnotation({
          mapper,
          event,
          rule: 'manifest-undeclared-network',
          classes: ['AST04'],
          confidence: 'M',
          reference: 'ast04.md#mitigation-manifest-network',
          evidence: { toolId, target, parametersHash: hashOf(parameters) }
        }));
      }
    }
  }

  // Rule 4 — denied-before-dispatch (AST09, H).
  if (event.outcome && event.outcome.success === false) {
    const err = String(event.outcome.errorMessage || '');
    if (err.startsWith('AWARE_DENY:')) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'denied-before-dispatch',
        classes: ['AST09'],
        confidence: 'H',
        reference: 'ast09.md#execution-receipt',
        evidence: { toolId, target, parametersHash: hashOf(parameters) }
      }));
    }
  }

  // Rule 5 — cross-platform-skill-load (AST10, M).
  if (actionType === 'skill_load') {
    matched.push(buildAnnotation({
      mapper,
      event,
      rule: 'cross-platform-skill-load',
      classes: ['AST10'],
      confidence: 'M',
      reference: 'ast10.md#mitigation-origin-tag',
      evidence: { target, parametersHash: hashOf(parameters) }
    }));
  }

  // Rule 6 — update-without-pinning (AST07, M).
  if (actionType === 'skill_load') {
    const manifest = action.manifest || {}; // hook may put manifest on action.manifest OR parameters.manifest
    const m2 = (manifest && typeof manifest === 'object') ? manifest : (parameters.manifest || {});
    if (!m2.content_hash) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'update-without-pinning',
        classes: ['AST07'],
        confidence: 'M',
        reference: 'ast07.md#mitigation-content-hash',
        evidence: { target, parametersHash: hashOf(parameters) }
      }));
    }
  }

  // Rule 7 — supply-chain-unknown-publisher (AST02, M).
  if (actionType === 'skill_load') {
    const actor = event.actor || {};
    if (!actor.publisherKey) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'supply-chain-unknown-publisher',
        classes: ['AST02'],
        confidence: 'M',
        reference: 'ast02.md#mitigation-publisher-key',
        evidence: { agentId: actor.agentId, target, parametersHash: hashOf(parameters) }
      }));
    }
  }

  // ------------------------------------------------------------------
  // ADR-048 additions — these rules close the AST06 / AST08 / AST01
  // gaps. The seven above MUST remain unchanged for backwards compat
  // (existing test fixtures + chain-link integrity rely on them).
  // ------------------------------------------------------------------

  // Rule 8 — sandbox-boundary-violation (AST06, H).
  // Source event: action.type === 'sandbox_policy_decision' (produced by
  // ToolObservationProxy OR a sandbox-policies module). Fires on:
  //   (a) explicit AWARE_SANDBOX_DENY: denial in outcome.errorMessage
  //       OR action.reason, OR
  //   (b) a verified requested-vs-effective isolation mismatch where
  //       action.parameters.requestedNamespace !== action.parameters.effectiveNamespace
  //       AND the request was NOT explicitly allowlisted for fall-through.
  // The proxy / sandbox policy retain their own configured fail policy;
  // annotation is fail-open per ADR-040 (a write failure does not block
  // the originating tool call).
  if (actionType === 'sandbox_policy_decision') {
    const sandboxParams = parameters || {};
    const errMsg = String((event.outcome && event.outcome.errorMessage) || action.reason || '');
    const denied = errMsg.startsWith('AWARE_SANDBOX_DENY:');
    const requestedNs = sandboxParams.requestedNamespace;
    const effectiveNs = sandboxParams.effectiveNamespace;
    const allowMismatch = sandboxParams.allowMismatch === true;
    const mismatch = (
      typeof requestedNs === 'string' &&
      typeof effectiveNs === 'string' &&
      requestedNs !== effectiveNs &&
      !allowMismatch
    );
    if (denied || mismatch) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'sandbox-boundary-violation',
        classes: ['AST06'],
        confidence: 'H',
        reference: 'ast06.md#mitigation-namespace-boundary',
        evidence: {
          toolId: action.toolId || null,
          target,
          parametersHash: hashOf(parameters),
          sandboxProfile: sandboxParams.sandboxProfile || null,
          requestedNamespace: requestedNs || null,
          effectiveNamespace: effectiveNs || null,
          hostEscapeCapability: Array.isArray(sandboxParams.hostEscapeCapabilities)
            ? sandboxParams.hostEscapeCapabilities.slice()
            : []
        }
      }));
    }
  }

  // Rule 9 — skill-scan-finding (AST08, H).
  // Source event: action.type === 'skill_scan_result' (produced by
  // src/compliance/skill-scanner.js via the SkillActivationGate or the
  // tool-observation-proxy). Fires when the scanner verdict is not
  // 'clean' — i.e. 'findings' (non-clean scanner result), 'malicious'
  // (scanner flagged malicious content; AST01 fires in parallel), or
  // 'failed' (scanner errored). Pinned scanner + scannerVersion +
  // rulesetVersion + artifactHash are required: if any are missing the
  // rule does NOT fire (so a caller can never ship an un-pinned AST08
  // annotation by accident).
  if (actionType === 'skill_scan_result') {
    const scanParams = parameters || {};
    const scanner = scanParams.scanner;
    const scannerVersion = scanParams.scannerVersion;
    const rulesetVersion = scanParams.rulesetVersion;
    const artifactHash = scanParams.artifactHash;
    const verdict = scanParams.verdict;
    const findings = Array.isArray(scanParams.findings) ? scanParams.findings : [];
    const pinned = !!(scanner && scannerVersion && rulesetVersion && artifactHash);
    const trigger = (verdict === 'findings' || verdict === 'malicious' || verdict === 'failed');
    if (pinned && trigger) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'skill-scan-finding',
        classes: ['AST08'],
        confidence: verdict === 'failed' ? 'H' : 'H',
        reference: 'ast08.md#mitigation-pinned-scanner',
        evidence: {
          toolId: action.toolId || null,
          target,
          parametersHash: hashOf(parameters),
          scanner,
          scannerVersion,
          rulesetVersion,
          artifactHash,
          findingIds: findings.map((f) => (f && f.id) || null).filter(Boolean),
          findingSeverities: findings.map((f) => (f && f.severity) || null).filter(Boolean),
          verdict
        }
      }));
    }
  }

  // Rule 10 — malicious-or-unproven-skill (AST01, H).
  // Shares the same `skill_scan_result` source event as Rule 9, but
  // targets a different risk class: malicious content OR an unproven
  // publisher/provenance. Fires when:
  //   (a) verdict === 'malicious' (any scanner finding classified as
  //       malicious-content), OR
  //   (b) verdict === 'unproven' (no publisher identity AND not on the
  //       pre-baked allowlist of hash-verified artifacts), OR
  //   (c) at least one finding has `kind === 'malicious-content'`.
  // Same pinning requirements as Rule 9. The two rules (AST01 + AST08)
  // intentionally share the source event so the chain carries both
  // annotations side-by-side on the same decision record.
  if (actionType === 'skill_scan_result') {
    const scanParams = parameters || {};
    const scanner = scanParams.scanner;
    const scannerVersion = scanParams.scannerVersion;
    const rulesetVersion = scanParams.rulesetVersion;
    const artifactHash = scanParams.artifactHash;
    const verdict = scanParams.verdict;
    const findings = Array.isArray(scanParams.findings) ? scanParams.findings : [];
    const pinned = !!(scanner && scannerVersion && rulesetVersion && artifactHash);
    const hasMaliciousFinding = findings.some((f) => f && f.kind === 'malicious-content');
    const trigger = (verdict === 'malicious' || verdict === 'unproven' || hasMaliciousFinding);
    if (pinned && trigger) {
      matched.push(buildAnnotation({
        mapper,
        event,
        rule: 'malicious-or-unproven-skill',
        classes: ['AST01'],
        confidence: 'H',
        reference: 'ast01.md#mitigation-publisher-or-content',
        evidence: {
          toolId: action.toolId || null,
          target,
          parametersHash: hashOf(parameters),
          scanner,
          scannerVersion,
          rulesetVersion,
          artifactHash,
          publisherIdentity: scanParams.publisherIdentity || null,
          verdict
        }
      }));
    }
  }

  return matched;
}

function matchesSensitiveWriteTarget(target) {
  if (!target) return false;
  // Per ADR-043 rule table: `*AGENTS.md`, `*SOUL.md`, `*MEMORY.md`.
  // We check the basename substring (case-insensitive) so paths like
  // <profile-dir>/AGENTS.md, ./SOUL.md, ./MEMORY.md all match,
  // and /tmp/AGENTS.md.bak does NOT match the canonical definition
  // (the ADR lists them as suffixes, but slash boundaries are implicit
  // because we anchor on the basename).
  const basename = String(target).split(/[\\/]/).pop() || '';
  const lower = basename.toLowerCase();
  return lower === 'agents.md' || lower === 'soul.md' || lower === 'memory.md';
}

function isFetchTool(toolId) {
  if (!toolId) return false;
  return /^(web_fetch|http_get|fetch_url|http_request|curl|web_get)$/i.test(String(toolId));
}

function isShellTool(toolId) {
  if (!toolId) return false;
  return /^(exec|shell|bash|sh|run_command|terminal)$/i.test(String(toolId));
}

function referencesNetworkTool(cmdText) {
  if (!cmdText) return false;
  // Match standalone tokens so 'curl' inside 'libcurl-dev' is NOT a hit.
  // We use word-boundary regex; function arg may be multiline, so we
  // flatten before matching.
  const flat = String(cmdText).replace(/\s+/g, ' ');
  return /\b(curl|wget|fetch|httpx|httpie)\b/i.test(flat);
}

function parseUrlSafe(url) {
  try {
    return new URL(String(url));
  } catch (_) {
    return null;
  }
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

// ----------------------------------------------------------------------------
// Annotation builder
// ----------------------------------------------------------------------------

function buildAnnotation({ mapper, event, rule, classes, confidence, reference, evidence }) {
  return {
    sourceDecisionId: event.decisionId,
    eventType: event.action && event.action.type ? event.action.type : 'unknown',
    matchedClasses: classes.slice(),
    evidence: Object.assign({}, evidence, {
      agentId: (event.actor && event.actor.agentId) || undefined,
      role: (event.actor && event.actor.role) || undefined
    }),
    classification: { rule, confidence, reference },
    timestamp: new Date().toISOString()
  };
}

function hashOf(obj) {
  // Cheap, deterministic, hash-free fingerprint. Real fingerprints live in
  // decision-logger.js; this is just so the route can group by parameter shape
  // without exposing the raw parameter object (PII risk).
  const crypto = require('crypto');
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
 * Fail-open contract (ADR-040, ADR-043 §"Failure modes"):
 *   - Each annotation is written via mapper.defaultLogger.logDecision().
 *   - A failure to write ONE annotation does NOT block the others AND does
 *     NOT throw to the caller. The annotation is dropped, the source event
 *     remains in the chain (the mapper never mutates source events).
 *   - Errors are caught and surfaced via the optional onError hook (so a
 *     caller can log metrics) without breaking the fail-open contract.
 *
 * @param {AST10MapperInstance} mapper
 * @param {Object} event
 * @param {Object} [hooks] - { onError?: (annotation, error) => void,
 *                              actor?: { agentId, trustScore } }
 * @returns {Promise<AST10Annotation[]>}
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
    // decision-logger computes it from the canonical serialisation
    // (per ADR-internal §Phase 3.3 F-2 fix). We DO pass
    // parentDecisionId = source event's id, as ADR-043 §"API surface"
    // requires — and we put prevHash at the TOP LEVEL (not in action),
    // because decision-logger.logDecision reads prevHash from
    // decision.prevHash via canonicalSerialize.
    const decisionRecord = {
      decisionId: generateUUID(),
      parentDecisionId: ann.sourceDecisionId,
      timestamp: ann.timestamp,
      actor: hooks.actor || {
        agentId: (ann.evidence && ann.evidence.agentId) || 'ast10-mapper',
        trustScore: 1.0
      },
      action: {
        type: 'ast10_annotation',
        target: ann.matchedClasses.join(','),
        reason: ann.classification.rule,
        annotation: ann
      },
      context: {
        pheromoneScores: {},
        heuristicWeights: {},
        policyId: 'ast10-mapper',
        policyVersion: '1.0.0'
      },
      outcome: {
        success: true,
        latencyMs: 0,
        errorMessage: null
      }
    };
    // Set top-level prevHash only after the first hash (i.e. when chaining
    // against a previous annotation emitted by THIS invocation). For the
    // FIRST annotation from a source, we omit prevHash so the real
    // decision-logger uses its stored lastHash (the source event's hash).
    // Tests that fake the logger may pre-initialise via decision.prevHash.
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
        console.warn(`[ast10-mapper] dropped annotation ${ann.classification.rule}: ${err.message}`);
      }
      // Don't push to `written`; don't update prevHash (chain stays anchored
      // on the last successfully written hash).
    }
  }

  return written;
}

// ----------------------------------------------------------------------------
// Chain-segment backfill — used by the /api/compliance/ast10 route to
// attach annotations to historical events.
// ----------------------------------------------------------------------------

/**
 * Bulk-classify a chain segment (between two decisionIds). Used by the
 * /api/compliance/ast10 route to backfill annotations for a session.
 *
 * Reads the segment via `mapper.defaultLogger.getChainBetween`. Each event
 * is re-classified through `classify`, then written through `logDecision`
 * with `parentDecisionId` = that event's decisionId. The mapper never
 * mutates the source events it reads.
 *
 * @param {AST10MapperInstance} mapper
 * @param {string} fromDecisionId
 * @param {string} toDecisionId
 * @returns {Promise<AST10Annotation[]>} all annotations written
 */
async function classifyChainSegment(mapper, fromDecisionId, toDecisionId) {
  if (!mapper || !mapper.defaultLogger || typeof mapper.defaultLogger.getChainBetween !== 'function') {
    throw new Error('classifyChainSegment requires a defaultLogger with getChainBetween()');
  }

  const segment = await mapper.defaultLogger.getChainBetween(fromDecisionId, toDecisionId);
  if (!Array.isArray(segment) || segment.length === 0) return [];

  const allWritten = [];
  for (const event of segment) {
    // Re-classify each event in the segment. The mapper writes a new
    // decision-chain record per annotation, parented at the source event.
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
  return require('crypto').randomUUID();
}

// ----------------------------------------------------------------------------
// Module exports
// ----------------------------------------------------------------------------

module.exports = {
  // Public API (per ADR-043)
  createAST10Mapper,
  classify,
  classifyAndLog,
  classifyChainSegment,

  // Helpers exposed for unit tests + future rules.
  loadCatalog,
  AST10_CONTROL_IDS
};
