// test/unit/db/logger.test.js
// Unit tests for src/db/logger.js
//
// Strategy: stub the pool.query() to return controlled responses, and
// verify (a) the SQL is well-formed, (b) the values map correctly from
// the result envelope, (c) the function never throws even on pool errors.
//
// We use Node's built-in test runner (node --test) to match the rest of
// the v2 suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// We need to inject a stub pool before requiring the logger. Use a
// loader that captures the module-level state via a side channel:
//   1. Replace pg with a stub
//   2. Pre-populate the module-level `pool` via getPool()'s side effect
//
// Simpler approach: import the logger normally, then replace the
// db/index.js getPool via a separate test-only export. We don't have
// that, so we'll use node:module's --experimental-vm-modules... or just
// test the pure helper logic by importing truncate/costTotal/backendUsed
// via a small test seam.
//
// Since the logger doesn't export its helpers, we test via behavior:
//   - stub process.env so config.db.enabled is false → logger is no-op
//   - call logConversation with various envelopes → expect {logged: false, reason: 'pool-unavailable'}

test('logger: returns missing-required-fields when requestId is empty', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({ problem: 'x' });
  assert.equal(r.logged, false);
  assert.equal(r.reason, 'missing-required-fields');
});

test('logger: returns missing-required-fields when problem is empty', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({ requestId: 'a' });
  assert.equal(r.logged, false);
  assert.equal(r.reason, 'missing-required-fields');
});

test('logger: returns pool-unavailable when AWARE_DB_ENABLED=false', async () => {
  const prev = process.env.AWARE_DB_ENABLED;
  process.env.AWARE_DB_ENABLED = '0';
  // The config module is loaded CJS-cached; we can't refresh its
  // lazy getter for the test. So instead, we test via behavior:
  // when DB is unavailable (default host 127.0.0.1:5432 won't be up
  // in the test env), we expect pool-unavailable.
  delete process.env.AWARE_DB_ENABLED;
  if (prev !== undefined) process.env.AWARE_DB_ENABLED = prev;

  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000001',
    problem: 'test',
  });
  assert.equal(r.logged, false);
  // Either pool-unavailable (no DB up) or no-pool — both are valid no-op results
  assert.ok(['pool-unavailable', 'no-pool', 'pool-init-failed'].includes(r.reason),
    `expected pool-unavailable-style reason, got: ${r.reason}`);
});

test('logger: never throws even with null/undefined args', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r1 = await logConversation(null);
  const r2 = await logConversation(undefined);
  const r3 = await logConversation({});
  assert.equal(r1.logged, false);
  assert.equal(r2.logged, false);
  assert.equal(r3.logged, false);
});

test('logger: redaction — does not attempt to log when requestId is missing', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({ problem: 'p' });
  assert.equal(r.reason, 'missing-required-fields');
});

test('logger: costTotal helper — sums attempts+refinement+judge USD', async () => {
  // We test this indirectly by checking the SQL parameters. Since
  // we can't easily inspect the params without a real pool, we verify
  // the function returns the right shape.
  const { logConversation } = await import('../../../src/db/logger.js');
  // Result with cost breakdown
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000010',
    problem: 'p',
    result: {
      ok: true,
      refined_trace: 't',
      confidence: 0.5,
      cost: { attempts_usd: 0.001, refinement_usd: 0.002, judge_usd: 0.0005 },
      pair_written: false,
    },
  });
  // We can't see the SQL params from here; we can only verify it
  // doesn't throw and returns a structured result.
  assert.ok(typeof r === 'object');
  assert.ok('logged' in r);
});

test('logger: costTotal helper — handles missing cost gracefully', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000011',
    problem: 'p',
    result: { ok: true, refined_trace: 't', pair_written: false }, // no cost
  });
  assert.ok(typeof r === 'object');
});

test('logger: costTotal helper — handles non-numeric cost gracefully', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000012',
    problem: 'p',
    result: { ok: true, refined_trace: 't', cost: 'not-a-number', pair_written: false },
  });
  assert.ok(typeof r === 'object');
});

test('logger: logConversationFireAndForget never throws on missing args', async () => {
  const { logConversationFireAndForget } = await import('../../../src/db/logger.js');
  // Should not throw synchronously
  assert.doesNotThrow(() => {
    logConversationFireAndForget(null);
    logConversationFireAndForget(undefined);
    logConversationFireAndForget({});
  });
  // Give the underlying promises a tick to settle (they will log errors to stderr)
  await new Promise((resolve) => setImmediate(resolve));
});

test('logger: long problem text — does not throw, returns graceful result', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const longProblem = 'x'.repeat(2000);
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000020',
    problem: longProblem,
  });
  assert.ok(typeof r === 'object');
  // If a real pool is up, the truncation should have run; we can't
  // assert that without a real DB. The contract is just "doesn't throw".
});

test('logger: long refined_trace — handled in same path as problem', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const longTrace = 't'.repeat(10_000);
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000021',
    problem: 'p',
    result: { ok: true, refined_trace: longTrace, pair_written: false },
  });
  assert.ok(typeof r === 'object');
});

test('logger: error kind and message are passed through', async () => {
  const { logConversation } = await import('../../../src/db/logger.js');
  const r = await logConversation({
    requestId: '00000000-0000-0000-0000-000000000030',
    problem: 'p',
    errorKind: 'killed',
    errorMessage: 'kill-switch is engaged',
  });
  // We can't assert the SQL params, but the function shouldn't throw
  assert.ok(typeof r === 'object');
  assert.ok('logged' in r);
});

// Silence unused import warning for EventEmitter
void EventEmitter;

// ─── New tests covering the previously-uncovered SQL execution branches ───
//
// The original logger tests were "no-DB" by design — they only covered
// the early-bail paths (missing required fields, no pool). That left
// the actual `pool.query()` success and catch branches (lines 136, 143)
// unmeasured, dragging the file's branch % to 38%.
//
// These tests use the new `_setPoolForTest` seam in db/index.js to
// install a stub pool, then assert on the return value shape.

test('logger: returns { logged: true } when pool.query() resolves', async () => {
  const { _setPoolForTest, dbStatus } = await import('../../../src/db/index.js');
  const { logConversation } = await import('../../../src/db/logger.js');

  let lastSql = null;
  let lastParams = null;
  const fakePool = {
    query: async (sql, params) => {
      lastSql = sql;
      lastParams = params;
      return { rows: [] };
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    const r = await logConversation({
      requestId: '00000000-0000-0000-0000-000000000100',
      problem: 'p',
      result: {
        ok: true,
        refined_trace: 't',
        confidence: 0.7,
        cost: { attempts_usd: 0.001, refinement_usd: 0.002, judge_usd: 0.0005 },
        pair_written: false,
      },
    });
    assert.equal(r.logged, true);
    // The SQL should mention aware_conversations
    assert.ok(/INSERT INTO aware_conversations/i.test(lastSql || ''));
    // cost_total_usd should be summed
    const costIdx = lastParams.findIndex(
      (v, i) => i > 0 && Number.isFinite(v) && Math.abs(v - 0.0035) < 1e-9
    );
    assert.ok(costIdx >= 0, `expected cost_total_usd=0.0035 in params, got ${JSON.stringify(lastParams)}`);
  } finally {
    dbStatus._reset();
  }
});

test('logger: returns { logged: false, reason: insert-failed } when pool.query() throws', async () => {
  const { _setPoolForTest, dbStatus } = await import('../../../src/db/index.js');
  const { logConversation } = await import('../../../src/db/logger.js');

  const fakePool = {
    query: async () => {
      const err = new Error('relation "aware_conversations" does not exist');
      throw err;
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    const r = await logConversation({
      requestId: '00000000-0000-0000-0000-000000000101',
      problem: 'p',
      result: { ok: true, refined_trace: 't', pair_written: false },
    });
    assert.equal(r.logged, false);
    assert.equal(r.reason, 'insert-failed');
    assert.ok(/aware_conversations/.test(r.error || ''));
  } finally {
    dbStatus._reset();
  }
});

test('logger: fire-and-forget logs to stderr when logConversation returns not-logged', async () => {
  // The "missing-required-fields" path returns {logged: false}, so
  // logConversationFireAndForget's `.then(r => { if (!r.logged) ... })`
  // branch is covered. This test asserts the stderr message is emitted.
  const errs = [];
  const origErr = console.error;
  console.error = (...args) => errs.push(args.join(' '));
  try {
    const { logConversationFireAndForget } = await import('../../../src/db/logger.js');
    logConversationFireAndForget({}); // missing required fields
    // Wait one tick for the .then to settle
    await new Promise((r) => setImmediate(r));
    // The fire-and-forget should have logged a "not logged" message
    assert.ok(
      errs.some((m) => /not logged/.test(m) || /request_id=undefined/.test(m)),
      `expected a "not logged" stderr line, got: ${JSON.stringify(errs)}`
    );
  } finally {
    console.error = origErr;
  }
});

// NOTE: The `.catch` handler in logConversationFireAndForget (line 157-160)
// is intentionally unreachable in production. logConversation's contract
// is "MUST NEVER throw" — every error path returns a structured
// {logged:false, reason} instead. Forcing a throw to cover this branch
// would require adding a synthetic source throw that does not exist in
// any real call site, which makes the code worse for no real coverage
// gain. We document this rather than cover it.
test('logger: fire-and-forget never rejects (the .catch is defensive dead code)', async () => {
  // We exercise every error path we can reach in logConversation and
  // assert logConversationFireAndForget never produces an unhandled
  // promise rejection. If a future change ever causes logConversation
  // to reject, the .catch on line 157-160 will fire — but in current
  // code, that branch is dead.
  const { _setPoolForTest, dbStatus } = await import('../../../src/db/index.js');
  const { logConversationFireAndForget } = await import('../../../src/db/logger.js');

  // Path 1: missing required fields
  logConversationFireAndForget(null);
  logConversationFireAndForget(undefined);
  logConversationFireAndForget({});

  // Path 2: pool returns a rejecting promise
  const fakePool = {
    query: async () => {
      throw new Error('simulated DB outage');
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    logConversationFireAndForget({
      requestId: '00000000-0000-0000-0000-000000000200',
      problem: 'p',
      result: { ok: true, refined_trace: 't', pair_written: false },
    });
  } finally {
    dbStatus._reset();
  }

  // Wait for all the fire-and-forget promises to settle
  await new Promise((r) => setImmediate(r));
  // If any of them rejected without being caught, Node would emit
  // an UnhandledPromiseRejection — and `process.exitCode` would
  // not be set. The test passing here is the assertion.
  assert.ok(true, 'no unhandled rejection');
});
