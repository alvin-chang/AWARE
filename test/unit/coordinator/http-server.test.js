// Tests for the coordinator HTTP service surface.
// Strategy: spin up the real server on a random port, hit it with real `fetch`
// calls, verify status codes + response shapes. No supertest, no mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../../src/coordinator/http-server.js';
import { COORDINATOR_VERSION, COORDINATOR_BUILD_PHASE } from '../../../src/coordinator/index.js';
import { _setPoolForTest as _setBudgetPoolForTest } from '../../../src/budget/watchdog.js';

// Helper: build a stub router with controllable backends.
// Returns a router whose health() matches the real ModelRouter's contract:
//   { mode, ok, at, clients: { [name]: { ok, cached, at } } }
function stubRouter(backends, mode = 'hybrid') {
  return {
    mode,
    async generate(prompt) {
      return { reasoning: `stub(${prompt})`, cost_usd: 0, _backend: backends[0]?.name };
    },
    async health() {
      return {
        mode,
        ok: backends.every((b) => b.healthy),
        at: new Date().toISOString(),
        clients: Object.fromEntries(
          backends.map((b) => [b.name, { ok: b.healthy, cached: false, at: new Date().toISOString() }]),
        ),
      };
    },
  };
}

// A router whose health() throws — used to verify the server stays up.
function throwingHealthRouter() {
  return {
    async generate() {
      throw new Error('should not be called in health test');
    },
    async health() {
      throw new Error('router health() exploded');
    },
  };
}

async function withServer(opts, fn) {
  const handle = await startServer(opts);
  try {
    await fn(handle);
  } finally {
    await handle.close();
  }
}

test('GET /version returns the coordinator version + build phase', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, COORDINATOR_VERSION);
    assert.equal(body.build_phase, COORDINATOR_BUILD_PHASE);
  });
});

test('GET /health returns 200 ok when at least one backend is healthy', async () => {
  await withServer(
    {
      port: 0,
      router: stubRouter([
        { name: 'minimax', healthy: true },
        { name: 'ollama', healthy: false, offline: true },
      ]),
    },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.backends.length, 2);
      assert.equal(body.backends[0].healthy, true);
    },
  );
});

test('GET /health returns 503 down when all backends are unhealthy', async () => {
  await withServer(
    {
      port: 0,
      router: stubRouter([
        { name: 'minimax', healthy: false },
        { name: 'ollama', healthy: false, offline: true },
      ]),
    },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/health`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.status, 'down');
    },
  );
});

test('POST /coordinate returns 200 with the result for a valid request', async () => {
  // The real coordinate() returns {ok: true, ...result}; match that envelope here.
  const coordinateFn = async ({ problem, task_type }) => ({
    ok: true,
    attempts: [{ reasoning: `attempt-1(${problem})` }, { reasoning: `attempt-2(${problem})` }],
    selected: { reasoning: 'selected-answer' },
    refined: 'refined-answer',
    prm_score: 0.91,
    task_type: task_type || 'standard',
    jsonl_written: false,
  });
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem: 'write hello world', task_type: 'code' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.selected.reasoning, 'selected-answer');
      assert.equal(body.prm_score, 0.91);
      assert.equal(body.task_type, 'code');
    },
  );
});

test('POST /coordinate returns 400 when problem is missing', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_type: 'code' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /`problem`/);
    assert.equal(body.kind, 'request');
  });
});

test('POST /coordinate returns 400 when body is invalid JSON', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid JSON/);
  });
});

test('POST /coordinate returns 413 when problem exceeds 100,000 chars', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'x'.repeat(100_001) }),
    });
    assert.equal(res.status, 413);
  });
});

test('POST /coordinate returns 503 when the coordinate function throws a backend-failure error', async () => {
  const coordinateFn = async () => {
    const err = new Error('all 2 backends failed: minimax=503, ollama=ECONNREFUSED');
    throw err;
  };
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem: 'hello' }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /all 2 backends failed/);
      assert.equal(body.kind, 'backend');
    },
  );
});

test('POST /coordinate returns 500 when the coordinate function throws a non-backend error', async () => {
  const coordinateFn = async () => {
    throw new Error('internal: bad config');
  };
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem: 'hello' }),
      });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /internal: bad config/);
      assert.equal(body.kind, 'internal');
    },
  );
});

test('POST /coordinate maps the real coordinate() envelope to 400/503/500 by error.type', async () => {
  const coordinateFn = async () => ({ ok: false, error: { type: 'invalid_input', message: 'problem is required' } });
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn },
    async (h) => {
      const r1 = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem: 'hi' }),
      });
      assert.equal(r1.status, 400);
      const b1 = await r1.json();
      assert.equal(b1.kind, 'invalid_input');
      assert.match(b1.error, /problem is required/);
    },
  );
  const upstreamFn = async () => ({ ok: false, error: { type: 'upstream_error', message: 'minimax 503' } });
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn: upstreamFn },
    async (h) => {
      const r2 = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem: 'hi' }),
      });
      assert.equal(r2.status, 503);
      const b2 = await r2.json();
      assert.equal(b2.kind, 'upstream_error');
    },
  );
  const internalFn = async () => ({ ok: false, error: { type: 'internal_error', message: 'PRM JSON parse failed' } });
  await withServer(
    { port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn: internalFn },
    async (h) => {
      const r3 = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem: 'hi' }),
      });
      assert.equal(r3.status, 500);
      const b3 = await r3.json();
      assert.equal(b3.kind, 'internal_error');
    },
  );
});

test('GET /health returns 500 degraded (server stays up) when router.health() throws', async () => {
  await withServer({ port: 0, router: throwingHealthRouter() }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/health`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.status, 'degraded');
    assert.match(body.error, /router health\(\) exploded/);
    // Verify the server is still up: a second call to /version works.
    const v = await fetch(`http://${h.host}:${h.port}/version`);
    assert.equal(v.status, 200);
  });
});

test('GET /health returns 200 when the router reports an empty clients list (degenerate but not all-down)', async () => {
  await withServer(
    {
      port: 0,
      router: { async generate() {}, async health() { return { mode: 'hybrid', ok: true, at: Date.now(), clients: {} }; } },
    },
    async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.backends.length, 0);
    },
  );
});

test('returns 404 for unknown routes', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/nope`);
    assert.equal(res.status, 404);
  });
});

test('GET /version and /health respond in any order, real concurrent server', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const [a, b] = await Promise.all([
      fetch(`http://${h.host}:${h.port}/version`),
      fetch(`http://${h.host}:${h.port}/health`),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });
});

// ─────────────────────── T0–T4 enforcement tests ───────────────────────

test('T4 kill-switch: AWARE_KILL_SWITCH=1 returns 503 to /coordinate without doing work', async () => {
  const coordinateFn = async () => {
    throw new Error('coordinateFn should not be called when kill-switch is engaged');
  };
  const prev = process.env.AWARE_KILL_SWITCH;
  process.env.AWARE_KILL_SWITCH = '1';
  try {
    await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem: 'hello' }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.kind, 'killed');
      assert.match(body.error, /kill-switch/i);
    });
  } finally {
    if (prev === undefined) delete process.env.AWARE_KILL_SWITCH;
    else process.env.AWARE_KILL_SWITCH = prev;
  }
});

test('T0 timeout: coordinateFn slower than body.timeout_ms returns 504', async () => {
  const coordinateFn = async () => {
    await new Promise((r) => setTimeout(r, 5000));
    return { ok: true };
  };
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'slow problem', timeout_ms: 200 }),
    });
    assert.equal(res.status, 504);
    const body = await res.json();
    assert.equal(body.kind, 'timeout');
    assert.match(body.error, /200ms/);
  });
});

test('T0 timeout: per-request body.timeout_ms overrides the env default', async () => {
  let observed = null;
  const coordinateFn = async () => {
    await new Promise((r) => setTimeout(r, 80));
    observed = 'ran';
    return { ok: true };
  };
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'fast', timeout_ms: 1000 }), // 1000ms cap, work takes 80ms
    });
    assert.equal(res.status, 200);
    assert.equal(observed, 'ran');
  });
});

test('T2 cost-cap: result.cost_usd exceeding body.cost_cap_usd returns 402', async () => {
  const coordinateFn = async () => ({ ok: true, cost_usd: 5.5, refined: 'expensive answer' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'expensive', cost_cap_usd: 1.0 }),
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.kind, 'cost_cap');
    assert.equal(body.cost_usd, 5.5);
    assert.equal(body.cost_cap_usd, 1.0);
  });
});

test('T2 cost-cap: result.cost_usd within cap returns 200', async () => {
  const coordinateFn = async () => ({ ok: true, cost_usd: 0.5 });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'cheap', cost_cap_usd: 1.0 }),
    });
    assert.equal(res.status, 200);
  });
});

// --- Phase 2.3: budget watchdog integration -----------------------------

test.afterEach(() => {
  _setBudgetPoolForTest(null);
  delete process.env.AWARE_BUDGET_ENABLED;
});

function budgetPool(spendValue) {
  return {
    query: async () => ({ rows: [{ spend: spendValue }] }),
  };
}

test('Phase 2.3: GET /budget/status returns 200 with status JSON', async () => {
  _setBudgetPoolForTest(budgetPool(0));
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/budget/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.tier, 'ok');
    assert.equal(typeof body.spendUsd, 'number');
    assert.equal(typeof body.softLimitUsd, 'number');
    assert.equal(typeof body.hardLimitUsd, 'number');
    assert.equal(typeof body.windowDays, 'number');
    assert.equal(typeof body.resetsAt, 'string');
    assert.equal(typeof body.lastCheckedAt, 'string');
    assert.equal(typeof body.request_id, 'string');
  });
});

test('Phase 2.3: /coordinate response carries x-budget-tier header (ok)', async () => {
  _setBudgetPoolForTest(budgetPool(0));
  const coordinateFn = async () => ({ ok: true, refined: 'cheap answer' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'cheap' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-budget-tier'), 'ok');
  });
});

test('Phase 2.3: /coordinate returns 402 budget_exhausted when spend >= hard', async () => {
  _setBudgetPoolForTest(budgetPool(10000));
  const coordinateFn = async () => ({ ok: true, refined: 'never reached' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'too expensive' }),
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.kind, 'budget_exhausted');
    assert.equal(body.spend_usd, 10000);
    assert.equal(typeof body.soft_limit_usd, 'number');
    assert.equal(typeof body.hard_limit_usd, 'number');
    assert.equal(typeof body.resets_at, 'string');
    assert.equal(res.headers.get('x-budget-tier'), 'hard');
  });
});

test('Phase 2.3: /coordinate proceeds with x-budget-tier=soft when in soft band', async () => {
  _setBudgetPoolForTest(budgetPool(85));  // between soft=80 and hard=100
  const coordinateFn = async () => ({ ok: true, refined: 'still answered' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'getting close' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-budget-tier'), 'soft');
  });
});

test('Phase 2.3: budget watchdog disabled short-circuits all checks', async () => {
  process.env.AWARE_BUDGET_ENABLED = 'false';
  // Even with a pool returning infinite spend, disabled → tier=ok
  _setBudgetPoolForTest(budgetPool(999999));
  const coordinateFn = async () => ({ ok: true, refined: 'unaffected' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'unlimited' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-budget-tier'), 'ok');
  });
});

test('Phase 2.3: budget watchdog fail-open when pool throws', async () => {
  _setBudgetPoolForTest({ query: async () => { throw new Error('connection refused'); } });
  const coordinateFn = async () => ({ ok: true, refined: 'still answered' });
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]), coordinateFn }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'sad DB' }),
    });
    assert.equal(res.status, 200);
    // Fail-open: tier=ok because the watchdog couldn't read the spend
    assert.equal(res.headers.get('x-budget-tier'), 'ok');
  });
});

test('Phase 2.3: /budget/status reflects tier=hard when spend is over hard', async () => {
  _setBudgetPoolForTest(budgetPool(10000));
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/budget/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, 'hard');
    assert.equal(body.ok, false);
  });
});

test('Phase 2.3: /budget/status reflects tier=soft when spend is in soft band', async () => {
  _setBudgetPoolForTest(budgetPool(85));
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/budget/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, 'soft');
    assert.equal(body.ok, true);
  });
});

test('every response carries an x-request-id header that matches body.request_id', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const customId = 'test-req-' + Date.now();
    const res = await fetch(`http://${h.host}:${h.port}/version`, {
      headers: { 'x-request-id': customId },
    });
    assert.equal(res.headers.get('x-request-id'), customId);
    const body = await res.json();
    assert.equal(body.request_id, customId);
  });
});

test('every response auto-generates a UUID v4 request_id when not supplied', async () => {
  await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/version`);
    const headerId = res.headers.get('x-request-id');
    const body = await res.json();
    assert.ok(headerId, 'response should have x-request-id header');
    assert.equal(body.request_id, headerId);
    // UUID v4 pattern: 8-4-4-4-12 hex chars with version digit 4
    assert.match(headerId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

test('GET /version surfaces kill_switch state', async () => {
  const prev = process.env.AWARE_KILL_SWITCH;
  process.env.AWARE_KILL_SWITCH = '1';
  try {
    await withServer({ port: 0, router: stubRouter([{ name: 'minimax', healthy: true }]) }, async (h) => {
      const res = await fetch(`http://${h.host}:${h.port}/version`);
      const body = await res.json();
      assert.equal(body.kill_switch, true);
    });
  } finally {
    if (prev === undefined) delete process.env.AWARE_KILL_SWITCH;
    else process.env.AWARE_KILL_SWITCH = prev;
  }
});
