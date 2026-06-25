// test/unit/coordinator/auth.test.js
//
// SEC-002 : bearer-token auth
// on /coordinate + /budget/status. These tests verify the gate works for
// positive (valid token) and negative (missing / malformed / wrong token)
// paths. They run with AWARE_COORDINATOR_AUTH_DISABLED=1 set during the
// http-server.test.js bootstrap — we override per-test to flip the gate
// on + off and assert the behavior.
//
// Each test boots its own server on a random port via startServer() with
// disableLoraReloader:true (the reloader poll would keep the process alive
// past test end otherwise).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../../src/coordinator/http-server.js';

const VALID_TOKEN = 'a'.repeat(48); // 48 chars, ≥32 required
const SHORT_TOKEN = 'short'; // 5 chars, < 32 (valid length test would fail)

function stubRouter() {
  return {
    mode: 'hybrid',
    async generate() {
      return { reasoning: 'stub', cost_usd: 0 };
    },
    async health() {
      return {
        mode: 'hybrid',
        ok: true,
        at: new Date().toISOString(),
        clients: {},
      };
    },
  };
}

async function withServerAuth(opts, env, fn) {
  const prev = process.env.AWARE_COORDINATOR_AUTH_DISABLED;
  const prevTok = process.env.AWARE_COORDINATOR_TOKEN;
  try {
    if (env.AUTH_DISABLED !== undefined) {
      if (env.AUTH_DISABLED) process.env.AWARE_COORDINATOR_AUTH_DISABLED = '1';
      else delete process.env.AWARE_COORDINATOR_AUTH_DISABLED;
    }
    if (env.TOKEN !== undefined) {
      if (env.TOKEN === null) delete process.env.AWARE_COORDINATOR_TOKEN;
      else process.env.AWARE_COORDINATOR_TOKEN = env.TOKEN;
    }
    const handle = await startServer({ ...opts, disableLoraReloader: true });
    try {
      await fn(handle);
    } finally {
      await handle.close();
    }
  } finally {
    if (prev === undefined) delete process.env.AWARE_COORDINATOR_AUTH_DISABLED;
    else process.env.AWARE_COORDINATOR_AUTH_DISABLED = prev;
    if (prevTok === undefined) delete process.env.AWARE_COORDINATOR_TOKEN;
    else process.env.AWARE_COORDINATOR_TOKEN = prevTok;
  }
}

test('SEC-002: /coordinate with no Authorization header returns 401 when auth enabled', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'cheap' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.kind, 'auth');
    assert.equal(body.error, 'unauthorized');
    assert.ok(body.request_id, '401 response should carry a request_id for log correlation');
  });
});

test('SEC-002: /coordinate with wrong Bearer token returns 401', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + 'z'.repeat(48), // same length, different value
      },
      body: JSON.stringify({ problem: 'cheap' }),
    });
    assert.equal(res.status, 401);
  });
});

test('SEC-002: /coordinate with non-Bearer auth scheme returns 401', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Basic ' + Buffer.from('user:pass').toString('base64'),
      },
      body: JSON.stringify({ problem: 'cheap' }),
    });
    assert.equal(res.status, 401);
  });
});

test('SEC-002: /coordinate with valid Bearer token is NOT short-circuited by auth gate', async () => {
  // We don't assert 200 here because the stub router returns 200 regardless
  // of input — we just want to confirm the gate lets the request through.
  // The 401 vs non-401 distinction is the load-bearing assertion.
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + VALID_TOKEN,
      },
      body: JSON.stringify({ problem: 'cheap', cost_cap_usd: 1.0 }),
    });
    assert.notEqual(res.status, 401, 'valid token must not be rejected by auth gate');
  });
});

test('SEC-002: /budget/status requires auth same as /coordinate', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const noAuth = await fetch(`http://${h.host}:${h.port}/budget/status`);
    assert.equal(noAuth.status, 401, 'no auth → 401 on /budget/status');
  });
});

test('SEC-002: /health is public (liveness probes must work)', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/health`);
    assert.equal(res.status, 200, '/health must work without auth');
  });
});

test('SEC-002: /version is public (orchestrators query it)', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: false, TOKEN: VALID_TOKEN }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/version`);
    assert.equal(res.status, 200, '/version must work without auth');
  });
});

test('SEC-002: AWARE_COORDINATOR_AUTH_DISABLED=1 lets all routes through', async () => {
  await withServerAuth({ port: 0, router: stubRouter() }, { AUTH_DISABLED: true, TOKEN: null }, async (h) => {
    const res = await fetch(`http://${h.host}:${h.port}/coordinate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'cheap', cost_cap_usd: 1.0 }),
    });
    assert.notEqual(res.status, 401, 'auth-disabled mode must allow /coordinate');
  });
});
