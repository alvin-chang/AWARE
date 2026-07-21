// SPDX-License-Identifier: Apache-2.0
// src/compliance/skill-scanner.js
//
// Vendor-neutral skill-scanner adapter — ADR-048 §5.
//
// Contract (per ADR-048 §5 / §8):
//
//   scan({ artifactPath, artifactHash, manifest, options })
//     → {
//         scanner,           // e.g. 'skillspector' (string, required)
//         scannerVersion,    // pinned at scan-time (string, required)
//         rulesetVersion,    // pinned at scan-time (string, required)
//         artifactHash,      // echoed from input (string, required)
//         verdict,           // 'clean' | 'findings' | 'malicious'
//                           // | 'unproven' | 'unavailable' | 'failed'
//         findings,          // [{ id, kind, severity, message, location? }]
//         status,            // operational status (free-form)
//         scannedAt,         // ISO 8601 timestamp
//         fromCache          // boolean — true when result came from the cache
//       }
//
// Verdict taxonomy:
//   'clean'       — scanner ran, no findings
//   'findings'    — scanner ran, findings present (severity <= 'medium')
//   'malicious'   — scanner flagged content as malicious (AST01 + AST08)
//   'unproven'    — no scanner result AND artifact is NOT on the
//                    hash-verified allowlist (AST01 fires; AST08 does not
//                    because there are no scanner findings)
//   'unavailable' — operational signal: scanner could not run. The
//                    caller (SkillActivationGate) treats this as
//                    fail-closed for new/untrusted skills. NEVER
//                    annotated as AST08 (per ADR-048 §5).
//   'failed'      — scanner ran but errored mid-scan. AST08 fires on
//                    this verdict (pinned fields still required).
//
// Failure modes & rollback:
//   - SKILL_SCAN_UNAVAILABLE is reported via the optional healthHook,
//     not via AST08 annotation. A reviewer looking at the audit chain
//     never sees "AST08 from unavailable" — they see a separate
//     operational event.
//   - Cached results are only valid for artifacts whose (a) hash is on
//     the explicit allowlist AND (b) hash matches the current
//     artifactHash. Any drift invalidates the cache (returns 'unproven'
//     for non-allowlisted, or 'unproven' for allowlisted-but-mismatch
//     — both surface as AST01, never as AST08).
//
// This module is intentionally tiny and synchronous from the
// adapter's POV: the heavy lifting (exec'ing the scanner binary,
// parsing output) lives behind a backend interface so future
// implementations (Cisco skill-scanner, custom YARA rule, etc.) can
// drop in without changing the mapper rules.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Constants — pin the default scanner identity so AST08 evidence is
// reproducible across deploys.
// ----------------------------------------------------------------------------

const DEFAULT_SCANNER = 'skillspector';
const PINNED_SCANNER_VERSION = 'skillspector-v1.0.0';
const PINNED_RULESET_VERSION = 'ruleset-2026.07';

// Maximum time a single scanner invocation may run. Kept tight
// because skill activation is on the hot path of agent startup;
// long-running scans are a separate async job (out of scope here).
const SCAN_TIMEOUT_MS = 5_000;

// Verdict constants — exported so callers (SkillActivationGate, tests)
// can reference them without stringly-typed drift.
const VERDICT = Object.freeze({
  CLEAN: 'clean',
  FINDINGS: 'findings',
  MALICIOUS: 'malicious',
  UNPROVEN: 'unproven',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed'
});

const SEVERITY_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

// ----------------------------------------------------------------------------
// Cache — keyed by (scanner, scannerVersion, rulesetVersion,
// artifactHash). Only valid when the artifactHash is on the allowlist
// at lookup time; if the artifact is not allowlisted at lookup time
// we never serve a cached result (caller must re-scan, and the
// scanner gate will fail-closed anyway).
// ----------------------------------------------------------------------------

function createInMemoryCache() {
  const store = new Map();
  return {
    get({ scanner, scannerVersion, rulesetVersion, artifactHash, allowlist }) {
      if (!allowlist.has(artifactHash)) return null;
      const key = `${scanner}|${scannerVersion}|${rulesetVersion}|${artifactHash}`;
      const hit = store.get(key);
      if (!hit) return null;
      // Defensive: cache entries include fromCache=true. Re-emit with
      // the same shape as a fresh scan.
      return { ...hit, fromCache: true };
    },
    set({ scanner, scannerVersion, rulesetVersion, artifactHash, result }) {
      if (!result || result.verdict === VERDICT.UNAVAILABLE) return; // never cache unavailability
      const key = `${scanner}|${scannerVersion}|${rulesetVersion}|${artifactHash}`;
      store.set(key, { ...result, fromCache: false });
    },
    clear() { store.clear(); },
    size() { return store.size; }
  };
}

// ----------------------------------------------------------------------------
// Default backend — SkillSpector. Lazily invokes an external binary
// when one is configured; otherwise returns 'unavailable' so the
// fail-closed gate fires (per ADR-048 §5).
// ----------------------------------------------------------------------------

function createSkillSpectorBackend({ executable, timeoutMs = SCAN_TIMEOUT_MS, childProcess } = {}) {
  const exec = childProcess || require('child_process');

  async function probeVersion() {
    if (!executable) return null;
    try {
      // Best-effort `--version` probe. SkillSpector's CLI emits a
      // single-line version string. Any non-zero exit / timeout
      // returns null (the caller treats null as 'unavailable').
      const { execFile } = exec;
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), Math.min(timeoutMs, 2_000));
        execFile(executable, ['--version'], { timeout: Math.min(timeoutMs, 2_000) }, (err, stdout) => {
          clearTimeout(timer);
          if (err) return resolve(null);
          const out = String(stdout || '').trim();
          // Anything non-empty counts as a successful probe. The exact
          // shape is implementation-defined; we just need a stable
          // pinned token.
          resolve(out.length > 0 ? out : null);
        });
      });
    } catch (_) {
      return null;
    }
  }

  async function scanArtifact({ artifactPath, manifest }) {
    if (!executable) {
      return { ok: false, reason: 'executable_not_configured' };
    }
    if (!fs.existsSync(artifactPath)) {
      return { ok: false, reason: 'artifact_not_found' };
    }
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
      try {
        exec.execFile(executable, ['scan', '--json', artifactPath], { timeout: timeoutMs }, (err, stdout, stderr) => {
          clearTimeout(timer);
          if (err) {
            // Non-zero exit: surface the stderr tail for diagnostics.
            const tail = String(stderr || '').split('\n').slice(-3).join(' ').trim();
            return resolve({ ok: false, reason: 'scan_failed', detail: tail || err.message });
          }
          try {
            const parsed = JSON.parse(String(stdout || '{}'));
            return resolve({ ok: true, raw: parsed });
          } catch (parseErr) {
            return resolve({ ok: false, reason: 'malformed_output', detail: parseErr.message });
          }
        });
      } catch (spawnErr) {
        clearTimeout(timer);
        resolve({ ok: false, reason: 'spawn_failed', detail: spawnErr.message });
      }
    });
  }

  return { probeVersion, scanArtifact, scanner: DEFAULT_SCANNER };
}

// ----------------------------------------------------------------------------
// Verdict computation — turn a backend raw result into a normalised
// verdict + findings array. Backend-agnostic: any backend that
// returns `{ ok: true, raw: <json> }` or `{ ok: false, reason }` is
// accepted.
// ----------------------------------------------------------------------------

function computeVerdict({ raw, manifest, artifactHash, allowlist }) {
  // Allowlist check first: if the artifact is hash-verified AND on
  // the allowlist, a scan failure is not catastrophic — we still
  // emit 'unproven' (not 'unavailable') so AST01 fires but AST08
  // does not (per ADR-048 §5: cached results only for allowlisted +
  // hash-verified).
  const onAllowlist = allowlist && allowlist.has && allowlist.has(artifactHash);

  // Normalise findings. The backend is expected to emit an array; we
  // tolerate missing arrays and missing severity fields by
  // defaulting to 'low'. AST01 fires on findings with kind ===
  // 'malicious-content' (any severity).
  const rawFindings = (raw && Array.isArray(raw.findings)) ? raw.findings : [];
  const findings = rawFindings
    .filter((f) => f && typeof f === 'object')
    .map((f, idx) => ({
      id: (typeof f.id === 'string' && f.id) || `finding-${idx}-${crypto.createHash('sha1').update(JSON.stringify(f)).digest('hex').slice(0, 8)}`,
      kind: typeof f.kind === 'string' ? f.kind : 'unknown',
      severity: typeof f.severity === 'string' ? f.severity : 'low',
      message: typeof f.message === 'string' ? f.message : '',
      location: typeof f.location === 'string' ? f.location : null
    }));

  const hasMaliciousContent = findings.some((f) => f.kind === 'malicious-content');
  const highestRank = findings.reduce((acc, f) => Math.max(acc, SEVERITY_RANK[f.severity] || 0), -1);
  const highestSeverity = highestRank >= 0
    ? Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === highestRank)
    : null;

  if (hasMaliciousContent || (raw && raw.verdict === 'malicious')) {
    return { verdict: VERDICT.MALICIOUS, findings };
  }
  if (findings.length > 0) {
    // findings present, none malicious — caller still wants the AST08
    // annotation. We do NOT promote to 'malicious' here.
    return { verdict: VERDICT.FINDINGS, findings };
  }
  // No findings. If the manifest has no publisher identity AND the
  // artifact isn't on the hash-verified allowlist, treat the skill as
  // unproven provenance — AST01 fires, AST08 does not.
  if (!onAllowlist) {
    const hasPublisher = manifest && manifest.publisher && manifest.publisher.identity;
    if (!hasPublisher) {
      return { verdict: VERDICT.UNPROVEN, findings: [] };
    }
  }
  return { verdict: VERDICT.CLEAN, findings, highestSeverity };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Create a skill scanner adapter.
 *
 * @param {Object} [opts]
 * @param {string} [opts.executable]            - path to SkillSpector binary
 *                                                (or whichever scanner the
 *                                                backend wraps). Omit
 *                                                for an adapter that
 *                                                always returns
 *                                                'unavailable' (useful
 *                                                in tests).
 * @param {string[]} [opts.allowlist]          - sha256 hex digests of
 *                                                artifacts allowed to
 *                                                skip scanning (cached
 *                                                results only). Empty
 *                                                array = empty
 *                                                allowlist (fail-closed
 *                                                by default).
 * @param {number} [opts.timeoutMs]            - per-scan timeout
 * @param {Object} [opts.childProcess]         - injected for tests
 * @param {Object} [opts.healthHook]           - ({scanner, scannerVersion,
 *                                                reason, detail}) => void
 *                                                invoked when scanner
 *                                                is unavailable (NOT an
 *                                                AST08 annotation)
 * @param {Object} [opts.backend]              - custom backend
 *                                                ({ probeVersion,
 *                                                scanArtifact, scanner })
 *                                                for swapping in
 *                                                another scanner. Defaults
 *                                                to SkillSpector.
 * @param {Object} [opts.cache]                - custom cache (defaults
 *                                                to in-memory)
 * @param {string} [opts.scannerVersion]       - override the pinned
 *                                                scanner version
 *                                                (defaults to the
 *                                                ADR-048 pin)
 * @param {string} [opts.rulesetVersion]       - override the pinned
 *                                                ruleset version
 *                                                (defaults to the
 *                                                ADR-048 pin)
 * @returns {{
 *   scan: (req: Object) => Promise<Object>,
 *   backend: Object,
 *   allowlist: Set<string>,
 *   cache: Object,
 *   scanner: string,
 *   scannerVersion: string,
 *   rulesetVersion: string
 * }}
 */
function createSkillScanner(opts = {}) {
  const backend = opts.backend || createSkillSpectorBackend({
    executable: opts.executable,
    timeoutMs: opts.timeoutMs,
    childProcess: opts.childProcess
  });
  const allowlist = new Set(Array.isArray(opts.allowlist) ? opts.allowlist : []);
  const cache = opts.cache || createInMemoryCache();
  const scanner = (backend && backend.scanner) || DEFAULT_SCANNER;
  const scannerVersion = opts.scannerVersion || PINNED_SCANNER_VERSION;
  const rulesetVersion = opts.rulesetVersion || PINNED_RULESET_VERSION;
  const healthHook = typeof opts.healthHook === 'function' ? opts.healthHook : null;

  // Probe the version ONCE at adapter construction. If the probe
  // fails, the scanner is unavailable for the lifetime of this
  // adapter — fail-closed posture per ADR-048 §5.
  let probeState = 'pending';
  let probeValue = null;
  const probePromise = (async () => {
    try {
      const v = await backend.probeVersion();
      probeValue = v;
      probeState = v ? 'ok' : 'unavailable';
      if (!v && healthHook) {
        healthHook({ scanner, scannerVersion, reason: 'probe_failed' });
      }
    } catch (_) {
      probeState = 'unavailable';
      if (healthHook) {
        healthHook({ scanner, scannerVersion, reason: 'probe_threw' });
      }
    }
  })();

  async function scan(req) {
    if (!req || typeof req !== 'object') {
      throw new TypeError('scan() requires a request object');
    }
    const { artifactPath, artifactHash, manifest, options } = req;
    if (typeof artifactPath !== 'string' || artifactPath.length === 0) {
      throw new TypeError('scan() requires artifactPath (string)');
    }
    if (typeof artifactHash !== 'string' || artifactHash.length === 0) {
      throw new TypeError('scan() requires artifactHash (string) — never trust the caller, always pin');
    }
    const startedAt = new Date().toISOString();

    // Wait for the version probe to complete (cheap; already fired
    // at construction). If the probe failed, we can short-circuit to
    // 'unavailable' — there is no point invoking a scanner whose
    // version we cannot pin.
    await probePromise;
    if (probeState !== 'ok') {
      if (healthHook) {
        healthHook({ scanner, scannerVersion, reason: 'probe_state_unavailable' });
      }
      return {
        scanner,
        scannerVersion,
        rulesetVersion,
        artifactHash,
        verdict: VERDICT.UNAVAILABLE,
        findings: [],
        status: 'scanner_unavailable',
        scannedAt: startedAt,
        fromCache: false
      };
    }

    // Cache check — only valid when the artifact is on the
    // allowlist at lookup time.
    const cached = cache.get({ scanner, scannerVersion, rulesetVersion, artifactHash, allowlist });
    if (cached) return { ...cached, scannedAt: startedAt };

    // Invoke the backend.
    let backendResult;
    try {
      backendResult = await backend.scanArtifact({ artifactPath, manifest });
    } catch (err) {
      if (healthHook) {
        healthHook({ scanner, scannerVersion, reason: 'scan_threw', detail: err.message });
      }
      return {
        scanner,
        scannerVersion,
        rulesetVersion,
        artifactHash,
        verdict: VERDICT.FAILED,
        findings: [],
        status: 'scan_threw:' + err.message,
        scannedAt: startedAt,
        fromCache: false
      };
    }

    if (!backendResult || backendResult.ok !== true) {
      // Backend reported a failure. Surface as 'failed' (AST08 fires)
      // OR 'unavailable' (operational signal only). The decision:
      // 'executable_not_configured' and 'artifact_not_found' are
      // configuration problems — fail-closed via 'unavailable'.
      // Anything else (timeout, spawn failure, malformed output,
      // scan_failed) is a runtime failure — AST08 fires on 'failed'.
      const reason = (backendResult && backendResult.reason) || 'unknown';
      const reasonText = String(reason);
      const isConfig = reasonText.startsWith('executable_not_') || reasonText === 'artifact_not_found';
      if (healthHook) {
        healthHook({
          scanner,
          scannerVersion,
          reason: isConfig ? 'unavailable' : 'failed',
          detail: (backendResult && backendResult.detail) || null
        });
      }
      return {
        scanner,
        scannerVersion,
        rulesetVersion,
        artifactHash,
        verdict: isConfig ? VERDICT.UNAVAILABLE : VERDICT.FAILED,
        findings: [],
        status: reason + ':' + ((backendResult && backendResult.detail) || ''),
        scannedAt: startedAt,
        fromCache: false
      };
    }

    const computed = computeVerdict({
      raw: backendResult.raw,
      manifest,
      artifactHash,
      allowlist
    });

    const result = {
      scanner,
      scannerVersion,
      rulesetVersion,
      artifactHash,
      verdict: computed.verdict,
      findings: computed.findings,
      highestSeverity: computed.highestSeverity || null,
      status: 'ok',
      scannedAt: startedAt,
      fromCache: false
    };

    // Only cache for clean / findings / malicious results. Never
    // cache unavailability or failures (they are operational
    // signals; the next call must re-attempt).
    if (result.verdict !== VERDICT.UNAVAILABLE && result.verdict !== VERDICT.FAILED) {
      cache.set({ scanner, scannerVersion, rulesetVersion, artifactHash, result });
    }

    return result;
  }

  return {
    scan,
    backend,
    allowlist,
    cache,
    scanner,
    scannerVersion,
    rulesetVersion
  };
}

// ----------------------------------------------------------------------------
// SkillActivationGate — the production-side fail-closed policy
// enforcement. Couples the scanner to the AST08 event emitter
// (consumer of this module: ToolObservationProxy / policy layer).
//
// Returns the policy decision the caller should apply BEFORE
// activating the skill:
//
//   { allowed: true,  scanResult }                       — scanner clean or
//                                                          allowlisted cached
//   { allowed: false, reason: 'SCAN_UNAVAILABLE', ... }  — scanner failed
//                                                          AND not on the
//                                                          hash-verified
//                                                          allowlist
//   { allowed: false, reason: 'SCAN_FAILED',    ... }   — scanner ran but
//                                                          errored
//   { allowed: false, reason: 'SCAN_FINDINGS',  ... }   — non-malicious
//                                                          findings present
//                                                          (configurable
//                                                          policy)
//   { allowed: false, reason: 'SCAN_MALICIOUS', ... }    — malicious content
//                                                          detected
//
// AST08/AST01 event emission is the caller's responsibility (the
// proxy / SkillActivationGate wrapper); this module is intentionally
// side-effect-free so it can be unit-tested without touching the
// audit chain.
// ----------------------------------------------------------------------------

function defaultActivationPolicy(scanResult, opts = {}) {
  const allowFindings = opts.allowFindings === true;
  switch (scanResult.verdict) {
    case VERDICT.CLEAN:
      return { allowed: true, scanResult };
    case VERDICT.FINDINGS:
      return allowFindings
        ? { allowed: true, scanResult }
        : { allowed: false, reason: 'SCAN_FINDINGS', scanResult };
    case VERDICT.MALICIOUS:
      return { allowed: false, reason: 'SCAN_MALICIOUS', scanResult };
    case VERDICT.UNPROVEN:
      return { allowed: false, reason: 'SCAN_UNPROVEN', scanResult };
    case VERDICT.UNAVAILABLE:
      // Fail-closed: a NEW / UNTRUSTED skill cannot activate when
      // the scanner is unavailable. An allowlisted + hash-verified
      // artifact may use a cached result (handled at cache.get
      // time — if the cache returned a value it would have been
      // served before reaching this branch).
      return { allowed: false, reason: 'SCAN_UNAVAILABLE', scanResult };
    case VERDICT.FAILED:
      return { allowed: false, reason: 'SCAN_FAILED', scanResult };
    default:
      // Unknown verdict: fail-closed by default.
      return { allowed: false, reason: 'SCAN_UNKNOWN_VERDICT', scanResult };
  }
}

// ----------------------------------------------------------------------------
// Module exports
// ----------------------------------------------------------------------------

module.exports = {
  // Public API
  createSkillScanner,
  defaultActivationPolicy,

  // Constants (useful for tests + downstream code)
  VERDICT,
  DEFAULT_SCANNER,
  PINNED_SCANNER_VERSION,
  PINNED_RULESET_VERSION,

  // Helpers (exported for tests)
  createInMemoryCache,
  createSkillSpectorBackend,
  computeVerdict
};