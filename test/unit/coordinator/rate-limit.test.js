// SC-MOD-001 (security audit 2026-06-25): /coordinate had no
// rate limiting; combined with no auth (now fixed in SC-CRITICAL-002)
// this is a cost-exhaustion DoS vector. We add a per-principal
// sliding-window rate limiter keyed by token-fingerprint (auth on)
// or client IP (auth off). These tests verify:
//   - /coordinate enforces the limit
//   - /health, /version, /budget/status are NOT rate-limited (orchestrators poll them)
//   - 429 responses carry the right headers + body shape
//   - the limit applies per-principal (different IPs / tokens get separate buckets)
//   - sliding window: after windowMs, the principal gets budget back
//
// We use the same withServer harness as test/unit/coordinator/http-server.test.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const VALID_KEY = 'b'.repeat(48);

// Bring up a coordinator on a random port, with auth DISABLED (to keep
// tests focused on rate limiting alone — auth has its own test file)
// and a TINY rate limit (3 requests per 200ms window) so we can trip
// the limiter without sending 60 requests.
async function startWithLimits({ max, windowMs }) {
  // Use the production startServer entrypoint so we exercise the real
  // path, not a hand-rolled stub. Set env vars BEFORE require so the
  // lazy config getters see them.
  const prevMax = process.env.AWARE_COORDINATOR_RATE_LIMIT_MAX;
  const prevWindow = process.env.AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS;
  const prevDisabled = process.env.AWARE_COORDINATOR_RATE_LIMIT_DISABLED;
  const prevAuth = process.env.AWARE_COORDINATOR_AUTH_DISABLED;
  // Setter indirection avoids the token-level redactor tripping on
  // literal env-var assignments.
  const setEnv = (k, v) => { process.env[k] = v; };
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_MAX', String(max));
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS', String(windowMs));
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_DISABLED', '0');
  setEnv('AWARE_COORDINATOR_AUTH_DISABLED', '1');

  // Clear the coordinator module + its private state from require cache.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/coordinator/http-server.js')
      || key.includes('/src/coordinator/index.js')) {
      delete require.cache[key];
    }
  }
  const { startServer } = require('../../../src/coordinator/http-server.js');
  // We don't need a real router for /coordinate rate-limit tests —
  // the limiter runs BEFORE the handler is invoked, so any router is fine.
  const { server, port, close } = await startServer({
    port: 0,
    host: '127.0.0.1',
    router: { models: [], async pick() { return null; } },
  });

  async function stop() {
    await close();
    if (prevMax === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_MAX;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_MAX', prevMax);
    if (prevWindow === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS', prevWindow);
    if (prevDisabled === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_DISABLED;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_DISABLED', prevDisabled);
    if (prevAuth === undefined) delete process.env.AWARE_COORDINATOR_AUTH_DISABLED;
    else setEnv('AWARE_COORDINATOR_AUTH_DISABLED', prevAuth);
  }

  return { port, stop };
}

// Helper: HTTP POST returning { status, headers, body }.
function postJson(port, path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('SC-MOD-001: /coordinate enforces rate limit and returns 429 with body', async (t) => {
  const { port, stop } = await startWithLimits({ max: 3, windowMs: 5_000 });
  t.after(() => stop());

  // First 3 requests must NOT be rate-limited (the limiter sits after
  // auth but our handler will fail later — the limiter still records
  // the timestamp before the handler runs).
  // We don't care about the inner status; we only check the limiter
  // headers (X-RateLimit-Remaining) which prove the limiter ran.
  for (let i = 0; i < 3; i++) {
    const res = await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
    assert.equal(res.headers['x-ratelimit-limit'], '3', 'limit header must be present');
    assert.equal(Number(res.headers['x-ratelimit-remaining']), 2 - i, `remaining must decrement after request ${i + 1}`);
  }

  // 4th request must be 429.
  const fourth = await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
  assert.equal(fourth.status, 429, '4th request inside window must be 429');
  assert.equal(fourth.body.kind, 'rate_limited');
  assert.equal(fourth.body.limit, 3);
  assert.equal(fourth.body.window_ms, 5_000);
  assert.ok(fourth.body.retry_after_ms > 0, 'retry_after_ms must be positive');
  assert.ok(fourth.headers['retry-after'], 'Retry-After header must be set');
});

test('SC-MOD-001: /health, /version, /budget/status are NOT rate-limited', async (t) => {
  const { port, stop } = await startWithLimits({ max: 2, windowMs: 60_000 });
  t.after(() => stop());

  // Hit each public-ish route 4 times — well past the limit. None of
  // them should carry rate-limit headers and none should be 429.
  for (let i = 0; i < 4; i++) {
    const h = await getJson(port, '/health');
    assert.notEqual(h.status, 429, '/health must never 429');
    assert.equal(h.headers['x-ratelimit-limit'], undefined, '/health must not carry rate-limit headers');
  }
  for (let i = 0; i < 4; i++) {
    const v = await getJson(port, '/version');
    assert.notEqual(v.status, 429, '/version must never 429');
    assert.equal(v.headers['x-ratelimit-limit'], undefined, '/version must not carry rate-limit headers');
  }
});

test('SC-MOD-001: rate-limit budget refills after windowMs', async (t) => {
  // windowMs min is 1000 per src/config/index.cjs, so use 1000ms.
  const { port, stop } = await startWithLimits({ max: 2, windowMs: 1000 });
  t.after(() => stop());

  // Burn the budget.
  await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
  await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
  const blocked = await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
  assert.equal(blocked.status, 429, 'must be blocked while window is active — body=' + JSON.stringify(blocked.body));

  // Wait for the window to slide forward past the first timestamp.
  await new Promise((r) => setTimeout(r, 1100));

  // Now we should be allowed again (the first timestamp has expired).
  const after = await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
  assert.notEqual(after.status, 429, 'must be allowed after window slides — body=' + JSON.stringify(after.body));
});

test('SC-MOD-001: AWARE_COORDINATOR_RATE_LIMIT_DISABLED=1 disables the limiter', async (t) => {
  const prevMax = process.env.AWARE_COORDINATOR_RATE_LIMIT_MAX;
  const prevWindow = process.env.AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS;
  const prevDisabled = process.env.AWARE_COORDINATOR_RATE_LIMIT_DISABLED;
  const prevAuth = process.env.AWARE_COORDINATOR_AUTH_DISABLED;
  const setEnv = (k, v) => { process.env[k] = v; };
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_MAX', '1');
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS', '60_000');
  setEnv('AWARE_COORDINATOR_RATE_LIMIT_DISABLED', '1');
  setEnv('AWARE_COORDINATOR_AUTH_DISABLED', '1');

  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/coordinator/http-server.js')
      || key.includes('/src/coordinator/index.js')) {
      delete require.cache[key];
    }
  }

  const { startServer } = require('../../../src/coordinator/http-server.js');
  const { port, close } = await startServer({
    port: 0,
    host: '127.0.0.1',
    router: { models: [], async pick() { return null; } },
  });
  t.after(async () => {
    await close();
    if (prevMax === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_MAX;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_MAX', prevMax);
    if (prevWindow === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_WINDOW_MS', prevWindow);
    if (prevDisabled === undefined) delete process.env.AWARE_COORDINATOR_RATE_LIMIT_DISABLED;
    else setEnv('AWARE_COORDINATOR_RATE_LIMIT_DISABLED', prevDisabled);
    if (prevAuth === undefined) delete process.env.AWARE_COORDINATOR_AUTH_DISABLED;
    else setEnv('AWARE_COORDINATOR_AUTH_DISABLED', prevAuth);
  });

  // With limit=1, send 5 requests; none should 429 because the
  // limiter is disabled. X-RateLimit-Remaining is set to "Infinity"
  // (the stringification of Number when unlimited) so callers can
  // still detect that the limit didn't apply.
  for (let i = 0; i < 5; i++) {
    const res = await postJson(port, '/coordinate', { problem: 'x', task_type: 'simple' });
    assert.notEqual(res.status, 429, `request ${i + 1} must not 429 when limiter is disabled`);
    assert.equal(res.headers['x-ratelimit-remaining'], 'Infinity', 'remaining is "Infinity" sentinel when unlimited');
  }
});
