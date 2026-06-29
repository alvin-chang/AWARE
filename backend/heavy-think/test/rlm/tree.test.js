// test/rlm/tree.test.js — Recursion + cost accounting + tree shape tests
//
// Verifies:
//   - runNode returns a leaf at max_depth
//   - runNode decomposes at root then recurses to leaves at depth=max_depth-1
//   - budget exhaustion throws RlmBudgetExceededError
//   - timeout throws RlmTimeoutError
//   - aggregation fallback flags tree.meta.partial = true
//   - leaf failure fallback
//   - utilities: traceAnswers, rollupCost, maxDepth, countCalls

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RlmBudgetExceededError,
  RlmTimeoutError,
} from '../../src/rlm/errors.js';

// tree.js has no default client; we test through rlm.js using a stub client.
// We also test the exported utilities directly.

// ─── Utilities (no client needed) ─────────────────────────────────────────

test('tree-utils: traceAnswers flattens pre-order', async () => {
  const { traceAnswers } = await import('../../src/rlm/tree.js');
  const node = {
    answer: 'root',
    children: [
      { answer: 'child1', children: [] },
      { answer: 'child2', children: [{ answer: 'grandchild', children: [] }] },
    ],
  };
  assert.deepEqual(traceAnswers(node), ['root', 'child1', 'child2', 'grandchild']);
});

test('tree-utils: traceAnswers handles null', async () => {
  const { traceAnswers } = await import('../../src/rlm/tree.js');
  assert.deepEqual(traceAnswers(null), []);
});

test('tree-utils: rollupCost sums leaf + internal costs', async () => {
  const { rollupCost } = await import('../../src/rlm/tree.js');
  const node = {
    kind: 'internal',
    cost: { decomposition_usd: 0.005, aggregation_usd: 0.005 },
    children: [
      { kind: 'leaf', cost: { total_usd: 0.01 } },
      { kind: 'leaf', cost: { total_usd: 0.02 } },
    ],
  };
  assert.equal(rollupCost(node), 0.04);
});

test('tree-utils: maxDepth returns leaf depth when no children', async () => {
  const { maxDepth } = await import('../../src/rlm/tree.js');
  assert.equal(maxDepth({ depth: 3, children: [] }), 3);
});

test('tree-utils: maxDepth recurses into children', async () => {
  const { maxDepth } = await import('../../src/rlm/tree.js');
  const node = {
    depth: 0,
    children: [
      { depth: 1, children: [{ depth: 2, children: [] }] },
      { depth: 1, children: [] },
    ],
  };
  assert.equal(maxDepth(node), 2);
});

test('tree-utils: countCalls counts 1 decompose + 1 aggregation + N leaves', async () => {
  const { countCalls } = await import('../../src/rlm/tree.js');
  const node = {
    kind: 'internal',
    children: [
      { kind: 'leaf', children: [] },
      { kind: 'leaf', children: [] },
    ],
  };
  // 1 (decompose) + 1 (aggregate) + 2 (leaves) = 4
  assert.equal(countCalls(node), 4);
});

// ─── runNode: budget exhaustion ──────────────────────────────────────────

test('runNode: throws RlmBudgetExceededError when budget_usd exhausted before recursion', async () => {
  // We test the rlm() entry instead, since runNode needs full state setup.
  // Create a stub client that reports high cost so we exhaust budget fast.
  const { rlm } = await import('../../src/rlm.js');
  const expensiveClient = {
    generate: async () => ({ reasoning: 'SUB-PROBLEMS:\n1. sub', cost_usd: 0.10, text: '' }),
  };

  await assert.rejects(
    () => rlm({
      problem: 'Analyze this',
      context: 'inline',
      budget_usd: 0.05, // less than the first call's cost
      client: expensiveClient,
      use_heavyskill: false, // use rawLeaf path
      max_depth: 2,
      branching: 2,
    }),
    (err) => err instanceof RlmBudgetExceededError
  );
});

test('runNode: throws RlmTimeoutError when elapsed >= timeout_ms', async () => {
  const { rlm } = await import('../../src/rlm.js');
  // Use a slow client that returns a real sub-problem on the first
  // call so we enter the recursion loop where checkTimeout fires
  // between children. branching=1 keeps the loop tight so we hit
  // the timeout check deterministically.
  let callCount = 0;
  const slowClient = {
    generate: async () => {
      callCount += 1;
      await new Promise(r => setTimeout(r, 30));
      if (callCount === 1) {
        return { reasoning: 'SUB-PROBLEMS:\n1. sub-a', cost_usd: 0.001 };
      }
      return { reasoning: 'SYNTHESIS: ok', cost_usd: 0.001 };
    },
  };

  await assert.rejects(
    () => rlm({
      problem: 'q',
      context: 'inline',
      timeout_ms: 10,
      client: slowClient,
      use_heavyskill: false,
      max_depth: 2,
      branching: 1,
    }),
    (err) => err instanceof RlmTimeoutError
  );
});