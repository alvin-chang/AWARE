// test/rlm/decompose.test.js — Decompose prompt + parser unit tests
//
// Verifies:
//   - buildDecomposePrompt returns {system, user} when system_prompt is provided
//   - buildDecomposePrompt returns concatenated string when no system_prompt
//   - parseDecomposition handles 1..N numbered sub-problems
//   - parseDecomposition handles bullets ("- " / "* ")
//   - parseDecomposition respects maxSubproblems cap
//   - parseDecomposition handles fenced (```...```) output
//   - parseDecomposition returns [] for atomic / malformed input
//   - decompose() retries on malformed then returns [] (after double-malformed)
//   - decompose() integrates with a stub client and aggregates cost_usd

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDecomposePrompt, parseDecomposition, decompose } from '../../src/rlm/decompose.js';

// ─── Prompt construction ─────────────────────────────────────────────────

test('decompose-prompt: returns object {system, user} when system_prompt is provided', () => {
  const r = buildDecomposePrompt({
    problem: 'Analyze this repo',
    env: { kind: 'directory', summary: 'a tree' },
    branching: 3,
    system_prompt: 'You are a decomposition LM',
  });
  assert.equal(typeof r, 'object');
  assert.equal(r.system, 'You are a decomposition LM');
  assert.match(r.user, /Analyze this repo/);
  assert.match(r.user, /a tree/);
  assert.match(r.user, /1–3|1-3/);
});

test('decompose-prompt: returns string (legacy) when no system_prompt', () => {
  const r = buildDecomposePrompt({
    problem: 'Analyze this repo',
    env: { kind: 'inline', text: 'short text', summary: 'inline text' },
    branching: 2,
  });
  assert.equal(typeof r, 'string');
  assert.match(r, /Analyze this repo/);
});

test('decompose-prompt: includes 3 examples when system_prompt is provided', () => {
  const r = buildDecomposePrompt({
    problem: 'p', env: { summary: 'inline' }, branching: 2, system_prompt: 's',
  });
  // Count "EXAMPLE N" occurrences — should be 3.
  const exampleCount = (r.user.match(/EXAMPLE\s+\d+/g) || []).length;
  assert.equal(exampleCount, 3);
});

test('decompose-prompt: respects branching cap', () => {
  const r = buildDecomposePrompt({
    problem: 'p', env: { summary: 'x' }, branching: 7, system_prompt: 's',
  });
  assert.match(r.user, /1–7|1-7/);
});

// ─── Parser ──────────────────────────────────────────────────────────────

test('parseDecomposition: handles numbered list', () => {
  const text = `SUB-PROBLEMS:
1. First sub-problem
2. Second sub-problem
3. Third sub-problem`;
  const subs = parseDecomposition(text, 5);
  assert.equal(subs.length, 3);
  assert.equal(subs[0], 'First sub-problem');
  assert.equal(subs[1], 'Second sub-problem');
  assert.equal(subs[2], 'Third sub-problem');
});

test('parseDecomposition: handles "1)" numbering variant', () => {
  const text = `SUB-PROBLEMS:
1) First
2) Second`;
  assert.deepEqual(parseDecomposition(text, 5), ['First', 'Second']);
});

test('parseDecomposition: handles bullet variant', () => {
  const text = `SUB-PROBLEMS:
- alpha
- beta
- gamma`;
  assert.deepEqual(parseDecomposition(text, 5), ['alpha', 'beta', 'gamma']);
});

test('parseDecomposition: respects maxSubproblems cap', () => {
  const text = `SUB-PROBLEMS:
1. A
2. B
3. C
4. D
5. E`;
  assert.equal(parseDecomposition(text, 3).length, 3);
});

test('parseDecomposition: extracts from fenced code block', () => {
  const text = `Here is my answer:
\`\`\`
SUB-PROBLEMS:
1. Only one
\`\`\``;
  assert.deepEqual(parseDecomposition(text, 5), ['Only one']);
});

test('parseDecomposition: returns [] when no SUB-PROBLEMS header', () => {
  assert.deepEqual(parseDecomposition('Just some prose without structure', 5), []);
});

test('parseDecomposition: returns [] when header missing sub-problem body', () => {
  assert.deepEqual(parseDecomposition('SUB-PROBLEMS:', 5), []);
});

test('parseDecomposition: stops at section headers (CONFIDENCE / OUTPUT)', () => {
  const text = `SUB-PROBLEMS:
1. First
2. Second
OUTPUT: stuff after`;
  const subs = parseDecomposition(text, 5);
  assert.deepEqual(subs, ['First', 'Second']);
});

test('parseDecomposition: handles atomic problem (single restated sub-problem)', () => {
  const text = `SUB-PROBLEMS:
1. The original problem restated exactly as given.`;
  const subs = parseDecomposition(text, 5);
  assert.equal(subs.length, 1);
});

// ─── High-level decompose() ──────────────────────────────────────────────

test('decompose: integrates with stub client + aggregates cost', async () => {
  const stubClient = {
    generate: async (_prompt, _opts) => ({
      reasoning: `SUB-PROBLEMS:
1. Sub A
2. Sub B`,
      cost_usd: 0.003,
    }),
  };
  const out = await decompose({
    problem: 'p',
    env: { summary: 'inline text' },
    branching: 3,
    client: stubClient,
  });
  assert.deepEqual(out.subproblems, ['Sub A', 'Sub B']);
  assert.equal(out.cost_usd, 0.003);
  assert.equal(out.retried, false);
});

test('decompose: retries once on malformed then succeeds', async () => {
  let attempt = 0;
  const stubClient = {
    generate: async () => {
      attempt += 1;
      if (attempt === 1) return { reasoning: 'no structure at all', cost_usd: 0.001 };
      return { reasoning: 'SUB-PROBLEMS:\n1. Worked second time', cost_usd: 0.002 };
    },
  };
  const out = await decompose({
    problem: 'p',
    env: { summary: 'x' },
    branching: 2,
    client: stubClient,
  });
  assert.deepEqual(out.subproblems, ['Worked second time']);
  assert.equal(out.retried, true);
  assert.equal(attempt, 2);
});

test('decompose: returns empty subproblems when client fails twice', async () => {
  const stubClient = {
    generate: async () => ({ reasoning: 'still no structure', cost_usd: 0.001 }),
  };
  const out = await decompose({
    problem: 'p', env: { summary: 'x' }, branching: 2, client: stubClient, maxRetries: 1,
  });
  assert.deepEqual(out.subproblems, []);
  assert.equal(out.retried, true);
});

test('decompose: throws on missing client.generate', async () => {
  await assert.rejects(
    () => decompose({ problem: 'p', env: {}, branching: 2, client: null }),
    /client\.generate is required/
  );
});

test('decompose: aggregates cost across retry attempts', async () => {
  let attempt = 0;
  const stubClient = {
    generate: async () => {
      attempt += 1;
      if (attempt === 1) return { reasoning: 'malformed', cost_usd: 0.005 };
      return { reasoning: 'SUB-PROBLEMS:\n1. ok', cost_usd: 0.007 };
    },
  };
  const out = await decompose({
    problem: 'p', env: { summary: 'x' }, branching: 2, client: stubClient, maxRetries: 1,
  });
  // Cost should be sum across both attempts
  assert.equal(out.cost_usd, 0.012);
});