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
import {
  heavy_think as heavyThink,
  defaultKForTaskType,
  K_CONFIGS,
} from '../../../heavy-think/src/index.js';
import * as prmCache from '../db/prm-cache.js';

const DEFAULT_PAIRS_DIR = join(homedir(), '.<runtime>', 'metaclaw', 'preference-pairs');

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
export { defaultKForTaskType, K_CONFIGS };
