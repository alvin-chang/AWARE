// AWARE 2.0 coordinator — HeavySkill integration tests
// These tests use mock clients (no network). The live API path is in heavy-think's
// own integration tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  awareHeavyThink,
  buildPairPath,
  classifyError,
  DEFAULT_PAIRS_DIR,
} from '../../../src/coordinator/heavyskill-integration.js';
import { coordinate, COORDINATOR_VERSION, COORDINATOR_BUILD_PHASE } from '../../../src/coordinator/index.js';

function mockClient() {
  return {
    async generate(prompt, opts = {}) {
      if (opts.phase === 'prm_score') {
        return { reasoning: JSON.stringify({ score: 7, strengths: [], weaknesses: [], confidence: 0.8 }) };
      }
      if (opts.phase === 'refine') {
        return { reasoning: 'refined output', confidence: 0.9 };
      }
      return { reasoning: `attempt ${opts.attempt_index}: solving the problem` };
    },
    calls: [],
  };
}

test('awareHeavyThink wraps heavy_think and returns ok:true on success', async () => {
  const result = await awareHeavyThink({
    problem: 'solve x',
    K: 2,
    task_type: 'standard',
    client: mockClient(),
    writePairs: false,
  });
  assert.equal(result.ok, true);
  assert.ok(result.refined_trace);
  assert.equal(result.attempts.length, 2);
});

test('awareHeavyThink returns error envelope on failure', async () => {
  const failing = { async generate() { throw new Error('upstream 502 bad gateway'); }, calls: [] };
  const result = await awareHeavyThink({
    problem: 'p', K: 1, client: failing, writePairs: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.type, 'upstream_error');
  assert.ok(result.error.message.includes('502'));
});

test('awareHeavyThink classifies invalid_input errors', async () => {
  const result = await awareHeavyThink({
    client: mockClient(), writePairs: false,  // no problem
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.type, 'invalid_input');
});

test('awareHeavyThink writes preference pairs to a daily JSONL file', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aware-coord-'));
  try {
    const result = await awareHeavyThink({
      problem: 'fix the bug',
      K: 1,
      task_type: 'simple',
      client: mockClient(),
      pairsDir: tmp,
    });
    assert.equal(result.ok, true);
    assert.equal(result.pair_written, true);

    const expectedPath = buildPairPath(tmp);
    assert.ok(existsSync(expectedPath), `pair file should exist at ${expectedPath}`);
    // pair_path must be returned so the AWARE conversation logger can
    // populate aware_conversations.pair_path. Phase 2.4 data flywheel
    // unblock — without this, the trainer's _fetchUnconsumedPairPaths
    // filters all rows out (pair_path IS NULL) and the trainer never
    // sees any pair.
    assert.equal(result.pair_path, expectedPath, 'pair_path should be the JSONL file path');
    const content = readFileSync(expectedPath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.problem, 'fix the bug');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('awareHeavyThink returns pair_path: null when writePairs is false', async () => {
  const result = await awareHeavyThink({
    problem: 'p',
    K: 1,
    task_type: 'simple',
    client: mockClient(),
    writePairs: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.pair_written, false);
  assert.equal(result.pair_path, null, 'pair_path should be null when writePairs=false');
});

test('buildPairPath produces a YYYY-MM-DD.jsonl path under the pairs dir', () => {
  const path = buildPairPath('/tmp/aware-test-pairs');
  assert.match(path, /\/tmp\/aware-test-pairs\/\d{4}-\d{2}-\d{2}\.jsonl$/);
});

test('DEFAULT_PAIRS_DIR is under <host-config>/metaclaw/preference-pairs/', () => {
  assert.match(DEFAULT_PAIRS_DIR, /\.<runtime>\/metaclaw\/preference-pairs$/);
});

test('classifyError handles common error shapes', () => {
  assert.equal(classifyError(new Error('problem is required')), 'invalid_input');
  assert.equal(classifyError(new Error('K must be >= 1')), 'invalid_input');
  assert.equal(classifyError(new Error('minimax API 502 bad gateway')), 'upstream_error');
  assert.equal(classifyError(new Error('something else')), 'internal_error');
});

test('coordinate() is the public entry point and accepts session/agent context', async () => {
  const result = await coordinate({
    problem: 'p',
    K: 1,
    task_type: 'simple',
    client: mockClient(),
    sessionId: 'sess-123',
    agentId: 'agent:scout:live-001',
  });
  assert.equal(result.ok, true);
});

test('COORDINATOR_VERSION and COORDINATOR_BUILD_PHASE are surfaced', () => {
  // Phase 1 passthrough (ADR-022) closes the two open items from
  // commit 301f672d: passthrough wrap (gateway proxy body-handling)
  // and api.pluginConfig plumbing.
  assert.equal(COORDINATOR_VERSION, '0.3.0-phase-1-pluginconfig');
  assert.equal(COORDINATOR_BUILD_PHASE, 'phase-1-passthrough');
});
