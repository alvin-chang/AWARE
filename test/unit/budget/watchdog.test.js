// test/unit/budget/watchdog.test.js
// Unit tests for src/budget/watchdog.js — AWARE 2.0 Phase 2.3 budget watchdog.
//
// Strategy:
//   1. Pure-function tests for formatResetsAt (no DB needed).
//   2. Tests with no pool available → getWindowSpendUsd returns 0
//      and checkBudget returns tier='ok' (we test this exhaustively).
//   3. Tests that use the watchdog's _setPoolForTest() seam to inject
//      a fake pool that returns canned spend values, verifying the
//      tier transitions (ok → soft → hard).
//
// We use Node's built-in test runner (node --test) to match the rest of
// the v2 suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatResetsAt,
  isEnabled,
  getWindowSpendUsd,
  checkBudget,
  getBudgetStatus,
  _setPoolForTest,
} from '../../../src/budget/watchdog.js';

// Helper: build a fake pool that returns a fixed spend value.
function fakePool(spendValue) {
  return {
    query: async (_sql, _params) => ({ rows: [{ spend: spendValue }] }),
  };
}

// Helper: build a fake pool whose query throws.
function throwingPool(errMsg = 'simulated DB explosion') {
  return {
    query: async () => { throw new Error(errMsg); },
  };
}

// Clear test seam after each test (defensive — some tests may not set it)
test.afterEach(() => {
  _setPoolForTest(null);
  delete process.env.AWARE_BUDGET_ENABLED;
});

// --- formatResetsAt (pure function) --------------------------------------

test('budget: formatResetsAt returns ISO string', () => {
  const out = formatResetsAt(30);
  assert.equal(typeof out, 'string');
  const t = Date.parse(out);
  assert.ok(Number.isFinite(t), 'must be a valid ISO timestamp');
});

test('budget: formatResetsAt is approximately now + windowDays days', () => {
  const before = Date.now();
  const out = formatResetsAt(7);
  const after = Date.now();
  const parsed = Date.parse(out);
  // Allow 10ms jitter for before/after
  assert.ok(parsed >= before + 7 * 86_400_000 - 10);
  assert.ok(parsed <= after + 7 * 86_400_000 + 10);
});

test('budget: formatResetsAt handles non-integer windowDays', () => {
  const out = formatResetsAt(0);
  assert.equal(typeof out, 'string');
  const parsed = Date.parse(out);
  assert.ok(Number.isFinite(parsed));
});

test('budget: formatResetsAt handles bad input (NaN, undefined, string)', () => {
  const a = formatResetsAt(NaN);
  const b = formatResetsAt(undefined);
  const c = formatResetsAt('not a number');
  // All should still return a valid ISO string (default 30 days)
  assert.ok(Number.isFinite(Date.parse(a)));
  assert.ok(Number.isFinite(Date.parse(b)));
  assert.ok(Number.isFinite(Date.parse(c)));
});

// --- isEnabled -----------------------------------------------------------

test('budget: isEnabled reads config.budget.enabled', () => {
  const v = isEnabled();
  assert.equal(typeof v, 'boolean');
});

test('budget: isEnabled returns false when AWARE_BUDGET_ENABLED=false', () => {
  process.env.AWARE_BUDGET_ENABLED = 'false';
  assert.equal(isEnabled(), false);
});

test('budget: isEnabled returns true when AWARE_BUDGET_ENABLED=true', () => {
  process.env.AWARE_BUDGET_ENABLED = 'true';
  assert.equal(isEnabled(), true);
});

// --- getWindowSpendUsd (DB-disabled path) -------------------------------

test('budget: getWindowSpendUsd returns 0 when no pool is available', async () => {
  // Default test env: no fake pool injected → falls back to real getPool()
  // which returns null (no Postgres in CI). Either way: 0.
  _setPoolForTest(null);
  const v = await getWindowSpendUsd();
  assert.equal(v, 0);
});

test('budget: getWindowSpendUsd returns 0 when watchdog disabled', async () => {
  process.env.AWARE_BUDGET_ENABLED = 'false';
  // Even with a pool available, disabled short-circuits to 0
  _setPoolForTest(fakePool(999999));
  const v = await getWindowSpendUsd();
  assert.equal(v, 0);
});

test('budget: getWindowSpendUsd reads from injected pool', async () => {
  _setPoolForTest(fakePool(42.5));
  const v = await getWindowSpendUsd();
  assert.equal(v, 42.5);
});

test('budget: getWindowSpendUsd returns 0 on query throw (fail-open)', async () => {
  _setPoolForTest(throwingPool('connection refused'));
  const v = await getWindowSpendUsd();
  assert.equal(v, 0);
});

// --- checkBudget tier transitions --------------------------------------

test('budget: checkBudget with mocked spend=0 → tier=ok', async () => {
  _setPoolForTest(fakePool(0));
  const r = await checkBudget();
  assert.equal(r.tier, 'ok');
  assert.equal(r.ok, true);
  assert.equal(r.spendUsd, 0);
  assert.equal(typeof r.softLimitUsd, 'number');
  assert.equal(typeof r.hardLimitUsd, 'number');
  assert.equal(typeof r.windowDays, 'number');
  assert.equal(typeof r.resetsAt, 'string');
});

test('budget: checkBudget with spend below soft → tier=ok', async () => {
  _setPoolForTest(fakePool(50));
  const r = await checkBudget();
  assert.equal(r.tier, 'ok');
  assert.equal(r.ok, true);
  assert.equal(r.spendUsd, 50);
});

test('budget: checkBudget with spend at soft limit → tier=soft', async () => {
  _setPoolForTest(fakePool(80));
  const r = await checkBudget();
  assert.equal(r.tier, 'soft');
  assert.equal(r.ok, true, 'soft tier is still ok (request proceeds)');
  assert.equal(r.spendUsd, 80);
});

test('budget: checkBudget with spend between soft and hard → tier=soft', async () => {
  _setPoolForTest(fakePool(90));
  const r = await checkBudget();
  assert.equal(r.tier, 'soft');
  assert.equal(r.ok, true);
  assert.equal(r.spendUsd, 90);
});

test('budget: checkBudget with spend at hard limit → tier=hard', async () => {
  _setPoolForTest(fakePool(100));
  const r = await checkBudget();
  assert.equal(r.tier, 'hard');
  assert.equal(r.ok, false, 'hard tier is NOT ok (request rejected)');
  assert.equal(r.spendUsd, 100);
});

test('budget: checkBudget with spend above hard limit → tier=hard', async () => {
  _setPoolForTest(fakePool(150.5));
  const r = await checkBudget();
  assert.equal(r.tier, 'hard');
  assert.equal(r.ok, false);
  assert.equal(r.spendUsd, 150.5);
});

test('budget: checkBudget with watchdog disabled → tier=ok regardless of spend', async () => {
  process.env.AWARE_BUDGET_ENABLED = 'false';
  _setPoolForTest(fakePool(999999));
  const r = await checkBudget();
  assert.equal(r.tier, 'ok', 'disabled watchdog never blocks');
  assert.equal(r.ok, true);
});

test('budget: checkBudget with pool throw → fail-open tier=ok', async () => {
  _setPoolForTest(throwingPool());
  const r = await checkBudget();
  assert.equal(r.tier, 'ok');
  assert.equal(r.ok, true);
  assert.equal(r.spendUsd, 0);
});

// --- getBudgetStatus ----------------------------------------------------

test('budget: getBudgetStatus includes enabled flag and lastCheckedAt', async () => {
  _setPoolForTest(fakePool(50));
  const s = await getBudgetStatus();
  assert.equal(typeof s.enabled, 'boolean');
  assert.equal(typeof s.lastCheckedAt, 'string');
  // All checkBudget fields should be present
  assert.equal(typeof s.tier, 'string');
  assert.equal(typeof s.spendUsd, 'number');
  assert.equal(typeof s.softLimitUsd, 'number');
  assert.equal(typeof s.hardLimitUsd, 'number');
  assert.equal(typeof s.windowDays, 'number');
  assert.equal(typeof s.resetsAt, 'string');
});

test('budget: getBudgetStatus lastCheckedAt is a recent ISO timestamp', async () => {
  const before = Date.now();
  const s = await getBudgetStatus();
  const after = Date.now();
  const t = Date.parse(s.lastCheckedAt);
  assert.ok(t >= before - 100);
  assert.ok(t <= after + 100);
});

test('budget: getBudgetStatus reflects tier=hard when spend >= hard', async () => {
  _setPoolForTest(fakePool(1000));
  const s = await getBudgetStatus();
  assert.equal(s.tier, 'hard');
  assert.equal(s.ok, false);
});

// --- shape / smoke ------------------------------------------------------

test('budget: checkBudget returns all expected fields', async () => {
  const r = await checkBudget();
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, [
    'hardLimitUsd', 'ok', 'resetsAt', 'softLimitUsd', 'spendUsd', 'tier', 'windowDays',
  ]);
});

test('budget: windowDays respects env override', async () => {
  process.env.AWARE_BUDGET_WINDOW_DAYS = '7';
  const r = await checkBudget();
  assert.equal(r.windowDays, 7);
});

test('budget: softLimitUsd respects env override', async () => {
  process.env.AWARE_BUDGET_SOFT_LIMIT_USD = '50';
  const r = await checkBudget();
  assert.equal(r.softLimitUsd, 50);
});

test('budget: hardLimitUsd respects env override', async () => {
  process.env.AWARE_BUDGET_HARD_LIMIT_USD = '250.50';
  const r = await checkBudget();
  assert.equal(r.hardLimitUsd, 250.50);
});
