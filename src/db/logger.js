// src/db/logger.js — Phase 2.1 conversation logger
//
// The single entry point for logging /coordinate requests to the
// aware_conversations table. Used by src/coordinator/http-server.js.
//
// Hard contract: this function MUST NEVER throw. The request path is
// more important than the log. All errors are caught and reported to
// stderr; the caller gets no feedback (intentional — logging is
// best-effort observability, not a control-flow signal).
//
// Public API:
//   import { logConversation, logConversationSync, _resetForTest } from './db/logger.js';

import { getPool } from './index.js';

// ─── Truncation helpers ─────────────────────────────────────────────
//
// MAX_PROBLEM_CHARS lifted from 1000 to 100000 to match
// src/coordinator/http-server.js's prompt accept cap. Prompts larger
// than 100000 chars are rejected at the HTTP boundary, so storing the
// full text in the audit log keeps the log faithful to the request
// (closes SC-MOD-003: prompt storage asymmetry that could hide
// prompt-injection payloads in the truncated tail).
//
// MAX_TRACE_CHARS kept at 8000 — reasoning traces are bounded by the
// router/refiner and 8k is more than enough for typical outputs.

const MAX_PROBLEM_CHARS = 100000;
const MAX_TRACE_CHARS = 8000;

function truncate(text, max) {
  if (text == null) return null;
  const s = String(text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}<truncated from ${s.length} chars>`;
}

function costTotal(result) {
  if (!result || !result.cost) return null;
  const c = result.cost;
  // HeavySkill returns { attempts_usd, refinement_usd, judge_usd }
  if (typeof c === 'object') {
    const a = Number(c.attempts_usd) || 0;
    const r = Number(c.refinement_usd) || 0;
    const j = Number(c.judge_usd) || 0;
    const total = a + r + j;
    return total > 0 ? total : null;
  }
  // Defensive: if cost is a number directly
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function backendUsed(result) {
  if (!result || !Array.isArray(result.attempts) || result.attempts.length === 0) return null;
  // The router doesn't currently tag each attempt with the backend name
  // (that's a model-router enhancement). For now, leave null when unknown.
  // TODO: surface backend name from model-router when available
  return null;
}

function safeNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Log a /coordinate request. NEVER throws.
 *
 * @param {object} args
 * @param {string} args.requestId       — required, UUID string
 * @param {string} args.problem         — required, the user's question
 * @param {string} [args.taskType]      — body.task_type
 * @param {number} [args.k]             — body.K
 * @param {object} [args.result]        — the coordinate() result envelope
 *                                        (null on killed/timeout/cost-cap/error)
 * @param {number} args.durationMs      — how long the request took
 * @param {string} [args.sessionId]     — body.sessionId
 * @param {string} [args.agentId]       — body.agentId
 * @param {string} [args.errorKind]     — 'killed' | 'timeout' | 'cost_cap' | 'backend' | 'internal'
 * @param {string} [args.errorMessage]  — error message if any
 * @returns {Promise<{logged: boolean, reason?: string}>}
 */
export async function logConversation(args) {
  // Pre-validate required fields synchronously; bail before any IO
  if (!args || !args.requestId || !args.problem) {
    return { logged: false, reason: 'missing-required-fields' };
  }

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    // getPool() already catches and logs; this catch is for defensive
    // coverage in case a future change introduces a throwing path
    return { logged: false, reason: 'pool-init-failed' };
  }

  if (!pool) {
    return { logged: false, reason: 'pool-unavailable' };
  }

  const result = args.result;
  const ok = !args.errorKind && result && result.ok !== false;

  const row = {
    request_id: args.requestId,
    problem: truncate(args.problem, MAX_PROBLEM_CHARS),
    task_type: args.taskType || null,
    k: safeNumber(args.k),
    backend_used: backendUsed(result),
    ok,
    confidence: result ? safeNumber(result.confidence) : null,
    cost_total_usd: costTotal(result),
    refined_trace: result ? truncate(result.refined_trace, MAX_TRACE_CHARS) : null,
    pair_path: result ? result.pair_path || null : null,
    session_id: args.sessionId || null,
    agent_id: args.agentId || null,
    duration_ms: safeNumber(args.durationMs),
    error_kind: args.errorKind || null,
    error_message: args.errorMessage || null,
  };

  const sql = `
    INSERT INTO aware_conversations (
      request_id, problem, task_type, k, backend_used, ok,
      confidence, cost_total_usd, refined_trace, pair_path,
      session_id, agent_id, duration_ms, error_kind, error_message
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15
    )
    ON CONFLICT (request_id) DO NOTHING
  `;

  try {
    await pool.query(sql, [
      row.request_id, row.problem, row.task_type, row.k, row.backend_used, row.ok,
      row.confidence, row.cost_total_usd, row.refined_trace, row.pair_path,
      row.session_id, row.agent_id, row.duration_ms, row.error_kind, row.error_message,
    ]);
    return { logged: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[aware-logger] insert failed for request_id=${args.requestId}:`,
      err.message
    );
    return { logged: false, reason: 'insert-failed', error: err.message };
  }
}

/**
 * Fire-and-forget variant. Logs to console if the awaitable log fails.
 * Use this in the request hot path so the response isn't blocked on a slow DB.
 */
export function logConversationFireAndForget(args) {
  logConversation(args).then((r) => {
    if (!r.logged) {
      // eslint-disable-next-line no-console
      console.error(`[aware-logger] request_id=${args && args.requestId} not logged: ${r.reason || 'unknown'}`);
    }
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[aware-logger] unexpected error:`, err.message);
  });
}

/**
 * Test-only: reset module state. Used by logger.test.js to ensure
 * isolation between tests when stubbing the pool.
 */
export function _resetForTest() {
  // No module-level mutable state in this file; getPool() is in
  // index.js and resets via dbStatus._reset(). This function exists
  // for API symmetry.
}
