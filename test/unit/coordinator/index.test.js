// test/unit/coordinator/index.test.js — coordinator entry point + buildDefaultRouter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  coordinate,
  COORDINATOR_VERSION,
  COORDINATOR_BUILD_PHASE,
  buildDefaultRouter,
  buildDefaultOllamaClient,
} from '../../../src/coordinator/index.js';

test('buildDefaultRouter accepts opts.heavyThinkPath (used by tests + Docker image)', async () => {
  // Absolute path to the actual heavy-think source (sibling repo at $REPO_PARENT/heavy-think/)
  // From test/unit/coordinator/, 4 `..` lands at $REPO_PARENT, then heavy-think/...
  const heavyThinkAbs = new URL('../../../../heavy-think/src/index.js', import.meta.url).pathname;
  const router = await buildDefaultRouter({
    heavyThinkPath: heavyThinkAbs,
    mode: 'online',
    minimaxClient: { name: 'minimax', generate: async () => ({ reasoning: 'r' }) },
    ollamaClient: { name: 'ollama', offline: true, generate: async () => ({ reasoning: 'r' }) },
  });
  const r = await router.generate('test');
  assert.equal(r.reasoning, 'r');
});

test('buildDefaultRouter honors AWARE_HEAVY_THINK_PATH env var', async () => {
  const prev = process.env.AWARE_HEAVY_THINK_PATH;
  process.env.AWARE_HEAVY_THINK_PATH = new URL('../../../../heavy-think/src/index.js', import.meta.url).pathname;
  try {
    const router = await buildDefaultRouter({
      mode: 'online',
      minimaxClient: { name: 'minimax', generate: async () => ({ reasoning: 'env-path' }) },
    });
    const r = await router.generate('test');
    assert.equal(r.reasoning, 'env-path');
  } finally {
    if (prev === undefined) delete process.env.AWARE_HEAVY_THINK_PATH;
    else process.env.AWARE_HEAVY_THINK_PATH = prev;
  }
});

test('buildDefaultRouter errors loudly if heavy-think path cannot be resolved', async () => {
  // Both injection and env point at a missing file
  const prev = process.env.AWARE_HEAVY_THINK_PATH;
  process.env.AWARE_HEAVY_THINK_PATH = '/nonexistent/heavy-think/src/index.js';
  try {
    await assert.rejects(
      () =>
        buildDefaultRouter({
          mode: 'online',
          minimaxClient: { name: 'minimax', generate: async () => ({}) },
        }),
      /Cannot find module|Cannot load|ENOENT/,
    );
  } finally {
    if (prev === undefined) delete process.env.AWARE_HEAVY_THINK_PATH;
    else process.env.AWARE_HEAVY_THINK_PATH = prev;
  }
});

test('COORDINATOR_VERSION and COORDINATOR_BUILD_PHASE are exposed and reflect Phase 1 progress', () => {
  // Phase 1 passthrough (ADR-022) closes the two open items from
  // commit 301f672d: passthrough wrap (gateway proxy body-handling)
  // and api.pluginConfig plumbing. The version reflects the bump.
  assert.equal(COORDINATOR_VERSION, '0.3.0-phase-1-pluginconfig');
  assert.equal(COORDINATOR_BUILD_PHASE, 'phase-1-passthrough');
});

test('coordinate() returns a result envelope (delegates to awareHeavyThink)', async () => {
  const result = await coordinate({
    problem: 'p',
    K: 1,
    task_type: 'simple',
    client: {
      async generate() { return { reasoning: 'r' }; },
    },
  });
  assert.equal(result.ok, true);
});

test('buildDefaultRouter in hybrid mode includes both clients', async () => {
  const router = await buildDefaultRouter({
    mode: 'hybrid',
    minimaxClient: { name: 'minimax-stub', generate: async () => ({ reasoning: 'm' }) },
    ollamaClient: { name: 'ollama-stub', offline: true, generate: async () => ({ reasoning: 'o' }) },
  });
  // Probe a generate; primary should win
  const result = await router.generate('hi');
  assert.equal(result._routed_via, 'minimax-stub');
  assert.equal(result.reasoning, 'm');
});

test('buildDefaultRouter in offline mode excludes the online client', async () => {
  const router = await buildDefaultRouter({
    mode: 'offline',
    minimaxClient: { name: 'minimax-stub', generate: async () => ({ reasoning: 'm' }) },
    ollamaClient: { name: 'ollama-stub', offline: true, generate: async () => ({ reasoning: 'o' }) },
  });
  const result = await router.generate('hi');
  assert.equal(result._routed_via, 'ollama-stub');
});

test('buildDefaultRouter in online mode excludes the offline client', async () => {
  const router = await buildDefaultRouter({
    mode: 'online',
    minimaxClient: { name: 'minimax-stub', generate: async () => ({ reasoning: 'm' }) },
    ollamaClient: { name: 'ollama-stub', offline: true, generate: async () => ({ reasoning: 'o' }) },
  });
  const result = await router.generate('hi');
  assert.equal(result._routed_via, 'minimax-stub');
});

test('buildDefaultRouter falls back from minimax to ollama in hybrid mode', async () => {
  const router = await buildDefaultRouter({
    mode: 'hybrid',
    minimaxClient: { name: 'minimax', generate: async () => { throw new Error('502 from minimax'); } },
    ollamaClient: { name: 'ollama', offline: true, generate: async () => ({ reasoning: 'from ollama' }) },
  });
  const result = await router.generate('hi');
  assert.equal(result._routed_via, 'ollama');
  assert.equal(result.reasoning, 'from ollama');
});

test('buildDefaultRouter without env var or opts: minimax stub fails, ollama stub works', async () => {
  // No env, no opts → default minimax stub throws "no API key",
  // default ollama stub hits a port that's not listening
  // → both fail → router throws
  // Use a custom ollama client to avoid the real port issue
  const router = await buildDefaultRouter({
    mode: 'hybrid',
    ollamaClient: { name: 'ollama', offline: true, generate: async () => ({ reasoning: 'fallback' }) },
  });
  // Save and clear env var to ensure minimax stub is used
  const saved = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    const result = await router.generate('hi');
    // The minimax stub throws, ollama stub succeeds
    assert.equal(result._routed_via, 'ollama');
    assert.equal(result.reasoning, 'fallback');
  } finally {
    if (saved !== undefined) process.env.LLM_API_KEY = saved;
  }
});

// === buildDefaultOllamaClient against a real local HTTP server ===

test('buildDefaultOllamaClient hits /api/generate and returns response field', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // Verify Ollama's expected request shape
      const parsed = JSON.parse(body);
      assert.ok(parsed.model, 'Ollama request should have a model field');
      assert.ok(parsed.prompt, 'Ollama request should have a prompt field');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: 'hello from ollama' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const client = buildDefaultOllamaClient(`http://127.0.0.1:${port}`);
    const result = await client.generate('test prompt', { model: 'qwen2.5:7b' });
    assert.equal(result.reasoning, 'hello from ollama');
    assert.equal(result.cost_usd, 0);  // local inference
  } finally {
    server.close();
  }
});

test('buildDefaultOllamaClient throws on non-2xx with error body included', async () => {
  const server = createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal ollama failure');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const client = buildDefaultOllamaClient(`http://127.0.0.1:${port}`);
    await assert.rejects(
      client.generate('test'),
      /Ollama API 500.*internal ollama failure/
    );
  } finally {
    server.close();
  }
});
