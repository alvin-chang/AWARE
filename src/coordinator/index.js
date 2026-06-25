// AWARE 2.0 coordinator service — entry point
// Per ADR (internal) Decision 1: persistent coordinator session + lightweight task workers
// Per ADR (internal) Decision 3: 3-tier model fallback (provider → Ollama)
//
// rl-pipeline is a sibling repo. The dev layout imports it via a relative
// path. The Docker image layout (see Dockerfile.coordinator) puts rl-pipeline
// at ./rl-pipeline/, so we resolve the import dynamically based on the
// AWARE_RL_PIPELINE_PATH env var, falling back to the dev layout.

import { awareRlPipeline } from './rl-pipeline-bridge-integration.js';
import { makeModelRouter, makeOllamaHealth } from './model-router.js';
import { makeLoraReloader } from './lora-reloader.js';
import { resolveKFromPluginConfig, validatePluginConfig, K_PLUGIN_CONFIG_VERSION } from './plugin-config.js';
import config from '../config/index.cjs';

export const COORDINATOR_VERSION = '0.3.0-phase-1-pluginconfig';
export const COORDINATOR_BUILD_PHASE = 'phase-1-passthrough';

export { resolveKFromPluginConfig, validatePluginConfig, K_PLUGIN_CONFIG_VERSION } from './plugin-config.js';

/**
 * Resolve the filesystem path to the rl-pipeline package.
 *
 * Resolution order:
 *   1. `opts.rlPipelinePath` (explicit injection; used by tests)
 *   2. `config.rlPipeline.path` (reads process.env.AWARE_RL_PIPELINE_PATH,
 *      falls back to the dev layout)
 *
 * The config module owns the env-var lookup so the coordinator doesn't
 * have to know the env-var name. Tests that want to override set
 * `opts.rlPipelinePath` directly.
 */
function resolveRlPipelinePath(opts = {}) {
  if (opts.rlPipelinePath) return opts.rlPipelinePath;
  return config.rlPipeline.path;
}

/**
 * Backwards-compatible `coordinate()` wrapper.
 *
 * Phase 1: defaults to a stub client. Callers wanting real model routing
 * should use `buildDefaultRouter()` and pass its `generate` as the client.
 *
 * Phase 1 passthrough: `pluginConfig` is the per-call plugin-local
 * config (parsed `plugins.entries.<id>.config` object, e.g. from the
 * rl-pipeline-bridge OC shim's `api.pluginConfig`). When present, the
 * coordinator uses it to resolve K (priority: explicit `K` >
 * `pluginConfig.agentDefaults.K` when enabled > `pluginConfig.defaultK`
 * > `defaultKForTaskType(task_type)`). The validated pluginConfig is
 * also passed through to `awareRlPipeline` for downstream use and is
 * echoed in the result envelope for audit.
 *
 * @param {Object} options
 * @param {string} options.problem
 * @param {string} [options.task_type='standard']
 * @param {Object} [options.context]
 * @param {number} [options.K]
 * @param {Object} [options.client] — rl_pipeline-compatible client
 * @param {string} [options.sessionId]
 * @param {string} [options.agentId]
 * @param {string} [options.pairsDir] — override AWARE_PAIRS_DIR for this call
 * @param {Object} [options.pluginConfig] — per-plugin config (ADR (internal)
 *   plugin-local config surface). Shape: `{ defaultK?: number,
 *   autoEnable?: boolean, agentDefaults?: { enabled?: boolean, K?: number } }`.
 *   Unknown keys are stripped (strict validation). A bad shape is
 *   silently treated as "no pluginConfig" so a misbehaving caller
 *   doesn't break the request path; the validation is logged on the
 *   envelope for observability.
 * @param {string} [options.system_prompt] — MR-HIGH-002 fix: when present,
 *   the system prompt is forwarded to rl_pipeline as a separate role
 *   instead of being concatenated into the user message. This is the
 *   architectural fix for the prompt-injection structural ambiguity.
 *   If absent, derived from `task_type` via TASK_GUIDANCE (preserves the
 *   legacy behavior of having system guidance in the prompt at all).
 */
export async function coordinate({ problem, task_type, context, K, client, sessionId, agentId, pairsDir, pluginConfig, system_prompt }) {
  // MR-HIGH-001 / MR-HIGH-002: Input-side prompt-injection defense.
  // The user-supplied `problem` is forwarded to the model. With MR-HIGH-002
  // fixed architecturally (system-prompt isolation), the rule-based filter
  // here is defense-in-depth: a belt-and-suspenders measure for attacks
  // that try to alter `problem` itself (rather than impersonate the system).
  if (typeof problem === 'string' && detectPromptInjection(problem)) {
    const err = new Error('problem rejected by injection filter');
    err.code = 'invalid_input';
    err.category = 'prompt_injection_suspected';
    err.pattern = 'rule_based_v1';
    throw err;
  }

  // Validate the pluginConfig shape (silent on failure — we don't want
  // a misconfigured caller to break the coordinator's request path).
  // The validator returns { ok, value, errors? }; `value` is the
  // sanitized object (unknown keys stripped) or null on failure.
  const pcValidation = validatePluginConfig(pluginConfig);

  // Resolve K through the priority order. When pluginConfig is invalid
  // we fall through to the per-task-type default (i.e., behave as if
  // pluginConfig were absent).
  const resolvedK = resolveKFromPluginConfig({
    explicitK: K,
    pluginConfig: pcValidation.value,
    taskType: task_type || 'standard',
  });

  // MR-HIGH-002 fix: derive system_prompt from task_type if caller didn't
  // provide one. This ensures the rl-pipeline-side receives an explicit
  // system_prompt and uses { system, user } isolation — without changing
  // the behavior for legacy callers (same wording, just architecturally
  // separated from the user input).
  const effectiveSystemPrompt = system_prompt || TASK_GUIDANCE[task_type || 'standard'] || TASK_GUIDANCE.standard;

  return await awareRlPipeline({
    problem,
    task_type: task_type || 'standard',
    context: { ...context, sessionId, agentId },
    K: resolvedK.K,
    client,
    pairsDir: pairsDir || config.coordinator.pairsDir,
    pluginConfig: pcValidation.value,
    pluginConfigValidation: pcValidation,
    system_prompt: effectiveSystemPrompt,
  });
}

// MR-HIGH-001: rule-based prompt-injection detection. Conservative —
// matches a small set of high-confidence patterns. False positives are
// possible; the caller can inspect `category: 'prompt_injection_suspected'`
// to decide whether to retry with sanitized input.
const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all )?previous (?:instructions|prompts|rules)\b/i,
  /\bdisregard (?:all )?(?:prior|previous|above) (?:instructions|prompts|rules)\b/i,
  /\byou are now\b/i,
  /\bforget everything\b/i,
  /\bact as (?:a|an|the)\b/i,
  /\bpretend (?:to be|you are)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /\bsystem\s*prompt\s*[:=]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
];

function detectPromptInjection(text) {
  if (typeof text !== 'string' || text.length > 100_000) return false;
  for (const re of PROMPT_INJECTION_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// MR-HIGH-002 fix: TASK_GUIDANCE mirrors the same map in
// rl-pipeline/src/parallel.js. AWARE uses this to derive system_prompt
// from task_type when the caller doesn't pass one explicitly. The wording
// MUST stay in sync with rl-pipeline's map; if you change one, change the
// other. Tested by test/unit/coordinator/system-prompt-isolation.test.js.
export const TASK_GUIDANCE = {
  simple: 'You are a careful, concise problem-solver. Aim for the most direct correct answer.',
  standard: 'You are a thorough, careful problem-solver. Consider multiple angles. Show your reasoning.',
  security: 'You are a security-focused expert. Identify threats, attack vectors, and mitigations. Be exhaustive.',
  financial: 'You are a financial/audit expert. Show calculations, cite constraints, flag risks explicitly.',
  creative: 'You are a creative thinker. Explore non-obvious approaches. Prefer novel solutions to conventional ones.',
};

/**
 * Build the default AWARE 2.0 model router.
 *
 * The router is constructed lazily so tests and offline development don't
 * require a live model. Callers can pass their own router via `router` to
 * override the default.
 *
 * @param {Object} [opts]
 * @param {string} [opts.mode='hybrid'] — 'online' | 'hybrid' | 'offline'
 * @param {Object} [opts.providerClient] — pre-built provider client (defaults to env-driven makeProviderClient from rl-pipeline)
 * @param {Object} [opts.ollamaClient] — pre-built Ollama client (defaults to a stub when not running)
 * @param {string} [opts.ollamaUrl='http://127.0.0.1:11434'] — Ollama base URL
 * @returns {Object} router
 */
export async function buildDefaultRouter(opts = {}) {
  const rlPipelinePath = resolveRlPipelinePath(opts);
  const rlPipelineMod = await import(rlPipelinePath);
  // The sibling library exports `makeMinimaxClient` (its public API name);
  // AWARE references it as `makeProviderClient` on the public-facing surface.
  const makeProviderClient = rlPipelineMod.makeProviderClient || rlPipelineMod.makeMinimaxClient;

  const mode = opts.mode || config.model.mode;
  const ollamaUrl = opts.ollamaUrl || config.model.ollamaUrl;

  // Online: provider (or whatever's passed in)
  let provider;
  if (opts.providerClient) {
    provider = opts.providerClient;
  } else if (config.model.providerApiKey) {
    provider = {
      name: 'provider',
      generate: async (prompt, genOpts) => {
        const client = makeProviderClient();
        return await client.generate(prompt, genOpts);
      },
    };
  } else {
    // No API key — provide a stub that fails loudly so the router knows
    // to fall back (in hybrid/offline mode) or to error (in online mode).
    provider = {
      name: 'provider',
      generate: async () => {
        throw new Error('provider API client: LLM_API_KEY is not set; cannot generate');
      },
    };
  }

  // Offline: Ollama (always present, even in online mode it's just unused)
  // The Ollama client wraps the Ollama HTTP API.
  const ollama = opts.ollamaClient || buildDefaultOllamaClient(ollamaUrl);

  return makeModelRouter({
    clients: [provider, ollama],
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
export { makeLoraReloader, resolveActiveTarget, shouldReload, buildModelfile, postOllamaCreate } from './lora-reloader.js';
export { awareRlPipeline } from './rl-pipeline-bridge-integration.js';
