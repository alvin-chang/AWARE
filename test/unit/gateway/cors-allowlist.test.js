// test/unit/gateway/cors-allowlist.test.js
//
// C-step finding #15 (P1, [date-redacted]): the v2 gateway previously used
// `cors()` with no options, defaulting to `Access-Control-Allow-Origin: *`.
// Wildcard CORS on a public-facing service that fronts the coordinator
// removed the browser-side defense for users logged in to a malicious
// site. This test verifies the new explicit allowlist behavior.
//
// The test pattern follows test/unit/gateway/server.test.js:
// spin up the gateway in-process on a random port, hit it with real
// fetch calls, verify response headers.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Force test mode: don't bind to GATEWAY_PORT; the tests pick a port.
process.env.GATEWAY_HOST = '127.0.0.1';
process.env.GATEWAY_PORT = '0';
process.env.AWARE_GATEWAY_KILL_SWITCH = '0';
process.env.COORDINATOR_URL = 'http://placeholder:0';

function loadGateway() {
  // Require fresh so env changes between tests take effect.
  delete require.cache[require.resolve('../../../src/gateway/server.js')];
  return require('../../../src/gateway/server.js');
}

function startGateway() {
  return new Promise((resolve, reject) => {
    const { app } = loadGateway();
    const server = app.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ─── Allowlist source-of-truth tests ───────────────────────────────────

test('cors: defaults to localhost:3001 when no env vars set', async (t) => {
  delete process.env.AWARE_GATEWAY_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  // Preflight OPTIONS request from the default allowlist origin.
  // The gateway explicitly sets optionsSuccessStatus: 200 (matches v1
  // API posture). Either 200 or 204 is valid per the CORS spec — what
  // matters is that Access-Control-Allow-Origin echoes the allowed
  // origin (NOT *).
  const res = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:3001',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.ok([200, 204].includes(res.status), `unexpected status ${res.status}`);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3001');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('cors: rejects origins not in allowlist', async (t) => {
  delete process.env.AWARE_GATEWAY_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://evil.example',
      'Access-Control-Request-Method': 'GET',
    },
  });
  // Either 204 without allow-origin header, or 403 — the contract is
  // that the response does NOT echo the disallowed origin.
  const allowed = res.headers.get('access-control-allow-origin');
  assert.ok(
    allowed !== 'https://evil.example' && allowed !== '*',
    `expected disallowed origin to NOT be echoed in Access-Control-Allow-Origin (got ${allowed})`,
  );
});

test('cors: AWARE_GATEWAY_ALLOWED_ORIGINS (comma-separated) is honored', async (t) => {
  process.env.AWARE_GATEWAY_ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
  delete process.env.FRONTEND_URL;
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://app.example.com',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.ok([200, 204].includes(res.status));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
});

test('cors: FRONTEND_URL fallback (single origin) is honored when no list', async (t) => {
  delete process.env.AWARE_GATEWAY_ALLOWED_ORIGINS;
  process.env.FRONTEND_URL = 'https://frontend.example.com';
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://frontend.example.com',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.ok([200, 204].includes(res.status));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
});

test('cors: never emits wildcard Access-Control-Allow-Origin', async (t) => {
  // Belt-and-suspenders: regardless of env, the response must never
  // echo "*" because wildcard + credentials is forbidden by the CORS
  // spec and would re-introduce the regression.
  delete process.env.AWARE_GATEWAY_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  for (const origin of ['http://localhost:3001', 'http://localhost:9999', 'https://attacker.tld']) {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert.notEqual(allowOrigin, '*', `wildcard CORS detected for origin ${origin}`);
  }
});

test('cors: empty AWARE_GATEWAY_ALLOWED_ORIGINS falls back to FRONTEND_URL or localhost:3001', async (t) => {
  // Defensive: empty env var (e.g., `AWARE_GATEWAY_ALLOWED_ORIGINS=`) should
  // not silently allow wildcard. The middleware falls through to FRONTEND_URL
  // or the dev-default localhost:3001.
  process.env.AWARE_GATEWAY_ALLOWED_ORIGINS = '';
  delete process.env.FRONTEND_URL;
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await fetch(`${baseUrl}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:3001',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3001');
});
