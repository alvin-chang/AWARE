/**
 * AWARE × Vaara audit backend adapter (shadow mode).
 *
 * Source spec: t_13d38c3a (parent: t_0eab8376 — AWARE Vaara research).
 *
 * Drop-in replacement for `src/audit/decision-logger.js`. The gateway
 * swaps backends via `AWARE_AUDIT_BACKEND=vaara` (default `file`).
 *
 * Shadow semantics:
 *   - Every gateway tool call is POSTed to Vaara's HTTP API and
 *     recorded in its hash-chained audit trail.
 *   - Verification runs per-record; the AWARE-side decision-chain
 *     entry is stamped `verified=true|false`.
 *   - On verification failure OR upstream unreachable: entry STILL
 *     recorded (with `verified=false` + structured WARN). The tool
 *     call is never blocked.
 *
 * Runtime: zero new deps. Node 22 global fetch. Compatible with the
 * Vaara HTTP API surface that `@vaara/client@1.30.0` wraps
 * (https://www.npmjs.com/package/@vaara/client).
 *
 * @module coordinator/adapters/vaara
 * @license Apache-2.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const GENESIS_HASH = '0'.repeat(64);

function loadConfig(env = process.env) {
  return {
    backend: env.AWARE_AUDIT_BACKEND || 'file',
    vaaraBaseUrl: (env.VAARA_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    verifyTimeoutMs: Number(env.VAARA_VERIFY_TIMEOUT_MS || 5000),
    auditDir: env.AUDIT_DIR || '/data/audit',
    shadow: env.VAARA_SHADOW !== '0',
  };
}

function loadDecisionLogger(auditDir) {
  // Cache key includes auditDir so per-test AUDIT_DIR overrides work.
  process.env.AUDIT_DIR = auditDir;
  const decisionLoggerPath = path.join(__dirname, '..', '..', 'audit', 'decision-logger.js');
  delete require.cache[decisionLoggerPath];
  return require(decisionLoggerPath);
}

async function vaaraFetch(baseUrl, p, init = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${p}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function warn(msg) {
  process.stderr.write(`[vaara-audit] WARN ${msg}\n`);
}

class VaaraAuditBackend {
  constructor(opts = {}) {
    this.cfg = { ...loadConfig(opts.env || process.env), ...opts };
    this.dl = this.cfg.backend === 'file' ? null : loadDecisionLogger(this.cfg.auditDir);
  }

  async logDecision(decision) {
    if (this.cfg.backend === 'file') {
      return loadDecisionLogger(this.cfg.auditDir).logDecision(decision);
    }

    // Validate.
    for (const f of ['decisionId', 'parentDecisionId', 'timestamp',
                     'actor', 'action', 'context', 'outcome']) {
      if (!(f in decision)) throw new Error(`Missing required field: ${f}`);
    }

    // 1. POST event → Vaara receipt.
    let receipt = null, verified = false, vaaraError = null;
    try {
      receipt = await vaaraFetch(this.cfg.vaaraBaseUrl, '/v1/audit/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'action_requested',
          action_id: decision.decisionId,
          agent_id: decision.actor?.agentId || null,
          tool_name: decision.action?.target || null,
          data: decision,
        }),
      }, this.cfg.verifyTimeoutMs);
    } catch (err) {
      vaaraError = err.message;
      warn(`upstream unreachable: ${err.message}`);
    }

    // 2. Verify chain.
    if (receipt) {
      try {
        const v = await vaaraFetch(this.cfg.vaaraBaseUrl, '/v1/audit/verify',
          {}, this.cfg.verifyTimeoutMs);
        verified = v.valid === true;
        if (!verified && v.first_break) {
          warn(`verify broken at ${v.first_break.event_id}: `
            + `expected ${v.first_break.expected_previous_hash?.slice(0, 12)}…, `
            + `got ${v.first_break.actual_previous_hash?.slice(0, 12)}…`);
        }
      } catch (err) {
        warn(`verify failed: ${err.message}`);
      }
    }

    // 3. Persist enriched record via decision-logger.
    const enriched = {
      ...decision,
      verified,
      vaara: {
        record_id: receipt?.record_id || null,
        record_hash: receipt?.record_hash || null,
        previous_hash: receipt?.previous_hash || null,
        upstream_error: vaaraError,
        shadow: this.cfg.shadow,
      },
    };
    return this.dl.logDecision(enriched);
  }

  getChain(id) { return this.dl.getChain(id); }
  getChainBetween(a, b) { return this.dl.getChainBetween(a, b); }
  verifyChain() { return this.dl.verifyChain(); }
  exportChain(a, b, f) { return this.dl.exportChain(a, b, f); }
  getLastHash() { return this.dl.getLastHash(); }
}

async function runCli() {
  const backend = new VaaraAuditBackend();
  const stdin = fs.readFileSync(0, 'utf8');
  for (const line of stdin.split('\n')) {
    if (!line.trim()) continue;
    try { await backend.logDecision(JSON.parse(line)); }
    catch (err) { warn(`logDecision: ${err.message}`); }
  }
}

module.exports = { VaaraAuditBackend, loadConfig, GENESIS_HASH };

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`[vaara-audit] FATAL ${err.message}\n`);
    process.exit(1);
  });
}