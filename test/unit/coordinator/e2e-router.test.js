// test/unit/coordinator/e2e-router.test.js
// End-to-end: the coordinator service wires the model router to rl-pipeline-bridge.
// Verifies that a problem flowing through the coordinator can hit either
// the primary or the fallback, depending on the router's mode and the
// state of the backends. Uses real local HTTP servers (not mocks) for
// both backends to prove the wiring is not just a mock-passing shell.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { awareRlPipeline } from '../../../src/coordinator/rl-pipeline-bridge-integration.js';
import { makeModelRouter } from '../../../src/coordinator/model-router.js';

function startFakeBackend({ name, statusCode = 200, responseBody }) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        name,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function clientFromBackend(backend, { offline = false } = {}) {
  return {
    name: backend.name,
    offline,
    async generate(prompt, opts) {
      const res = await fetch(`${backend.url}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, ...opts }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${backend.name} returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      return {
        reasoning: data.reasoning || '',
        cost_usd: data.cost_usd || 0,
      };
    },
  };
}

test('e2e: provider (primary) responds → router uses it, full pipeline completes', async () => {
  const provider = await startFakeBackend({
    name: 'the provider',
    responseBody: { reasoning: 'thinking through this problem carefully', cost_usd: 0.001 },
  });
  const ollama = await startFakeBackend({
    name: 'ollama',
    responseBody: { reasoning: 'local-model-thinking', cost_usd: 0 },
  });

  try {
    const router = makeModelRouter({
      clients: [clientFromBackend(provider), clientFromBackend(ollama, { offline: true })],
      mode: 'hybrid',
    });

    // Use the router's generate as the rl_pipeline client.
    // The whole pipeline runs: parallel → PRM scoring → refine → preference pair.
    // For the test we use a deterministic client for the rl_pipeline
    // internal calls, and the router for the LLM client slot.
    const result = await awareRlPipeline({
      problem: 'solve this',
      K: 2,
      task_type: 'simple',
      // The router's generate is rl_pipeline-compatible (it returns
      // { reasoning, cost_usd } and routes to a backend). But rl_pipeline
      // uses the client for K parallel calls AND PRM scoring AND refinement.
      // We want to confirm the router is used as the client; we don't care
      // about the rl_pipeline's internal pipeline details here.
      client: router,
      writePairs: false,
    });

    assert.equal(result.ok, true);
    assert.ok(result.refined_trace);
    // The router should have been called at least once (router is the
    // client, so rl_pipeline invokes router.generate for the parallel
    // attempts, the PRM scores, and the refinement)
    assert.ok(result.cost);
  } finally {
    await provider.close();
    await ollama.close();
  }
});

test('e2e: provider returns 500 → router falls back to ollama, pipeline still completes', async () => {
  const provider = await startFakeBackend({
    name: 'the provider',
    statusCode: 500,
    responseBody: { error: 'upstream model error' },
  });
  const ollama = await startFakeBackend({
    name: 'ollama',
    responseBody: { reasoning: 'ollama response', cost_usd: 0 },
  });

  try {
    const router = makeModelRouter({
      clients: [clientFromBackend(provider), clientFromBackend(ollama, { offline: true })],
      mode: 'hybrid',
    });

    const result = await awareRlPipeline({
      problem: 'fallback test',
      K: 1,
      task_type: 'simple',
      client: router,
      writePairs: false,
    });

    assert.equal(result.ok, true);
    // We can't directly assert which backend was used (the rl_pipeline
    // pipeline doesn't expose that), but the fact that it completed
    // successfully despite provider returning 500 proves the fallback worked.
  } finally {
    await provider.close();
    await ollama.close();
  }
});

test('e2e: both backends fail → awareRlPipeline returns error envelope (not throw)', async () => {
  const provider = await startFakeBackend({
    name: 'the provider',
    statusCode: 502,
    responseBody: { error: 'bad gateway' },
  });
  const ollama = await startFakeBackend({
    name: 'ollama',
    statusCode: 503,
    responseBody: { error: 'service unavailable' },
  });

  try {
    const router = makeModelRouter({
      clients: [clientFromBackend(provider), clientFromBackend(ollama, { offline: true })],
      mode: 'hybrid',
    });

    // First call will likely fail in the parallelReasoning stage, returning
    // an error envelope. The error envelope should be a proper response,
    // not an unhandled throw.
    const result = await awareRlPipeline({
      problem: 'all-fail test',
      K: 1,
      task_type: 'simple',
      client: router,
      writePairs: false,
    });

    // awareRlPipeline catches errors and returns { ok: false, error: {...} }
    // The router throws on all-fail, so the wrapper turns it into an error envelope
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.ok(result.error.message);
  } finally {
    await provider.close();
    await ollama.close();
  }
});
