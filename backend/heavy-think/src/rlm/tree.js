// src/rlm/tree.js — Recursion machinery, cost accounting, tree shape
//
// Drives the recursive walk: decompose → recurse (or leaf) → aggregate.
// Owns the budget / timeout enforcement and the per-node cost rollup.
//
// Architecture refs:
//   - ARCHITECTURE.md §3 (tree shape, three node kinds)
//   - ARCHITECTURE.md §6 (termination policy, cost accounting)
//   - SPEC.md §3.3, §3.4 (RlmResult, RlmNode shapes)
//   - SPEC.md §4.2, §4.3 (termination, cost enforcement)

import { randomUUID } from 'node:crypto';

import { decompose, parseDecomposition } from './decompose.js';
import { aggregate } from './aggregate.js';
import {
  RlmBudgetExceededError,
  RlmTimeoutError,
  RlmEnvironmentError,
} from './errors.js';

// Conservative floor cost for a single leaf call (heavy_think default).
const MIN_LEAF_COST_USD = 0.01;
// Conservative floor cost for a single decomposition/aggregation LM call.
const MIN_LM_CALL_USD = 0.002;

/**
 * @typedef {Object} TreeRunOpts
 * @property {string} problem
 * @property {Object} env - Loaded context (output of environment.loadContext)
 * @property {Object} opts - Original rlm() options (passed through)
 * @property {Object} state - Shared mutable state across the recursion:
 *   { run_id, start_ms, cost_so_far, sub_calls, decomposition_skipped,
 *     env_errors, env_paginated, aggregation_retries, aggregation_fallback,
 *     leaf_failures, partial }
 * @property {number} depth - 0 at root
 */

/**
 * Recursive entry point. Returns a root RlmNode.
 *
 * @param {TreeRunOpts} args
 * @returns {Promise<RlmNode>}
 */
export async function runNode({ problem, env, opts, state, depth = 0 }) {
  const id = randomUUID();
  const isRoot = depth === 0;
  const isLeafCandidate = depth >= opts.max_depth;

  // ── Budget / timeout pre-check ─────────────────────────────────────────
  checkBudget(opts, state, id);
  checkTimeout(opts, state, id);

  // ── Leaf path ──────────────────────────────────────────────────────────
  if (isLeafCandidate || isBudgetTooTight(opts, state)) {
    return await runLeaf({ id, depth, problem, env, opts, state });
  }

  // ── Decompose ──────────────────────────────────────────────────────────
  let subproblems = [];
  let decompositionCost = 0;
  let decomposeRetried = false;

  try {
    const result = await decompose({
      problem,
      env,
      branching: opts.branching,
      client: opts.client,
      system_prompt: opts.system_prompt,
      maxRetries: 1,
    });
    subproblems = result.subproblems;
    decompositionCost = result.cost_usd;
    decomposeRetried = !!result.retried;
  } catch (err) {
    // Decompose failed twice → treat as leaf (SPEC §7 F8).
    state.env_errors = state.env_errors || [];
    state.env_errors.push({ op: 'decompose', msg: String(err.message || err) });
    return await runLeaf({ id, depth, problem, env, opts, state, decomposeRetried: true });
  }
  state.cost_so_far += decompositionCost;
  state.sub_calls += 1;

  // Atomic problem (0 sub-problems at root) → leaf.
  // Internal node with 0 sub-problems → escalate to leaf per ARCHITECTURE.md §6.
  if (subproblems.length === 0) {
    return await runLeaf({ id, depth, problem, env, opts, state });
  }

  // ── Recurse / spawn leaves per child ───────────────────────────────────
  const childOptsBase = { ...opts };
  const children = [];
  for (const sub of subproblems) {
    checkBudget(opts, state, id);
    checkTimeout(opts, state, id);

    // Per-child context view: the env is shared in v1 (no per-leaf slicing).
    // For inline string contexts, pass the inline text as the leaf context;
    // for typed contexts, the leaf's `context` is `null` (env is at root).
    const childEnv = env;
    try {
      const child = await runNode({
        problem: sub,
        env: childEnv,
        opts: childOptsBase,
        state,
        depth: depth + 1,
      });
      children.push(child);
    } catch (err) {
      // Budget/timeout errors propagate up; env errors get a stub child so
      // siblings can still proceed (the parent's aggregation will mark
      // `partial: true`).
      if (err instanceof RlmBudgetExceededError || err instanceof RlmTimeoutError) {
        throw err;
      }
      // Unknown error — record and continue.
      state.env_errors = state.env_errors || [];
      state.env_errors.push({ op: 'recurse', msg: String(err.message || err) });
    }
  }

  if (children.length === 0) {
    // No children succeeded — return a partial leaf ourselves.
    state.partial = true;
    return await runLeaf({ id, depth, problem, env, opts, state, noChildren: true });
  }

  // ── Aggregate ──────────────────────────────────────────────────────────
  checkBudget(opts, state, id);
  checkTimeout(opts, state, id);

  const agg = await aggregate({
    problem,
    child_results: children.map(c => ({
      problem: c.sub_problem,
      summary: c.answer,
      prm_score: c.meta?.prm_score ?? 0.5,
      cost_usd: c.cost?.total_usd ?? 0,
      depth: c.depth,
      failed: c.meta?.failed || false,
    })),
    client: opts.client,
    system_prompt: opts.system_prompt,
  });
  state.cost_so_far += agg.cost_usd;
  state.sub_calls += 1;
  if (agg.retries > 0) state.aggregation_retries = agg.retries;
  if (agg.fallback !== 'none') {
    state.aggregation_fallback = agg.fallback;
    state.partial = true;
  }

  const nodeCost = {
    decomposition_usd: decompositionCost,
    aggregation_usd: agg.cost_usd,
    leaf_usd_total: children.reduce((s, c) => s + (c.cost?.leaf_usd ?? c.cost?.total_usd ?? 0), 0),
    total_usd: decompositionCost + agg.cost_usd + children.reduce((s, c) => s + (c.cost?.total_usd ?? 0), 0),
  };

  return {
    id,
    kind: isRoot ? 'root' : 'internal',
    depth,
    sub_problem: problem,
    answer: agg.final,
    cost: nodeCost,
    children,
    meta: {
      decomposition_skipped: state.decomposition_skipped || [],
      aggregation_retries: agg.retries,
      aggregation_fallback: agg.fallback,
      env_paginated: !!state.env_paginated,
      env_errors: state.env_errors || [],
      decompose_retried: decomposeRetried,
      partial: state.partial,
    },
  };
}

// ─── Leaf execution ────────────────────────────────────────────────────────

async function runLeaf({ id, depth, problem, env, opts, state, noChildren = false, decomposeRetried = false }) {
  let leafResult = null;
  let retried = false;
  let failed = false;
  let cost_usd = 0;

  // Compose the leaf context: inline text is passed through; typed env is
  // summarised as a hint for the heavy_think() call.
  const leafContext = composeLeafContext(env, opts);

  try {
    leafResult = await invokeLeaf({ problem, context: leafContext, opts, state });
    cost_usd += leafResult.cost?.total_usd ?? 0;
  } catch (err) {
    // Retry once with a smaller K.
    retried = true;
    state.sub_calls += 1;
    try {
      const smaller = { ...opts, K: Math.max(2, Math.floor((opts.K || 4) / 2)) };
      leafResult = await invokeLeaf({ problem, context: leafContext, opts: smaller, state });
      cost_usd += leafResult.cost?.total_usd ?? 0;
    } catch (err2) {
      failed = true;
      state.leaf_failures = (state.leaf_failures || 0) + 1;
      state.partial = true;
    }
  }

  state.cost_so_far += cost_usd;
  state.sub_calls += 1;

  return {
    id,
    kind: 'leaf',
    depth,
    sub_problem: problem,
    answer: leafResult?.refined_trace ?? (noChildren ? '' : '(leaf failed)'),
    cost: {
      leaf_usd: cost_usd,
      total_usd: cost_usd,
    },
    children: [],
    meta: {
      prm_score: leafResult?.confidence ?? 0,
      verification: leafResult?.verification ?? { passed: false, method: 'none', duration_ms: 0 },
      pair_written: !!leafResult?.pair_written,
      cache: leafResult?.cache ?? { hits: 0, misses: 0, enabled: false },
      retried,
      failed,
      no_children: noChildren,
      decompose_retried: decomposeRetried,
    },
  };
}

function composeLeafContext(env, opts) {
  if (!env) return {};
  if (env.kind === 'inline') return env.text || '';
  // For typed envs, hand heavy_think a summary + the REPL hint.
  return {
    _rlm_env: true,
    kind: env.kind,
    summary: env.summary,
    hint: env.hint || '',
    // Tell heavy_think how to reach the REPL (only relevant when caller
    // explicitly asks for REPL access — not v1).
    repl_access: false,
  };
}

async function invokeLeaf({ problem, context, opts, state }) {
  // Lazy-import heavy_think to avoid a hard module dep cycle.
  let heavy_think;
  try {
    const mod = await import(opts.heavy_think_module || '../../src/index.js');
    heavy_think = mod.heavy_think;
  } catch (err) {
    // Fallback: client.generate directly (matches use_heavyskill=false path).
    return await rawLeaf({ problem, context, opts, state });
  }
  if (!heavy_think || opts.use_heavyskill === false) {
    return await rawLeaf({ problem, context, opts, state });
  }
  return await heavy_think({
    problem,
    context,
    K: opts.K,
    task_type: opts.task_type,
    client: opts.client,
    system_prompt: opts.system_prompt,
    cache: opts.cache,
    preferencePairPath: opts.preferencePairPath,
  });
}

async function rawLeaf({ problem, context, opts, state }) {
  const prompt = typeof context === 'string'
    ? `${problem}\n\nContext:\n${context}`
    : `${problem}\n\nContext summary:\n${context?.summary || ''}`;
  const out = await opts.client.generate(prompt, { task_type: opts.task_type, role: 'leaf' });
  state.sub_calls += 1;
  return {
    refined_trace: out.reasoning || out.text || '',
    confidence: 0.5,
    verification: { passed: true, method: 'none', duration_ms: 0 },
    pair_written: false,
    cache: { hits: 0, misses: 0, enabled: false },
    cost: { total_usd: out.cost_usd || 0 },
  };
}

// ─── Guards ────────────────────────────────────────────────────────────────

function checkBudget(opts, state, id) {
  if (state.cost_so_far >= opts.budget_usd) {
    const err = new RlmBudgetExceededError(
      `rlm: budget_usd (${opts.budget_usd}) exhausted at depth ${state.depth_reached ?? 0}`,
      state.partial_tree,
      state.run_id
    );
    throw err;
  }
}

function checkTimeout(opts, state, id) {
  const elapsed = Date.now() - state.start_ms;
  if (opts.timeout_ms > 0 && elapsed >= opts.timeout_ms) {
    throw new RlmTimeoutError(
      `rlm: timeout_ms (${opts.timeout_ms}) exceeded (elapsed=${elapsed}ms)`,
      state.partial_tree,
      state.run_id
    );
  }
}

function isBudgetTooTight(opts, state) {
  // Conservative: if remaining budget < estimated minimum leaf cost, leaf.
  const remaining = opts.budget_usd - state.cost_so_far;
  return remaining < MIN_LEAF_COST_USD;
}

// ─── Tree shape utilities (exported for tests / docs) ─────────────────────

/**
 * Flat pre-order walk of all node answers.
 * @param {Object} node - Root RlmNode
 * @returns {string[]}
 */
export function traceAnswers(node) {
  if (!node) return [];
  const out = [node.answer].filter(Boolean);
  for (const child of node.children || []) out.push(...traceAnswers(child));
  return out;
}

/**
 * Total cost rolled up across the tree (recomputed; should equal node.cost.total_usd at root).
 * @param {Object} node
 * @returns {number}
 */
export function rollupCost(node) {
  if (!node) return 0;
  if (node.kind === 'leaf') return node.cost?.total_usd ?? 0;
  let total = node.cost?.decomposition_usd ?? 0;
  total += node.cost?.aggregation_usd ?? 0;
  for (const child of node.children || []) total += rollupCost(child);
  return total;
}

/**
 * Actual max depth visited.
 * @param {Object} node
 * @returns {number}
 */
export function maxDepth(node) {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) return node.depth;
  return Math.max(...node.children.map(maxDepth));
}

/**
 * Count heavy_think() + client.generate calls in the tree.
 * @param {Object} node
 * @returns {number}
 */
export function countCalls(node) {
  if (!node) return 0;
  if (node.kind === 'leaf') return 1;
  let n = 1; // decomposition
  n += 1;   // aggregation
  for (const c of node.children || []) n += countCalls(c);
  return n;
}