// test/unit/trainer/outcome-filter.test.js — Unit tests for src/trainer/outcome-filter.js
//
// Phase 4 (ADR-020 618-627): outcome filter gates MetaClaw preference
// pairs. The filter is a pure function — these tests assert the
// contract directly, with no I/O, no clock, no randomness.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterOutcomePairs,
  listFilterRules,
} from '../../../src/trainer/outcome-filter.js';

// -- Fixtures ------------------------------------------------------------

function makeRecord(overrides = {}) {
  return {
    problem: 'What is 2+2?',
    chosen: { reasoning: '4', prm_score: 0.9 },
    rejected: { reasoning: '5', prm_score: 0.3 },
    task_type: 'arithmetic',
    _content_hash: 'abc123',
    ...overrides,
  };
}

// -- noop (default) -------------------------------------------------------

test('outcome-filter: noop rule keeps all valid records', () => {
  const records = [makeRecord(), makeRecord({ problem: 'What is 3+3?' })];
  const result = filterOutcomePairs(records);
  assert.equal(result.kept.length, 2);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.stats.rule, 'noop');
  assert.equal(result.stats.totalIn, 2);
  assert.equal(result.stats.totalKept, 2);
  assert.equal(result.stats.totalDropped, 0);
});

test('outcome-filter: noop is the default when options.rule is omitted', () => {
  const result = filterOutcomePairs([makeRecord()]);
  assert.equal(result.stats.rule, 'noop');
});

test('outcome-filter: empty input returns empty arrays, not an error', () => {
  const result = filterOutcomePairs([]);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.stats.totalIn, 0);
});

// -- min_score_gap --------------------------------------------------------

test('outcome-filter: min_score_gap drops records with gap < threshold', () => {
  const tight = makeRecord({
    chosen: { reasoning: 'A', prm_score: 0.55 },
    rejected: { reasoning: 'B', prm_score: 0.50 },
  });
  const wide = makeRecord({
    problem: 'What is 4+4?',
    chosen: { reasoning: '8', prm_score: 0.95 },
    rejected: { reasoning: '9', prm_score: 0.20 },
  });
  const result = filterOutcomePairs([tight, wide], {
    rule: 'min_score_gap',
    minGap: 0.1,
  });
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].problem, 'What is 4+4?');
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /^min_score_gap:0\.0500<0\.1$/);
});

test('outcome-filter: min_score_gap keeps records when scores are missing (defensive)', () => {
  const noScores = makeRecord({
    chosen: { reasoning: 'X' },     // no prm_score
    rejected: { reasoning: 'Y' },   // no prm_score
  });
  const result = filterOutcomePairs([noScores], { rule: 'min_score_gap' });
  assert.equal(result.kept.length, 1, 'missing scores should not penalize');
});

test('outcome-filter: min_score_gap uses default 0.05 when minGap is omitted', () => {
  const rec = makeRecord({
    chosen: { reasoning: 'A', prm_score: 0.51 },
    rejected: { reasoning: 'B', prm_score: 0.50 },
  });
  const result = filterOutcomePairs([rec], { rule: 'min_score_gap' });
  // gap = 0.01, below 0.05 → drop
  assert.equal(result.kept.length, 0);
  assert.match(result.dropped[0].reason, /^min_score_gap/);
});

// -- tag_match ------------------------------------------------------------

test('outcome-filter: tag_match keeps records whose task_type is in the allow-list', () => {
  const math = makeRecord({ task_type: 'arithmetic' });
  const code = makeRecord({ task_type: 'code', problem: 'reverse a string' });
  const result = filterOutcomePairs([math, code], {
    rule: 'tag_match',
    allowedTaskTypes: ['arithmetic'],
  });
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].task_type, 'arithmetic');
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /^tag_match:code/);
});

test('outcome-filter: tag_match with empty allow-list keeps everything', () => {
  // Empty allow-list means "operator hasn't decided yet" — keep all
  const rec = makeRecord({ task_type: 'chitchat' });
  const result = filterOutcomePairs([rec], {
    rule: 'tag_match',
    allowedTaskTypes: [],
  });
  assert.equal(result.kept.length, 1);
});

test('outcome-filter: tag_match drops records with no task_type', () => {
  const rec = makeRecord();
  delete rec.task_type;
  const result = filterOutcomePairs([rec], {
    rule: 'tag_match',
    allowedTaskTypes: ['arithmetic'],
  });
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /<unset>/);
});

// -- malformed input ------------------------------------------------------

test('outcome-filter: rejects unknown rule name with a clear error', () => {
  assert.throws(
    () => filterOutcomePairs([makeRecord()], { rule: 'magic_beans' }),
    /unknown rule 'magic_beans'/
  );
});

test('outcome-filter: rejects non-array input', () => {
  assert.throws(
    () => filterOutcomePairs('not an array'),
    /records must be an array/
  );
});

test('outcome-filter: drops malformed records (null, string, number)', () => {
  const result = filterOutcomePairs([null, 'a string', 42, makeRecord()]);
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 3);
  for (const d of result.dropped) {
    assert.equal(d.reason, 'malformed_record');
  }
});

// -- introspection -------------------------------------------------------

test('outcome-filter: listFilterRules returns the canonical set', () => {
  const rules = listFilterRules();
  assert.deepEqual(rules.sort(), ['min_score_gap', 'noop', 'tag_match']);
});

test('outcome-filter: result shape is stable (kept, dropped, stats)', () => {
  const result = filterOutcomePairs([makeRecord()]);
  assert.ok(Array.isArray(result.kept));
  assert.ok(Array.isArray(result.dropped));
  assert.equal(typeof result.stats, 'object');
  assert.ok('rule' in result.stats);
  assert.ok('totalIn' in result.stats);
  assert.ok('totalKept' in result.stats);
  assert.ok('totalDropped' in result.stats);
});
