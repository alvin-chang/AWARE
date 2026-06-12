// AWARE 2.0 coordinator service — HeavySkill integration
// Wires the standalone heavy-think library into the AWARE coordinator.
// Per ADR-020 Decision 7: HeavySkill is a universal reasoning primitive available
// to all agents, called like a system tool.
//
// This shim does NOT reimplement HeavySkill logic — it just wraps it with
// AWARE-specific defaults (preference pair path, task types, error envelope,
// PRM score cache injection).

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  heavy_think as heavyThink,
  defaultKForTaskType,
  K_CONFIGS,
} from '../../../../src/heavy-think/src/index.js';
import * as prmCache from '../db/prm-cache.js';

const DEFAULT_PAIRS_DIR = join(homedir(), '.<runtime>', 'metaclaw', 'preference-pairs');

/**
 * AWARE coordinator wrapper around heavy_think.
 * Adds:
 *   - default preference-pair path under <host-config>/metaclaw/preference-pairs/
 *   - daily file rotation (one JSONL per UTC day)
 *   - standard error envelope for AWARE API responses
 *   - PRM score cache injection (Phase 2.2)
 *
 * @param {Object} options — same as heavy_think, plus:
 *   @param {string} [options.sessionId] — for traceability in the JSONL record
 *   @param {string} [options.agentId] — for traceability in the JSONL record
 *   @param {boolean} [options.writePairs=true] — set false to skip JSONL writes
 *   @param {string} [options.pairsDir] — override the default pair directory
 *   @param {boolean} [options.disableCache=false] — set true to skip the PRM cache for this call
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
    const result = await heavyThink({
      ...options,
      preferencePairPath: pairPath,
      cache,
    });
    return { ok: true, ...result };
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
