// src/coordinator/plugin-config.js — plugin-local config plumbing
// Per ADR-022: plugins own their config surface. The coordinator
// accepts a per-call `pluginConfig` object (the parsed
// `plugins.entries.<id>.config` from the <runtime> shim, e.g. the
// HeavySkill v2 shim's `api.pluginConfig`). The coordinator uses it
// to resolve K and echoes the validated shape in the result envelope.
//
// Why a dedicated module:
//   - The pluginConfig shape, K priority, and validation are tested
//     in isolation. The HTTP layer in `http-server.js` only reads
//     the body and forwards; the heavy-think integration only
//     consumes the resolved K and the sanitized pluginConfig.
//   - Future plugins (each with their own configSchema) can share
//     the same K resolver by passing a different `schemaKey` or by
//     composing their own resolver on top of `resolveKFromPluginConfig`.
//
// What this module does NOT do:
//   - Read OC config from disk. The OC shim (in `~/src/<runtime>/`)
//     is the only place that reads `<runtime>.json`. The coordinator
//     receives pluginConfig as a wire payload and treats it as
//     untrusted input.
//   - Override env-driven defaults on the coordinator itself. The
//     pluginConfig is a per-call override only; it does not mutate
//     `config.coordinator.*` or `config.gateway.*`.
//   - Touch core zod schemas. ADR-022's whole point is that the
//     core schema stays clean; plugin-owned config is opaque to
//     the core.

import { defaultKForTaskType } from '../../../heavy-think/src/config.js';

/**
 * Schema version. Bump when the shape of `pluginConfig` changes in
 * a backwards-incompatible way. The current version (1) supports:
 *   { defaultK?: number, autoEnable?: boolean,
 *     agentDefaults?: { enabled?: boolean, K?: number } }
 */
export const K_PLUGIN_CONFIG_VERSION = 1;

/**
 * Default per-task-type K from heavy-think. Re-exported for callers
 * that want to know what the fallback K would be when no pluginConfig
 * is present.
 */
export { defaultKForTaskType };

/**
 * Sanitize a pluginConfig object to the ADR-022 shape. Returns a new
 * object with unknown keys removed. Used by `validatePluginConfig`
 * and exposed so callers (tests, the HTTP layer) can do their own
 * downstream handling.
 *
 * @param {Object} pc — raw pluginConfig
 * @returns {Object|null} — sanitized object, or null if pc is null/undefined
 */
export function sanitizePluginConfig(pc) {
  if (pc == null) return null;
  if (typeof pc !== 'object' || Array.isArray(pc)) return null;

  const out = {};
  if (Number.isInteger(pc.defaultK) && pc.defaultK >= 1 && pc.defaultK <= 16) {
    out.defaultK = pc.defaultK;
  }
  if (typeof pc.autoEnable === 'boolean') {
    out.autoEnable = pc.autoEnable;
  }
  if (pc.agentDefaults != null && typeof pc.agentDefaults === 'object' && !Array.isArray(pc.agentDefaults)) {
    const ad = {};
    if (typeof pc.agentDefaults.enabled === 'boolean') ad.enabled = pc.agentDefaults.enabled;
    if (Number.isInteger(pc.agentDefaults.K) && pc.agentDefaults.K >= 1 && pc.agentDefaults.K <= 16) {
      ad.K = pc.agentDefaults.K;
    }
    // Only emit the agentDefaults block if at least one key survived.
    if (Object.keys(ad).length > 0) out.agentDefaults = ad;
  }
  return out;
}

/**
 * Validate a pluginConfig object.
 *
 * Returns:
 *   { ok: true,  value: <sanitized> } when the input is a valid
 *     object (possibly empty) or null/undefined.
 *   { ok: false, value: null, errors: [string, ...] } when the input
 *     is a non-object (string, number, array) or fails structural
 *     validation. The errors are human-readable and safe to log
 *     (no PII, no secrets).
 *
 * Validation rules (all soft — a bad shape returns ok:false but the
 * coordinator still processes the call with no pluginConfig):
 *   - Must be an object or null/undefined.
 *   - Arrays are rejected (callers sometimes send an array by mistake).
 *   - Per-field types are checked in `sanitizePluginConfig`; values
 *     that don't match the shape are silently dropped (so a caller
 *     sending `defaultK: "4"` is treated as "no defaultK" — better
 *     than rejecting the whole call).
 *   - `K` values are clamped to [1, 16]. The paper (arXiv:2605.02396)
 *     uses K=4; values above 16 are practically never useful and
 *     would balloon cost.
 *
 * @param {*} pc
 * @returns {{ ok: boolean, value: Object|null, errors?: string[] }}
 */
export function validatePluginConfig(pc) {
  if (pc == null) {
    return { ok: true, value: null };
  }
  if (typeof pc !== 'object' || Array.isArray(pc)) {
    return {
      ok: false,
      value: null,
      errors: [`pluginConfig must be an object, got ${Array.isArray(pc) ? 'array' : typeof pc}`],
    };
  }
  const sanitized = sanitizePluginConfig(pc);
  if (sanitized == null) {
    return { ok: false, value: null, errors: ['pluginConfig sanitize returned null'] };
  }
  // Detect "all-known-keys-were-bad" so we can flag it (caller
  // probably has a wrong schema version). If the caller sent a
  // non-empty object but the sanitizer dropped everything, that's
  // worth surfacing.
  const hadAnyKey = Object.keys(pc).length > 0;
  const keptAnyKey = Object.keys(sanitized).length > 0;
  if (hadAnyKey && !keptAnyKey) {
    return {
      ok: false,
      value: null,
      errors: [
        'pluginConfig contained no recognized keys (unknown schema? see K_PLUGIN_CONFIG_VERSION)',
      ],
    };
  }
  return { ok: true, value: sanitized };
}

/**
 * Resolve K from explicit + pluginConfig + task_type.
 *
 * Priority (highest first):
 *   1. `explicitK` — a positive integer from the request body's `K` field
 *      (or whatever the caller passes as `explicitK`).
 *   2. `pluginConfig.agentDefaults.K` — when `pluginConfig.agentDefaults.enabled === true`.
 *      This is the per-agent default from the OC plugin config.
 *   3. `pluginConfig.defaultK` — the plugin-wide default K.
 *   4. `defaultKForTaskType(taskType)` — heavy-think's per-task-type
 *      fallback. The paper suggests K=4 for "standard" tasks.
 *
 * @param {Object} args
 * @param {*} args.explicitK — explicit K from the caller (may be any value; validated here)
 * @param {Object|null} args.pluginConfig — validated pluginConfig (already sanitized)
 * @param {string} [args.taskType='standard'] — task type for fallback
 * @returns {{ K: number, source: string }}
 *   `source` is one of 'explicit', 'agentDefaults', 'pluginDefault', 'taskType'.
 *   Useful for audit: callers (and tests) can assert that the K came
 *   from the expected source.
 */
export function resolveKFromPluginConfig({ explicitK, pluginConfig, taskType }) {
  // 1. Explicit K always wins. This is the operator's highest-priority
  //    override (e.g., a model-id prefix `heavyskill-4:` resolved by
  //    the OC shim to K=4 before the call hits the coordinator).
  if (Number.isInteger(explicitK) && explicitK >= 1 && explicitK <= 16) {
    return { K: explicitK, source: 'explicit' };
  }

  // 2. Per-agent defaults (S2 in ADR-022). Only active when the
  //    operator has explicitly enabled it for that agent.
  const ad = pluginConfig && pluginConfig.agentDefaults;
  if (ad && ad.enabled === true && Number.isInteger(ad.K) && ad.K >= 1 && ad.K <= 16) {
    return { K: ad.K, source: 'agentDefaults' };
  }

  // 3. Plugin-wide defaultK.
  if (pluginConfig && Number.isInteger(pluginConfig.defaultK) && pluginConfig.defaultK >= 1 && pluginConfig.defaultK <= 16) {
    return { K: pluginConfig.defaultK, source: 'pluginDefault' };
  }

  // 4. Per-task-type fallback (heavy-think's own table).
  return { K: defaultKForTaskType(taskType || 'standard'), source: 'taskType' };
}
