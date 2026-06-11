// Tests for the coordinator HTTP service surface.
// Strategy: spin up the real server on a random port, hit it with real `fetch`
// calls, verify status codes + response shapes. No supertest, no mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../../src/coordinator/http-server.js';
import { COORDINATOR_VERSION, COORDINATOR_BUILD_PHASE } from '../../../src/coordinator/index.js';

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
