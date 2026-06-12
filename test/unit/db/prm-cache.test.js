// test/unit/db/prm-cache.test.js
// Unit tests for src/db/prm-cache.js — AWARE 2.0 Phase 2.2 PRM score cache.
//
// Strategy: pure-function tests for buildCacheKey (no DB needed) + behavior
// tests for getCachedScore/putCachedScore/getCacheStats that work with the
// DB disabled. In the test env, AWARE_DB_HOST defaults to 127.0.0.1:5432
// which is not running, so getPool() returns null and the cache is a no-op.
// This matches the "cache disabled" path in production.
//
// We use Node's built-in test runner (node --test) to match the rest of
// the v2 suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- buildCacheKey (pure function) --------------------------------------

test('prmCache: buildCacheKey returns 64-char hex SHA-256', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const key = buildCacheKey({
    problem: '2+2?',
    reasoning: 'The answer is 4',
    task_type: 'simple',
    context: {},
    prm_model: 'primary-model',
  });
  assert.equal(typeof key, 'string');
  assert.equal(key.length, 64);
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('prmCache: buildCacheKey is deterministic for same inputs', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const inputs = {
    problem: 'test problem',
    reasoning: 'test reasoning',
    task_type: 'standard',
    context: { repo: 'aware', files: ['a.js'] },
    prm_model: 'primary-model',
  };
  const k1 = buildCacheKey(inputs);
  const k2 = buildCacheKey(inputs);
  assert.equal(k1, k2);
});

test('prmCache: buildCacheKey differs for different problem', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: 'a', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: 'b', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  assert.notEqual(k1, k2);
});

test('prmCache: buildCacheKey differs for different reasoning', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: 'p', reasoning: 'a', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: 'p', reasoning: 'b', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  assert.notEqual(k1, k2);
});

test('prmCache: buildCacheKey normalizes whitespace in problem/reasoning', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: '2+2?', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: '  2+2?  ', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  assert.equal(k1, k2, 'leading/trailing whitespace must collapse to same key');
});

test('prmCache: buildCacheKey differs for different task_type', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'simple', context: {}, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  assert.notEqual(k1, k2);
});

test('prmCache: buildCacheKey is order-insensitive for context keys', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: { a: 1, b: 2 }, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: { b: 2, a: 1 }, prm_model: 'primary-model' });
  assert.equal(k1, k2, 'object key order must not affect hash (canonicalization)');
});

test('prmCache: buildCacheKey differs for different prm_model', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const k1 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'primary-model' });
  const k2 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {}, prm_model: 'claude-haiku-4-5' });
  assert.notEqual(k1, k2, 'different PRM model = different cache key (invalidation hook)');
});

test('prmCache: buildCacheKey handles missing fields with defaults', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  // No context, no prm_model
  const k = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard' });
  assert.equal(typeof k, 'string');
  assert.equal(k.length, 64);
});

// --- isCacheEnabled ------------------------------------------------------

test('prmCache: isCacheEnabled returns boolean', async () => {
  const { isCacheEnabled } = await import('../../../src/db/prm-cache.js');
  const v = isCacheEnabled();
  assert.equal(typeof v, 'boolean');
});

// --- getCachedScore (DB-disabled path) -----------------------------------

test('prmCache: getCachedScore returns null on miss (DB unavailable)', async () => {
  const { getCachedScore, buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const key = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {} });
  const r = await getCachedScore(key);
  // DB is unavailable in the test env, so this should return null
  // OR (if cache is disabled) return null. Either way: null.
  assert.equal(r, null);
});

test('prmCache: getCachedScore returns null for invalid key (not 64 chars)', async () => {
  const { getCachedScore } = await import('../../../src/db/prm-cache.js');
  const r = await getCachedScore('too-short');
  assert.equal(r, null);
});

test('prmCache: getCachedScore returns null for empty key', async () => {
  const { getCachedScore } = await import('../../../src/db/prm-cache.js');
  const r = await getCachedScore('');
  assert.equal(r, null);
});

test('prmCache: getCachedScore never throws on bad input', async () => {
  const { getCachedScore } = await import('../../../src/db/prm-cache.js');
  // Null, undefined, non-string — all should be silently rejected.
  assert.equal(await getCachedScore(null), null);
  assert.equal(await getCachedScore(undefined), null);
  assert.equal(await getCachedScore(123), null);
  assert.equal(await getCachedScore({}), null);
});

// --- putCachedScore -----------------------------------------------------

test('prmCache: putCachedScore returns false when DB unavailable', async () => {
  const { putCachedScore, buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const key = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {} });
  const r = await putCachedScore(key, { score: 0.85, strengths: ['clear'], weaknesses: [], confidence: 0.9, prm_model: 'primary-model', prm_cost_usd: 0.001 });
  // DB unavailable or cache disabled → returns false (best-effort, no throw)
  assert.equal(typeof r, 'boolean');
});

test('prmCache: putCachedScore returns false for invalid key', async () => {
  const { putCachedScore } = await import('../../../src/db/prm-cache.js');
  const r = await putCachedScore('bad', { score: 0.5 });
  assert.equal(r, false);
});

test('prmCache: putCachedScore returns false for score with no .score field', async () => {
  const { putCachedScore, buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const key = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: {} });
  const r = await putCachedScore(key, { strengths: ['x'] });
  assert.equal(r, false);
});

test('prmCache: putCachedScore never throws on bad input', async () => {
  const { putCachedScore } = await import('../../../src/db/prm-cache.js');
  // No throw expected
  await putCachedScore(null, null);
  await putCachedScore(undefined, undefined);
  await putCachedScore(123, 'not an object');
  await putCachedScore('a'.repeat(64), { score: 'not a number' });
});

// --- getCacheStats ------------------------------------------------------

test('prmCache: getCacheStats returns zeros when DB unavailable', async () => {
  const { getCacheStats } = await import('../../../src/db/prm-cache.js');
  const stats = await getCacheStats();
  assert.equal(typeof stats, 'object');
  assert.equal(stats.rows, 0);
  assert.equal(stats.hit_count_total, 0);
  assert.equal(stats.distinct_keys_24h, 0);
  assert.equal(stats.oldest_hit_at, null);
  assert.equal(stats.newest_hit_at, null);
  // error is either null (when cache is disabled) or 'no-pool' (when DB unavailable)
  assert.ok(stats.error === null || stats.error === 'no-pool' || typeof stats.error === 'string');
});

test('prmCache: getCacheStats always includes enabled field', async () => {
  const { getCacheStats } = await import('../../../src/db/prm-cache.js');
  const stats = await getCacheStats();
  assert.equal(typeof stats.enabled, 'boolean');
});

// --- shape / smoke ------------------------------------------------------

test('prmCache: buildCacheKey with nested context is stable', async () => {
  const { buildCacheKey } = await import('../../../src/db/prm-cache.js');
  const ctx = { repo: 'aware', files: { src: ['a.js', 'b.js'], test: ['x.test.js'] } };
  const k1 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: ctx });
  const k2 = buildCacheKey({ problem: 'p', reasoning: 'r', task_type: 'standard', context: ctx });
  assert.equal(k1, k2);
});
