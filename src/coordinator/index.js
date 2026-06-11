// AWARE 2.0 coordinator service — entry point
// Per ADR-020 Decision 1: persistent coordinator session + lightweight task workers
// Per ADR-020 Decision 3: 3-tier model fallback (minimax → Ollama)
//
// Heavy-think is a sibling repo. The dev layout imports it via a relative
// path. The Docker image layout (see Dockerfile.coordinator) puts heavy-think
// at ./heavy-think/, so we resolve the import dynamically based on the
// AWARE_HEAVY_THINK_PATH env var, falling back to the dev layout.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { awareHeavyThink } from './heavyskill-integration.js';
import { makeModelRouter, makeOllamaHealth } from './model-router.js';

export const COORDINATOR_VERSION = '0.2.0-phase-1-router';
export const COORDINATOR_BUILD_PHASE = 'phase-1-partial';

/**
 * Resolve the filesystem path to the heavy-think package.
 *
 * Resolution order:
 *   1. `opts.heavyThinkPath` (explicit injection; used by tests)
 *   2. `process.env.AWARE_HEAVY_THINK_PATH` (used in the Docker image)
 *   3. Dev layout: ../../../../src/heavy-think/src/index.js
 *      (resolves to <repo-root>/ from <repo-root>/src/coordinator/)
 */
function resolveHeavyThinkPath(opts = {}) {
  if (opts.heavyThinkPath) return opts.heavyThinkPath;
  if (process.env.AWARE_HEAVY_THINK_PATH) return process.env.AWARE_HEAVY_THINK_PATH;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'src', 'heavy-think', 'src', 'index.js');
}

/**
 * Backwards-compatible `coordinate()` wrapper.
 *
 * Phase 1: defaults to a stub client. Callers wanting real model routing
 * should use `buildDefaultRouter()` and pass its `generate` as the client.
 *
 * @param {Object} options
 * @param {string} options.problem
 * @param {string} [options.task_type='standard']
 * @param {Object} [options.context]
 * @param {number} [options.K]
 * @param {Object} [options.client] — heavy_think-compatible client
 * @param {string} [options.sessionId]
 * @param {string} [options.agentId]
 */
export async function coordinate({ problem, task_type, context, K, client, sessionId, agentId }) {
  return await awareHeavyThink({
    problem,
    task_type: task_type || 'standard',
    context: { ...context, sessionId, agentId },
    K,
    client,
  });
}

/**
 * Build the default AWARE 2.0 model router.
 *
 * The router is constructed lazily so tests and offline development don't
 * require a live model. Callers can pass their own router via `router` to
 * override the default.
 *
 * @param {Object} [opts]
 * @param {string} [opts.mode='hybrid'] — 'online' | 'hybrid' | 'offline'
 * @param {Object} [opts.minimaxClient] — pre-built minimax client (defaults to env-driven makeMinimaxClient from heavy-think)
 * @param {Object} [opts.ollamaClient] — pre-built Ollama client (defaults to a stub when not running)
 * @param {string} [opts.ollamaUrl='http://127.0.0.1:11434'] — Ollama base URL
 * @returns {Object} router
 */
export async function buildDefaultRouter(opts = {}) {
  const heavyThinkPath = resolveHeavyThinkPath(opts);
  const { makeMinimaxClient } = await import(heavyThinkPath);

  const mode = opts.mode || process.env.AWARE_MODE || 'hybrid';
  const ollamaUrl = opts.ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

  // Online: minimax (or whatever's passed in)
  let minimax;
  if (opts.minimaxClient) {
    minimax = opts.minimaxClient;
  } else if (process.env.<redacted-credential-name>) {
    minimax = {
      name: 'minimax',
      generate: async (prompt, genOpts) => {
        const client = makeMinimaxClient();
        return await client.generate(prompt, genOpts);
      },
    };
  } else {
    // No API key — provide a stub that fails loudly so the router knows
    // to fall back (in hybrid/offline mode) or to error (in online mode).
    minimax = {
      name: 'minimax',
      generate: async () => {
        throw new Error('minimax API client: <redacted-credential-name> is not set; cannot generate');
      },
    };
  }

  // Offline: Ollama (always present, even in online mode it's just unused)
  // The Ollama client wraps the Ollama HTTP API.
  const ollama = opts.ollamaClient || buildDefaultOllamaClient(ollamaUrl);

  return makeModelRouter({
    clients: [minimax, ollama],
    mode,
  });
}

/**
 * Build a minimal Ollama client (the /api/generate endpoint).
 * Uses Node's built-in fetch (Node 18+).
 */
function buildDefaultOllamaClient(baseUrl) {
  return {
    name: 'ollama',
    offline: true,
    healthy: makeOllamaHealth({ baseUrl }),
    async generate(prompt, opts = {}) {
      const model = opts.model || 'qwen2.5:7b';
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(opts.timeout_ms || 60_000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
      }
      const data = await res.json();
      return {
        reasoning: data.response || '',
        cost_usd: 0,  // local inference
      };
    },
  };
}

export { makeModelRouter, makeOllamaHealth, buildDefaultOllamaClient };
export { awareHeavyThink } from './heavyskill-integration.js';
