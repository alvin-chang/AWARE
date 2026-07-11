// AWARE 2.0 coordinator service — rl-pipeline-bridge integration
// Wires the standalone rl-pipeline library into the AWARE coordinator.
// Per ADR (internal) Decision 7: rl-pipeline-bridge is a universal reasoning primitive available
// to all agents, called like a system tool.
//
// This shim does NOT reimplement rl-pipeline-bridge logic — it just wraps it with
// AWARE-specific defaults (preference pair path, task types, error envelope,
// PRM score cache injection, pluginConfig passthrough for ADR (internal) K+S).

import { join } from 'node:path';
import { homedir } from 'node:os';
import * as prmCache from '../db/prm-cache.js';
import config from '../config/index.cjs';

const DEFAULT_PAIRS_DIR = join(homedir(), '.<runtime>', 'redacted-internal-project', 'preference-pairs');

// Lazy-load rl-pipeline from `config.rlPipeline.path`. The previous static
// import `'../../../rl-pipeline/src/index.js'` resolved to `/rl-pipeline/...`
// in the Docker image (where `WORKDIR=/app`), but the actual location baked
// by Dockerfile.coordinator is `/app/rl-pipeline/`. The static path ignored
// `AWARE_RL_PIPELINE_PATH` and caused the coordinator to crash-loop on
// import-time `ERR_MODULE_NOT_FOUND`. Resolving via `config.rlPipeline.path`
// honors the env override.
//
// We avoid top-level `await import()` because `rl-pipeline-bridge-integration.js`
// is transitively `require()`d from CJS code paths (rate-limit.test.js
// pulls in http-server.js → coordinator/index.js → this file), and
// top-level await turns the module into an "async module" that `require()`
// rejects with ERR_REQUIRE_ASYNC_MODULE. Instead we resolve rl-pipeline
// once on the first call to `awareRlPipeline` and cache the result.
let _rlPipelineMod = null;
let _rlPipelineLoadError = null;
let _rlPipelineLoadPromise = null;
async function loadRlPipeline() {
  if (_rlPipelineMod) return _rlPipelineMod;
  if (_rlPipelineLoadError) throw _rlPipelineLoadError;
  if (_rlPipelineLoadPromise) return _rlPipelineLoadPromise;
  _rlPipelineLoadPromise = import(config.rlPipeline.path)
    .then((mod) => {
      // The sibling library exports its primary entry point under a
      // legacy name; AWARE wraps it as `rl_pipeline` for the public-facing surface.
      if (typeof mod.rl_pipeline === 'function') {
        _rlPipelineMod = mod;
      } else if (typeof mod.heavy_think === 'function') {
        _rlPipelineMod = { ...mod, rl_pipeline: mod.heavy_think };
      } else {
        throw new Error(
          `rl_pipeline not exported from ${config.rlPipeline.path} — ` +
          `check that AWARE_RL_PIPELINE_PATH points at a rl-pipeline build >= v0.2.x`
        );
      }
      return _rlPipelineMod;
    })
    .catch((err) => {
      _rlPipelineLoadError = err;
      _rlPipelineLoadPromise = null; // allow retry on next call
      throw err;
    });
  return _rlPipelineLoadPromise;
}

// Test seam: lets unit tests force the rl-pipeline loader to a fresh state
// after they've swapped `process.env.AWARE_RL_PIPELINE_PATH` or mocked the
// `import` builtin. Not exported on the public surface — see
// test/unit/coordinator/rl-pipeline-bridge-integration.test.js for usage.
export function __resetRlPipelineForTest() {
  _rlPipelineMod = null;
  _rlPipelineLoadError = null;
  _rlPipelineLoadPromise = null;
}

/**
 * AWARE coordinator wrapper around rl_pipeline.
 * Adds:
 *   - default preference-pair path under redacted-internal-pipeline-output/preference-pairs/
 *   - daily file rotation (one JSONL per UTC day)
 *   - standard error envelope for AWARE API responses
 *   - PRM score cache injection (Phase 2.2)
 *   - pluginConfig passthrough (ADR (internal) — phase 1-passthrough): the
 *     per-call pluginConfig from the OC shim is echoed in the result
 *     envelope for audit, and its K-related fields have already been
 *     applied upstream in `coordinate()` so rl-pipeline sees the
 *     resolved K in `options.K`.
 *
 * @param {Object} options — same as rl_pipeline, plus:
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
export async function awareRlPipeline(options) {
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
    // MR-HIGH-002 fix: forward system_prompt through to rl_pipeline so the
    // underlying reasoning + refinement + PRM scoring build { system, user }
    // message shapes. The system prompt is forwarded as-is; rl_pipeline is
    // responsible for routing it to the right pipeline stages.
    const { rl_pipeline: rlPipeline } = await loadRlPipeline();
    const result = await rlPipeline({
      ...options,
      preferencePairPath: pairPath,
      cache,
    });
    // Forward the pair_path from rl-pipeline's result so the conversation
    // logger can populate aware_conversations.pair_path. Without this,
    // the trainer's _fetchUnconsumedPairPaths returns 0 rows because the
    // WHERE clause pair_path IS NOT NULL filters them all out. Phase 2.4
    // data flywheel unblock.
    // HO-HIGH-001 : surface an
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
    // Sum __retriedAttempts across every upstream call in the pipeline:
    // K parallel reasoning attempts + K PRM scores + 1 refinement. Each
    // path attaches the metadata additively to its return object
    // (see parallel.js, prm.js, refine.js — t_22a34f6d design §3.4.2).
    // If the total is zero we omit the field for clean envelopes.
    const totalRetried = sumRetriedAttempts(result);
    if (totalRetried > 0) {
      envelope.retried_attempts_total = totalRetried;
    }
    // Echo the validated pluginConfig + validation result in the
    // envelope. The HTTP layer can read these for audit logging and
    // the OC shim can confirm the K that was actually used. Never
    // mutate rl-pipeline's result before this line — only extend.
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
  // Structured-code first (set by minimax.js's withRateLimitRetry on a 429
  // that exhausted retries). Falls through to the message regex for older
  // callers that pre-date the retry layer. The `statusCode === 429` branch
  // is belt-and-suspenders for any future caller that surfaces the HTTP
  // status on the error without going through withRateLimitRetry.
  if (err && err.code === 'upstream_rate_limited') return 'upstream_rate_limited';
  if (err && err.statusCode === 429) return 'upstream_rate_limited';
  if (/problem is required/.test(msg)) return 'invalid_input';
  if (/K must be >= 1/.test(msg)) return 'invalid_input';
  if (/\b(upstream|api).*\b\d{3}\b/i.test(msg) || /\b\d{3}\b.*(gateway|service|upstream|api)/i.test(msg)) {
    return 'upstream_error';
  }
  return 'internal_error';
}

// Walk the pipeline result shape and sum __retriedAttempts across the
// three call paths. All three attach the metadata additively (parallel.js,
// prm.js, refine.js); a missing key contributes 0. Return shape is opaque
// enough that we walk defensively rather than assume a fixed schema.
function sumRetriedAttempts(result) {
  if (!result || typeof result !== 'object') return 0;
  let total = 0;
  if (Array.isArray(result.attempts)) {
    for (const a of result.attempts) {
      if (a && typeof a === 'object' && typeof a.__retriedAttempts === 'number') {
        total += a.__retriedAttempts;
      }
    }
  }
  // rl-pipeline returns refinement under both `refined_*` keys and a
  // `selected` / `refined` shape depending on the config; we don't try to
  // introspect every variant. The bridge only sees the normalised
  // envelope from rl-pipeline's main export — if `__retriedAttempts` was
  // surfaced at the top level (e.g. refine was called directly), we add
  // it. Otherwise zero contributes cleanly.
  if (typeof result.__retriedAttempts === 'number') {
    total += result.__retriedAttempts;
  }
  return total;
}

export { DEFAULT_PAIRS_DIR, buildPairPath, classifyError };
// (defaultKForTaskType and K_CONFIGS were previously re-exported here but
// no consumer imports them from this module — `plugin-config.js` is the
// canonical source for both. Removed in v2.5.4 along with the static
// rl-pipeline import.)
