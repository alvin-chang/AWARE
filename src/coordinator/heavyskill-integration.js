// AWARE 2.0 coordinator service — HeavySkill integration
// Wires the standalone heavy-think library into the AWARE coordinator.
// Per ADR-020 Decision 7: HeavySkill is a universal reasoning primitive available
// to all agents, called like a system tool.
//
// This shim does NOT reimplement HeavySkill logic — it just wraps it with
// AWARE-specific defaults (preference pair path, task types, error envelope,
// PRM score cache injection, pluginConfig passthrough for ADR-022 K+S).

import { join } from 'node:path';
import { homedir } from 'node:os';
import * as prmCache from '../db/prm-cache.js';
import config from '../config/index.cjs';

const DEFAULT_PAIRS_DIR = join(homedir(), '.<runtime>', 'metaclaw', 'preference-pairs');

// Lazy-load heavy-think from `config.heavyThink.path`. The previous static
// import `'../../../heavy-think/src/index.js'` resolved to `/heavy-think/...`
// in the Docker image (where `WORKDIR=/app`), but the actual location baked
// by Dockerfile.coordinator is `/app/heavy-think/`. The static path ignored
// `AWARE_HEAVY_THINK_PATH` and caused the coordinator to crash-loop on
// import-time `ERR_MODULE_NOT_FOUND`. Resolving via `config.heavyThink.path`
// honors the env override.
//
// We avoid top-level `await import()` because `heavyskill-integration.js`
// is transitively `require()`d from CJS code paths (rate-limit.test.js
// pulls in http-server.js → coordinator/index.js → this file), and
// top-level await turns the module into an "async module" that `require()`
// rejects with ERR_REQUIRE_ASYNC_MODULE. Instead we resolve heavy-think
// once on the first call to `awareHeavyThink` and cache the result.
let _heavyThinkMod = null;
let _heavyThinkLoadError = null;
let _heavyThinkLoadPromise = null;
async function loadHeavyThink() {
  if (_heavyThinkMod) return _heavyThinkMod;
  if (_heavyThinkLoadError) throw _heavyThinkLoadError;
  if (_heavyThinkLoadPromise) return _heavyThinkLoadPromise;
  _heavyThinkLoadPromise = import(config.heavyThink.path)
    .then((mod) => {
      if (typeof mod.heavy_think !== 'function') {
        throw new Error(
          `heavy_think not exported from ${config.heavyThink.path} — ` +
          `check that AWARE_HEAVY_THINK_PATH points at a heavy-think build >= v0.2.x`
        );
      }
      _heavyThinkMod = mod;
      return mod;
    })
    .catch((err) => {
      _heavyThinkLoadError = err;
      _heavyThinkLoadPromise = null; // allow retry on next call
      throw err;
    });
  return _heavyThinkLoadPromise;
}

// Test seam: lets unit tests force the heavy-think loader to a fresh state
// after they've swapped `process.env.AWARE_HEAVY_THINK_PATH` or mocked the
// `import` builtin. Not exported on the public surface — see
// test/unit/coordinator/heavyskill-integration.test.js for usage.
export function __resetHeavyThinkForTest() {
  _heavyThinkMod = null;
  _heavyThinkLoadError = null;
  _heavyThinkLoadPromise = null;
}

/**
 * AWARE coordinator wrapper around heavy_think.
 * Adds:
 *   - default preference-pair path under <host-config>/metaclaw/preference-pairs/
 *   - daily file rotation (one JSONL per UTC day)
 *   - standard error envelope for AWARE API responses
 *   - PRM score cache injection (Phase 2.2)
 *   - pluginConfig passthrough (ADR-022 — phase 1-passthrough): the
 *     per-call pluginConfig from the OC shim is echoed in the result
 *     envelope for audit, and its K-related fields have already been
 *     applied upstream in `coordinate()` so heavy-think sees the
 *     resolved K in `options.K`.
 *
 * @param {Object} options — same as heavy_think, plus:
 *   @param {string} [options.sessionId] — for traceability in the JSONL record
 *   @param {string} [options.agentId] — for traceability in the JSONL record
 *   @param {boolean} [options.writePairs=true] — set false to skip JSONL writes
 *   @param {string} [options.pairsDir] — override the default pair directory
 *   @param {boolean} [options.disableCache=false] — set true to skip the PRM cache for this call
 *   @param {Object} [options.pluginConfig] — validated plugin-local config
 *     from the OC shim. Echoed in the result envelope for audit.
 *   @param {Object} [options.pluginConfigValidation] — the { ok, errors? }
 *     shape from `validatePluginConfig`, also echoed for observability.
 */
export async function awareHeavyThink(options) {
  const writePairs = options.writePairs !== false;
  const pairsDir = options.pairsDir || DEFAULT_PAIRS_DIR;
  const pairPath = writePairs ? buildPairPath(pairsDir) : null;
  const disableCache = options.disableCache === true;
  const cache = !disableCache && prmCache.isCacheEnabled()
    ? {
        buildCacheKey: prmCache.buildCacheKey,
        getCachedScore: prmCache.getCachedScore,
        putCachedScore: prmCache.putCachedScore,
      }
    : null;

  try {
    // MR-HIGH-002 fix: forward system_prompt through to heavy_think so the
    // underlying reasoning + refinement + PRM scoring build { system, user }
    // message shapes. The system prompt is forwarded as-is; heavy_think is
    // responsible for routing it to the right pipeline stages.
    const { heavy_think: heavyThink } = await loadHeavyThink();
    const result = await heavyThink({
      ...options,
      preferencePairPath: pairPath,
      cache,
    });
    // Forward the pair_path from heavy-think's result so the conversation
    // logger can populate aware_conversations.pair_path. Without this,
    // the trainer's _fetchUnconsumedPairPaths returns 0 rows because the
    // WHERE clause pair_path IS NOT NULL filters them all out. Phase 2.4
    // data flywheel unblock.
    // HO-HIGH-001 (security audit 2026-06-25): surface an
    // autonomy_level alongside confidence so callers can act on a
    // discrete tier instead of re-interpreting a float. Mapping per
    // APTS Foundation §HO-017 (Surfaces confidence levels) and §RP-004:
    //   - L1 (suggest):  confidence < 0.6   → human must review
    //   - L2 (assist):   0.6 ≤ c < 0.85    → auto-apply with audit log
    //   - L3 (autonomous): c ≥ 0.85        → auto-apply
    const confidence = typeof result.confidence === 'number'
      ? result.confidence
      : null;
    const autonomy_level = confidence == null
      ? null
      : confidence < 0.6 ? 'L1_suggest'
      : confidence < 0.85 ? 'L2_assist'
      : 'L3_autonomous';
    const envelope = {
      ok: true,
      ...result,
      pair_path: result.pair_path || pairPath || null,
      autonomy_level,
    };
    // Echo the validated pluginConfig + validation result in the
    // envelope. The HTTP layer can read these for audit logging and
    // the OC shim can confirm the K that was actually used. Never
    // mutate heavy-think's result before this line — only extend.
    if (options.pluginConfig !== undefined) {
      envelope.plugin_config = options.pluginConfig;
    }
    if (options.pluginConfigValidation) {
      envelope.plugin_config_validation = {
        ok: options.pluginConfigValidation.ok,
        ...(options.pluginConfigValidation.errors
          ? { errors: options.pluginConfigValidation.errors }
          : {}),
      };
    }
    return envelope;
  } catch (err) {
    return {
      ok: false,
      error: {
        type: classifyError(err),
        message: err.message,
      },
    };
  }
}

function buildPairPath(pairsDir) {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD UTC
  return join(pairsDir, `${today}.jsonl`);
}

function classifyError(err) {
  const msg = err.message || '';
  if (/problem is required/.test(msg)) return 'invalid_input';
  if (/K must be >= 1/.test(msg)) return 'invalid_input';
  if (/\b(upstream|api).*\b\d{3}\b/i.test(msg) || /\b\d{3}\b.*(gateway|service|upstream|api)/i.test(msg)) {
    return 'upstream_error';
  }
  return 'internal_error';
}

export { DEFAULT_PAIRS_DIR, buildPairPath, classifyError };
// (defaultKForTaskType and K_CONFIGS were previously re-exported here but
// no consumer imports them from this module — `plugin-config.js` is the
// canonical source for both. Removed in v2.5.4 along with the static
// heavy-think import.)
