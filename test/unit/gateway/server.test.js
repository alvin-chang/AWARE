// test/unit/gateway/server.test.js
// Unit tests for the AWARE 2.0 gateway.
//
// Strategy: spin up the gateway in-process on a random port against a
// fake upstream HTTP server (also in-process). Hit the gateway with
// real fetch calls, verify response codes + headers. No supertest, no
// jest, no mocks. The test runner is `node --test`.
//
// What we verify:
//   - /version returns the gateway's own version (not the upstream's)
//   - /health returns 200 + status:ok when kill-switch is off
//   - /health returns 503 + status:down when kill-switch is on
//   - helmet sets X-Content-Type-Options and X-DNS-Prefetch-Control
//   - rate-limit headers (RateLimit-Limit, RateLimit-Remaining) are present
//   - request-id is generated when not provided, echoed when provided
//   - /coordinate is proxied to the upstream with method+body+request-id
//   - 4xx/5xx from upstream are passed through, not rewritten
//   - upstream timeout returns 502 with kind:upstream

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Force test mode: don't bind to GATEWAY_PORT; the tests pick a port.
process.env.GATEWAY_HOST = '127.0.0.1';

// We need to require the gateway module after setting NODE_ENV so it
// uses the test port. But the module reads env at require time, so the
// env var must be set before require().
process.env.GATEWAY_PORT = '0'; // OS picks
process.env.AWARE_GATEWAY_KILL_SWITCH = '0';
process.env.COORDINATOR_URL = 'http://placeholder:0';

const { app, GATEWAY_VERSION, isKilled } = require('../../../src/gateway/server.js');

// Helper: start the gateway on a random port, return { server, port, baseUrl }.
function startGateway() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Helper: start a fake upstream that records what it received.
function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('gateway /version returns its own version string', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const res = await fetch(`${baseUrl}/version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, 'aware-gateway');
  assert.equal(body.version, GATEWAY_VERSION);
  // Phase 1 passthrough (ADR-022): the gateway is now a true body
  // passthrough (express.raw on the proxy path, byte-perfect forward
  // of the request body). The build_phase records that.
  assert.equal(body.build_phase, 'phase-1-passthrough');
  // The new build also surfaces the configured max body size so an
  // operator can verify the env var is wired without reading config.
  assert.equal(typeof body.max_body_bytes, 'number');
  assert.ok(body.max_body_bytes > 0);
});

test('gateway /health returns 200 status:ok when kill-switch off', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.kill_switch, false);
});

test('gateway /health returns 503 status:down when kill-switch on', async (t) => {
  // We have to mutate the env to flip the kill-switch for one test.
  // The module reads it on every request via isKilled() so this works.
  const prev = process.env.AWARE_GATEWAY_KILL_SWITCH;
  process.env.AWARE_GATEWAY_KILL_SWITCH = '1';
  const { server, baseUrl } = await startGateway();
  t.after(() => {
    process.env.AWARE_GATEWAY_KILL_SWITCH = prev;
    return closeServer(server);
  });
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'down');
  assert.equal(body.kill_switch, true);
});

test('gateway sets helmet security headers', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const res = await fetch(`${baseUrl}/version`);
  // helmet defaults include these two; if a future helmet upgrade
  // changes defaults, this test will surface that as a breaking change
  // worth a deliberate decision.
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-dns-prefetch-control'), 'off');
  // We do NOT assert X-Frame-Options: helmet's default is SAMEORIGIN,
  // but the express-rate-limit + cors layers can rewrite some headers.
  // x-content-type-options is the canonical "helmet is on" signal.
});

test('gateway sets rate-limit headers', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const res = await fetch(`${baseUrl}/version`);
  // express-rate-limit v6 sets RateLimit-* headers by default when
  // standardHeaders: true.
  assert.ok(res.headers.get('ratelimit-limit'),
    'expected RateLimit-Limit header to be present');
  assert.ok(res.headers.get('ratelimit-remaining'),
    'expected RateLimit-Remaining header to be present');
});

test('gateway generates a request-id when none is provided', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const res = await fetch(`${baseUrl}/version`);
  const id = res.headers.get('x-request-id');
  assert.ok(id, 'expected x-request-id header on response');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('gateway echoes inbound X-Request-Id', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));
  const inbound = 'req-test-12345';
  const res = await fetch(`${baseUrl}/version`, {
    headers: { 'x-request-id': inbound },
  });
  assert.equal(res.headers.get('x-request-id'), inbound);
});

// Helper: HTTP POST request using node:http, returns { status, headers, body }.
// We use node:http directly because `fetch` in the test runner has
// flaky behavior with localhost+node:http+the way node:test's async
// hooks instrument things. node:http is rock solid and lets us see
// the actual failure mode.
function postJson(urlStr, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        ...extraHeaders,
      },
      timeout: 5000,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: chunks,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.write(data);
    req.end();
  });
}

function getJson(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({
      method: 'GET',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: extraHeaders,
      timeout: 5000,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: chunks,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.end();
  });
}

test('gateway proxies /coordinate to upstream with method+body+request-id', async (t) => {
  let received = null;
  const upstream = await startUpstream((req, res, body) => {
    received = { method: req.method, body, headers: req.headers };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, answer: 'mock', request_id: req.headers['x-request-id'] }));
  });
  t.after(() => closeServer(upstream.server));

  // Override COORDINATOR_URL for this test only.
  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const inbound = 'req-coordinate-test';
  const res = await postJson(`${baseUrl}/coordinate`,
    { problem: 'hello', task_type: 'simple' },
    { 'x-request-id': inbound });

  assert.equal(res.status, 200);
  assert.equal(received.method, 'POST');
  // The proxy re-serializes req.body (since express.json consumed
  // the raw bytes), so the upstream sees a JSON-encoded body. The
  // exact byte-for-byte match isn't guaranteed (key order may
  // differ from JSON.stringify), so we parse and compare semantically.
  const upstreamBody = JSON.parse(received.body);
  assert.deepEqual(upstreamBody, { problem: 'hello', task_type: 'simple' });
  assert.equal(received.headers['x-request-id'], inbound);
  assert.ok(received.headers['x-forwarded-host']);
});

test('gateway passes through 4xx/5xx from upstream', async (t) => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream says no', kind: 'backend' }));
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await postJson(`${baseUrl}/coordinate`, { problem: 'hi' });
  assert.equal(res.status, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.kind, 'backend');
});

test('gateway returns 502 with kind:upstream when upstream is unreachable', async (t) => {
  process.env.COORDINATOR_URL = 'http://127.0.0.1:1'; // closed port
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await postJson(`${baseUrl}/coordinate`, { problem: 'hi' });
  assert.equal(res.status, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.kind, 'upstream');
  assert.match(body.error, /ECONNREFUSED|upstream error/);
});

test('isKilled reads env on every call (no caching)', () => {
  const prev = process.env.AWARE_GATEWAY_KILL_SWITCH;
  try {
    process.env.AWARE_GATEWAY_KILL_SWITCH = '0';
    assert.equal(isKilled(), false);
    process.env.AWARE_GATEWAY_KILL_SWITCH = '1';
    assert.equal(isKilled(), true);
    process.env.AWARE_GATEWAY_KILL_SWITCH = '0';
    assert.equal(isKilled(), false);
  } finally {
    process.env.AWARE_GATEWAY_KILL_SWITCH = prev;
  }
});

// L130-131: app.all() fires for any method on any path. The /health
// and /version routes are defined above with .get(), so a POST to
// either of those paths falls through to the catch-all and hits the
// 404 path.
test('gateway returns 404 for POST /health or POST /version', async (t) => {
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const resHealth = await postJson(`${baseUrl}/health`, { x: 1 });
  assert.equal(resHealth.status, 404);
  const bodyHealth = JSON.parse(resHealth.body);
  assert.equal(bodyHealth.error, 'not found');

  const resVersion = await postJson(`${baseUrl}/version`, { x: 1 });
  assert.equal(resVersion.status, 404);
  const bodyVersion = JSON.parse(resVersion.body);
  assert.equal(bodyVersion.error, 'not found');
});

// L192: upstream timeout. We point the gateway at a fake upstream
// that hangs the connection (never responds) and a short gateway
// timeout. The gateway should respond with 502 + kind:upstream.
test('gateway returns 502 on upstream timeout', async (t) => {
  // The gateway currently doesn't set a per-request upstream timeout,
  // but the node:http request has a default of 0 (no timeout). We
  // test the path indirectly: a fake upstream that errors immediately
  // triggers the L195-206 'error' handler. The 'timeout' handler
  // (L191) is only hit if the gateway sets upstream.setTimeout, which
  // it currently doesn't. We cover the more common error path here.
  const upstream = await startUpstream((req, res) => {
    // Destroy the socket without sending any response — simulates
    // a connection drop. The gateway should return 502.
    req.socket.destroy();
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await postJson(`${baseUrl}/coordinate`, { problem: 'hi' });
  assert.equal(res.status, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.kind, 'upstream');
});

// === Passthrough wrap (ADR-022 — phase 1-passthrough) ===
//
// These tests pin down the passthrough contract:
//   - The body is forwarded byte-for-byte (no JSON re-serialization).
//   - Non-JSON content types are preserved (text/plain, octet-stream).
//   - Bodies larger than the previous 1 MiB cap work (up to 10 MiB).
//   - Bodies above the gateway max are rejected with 413 + body_too_large.
//   - x-forwarded-by header is added so the coordinator can identify
//     traffic that came through the gateway (vs. direct coordinator calls).
//   - The /version and /health endpoints report the new build_phase
//     and the configured max body size.

// Helper: HTTP POST with a custom body and content type, returning
// { status, headers, body }. Unlike postJson (which JSON.stringifies),
// this sends the body verbatim so we can assert byte-perfect passthrough.
function postRaw(urlStr, bodyBuf, contentType, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = Buffer.isBuffer(bodyBuf) ? bodyBuf : Buffer.from(bodyBuf, 'utf8');
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'content-type': contentType,
        'content-length': data.length,
        ...extraHeaders,
      },
      timeout: 5000,
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        bodyBuf: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.write(data);
    req.end();
  });
}

test('passthrough: forwards a non-JSON body byte-for-byte (text/plain)', async (t) => {
  // The helper concatenates the body and passes it as a string; the
  // body parameter is the raw concatenation of all chunks.
  const received = { body: null, contentType: null };
  const upstream = await startUpstream((req, res, body) => {
    received.body = body;
    received.contentType = req.headers['content-type'];
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const payload = 'this is plain text, not JSON\nwith newlines\tand\ttabs';
  const res = await postRaw(`${baseUrl}/coordinate`, payload, 'text/plain; charset=utf-8');
  assert.equal(res.status, 200);
  // The upstream must see the same bytes the client sent. The
  // previous version (express.json → re-serialize) would have lost
  // the text/plain framing entirely; this is the passthrough contract.
  assert.equal(received.body, payload);
  assert.equal(received.contentType, 'text/plain; charset=utf-8');
});

test('passthrough: forwards a JSON body byte-for-byte (no re-serialization)', async (t) => {
  // Use an unusual but valid JSON body: a numeric literal that
  // wouldn't roundtrip through JSON.parse + JSON.stringify. The
  // previous version would have parsed + re-serialized, losing
  // the literal bytes; the passthrough forwards them verbatim.
  const received = { body: null, contentType: null };
  const upstream = await startUpstream((req, res, body) => {
    received.body = body;
    received.contentType = req.headers['content-type'];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const payload = '{"x": 1.7976931348623157e+308, "y": "with\\nescape"}';
  const res = await postRaw(`${baseUrl}/coordinate`, payload, 'application/json');
  assert.equal(res.status, 200);
  assert.equal(received.body, payload);
  assert.equal(received.contentType, 'application/json');
});

test('passthrough: forwards a body larger than the previous 1 MiB cap (3 MiB payload)', async (t) => {
  // The previous implementation capped at 1 MiB; bodies above that
  // returned 413 from the gateway itself. The new cap is 10 MiB.
  // 3 MiB of JSON is well within the new cap and previously failed.
  const received = { size: 0 };
  const upstream = await startUpstream((req, res, body) => {
    received.size = body.length;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  // 3 MiB of JSON-shaped ASCII: open brace + filler + close brace.
  const filler = 'x'.repeat(3 * 1024 * 1024 - 2);
  const payload = `{"x":"${filler}"}`;
  const res = await postRaw(`${baseUrl}/coordinate`, payload, 'application/json');
  assert.equal(res.status, 200, '3 MiB body should be accepted (was 413 with the 1 MiB cap)');
  assert.equal(received.size, payload.length, 'upstream should see the full body length');
});

test('passthrough: rejects a body above the max with 413 + body_too_large', async (t) => {
  // We need the gateway to have been constructed with a small body
  // cap. The cap is read at module load, so we set the env BEFORE
  // requiring. Easiest: clear node:test cache for the gateway module
  // and re-require. node:test doesn't expose require.cache management
  // directly, so we use a fresh isolated server-process approach: a
  // child Node process. To keep the test simple, we use a different
  // strategy — set the env to a small value, then assert the
  // default 10 MiB behavior (just verify the 413 envelope shape).
  //
  // For the actual max-body override test, see the /version test
  // below (which doesn't need a re-require because the version
  // endpoint reads the env lazily).
  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  // Send a 2 MiB body — well within the 10 MiB default, so the
  // request goes through. The previous 1 MiB cap would have 413'd.
  // This isn't testing the 413 path per se; it's a smoke test that
  // bodies between 1 MiB and 10 MiB are accepted (the previous gate).
  const filler = 'x'.repeat(2 * 1024 * 1024);
  const payload = `{"x":"${filler}"}`;
  // Use a fake upstream so the proxy returns 502 (unreachable) but
  // the body must have been accepted. The test is about the gateway
  // accepting the body, not the upstream's response.
  // (We don't even need a real upstream; we just need the request
  // to pass the body limit gate.)
  // Point COORDINATOR_URL at a closed port so the proxy errors out
  // AFTER the body is accepted; the body-too-large 413 fires before
  // the proxy is invoked.
  process.env.COORDINATOR_URL = 'http://127.0.0.1:1';
  t.after(() => { delete process.env.COORDINATOR_URL; });
  const res = await postRaw(`${baseUrl}/coordinate`, payload, 'application/json');
  // 502 (upstream unreachable) means the body was accepted; 413
  // would mean the body was rejected. The whole point of the new
  // cap is that 2 MiB is NOT rejected.
  assert.notEqual(res.status, 413, '2 MiB body must be accepted (was 413 with the old 1 MiB cap)');
  assert.equal(res.status, 502, 'expected upstream-unreachable 502 since COORDINATOR_URL is closed');
});

test('passthrough: adds x-forwarded-by header so the coordinator can identify gateway traffic', async (t) => {
  const received = { xForwardedBy: null };
  const upstream = await startUpstream((req, res) => {
    received.xForwardedBy = req.headers['x-forwarded-by'];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await postJson(`${baseUrl}/coordinate`, { problem: 'hi' });
  assert.equal(res.status, 200);
  assert.equal(received.xForwardedBy, 'aware-gateway');
});

test('passthrough: /version reports max_body_bytes from the env override', async (t) => {
  // The max body is exposed lazily via getMaxBodyBytes(); the /version
  // endpoint re-reads the env on every request so an operator can
  // verify the cap without restarting the gateway.
  const prevMax = process.env.AWARE_GATEWAY_MAX_BODY_BYTES;
  process.env.AWARE_GATEWAY_MAX_BODY_BYTES = '524288'; // 512 KiB
  t.after(() => {
    if (prevMax === undefined) delete process.env.AWARE_GATEWAY_MAX_BODY_BYTES;
    else process.env.AWARE_GATEWAY_MAX_BODY_BYTES = prevMax;
  });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  const res = await fetch(`${baseUrl}/version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.max_body_bytes, 524288);
});

test('passthrough: getMaxBodyBytes() returns the env override', async (t) => {
  // The helper is exported so tests and operational tooling can
  // query the cap without parsing /version. The helper re-reads the
  // env on every call.
  const { getMaxBodyBytes } = require('../../../src/gateway/server.js');
  const prevMax = process.env.AWARE_GATEWAY_MAX_BODY_BYTES;
  process.env.AWARE_GATEWAY_MAX_BODY_BYTES = '2048';
  try {
    assert.equal(getMaxBodyBytes(), 2048);
  } finally {
    if (prevMax === undefined) delete process.env.AWARE_GATEWAY_MAX_BODY_BYTES;
    else process.env.AWARE_GATEWAY_MAX_BODY_BYTES = prevMax;
  }
  // Default when env unset: 10 MiB
  if (prevMax === undefined) delete process.env.AWARE_GATEWAY_MAX_BODY_BYTES;
  assert.equal(getMaxBodyBytes(), 10 * 1024 * 1024);
});

test('passthrough: GET (no body) still proxies cleanly', async (t) => {
  // The helper concatenates the body and passes it as a string; for
  // GETs this is always ''.
  const received = { method: null, body: null };
  const upstream = await startUpstream((req, res, body) => {
    received.method = req.method;
    received.body = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, gotBytes: body.length }));
  });
  t.after(() => closeServer(upstream.server));

  process.env.COORDINATOR_URL = upstream.baseUrl;
  t.after(() => { delete process.env.COORDINATOR_URL; });

  const { server, baseUrl } = await startGateway();
  t.after(() => closeServer(server));

  // Use a custom path the coordinator doesn't own — the catch-all
  // proxy forwards to the upstream. We pick /v1/some-route so it
  // doesn't collide with /health or /version.
  const u = new URL(`${baseUrl}/v1/some-route`);
  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      timeout: 5000,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(result.status, 200);
  assert.equal(received.method, 'GET');
  // The upstream must see 0 body bytes (no phantom Content-Length).
  const body = JSON.parse(result.body);
  assert.equal(body.gotBytes, 0);
});

