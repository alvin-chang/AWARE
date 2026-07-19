// SPDX-License-Identifier: Apache-2.0
// test/unit/policies/output-confidence.test.js
//
// Unit tests for the LLM09:2025 (Misinformation) output-confidence heuristic
// at src/policies/output-confidence.js. Per ADR-050 §5 GAP-6.
//
// The heuristic has three rules in v0:
//   (a) numeric claims without source citation
//   (b) date claims against current date
//   (c) entity claims not in the retrieval result set
//
// Discovery: `npm test` globs `test/unit/**/*.test.js`.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const outputConfidence = require('../../../src/policies/output-confidence');

const {
  HEURISTIC_VERSION,
  isDetectionEnabled,
  evaluate,
  primaryRule,
  confidenceScore,
  findNumericClaims,
  findDateClaims,
  extractEntities
} = outputConfidence;

// ----------------------------------------------------------------------------
// (1) Env-var gating — default off; explicit on via AWARE_LLM09_DETECTION_ENABLED.
// ----------------------------------------------------------------------------

test('output-confidence: isDetectionEnabled returns false when env var is unset', () => {
  const prev = process.env.AWARE_LLM09_DETECTION_ENABLED;
  delete process.env.AWARE_LLM09_DETECTION_ENABLED;
  try {
    assert.strictEqual(isDetectionEnabled(), false);
  } finally {
    if (prev !== undefined) process.env.AWARE_LLM09_DETECTION_ENABLED = prev;
  }
});

test('output-confidence: isDetectionEnabled returns true for "1"/"true"/"yes"/"on"', () => {
  const truthy = ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'ON'];
  const falsy = ['0', 'false', 'no', 'off', '', 'random'];
  const prev = process.env.AWARE_LLM09_DETECTION_ENABLED;
  try {
    for (const v of truthy) {
      process.env.AWARE_LLM09_DETECTION_ENABLED = v;
      assert.strictEqual(isDetectionEnabled(), true, `expected true for ${JSON.stringify(v)}`);
    }
    for (const v of falsy) {
      process.env.AWARE_LLM09_DETECTION_ENABLED = v;
      assert.strictEqual(isDetectionEnabled(), false, `expected false for ${JSON.stringify(v)}`);
    }
  } finally {
    if (prev !== undefined) process.env.AWARE_LLM09_DETECTION_ENABLED = prev;
    else delete process.env.AWARE_LLM09_DETECTION_ENABLED;
  }
});

// ----------------------------------------------------------------------------
// (2) Numeric-claim detection — rule (a)
// ----------------------------------------------------------------------------

test('output-confidence: numeric claim without citation is flagged', () => {
  const concerns = evaluate({ text: 'Revenue grew 47% in Q3.' });
  assert.ok(concerns.length >= 1, 'expected at least one concern');
  const numeric = concerns.filter((c) => c.rule === 'LLM09_2025_CITATION_MISSING');
  assert.ok(numeric.length >= 1, 'expected a CITATION_MISSING concern');
});

test('output-confidence: numeric claim WITH [1] citation is NOT flagged', () => {
  const concerns = evaluate({ text: '[1] Revenue grew 47% in Q3.' });
  const numeric = concerns.filter((c) => c.rule === 'LLM09_2025_CITATION_MISSING');
  assert.strictEqual(numeric.length, 0, 'a cited claim should not be flagged');
});

test('output-confidence: numeric claim with URL citation is NOT flagged', () => {
  const concerns = evaluate({
    text: 'Revenue grew 47% in Q3 — see https://example.com/report.'
  });
  const numeric = concerns.filter((c) => c.rule === 'LLM09_2025_CITATION_MISSING');
  assert.strictEqual(numeric.length, 0, 'a URL-cited claim should not be flagged');
});

test('output-confidence: pure prose with no numbers produces no numeric concerns', () => {
  const concerns = evaluate({ text: 'This is a simple sentence.' });
  const numeric = concerns.filter((c) => c.rule === 'LLM09_2025_CITATION_MISSING');
  assert.strictEqual(numeric.length, 0);
});

// ----------------------------------------------------------------------------
// (3) Date-claim detection — rule (b)
// ----------------------------------------------------------------------------

test('output-confidence: date far in the past flags FACTUAL_CONFLICT', () => {
  const now = new Date('2026-07-19T00:00:00Z');
  const concerns = evaluate({ text: 'The result was announced on 2020-03-15.', now });
  const conflict = concerns.filter((c) => c.rule === 'LLM09_2025_FACTUAL_CONFLICT');
  assert.ok(conflict.length >= 1, 'expected FACTUAL_CONFLICT for a 6-year-old date');
});

test('output-confidence: date within tolerance does not flag FACTUAL_CONFLICT', () => {
  const now = new Date('2026-07-19T00:00:00Z');
  const concerns = evaluate({ text: 'Released on 2026-01-10.', now });
  const conflict = concerns.filter((c) => c.rule === 'LLM09_2025_FACTUAL_CONFLICT');
  assert.strictEqual(conflict.length, 0);
});

test('output-confidence: relative-date phrase ("today") flags RELATIVE_DATE', () => {
  const now = new Date('2026-07-19T00:00:00Z');
  const concerns = evaluate({ text: 'Today is a good day to ship.', now });
  const rel = concerns.filter((c) => c.rule === 'LLM09_2025_RELATIVE_DATE');
  assert.ok(rel.length >= 1);
});

test('output-confidence: quarter labels are recognised as date claims', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const concerns = evaluate({ text: 'Q3 2026 was the launch window.', now });
  const conflict = concerns.filter((c) => c.rule === 'LLM09_2025_FACTUAL_CONFLICT');
  assert.ok(conflict.length >= 1, 'Q3 2026 vs now=2030 → FACTUAL_CONFLICT');
});

// ----------------------------------------------------------------------------
// (4) Entity-claim detection — rule (c)
// ----------------------------------------------------------------------------

test('output-confidence: entity not in retrieval set is flagged', () => {
  const concerns = evaluate({
    text: 'Acme Corp released a new product today.',
    retrievalEntities: ['Globex Inc', 'Initech']
  });
  const unsupported = concerns.filter((c) => c.rule === 'LLM09_2025_UNSUPPORTED_ENTITY');
  assert.ok(unsupported.length >= 1);
  assert.strictEqual(unsupported[0].entity, 'Acme Corp');
});

test('output-confidence: entity in retrieval set is NOT flagged', () => {
  const concerns = evaluate({
    text: 'Acme Corp released a new product today.',
    retrievalEntities: ['Acme Corp', 'Globex Inc']
  });
  const unsupported = concerns.filter((c) => c.rule === 'LLM09_2025_UNSUPPORTED_ENTITY');
  assert.strictEqual(unsupported.length, 0);
});

test('output-confidence: empty retrievalEntities skips entity checking', () => {
  // With no retrieval context, the heuristic can't claim an unsupported
  // entity — that's a conservative call. Numeric and date rules still fire.
  const concerns = evaluate({ text: 'Acme Corp grew 47%.' });
  const unsupported = concerns.filter((c) => c.rule === 'LLM09_2025_UNSUPPORTED_ENTITY');
  assert.strictEqual(unsupported.length, 0);
});

// ----------------------------------------------------------------------------
// (5) Aggregate behaviour — confidenceScore and primaryRule
// ----------------------------------------------------------------------------

test('output-confidence: confidenceScore is 1.0 when there are no concerns', () => {
  assert.strictEqual(confidenceScore([]), 1.0);
});

test('output-confidence: confidenceScore decreases as concerns accumulate', () => {
  assert.strictEqual(confidenceScore([{ rule: 'X' }]), 0.7);
  assert.strictEqual(confidenceScore([{ rule: 'X' }, { rule: 'Y' }]), 0.4);
  assert.strictEqual(confidenceScore([{ rule: 'X' }, { rule: 'Y' }, { rule: 'Z' }, { rule: 'W' }]), 0);
});

test('output-confidence: primaryRule orders FACTUAL_CONFLICT above the others', () => {
  const concerns = [
    { rule: 'LLM09_2025_CITATION_MISSING' },
    { rule: 'LLM09_2025_FACTUAL_CONFLICT' }
  ];
  assert.strictEqual(primaryRule(concerns), 'LLM09_2025_FACTUAL_CONFLICT');
});

test('output-confidence: primaryRule returns null on empty input', () => {
  assert.strictEqual(primaryRule([]), null);
  assert.strictEqual(primaryRule(null), null);
});

// ----------------------------------------------------------------------------
// (6) Defensive input handling
// ----------------------------------------------------------------------------

test('output-confidence: evaluate() handles missing/invalid input gracefully', () => {
  assert.deepStrictEqual(evaluate(null), []);
  assert.deepStrictEqual(evaluate({}), []);
  assert.deepStrictEqual(evaluate({ text: null }), []);
  assert.deepStrictEqual(evaluate({ text: 123 }), []); // not a string
});

// ----------------------------------------------------------------------------
// (7) Lower-level helpers — findNumericClaims / findDateClaims / extractEntities
// ----------------------------------------------------------------------------

test('output-confidence: findNumericClaims skips ordinals', () => {
  const claims = findNumericClaims('He came 1st, she came 2nd.');
  assert.strictEqual(claims.length, 0, 'ordinals should not be flagged as claims');
});

test('output-confidence: findDateClaims recognises ISO dates', () => {
  const claims = findDateClaims('On 2026-07-19 we shipped.');
  assert.ok(claims.length >= 1);
  assert.strictEqual(claims[0].year, 2026);
});

test('output-confidence: extractEntities captures multi-word capitalized phrases', () => {
  const entities = extractEntities('Acme Corp released the Open Source Library.');
  assert.ok(entities.includes('Acme Corp'), `expected 'Acme Corp' in ${JSON.stringify(entities)}`);
  assert.ok(entities.includes('Open Source Library'),
    `expected 'Open Source Library' in ${JSON.stringify(entities)}`);
});

// ----------------------------------------------------------------------------
// (8) Version surface
// ----------------------------------------------------------------------------

test('output-confidence: HEURISTIC_VERSION is a non-empty string', () => {
  assert.strictEqual(typeof HEURISTIC_VERSION, 'string');
  assert.ok(HEURISTIC_VERSION.length > 0);
});
