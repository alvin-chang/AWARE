// src/index.js — Public entry point for HeavySkill
// HeavySkill: K parallel reasoning attempts → deep refinement → verification → preference pair
// Reference: AWARE 2.0 ADR-020, Decision 7

import { createHash } from 'node:crypto';
import { parallelReasoning } from './parallel.js';
import { refine } from './refine.js';
import { scoreWithPRM } from './prm.js';
import { verify } from './verify.js';
import { writePreferencePair, shouldSkipDuplicate } from './preference-pair.js';
import { defaultKForTaskType, K_CONFIGS } from './config.js';

/**
 * Heavy reasoning primitive. System-provided, available to all agents.
 *
 * @param {Object} options
 * @param {string} options.problem - The task or question
 * @param {number} [options.K] - Parallel attempts (default: per task_type)
 * @param {string} [options.task_type='standard'] - 'simple' | 'standard' | 'security' | 'financial' | 'creative'
 * @param {Object} [options.context] - Additional context (repo, files, conversation)
 * @param {Object} [options.verification] - { method: 'exec'|'test_suite'|'citation_check'|'kg_consistency', ...args }
 * @param {Object} [options.prm] - PRM judge config (model override, custom prompt)
 * @param {Object} [options.client] - LLM client (for test injection). Must implement { generate(prompt, opts) }
 * @param {string} [options.preferencePairPath] - JSONL output path; if omitted, no pair is written
 * @param {Object} [options.cache] - Optional PRM score cache (AWARE 2.0 Phase 2.2).
 *   Must implement { buildCacheKey, getCachedScore, putCachedScore }.
 *   If present, scoreWithPRM is called via a wrapper that checks the cache
 *   first and only calls the live PRM on miss. If absent, behavior is
 *   identical to the pre-cache version (live PRM every time).
 * @returns {Promise<{
 *   refined_trace: string,
 *   confidence: number,
 *   attempts: Array<{ reasoning: string, prm_score: number, selected: boolean }>,
 *   verification: { passed: boolean, method: string, details?: any, duration_ms: number },
 *   cost: { attempts_usd: number, refinement_usd: number, judge_usd: number },
 *   pair_written: boolean,
 *   cache: { hits: number, misses: number, enabled: boolean },
 * }>}
 */
export async function heavy_think(options) {
  if (!options || !options.problem) {
    throw new Error('heavy_think: options.problem is required');
  }

  const K = options.K ?? defaultKForTaskType(options.task_type || 'standard');
  const task_type = options.task_type || 'standard';
  const problem = options.problem;
  const context = options.context || {};
  const verification = options.verification || null;
  const prmConfig = options.prm || {};
  const client = options.client;  // injected for tests; production: build default minimax client
  const pairPath = options.preferencePairPath || null;
  const cache = options.cache || null;  // Phase 2.2 — optional PRM score cache
  // MR-HIGH-002 fix: forward system_prompt through the heavy_think pipeline
  // so parallel reasoning + refinement + PRM scoring all use { system, user }
  // message shape when the caller opts in. Legacy callers (no system_prompt)
  // get the original concatenated-string shape.
  const system_prompt = options.system_prompt || null;

  if (K < 1) {
    throw new Error(`heavy_think: K must be >= 1, got ${K}`);
  }

  // 1. PARALLEL REASONING: K independent attempts
  const parallelResult = await parallelReasoning({
    problem, K, task_type, context, client, system_prompt,
  });

  // 2. PRM SCORING: each attempt → score (parallel)
  // parallelReasoning returns attempts as { reasoning, attempt_index } objects
  // Phase 2.2: if a cache is injected, check it first; on miss, call live
  // PRM and write the result back to the cache.
  const cacheStats = { hits: 0, misses: 0, enabled: cache !== null };
  const scored = await Promise.all(
    parallelResult.attempts.map(async (attempt) => {
      let score;
      if (cache) {
        const key = cache.buildCacheKey({
          problem, reasoning: attempt.reasoning, task_type, context,
          prm_model: client?.model || 'minimax-M3',
        });
        const hit = await cache.getCachedScore(key);
        if (hit) {
          cacheStats.hits++;
          score = { ...hit, cost_usd: 0 };  // cached reads have zero PRM cost
        } else {
          cacheStats.misses++;
          score = await scoreWithPRM({
            problem, reasoning: attempt.reasoning, task_type, context, prmConfig, client,
          });
          // Fire-and-forget cache write — must not block the scoring path.
          // Cache errors are silently swallowed inside putCachedScore.
          cache.putCachedScore(key, score).catch(() => { /* ignore */ });
        }
      } else {
        score = await scoreWithPRM({
          problem, reasoning: attempt.reasoning, task_type, context, prmConfig, client,
        });
      }
      return { ...attempt, prm_score: score.score, prm_meta: score };
    })
  );

  // 3. PICK BEST initial attempt
  const sortedByScore = [...scored].sort((a, b) => b.prm_score - a.prm_score);
  const bestInitial = sortedByScore[0];
  const attemptsWithSelection = scored.map(a => ({ ...a, selected: a === bestInitial }));

  // 4. HEAVY REFINEMENT of best attempt
  const refinement = await refine({
    problem, best_attempt: bestInitial.reasoning, task_type, context, client, system_prompt,
  });

  // 5. VERIFICATION (optional)
  let verificationResult = { passed: true, method: 'none', duration_ms: 0 };
  if (verification) {
    verificationResult = await verify({
      trace: refinement.refined_trace, verification, context,
    });
  }

  // 6. WRITE PREFERENCE PAIR (only if not duplicate)
  let pair_written = false;
  if (pairPath) {
    const contentHash = hashAttempt(problem, bestInitial.reasoning, refinement.refined_trace);
    const isDup = await shouldSkipDuplicate({ path: pairPath, contentHash });
    if (!isDup) {
      await writePreferencePair({
        path: pairPath,
        record: {
          ts: new Date().toISOString(),
          problem,
          task_type,
          chosen: { reasoning: refinement.refined_trace, prm_score: refinement.refined_score },
          rejected: { reasoning: bestInitial.reasoning, prm_score: bestInitial.prm_score },
          all_attempts: attemptsWithSelection.map(a => ({
            reasoning: a.reasoning,
            prm_score: a.prm_score,
            selected: a.selected,
          })),
          verification: {
            method: verificationResult.method,
            passed: verificationResult.passed,
            duration_ms: verificationResult.duration_ms,
          },
          cost: {
            attempts_usd: parallelResult.cost_usd || 0,
            refinement_usd: refinement.cost_usd || 0,
            judge_usd: scored.reduce((s, a) => s + (a.prm_meta?.cost_usd || 0), 0),
          },
        },
        contentHash,
      });
      pair_written = true;
    }
  }

  // 7. RETURN
  return {
    refined_trace: refinement.refined_trace,
    confidence: refinement.confidence,
    attempts: attemptsWithSelection,
    verification: verificationResult,
    cost: {
      attempts_usd: parallelResult.cost_usd || 0,
      refinement_usd: refinement.cost_usd || 0,
      judge_usd: scored.reduce((s, a) => s + (a.prm_meta?.cost_usd || 0), 0),
    },
    pair_written,
    pair_path: pairPath,        // absolute path to the JSONL line, or null if not written
    cache: cacheStats,
  };
}

function hashAttempt(problem, rejected, chosen) {
  return createHash('sha256')
    .update(problem)
    .update('\u0000')
    .update(rejected)
    .update('\u0000')
    .update(chosen)
    .digest('hex')
    .slice(0, 16);
}

export { hashAttempt };
export { parallelReasoning } from './parallel.js';
export { refine } from './refine.js';
export { scoreWithPRM } from './prm.js';
export { verify } from './verify.js';
export { writePreferencePair, shouldSkipDuplicate } from './preference-pair.js';
export { toDpoRow, toDpoDataset, convertFile } from './dpo-format.js';
export { defaultKForTaskType, K_CONFIGS } from './config.js';
export { makeMinimaxClient, DEFAULT_BASE_URL, DEFAULT_MODEL, ANTHROPIC_VERSION } from './clients/minimax.js';
