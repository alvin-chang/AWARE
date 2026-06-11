// test/unit/coordinator/model-router.test.js — 3-tier model router
// Verifies real fallback semantics with mocked clients. No real network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeModelRouter, makeOllamaHealth } from '../../../src/coordinator/model-router.js';

// === Test helpers ===

function mockClient(name, { healthy = () => Promise.resolve(true), generate, generateDelay = 0, offline = false } = {}) {
  return {
    name,
    offline,
    healthy,
    async generate(prompt, opts) {
      if (generateDelay) await new Promise(r => setTimeout(r, generateDelay));
      return await generate(prompt, opts);
    },
  };
}

function alwaysFails(name, errMsg = 'mocked failure') {
  return mockClient(name, {
    generate: async () => { throw new Error(errMsg); },
  });
}

function alwaysWorks(name, response = { reasoning: 'ok' }, opts = {}) {
  return mockClient(name, { generate: async () => response, ...opts });
}

// Default helper: an Ollama-style offline client
function ollamaClient(name, opts = {}) {
  return alwaysWorks(name, opts.response || { reasoning: `from ${name}` }, { offline: true, ...opts.others });
}

// === Mode validation ===

test('makeModelRouter throws on empty clients array', () => {
  assert.throws(() => makeModelRouter({ clients: [] }), /non-empty array/);
});

test('makeModelRouter throws on invalid mode', () => {
  assert.throws(
    () => makeModelRouter({ clients: [alwaysWorks('a')], mode: 'broken' }),
    /mode must be one of/
  );
});

test('makeModelRouter throws on client without name/generate', () => {
  assert.throws(
    () => makeModelRouter({ clients: [{ generate: () => {} }] }),
    /name: string/
  );
  assert.throws(
    () => makeModelRouter({ clients: [{ name: 'x' }] }),
    /generate: function/
  );
});

// === Online mode ===

test('online mode uses online clients and skips offline', async () => {
  const online = alwaysWorks('minimax', { reasoning: 'from minimax' });
  const offline = ollamaClient('ollama', { response: { reasoning: 'from ollama' } });
  const r = makeModelRouter({ clients: [online, offline], mode: 'online' });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from minimax');
  assert.equal(result._routed_via, 'minimax');
  assert.equal(r.whichClient(), 'minimax');
});

test('online mode throws if primary fails (no offline fallback)', async () => {
  const online = alwaysFails('minimax', '502 bad gateway');
  const offline = ollamaClient('ollama');
  const r = makeModelRouter({ clients: [online, offline], mode: 'online' });

  await assert.rejects(
    r.generate('hi'),
    /all 1 backends failed/
  );
});

// === Hybrid mode (the ADR-020 default) ===

test('hybrid mode uses primary on success', async () => {
  const minimax = alwaysWorks('minimax', { reasoning: 'from minimax' });
  const ollama = ollamaClient('ollama', { response: { reasoning: 'from ollama' } });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from minimax');
  assert.equal(result._routed_via, 'minimax');
});

test('hybrid mode falls back to Ollama when minimax fails', async () => {
  const minimax = alwaysFails('minimax', '502 from minimax');
  const ollama = ollamaClient('ollama', { response: { reasoning: 'from ollama' } });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from ollama');
  assert.equal(result._routed_via, 'ollama');
  assert.equal(r.whichClient(), 'ollama');
});

test('hybrid mode throws when BOTH backends fail', async () => {
  const minimax = alwaysFails('minimax', '502 from minimax');
  const ollama = mockClient('ollama', {
    offline: true,
    generate: async () => { throw new Error('connection refused'); },
  });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  await assert.rejects(r.generate('hi'), /all 2 backends failed/);
});

// === Offline mode ===

test('offline mode uses only offline (Ollama) clients', async () => {
  // Even if we pass a "minimax" client, offline mode should not invoke it
  let minimaxCalled = false;
  const minimax = mockClient('minimax', {
    generate: async () => { minimaxCalled = true; return { reasoning: 'should not happen' }; },
  });
  const ollama = ollamaClient('ollama', { response: { reasoning: 'from ollama offline' } });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'offline' });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from ollama offline');
  assert.equal(result._routed_via, 'ollama');
  assert.equal(minimaxCalled, false, 'minimax should not be called in offline mode');
});

test('offline mode throws if no offline client is configured', async () => {
  // No {offline: true} client → all clients excluded → throws on construction
  const online = alwaysWorks('minimax');
  assert.throws(
    () => makeModelRouter({ clients: [online], mode: 'offline' }),
    /excludes all configured clients/
  );
});

// === Health probing ===

test('router skips client whose health() returns false (cached)', async () => {
  let minimaxCalled = false;
  const minimax = mockClient('minimax', {
    healthy: () => Promise.resolve(false),
    generate: async () => { minimaxCalled = true; return { reasoning: 'should not happen' }; },
  });
  const ollama = alwaysWorks('ollama', { reasoning: 'from ollama' });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid', healthTtlMs: 60_000 });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from ollama');
  assert.equal(minimaxCalled, false, 'minimax must be skipped on health probe failure');
});

test('router skips client whose health() throws (treated as unhealthy)', async () => {
  let minimaxCalled = false;
  const minimax = mockClient('minimax', {
    healthy: () => { throw new Error('probe error'); },
    generate: async () => { minimaxCalled = true; return { reasoning: 'should not happen' }; },
  });
  const ollama = alwaysWorks('ollama', { reasoning: 'from ollama' });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  const result = await r.generate('hi');
  assert.equal(result.reasoning, 'from ollama');
  assert.equal(minimaxCalled, false);
});

test('health() reports per-client status and overall ok', async () => {
  const minimax = mockClient('minimax', { healthy: () => Promise.resolve(true) });
  const ollama = mockClient('ollama', { healthy: () => Promise.resolve(false) });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  const h = await r.health();
  assert.equal(h.ok, false);  // overall: ollama is down
  assert.equal(h.mode, 'hybrid');
  assert.equal(h.clients.minimax.ok, true);
  assert.equal(h.clients.ollama.ok, false);
});

test('health() reports ok:true when all clients are healthy', async () => {
  const minimax = mockClient('minimax', { healthy: () => Promise.resolve(true) });
  const ollama = mockClient('ollama', { healthy: () => Promise.resolve(true) });
  const r = makeModelRouter({ clients: [minimax, ollama], mode: 'hybrid' });

  const h = await r.health();
  assert.equal(h.ok, true);
});

test('health() defaults to healthy when client has no healthy() function', async () => {
  const client = { name: 'no-probe', generate: async () => ({ reasoning: 'x' }) };
  const r = makeModelRouter({ clients: [client], mode: 'online' });

  const h = await r.health();
  assert.equal(h.ok, true);
  assert.equal(h.clients['no-probe'].ok, true);
});

// === Health probe timeout ===

test('health probe times out and marks client unhealthy', async () => {
  const slow = mockClient('slow', {
    healthy: () => new Promise((resolve) => setTimeout(() => resolve(true), 10_000)),
  });
  const r = makeModelRouter({
    clients: [slow],
    mode: 'online',
    healthTimeoutMs: 100,  // aggressive timeout
  });

  const start = Date.now();
  const h = await r.health();
  const elapsed = Date.now() - start;

  assert.equal(h.ok, false);
  assert.equal(h.clients.slow.ok, false);
  assert.ok(elapsed < 1_000, `health should have timed out fast, took ${elapsed}ms`);
});

// === Health cache ===

test('health probe is cached across calls within TTL', async () => {
  let probeCount = 0;
  const client = mockClient('cached', {
    healthy: () => { probeCount++; return Promise.resolve(true); },
  });
  const r = makeModelRouter({ clients: [client], mode: 'online', healthTtlMs: 60_000 });

  await r.health();
  await r.health();
  await r.health();

  // The first call probes, subsequent two use cache
  assert.equal(probeCount, 1, `expected 1 probe call, got ${probeCount}`);
});

test('after a failed generate, health cache marks the client unhealthy', async () => {
  let probeCount = 0;
  const flaky = mockClient('flaky', {
    healthy: () => { probeCount++; return Promise.resolve(true); },
    generate: async () => { throw new Error('boom'); },
  });
  const fallback = alwaysWorks('fallback', { reasoning: 'from fallback' });
  const r = makeModelRouter({ clients: [flaky, fallback], mode: 'hybrid', healthTtlMs: 60_000 });

  // First call: probes flaky (1), generates (fails), probes fallback, succeeds
  const result1 = await r.generate('hi');
  assert.equal(result1._routed_via, 'fallback');

  // Second call: should NOT re-probe flaky (it's cached as unhealthy), should NOT re-probe fallback either
  // because generate success marks it healthy
  const result2 = await r.generate('hi');
  assert.equal(result2._routed_via, 'fallback');
  assert.ok(probeCount <= 2, `expected at most 2 probes, got ${probeCount}`);
});

// === Error envelope ===

test('when all backends fail, error includes routerErrors array with per-client details', async () => {
  const a = alwaysFails('a', '503 service unavailable');
  const b = alwaysFails('b', 'connection refused');
  const r = makeModelRouter({ clients: [a, b], mode: 'hybrid' });

  try {
    await r.generate('hi');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.routerErrors.length, 2);
    assert.equal(err.routerErrors[0].client, 'a');
    assert.equal(err.routerErrors[0].error, '503 service unavailable');
    assert.equal(err.routerErrors[1].client, 'b');
    assert.equal(err.routerErrors[1].error, 'connection refused');
  }
});

// === makeOllamaHealth ===

test('makeOllamaHealth returns a function', () => {
  const probe = makeOllamaHealth({ baseUrl: 'http://127.0.0.1:1' });  // unreachable port
  assert.equal(typeof probe, 'function');
});

test('makeOllamaHealth resolves to false on connection error', async () => {
  const probe = makeOllamaHealth({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 200 });
  // Port 1 should reject immediately
  const result = await probe();
  assert.equal(result, false);
});

test('makeOllamaHealth resolves to true when Ollama responds 200', async () => {
  // Spin up a tiny in-process HTTP server
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"models":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const probe = makeOllamaHealth({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2_000 });
    const result = await probe();
    assert.equal(result, true);
  } finally {
    server.close();
  }
});
