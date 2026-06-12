// src/db/prm-cache.js — Postgres-backed PRM score cache
//
// Phase 2.2 of AWARE 2.0 — caches heavy-think's PRM (Process Reward Model) judge
// scores so identical {problem, reasoning, task_type, context, prm_model} inputs
// skip the LLM call.
//
// Architecture decision P: content-hash key — SHA-256 of canonicalized inputs.
// Architecture decision B (storage backend): same Postgres instance as the
// Phase 2.1 conversation logger (aware2 database, aware_prm_cache table).
// Architecture decision X (kill mechanism): config.prmCache.enabled=false
// short-circuits to live PRM (the cache is opt-out, not opt-in, by default).
//
// Resilience contract:
//   - All public functions return null / no-op on ANY error
//   - The cache MUST NEVER break the request path
//   - When DB is disabled (AWARE_DB_ENABLED=false) all functions return null
//   - When PRM cache is disabled (AWARE_PRM_CACHE_ENABLED=false) all functions return null
//   - The cache is best-effort: a miss is fine, a hit is a bonus
//
// Public API:
//   import {
//     buildCacheKey,
//     getCachedScore,
//     putCachedScore,
//     getCacheStats,
//     isCacheEnabled,
//   } from '../db/prm-cache.js';

import { createHash } from 'node:crypto';
import { getPool } from './index.js';
import config from '../config/index.cjs';

/**
 * Canonicalize a value for hashing. Recursively sorts object keys so
 * {a: 1, b: 2} and {b: 2, a: 1} hash to the same value.
 * Arrays preserve order (their position is semantically meaningful).
 * Primitives returned as-is.
 */
function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  if (typeof value === 'string') {
    // Whitespace normalization: collapse runs of whitespace into single spaces,
    // trim leading/trailing. This means "2+2" and "  2+2  " hash the same.
    return value.replace(/\s+/g, ' ').trim();
  }
  return value;
}

/**
 * Build a SHA-256 cache key from PRM inputs.
 * The key is 64 hex chars (256 bits) — collision space is huge.
 *
 * @param {Object} inputs
 * @param {string} inputs.problem     — the question / task
 * @param {string} inputs.reasoning   — the agent's reasoning to score
 * @param {string} inputs.task_type   — 'simple' | 'standard' | 'security' | ...
 * @param {Object} inputs.context     — additional context (repo, files, ...)
 * @param {string} [inputs.prm_model] — model name (default: 'primary-model')
 * @returns {string} 64-char hex SHA-256
 */
export function buildCacheKey({ problem, reasoning, task_type, context, prm_model }) {
  const canonical = canonicalize({
    problem: problem || '',
    reasoning: reasoning || '',
    task_type: task_type || 'standard',
    context: context || {},
    prm_model: prm_model || 'primary-model',
  });
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Check whether the PRM cache is enabled (kill mechanism X).
 * Two conditions: the DB must be enabled AND the prmCache config must be on.
 */
export function isCacheEnabled() {
  return Boolean(config.db?.enabled) && Boolean(config.prmCache?.enabled);
}

/**
 * Look up a cached PRM score.
 * Returns null on miss, on any error, or when cache is disabled.
 * On hit, the row's last_hit_at and hit_count are updated (fire-and-forget)
 * so the cache's TTL clock resets and hot rows surface in diagnostics.
 *
 * @param {string} cacheKey  64-char hex SHA-256 from buildCacheKey
 * @returns {Promise<null | {
 *   score: number,
 *   strengths: string[],
 *   weaknesses: string[],
 *   confidence: number,
 *   prm_model: string,
 *   prm_cost_usd: number,
 *   cache_hit: true,
 * }>}
 */
export async function getCachedScore(cacheKey) {
  if (!isCacheEnabled()) return null;
  if (!cacheKey || cacheKey.length !== 64) return null;

  let pool;
  try {
    pool = await getPool();
  } catch {
    return null;
  }
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      `SELECT score, strengths, weaknesses, confidence, prm_model, prm_cost_usd,
              created_at, last_hit_at, hit_count
         FROM aware_prm_cache
        WHERE content_hash = $1
          AND last_hit_at > NOW() - ($2 || ' days')::interval
        LIMIT 1`,
      [cacheKey, String(config.prmCache.ttlDays)]
    );

    if (rows.length === 0) return null;

    const row = rows[0];

    // Fire-and-forget hit bookkeeping. Errors here are silent.
    pool.query(
      `UPDATE aware_prm_cache
          SET last_hit_at = NOW(), hit_count = hit_count + 1
        WHERE content_hash = $1`,
      [cacheKey]
    ).catch(() => { /* ignore */ });

    return {
      score: Number(row.score),
      strengths: row.strengths || [],
      weaknesses: row.weaknesses || [],
      confidence: Number(row.confidence),
      prm_model: row.prm_model,
      prm_cost_usd: Number(row.prm_cost_usd),
      cache_hit: true,
    };
  } catch {
    return null;
  }
}

/**
 * Insert or update a PRM cache row.
 * Idempotent: re-inserting the same key updates last_hit_at and increments hit_count.
 * Silently no-ops on any error — the cache must never break the request path.
 *
 * @param {string} cacheKey  64-char hex SHA-256
 * @param {Object} score     — { score, strengths, weaknesses, confidence, prm_model, prm_cost_usd }
 * @returns {Promise<boolean>} true if the row was written, false otherwise
 */
export async function putCachedScore(cacheKey, score) {
  if (!isCacheEnabled()) return false;
  if (!cacheKey || cacheKey.length !== 64) return false;
  if (!score || typeof score.score !== 'number') return false;

  let pool;
  try {
    pool = await getPool();
  } catch {
    return false;
  }
  if (!pool) return false;

  try {
    await pool.query(
      `INSERT INTO aware_prm_cache
         (content_hash, score, strengths, weaknesses, confidence, prm_model, prm_cost_usd)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
       ON CONFLICT (content_hash) DO UPDATE SET
         last_hit_at = NOW(),
         hit_count = aware_prm_cache.hit_count + 1`,
      [
        cacheKey,
        score.score,
        JSON.stringify(score.strengths || []),
        JSON.stringify(score.weaknesses || []),
        score.confidence ?? 0.5,
        score.prm_model || 'primary-model',
        score.prm_cost_usd || 0,
      ]
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Cache diagnostics. Returns zeros when cache is disabled.
 * @returns {Promise<{
 *   enabled: boolean,
 *   rows: number,
 *   hit_count_total: number,
 *   distinct_keys_24h: number,
 *   oldest_hit_at: string | null,
 *   newest_hit_at: string | null,
 *   error: string | null,
 * }>}
 */
export async function getCacheStats() {
  const base = {
    enabled: isCacheEnabled(),
    rows: 0,
    hit_count_total: 0,
    distinct_keys_24h: 0,
    oldest_hit_at: null,
    newest_hit_at: null,
    error: null,
  };
  if (!isCacheEnabled()) return base;

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    return { ...base, error: err.message };
  }
  if (!pool) return { ...base, error: 'no-pool' };

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS rows,
        COALESCE(SUM(hit_count), 0)::int AS hit_count_total,
        COUNT(*) FILTER (WHERE last_hit_at > NOW() - INTERVAL '24 hours')::int AS distinct_keys_24h,
        MIN(last_hit_at) AS oldest_hit_at,
        MAX(last_hit_at) AS newest_hit_at
      FROM aware_prm_cache
    `);
    const row = rows[0] || {};
    return {
      ...base,
      rows: row.rows || 0,
      hit_count_total: row.hit_count_total || 0,
      distinct_keys_24h: row.distinct_keys_24h || 0,
      oldest_hit_at: row.oldest_hit_at ? row.oldest_hit_at.toISOString() : null,
      newest_hit_at: row.newest_hit_at ? row.newest_hit_at.toISOString() : null,
    };
  } catch (err) {
    return { ...base, error: err.message };
  }
}
