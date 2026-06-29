// src/clients/minimax.js — minimax client for heavy_think
// Reads LLM_API_KEY from env at call time (not at module load).
// Refuses to start without a key. Provides the { generate(prompt, opts) }
// interface heavy_think expects.
//
// Endpoints (from ${OPENCLAW_CONFIG}/openclaw.json):
//   baseUrl: https://api.minimax.io/anthropic  (Anthropic-compatible)
//   model:   MiniMax-M3  (1M context, 131072 max output, xhigh thinking)
//
// This module is hermetic — no env read at import time, no key extraction,
// no network call until generate() is invoked. Tests pass a stub client.

const DEFAULT_BASE_URL = 'https://api.minimax.io/anthropic';
const DEFAULT_MODEL = 'MiniMax-M3';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

// PRM judges must be deterministic for ranking to be reproducible.
// K-parallel reasoning attempts should stay diverse (API-default temperature).
// Per ADR-038 (noise floor finding): without temperature=0, PRM scoring is
// dominated by sampling noise (|mean|/stddev < 1.0 on 2/3 tested prompts).
// Override via opts.temperature (explicit non-null value wins).
function resolveTemperature(opts) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'temperature')) {
    return opts.temperature;
  }
  if (opts && opts.phase === 'prm_score') {
    return 0;
  }
  return null;  // let the API decide (default = 1.0 for Anthropic-compatible)
}

export function makeMinimaxClient(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const apiKey = options.apiKey || process.env.LLM_API_KEY;
  const fetchImpl = options._fetch || globalThis.fetch;

  if (!apiKey) {
    throw new Error(
      'makeMinimaxClient: LLM_API_KEY is not set. ' +
      'Set it in your environment (e.g. `export LLM_API_KEY=*** ' +
      'or pass { apiKey } explicitly. ' +
      'For tests, use a mock client instead.'
    );
  }

  return {
    provider: 'minimax',
    model,
    async generate(prompt, opts = {}) {
      const useMaxTokens = opts.max_tokens || maxTokens;
      const useModel = opts.model || model;
      const temperature = resolveTemperature(opts);

      // MR-HIGH-002 fix: accept either a string (legacy) or { system, user }
      // shape. When given { system, user }, build two-role messages so the
      // model has architectural separation between system instructions and
      // user input. This is the actual fix for the prompt-injection
      // structural ambiguity — user content cannot impersonate system.
      let messages;
      if (typeof prompt === 'string') {
        messages = [{ role: 'user', content: prompt }];
      } else if (prompt && typeof prompt === 'object') {
        if (prompt.system && prompt.user) {
          messages = [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ];
        } else if (prompt.user) {
          // system omitted → fall back to single user role
          messages = [{ role: 'user', content: prompt.user }];
        } else {
          throw new Error('minimax generate: prompt object must have either .system+.user or just .user');
        }
      } else {
        throw new Error(`minimax generate: prompt must be a string or {system,user} object, got ${typeof prompt}`);
      }

      const body = {
        model: useModel,
        max_tokens: useMaxTokens,
        messages,
      };
      if (temperature !== null) {
        body.temperature = temperature;
      }

      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const respBody = await res.text();
        throw new Error(
          `minimax API ${res.status} ${res.statusText}: ${respBody.slice(0, 500)}`
        );
      }

      const data = await res.json();
      const text = extractText(data);
      const cost = estimateCost(useModel, useMaxTokens, data);

      return { reasoning: text, cost_usd: cost };
    },
  };
}

// Extract text from Anthropic-compatible response shape.
// data.content is an array of { type, text } or { type, ... } blocks.
function extractText(data) {
  if (!data || !Array.isArray(data.content)) return '';
  return data.content
    .filter(block => block && (block.type === 'text' || typeof block.text === 'string'))
    .map(block => block.text || '')
    .join('\n');
}

// Rough cost estimate. We don't have official minimax pricing, so this is a
// conservative upper-bound placeholder. Real PRM scoring cost will be tracked
// in the budget watchdog (Phase 2) using actual token counts from the API.
function estimateCost(model, maxTokens, response) {
  if (!response || !response.usage) return 0.001;  // conservative default
  const input = response.usage.input_tokens || 0;
  const output = response.usage.output_tokens || 0;
  // Per ADR-020: PRM calls should be cheap. If M3 costs more than ~$0.01/call
  // we have a problem — the budget watchdog will catch it.
  // Assumed rates: $1/M input, $3/M output (placeholder until real pricing known).
  return (input * 1 + output * 3) / 1_000_000;
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL, ANTHROPIC_VERSION };
