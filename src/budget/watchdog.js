// src/budget/watchdog.js — Phase 2.3 budget watchdog
//
// Rolling-30d LLM cost budget enforcement for the AWARE coordinator.
// Reads spend from the aware_conversations table (single source of truth
// — no double-bookkeeping with the logger), enforces tiered limits,
// exposes a status endpoint for observability.
//
// Hard contract: this module MUST NEVER throw and MUST NEVER block the
// request path. All DB calls return safe defaults (spend=0, tier=ok) on
// any error. The watchdog is read-only — no INSERT/UPDATE/DELETE.
//
// Architecture decisions (this session):
//   - A1: cost counter = Postgres aggregate on aware_conversations
//   - B3: tiered semantics (soft warn at 80%, hard stop at 100%)
//   - C2: rolling 30-day window (configurable)
//
// Public API:
//   import { isEnabled, getWindowSpendUsd, checkBudget,
//            getBudgetStatus, formatResetsAt } from './budget/watchdog.js';

import config from '../config/index.cjs';
import { getPool } from '../db/index.js';

// ─── Test seam ────────────────────────────────────────────────────────
//
// `_setPoolForTest(pool)` lets unit tests substitute a fake pool that
// returns canned `query()` results. Production code never calls this —
// it's an explicit seam for the watchdog test suite. Pass `null` to
// clear the override and fall back to the real getPool().
let _poolOverride = null;
export function _setPoolForTest(pool) {
  _poolOverride = pool;
}
function _getPoolSafe() {
  if (_poolOverride) return Promise.resolve(_poolOverride);
  return getPool();
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute the wall-clock timestamp at which the rolling window resets.
 * The reset is "now + windowDays" — the window is a sliding window, not
 * a fixed-cycle budget, so this is a lower bound on when enough spend
 * will roll off to potentially drop below the soft/hard limits.
 */
export function formatResetsAt(windowDays) {
  const days = Number.isFinite(Number(windowDays)) ? Number(windowDays) : 30;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Is the budget watchdog enabled? Reads the env-var-driven config
 * (lazy, so tests can flip it without reload).
 */
export function isEnabled() {
  return config.budget.enabled === true;
}

/**
 * Read the current rolling-window spend (USD) from aware_conversations.
 * NEVER throws. Returns 0 on any error or if the pool is unavailable.
 *
 * The query is parameterized; the interval is a Postgres string literal
 * built from windowDays (a positive integer bound by config validation).
 */
export async function getWindowSpendUsd() {
  if (!isEnabled()) return 0;
  const windowDays = config.budget.windowDays;
  let pool;
  try {
    pool = await _getPoolSafe();
  } catch (_err) {
    return 0;
  }
  if (!pool) return 0;
  try {
    const sql = `
      SELECT COALESCE(SUM(cost_total_usd), 0)::float AS spend
      FROM aware_conversations
      WHERE ts > now() - ($1 || ' days')::interval
        AND cost_total_usd IS NOT NULL
        AND ok = true
    `;
    const r = await pool.query(sql, [String(windowDays)]);
    const v = r && r.rows && r.rows[0] ? Number(r.rows[0].spend) : 0;
    return Number.isFinite(v) ? v : 0;
  } catch (_err) {
    // eslint-disable-next-line no-console
    console.error('[aware-budget] getWindowSpendUsd query failed, treating as 0');
    return 0;
  }
}

/**
 * Compute the current budget tier + status.
 * Returns:
 *   { ok, tier, spendUsd, softLimitUsd, hardLimitUsd, windowDays, resetsAt }
 * where tier is one of: 'ok' | 'soft' | 'hard'.
 *
 * tier=hard  → coordinator should reject /coordinate with 402
 * tier=soft  → coordinator should warn (X-Budget-Tier header) and proceed
 * tier=ok    → coordinator should proceed with no warning
 *
 * Never throws; on any internal error returns tier='ok' (fail-open —
 * never block requests because the budget DB is sad).
 */
export async function checkBudget() {
  const softLimitUsd = Number(config.budget.softLimitUsd) || 0;
  const hardLimitUsd = Number(config.budget.hardLimitUsd) || 0;
  const windowDays = Number(config.budget.windowDays) || 30;
  const resetsAt = formatResetsAt(windowDays);

  // Disabled: short-circuit to ok. Spend is irrelevant.
  if (!isEnabled()) {
    return {
      ok: true,
      tier: 'ok',
      spendUsd: 0,
      softLimitUsd,
      hardLimitUsd,
      windowDays,
      resetsAt,
    };
  }

  let spendUsd = 0;
  try {
    spendUsd = await getWindowSpendUsd();
  } catch (_err) {
    spendUsd = 0;
  }

  let tier = 'ok';
  if (hardLimitUsd > 0 && spendUsd >= hardLimitUsd) {
    tier = 'hard';
  } else if (softLimitUsd > 0 && spendUsd >= softLimitUsd) {
    tier = 'soft';
  }

  return {
    ok: tier !== 'hard',
    tier,
    spendUsd,
    softLimitUsd,
    hardLimitUsd,
    windowDays,
    resetsAt,
  };
}

/**
 * Full status snapshot for the /budget/status endpoint.
 * Adds { enabled, lastCheckedAt } on top of checkBudget().
 */
export async function getBudgetStatus() {
  let status;
  try {
    status = await checkBudget();
  } catch (_err) {
    status = {
      ok: true,
      tier: 'ok',
      spendUsd: 0,
      softLimitUsd: Number(config.budget.softLimitUsd) || 0,
      hardLimitUsd: Number(config.budget.hardLimitUsd) || 0,
      windowDays: Number(config.budget.windowDays) || 30,
      resetsAt: formatResetsAt(config.budget.windowDays),
    };
  }
  return {
    enabled: isEnabled(),
    lastCheckedAt: new Date().toISOString(),
    ...status,
  };
}
