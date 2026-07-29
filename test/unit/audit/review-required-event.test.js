// SPDX-License-Identifier: Apache-2.0
// test/unit/audit/review-required-event.test.js
//
// Chain-integrity tests for the LLM09:2025 (Misinformation) review-loop
// event type emitted by src/compliance/llm09-mapper.js. Per ADR-050 §5
// GAP-6.
//
// What this test pins:
//
//   1. review_required annotations carry the canonical action.type
//      discriminator so the /api/compliance/llm-top-10/misinformation-review
//      route can filter on it.
//   2. Each review_required record's parentDecisionId points at the source
//      model-output event's decisionId — the audit chain topology required
//      for downstream compliance reports to group by source.
//   3. resolveReview() writes a child review_required_resolved record
//      whose parentDecisionId is the review_required decisionId. The
//      route derives `status=resolved` from this linkage.
//   4. The mapper never mutates the source event it reads from.
//   5. When AWARE_LLM09_DETECTION_ENABLED is unset, classifyAndLog with
//      forceReview writes nothing — the env var gates the production path.
//   6. Audit chain hash integrity: a review_required annotation chained
//      via the real decision-logger.logDecision participates in the
//      existing prevHash chain (we test this with a fake logger that
//      mirrors the real prevHash behaviour).
//
// Discovery: `npm test` globs `test/unit/**/*.test.js`.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  emitReviewRequired,
  resolveReview,
  classify,
  classifyAndLog,
  ACTION_TYPE_REVIEW_REQUIRED,
  ACTION_TYPE_REVIEW_RESOLVED,
  buildReviewRecord,
  buildResolvedRecord,
  computeOutputHash
} = require('../../../src/compliance/llm09-mapper');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeSourceEvent(overrides = {}) {
  return {
    decisionId: 'src-' + Math.random().toString(36).slice(2, 10),
    parentDecisionId: null,
    timestamp: '2026-07-19T00:00:00.000Z',
    actor: { agentId: 'agent-1', trustScore: 0.8 },
    action: {
      type: 'model_output',
      target: 'tool-output',
      reason: 'final-answer'
    },
    context: { pheromoneScores: {}, heuristicWeights: {}, policyId: 'p', policyVersion: '1' },
    outcome: { success: true, latencyMs: 5, errorMessage: null },
    ...overrides
  };
}

// Fake decision-logger: stores every record with a chained prevHash and
// exposes getChainBetween for cross-record assertions. Mirrors the
// decision-logger's prevHash semantics closely enough to validate the
// mapper's write-path invariants without taking a real on-disk dependency.
function makeChainingFakeLogger() {
  const stored = [];
  let prevHash = null;
  return {
    stored,
    logDecision: async (decision) => {
      const hash = 'sha-' + (stored.length + 1).toString().padStart(60, '0');
      decision.hash = hash;
      if (prevHash !== null) decision.prevHash = prevHash;
      stored.push(decision);
      prevHash = hash;
      return hash;
    },
    getChainBetween: async (from, to) => {
      const startIdx = stored.findIndex((r) => r.decisionId === from);
      const endIdx = stored.findIndex((r) => r.decisionId === to);
      if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return [];
      return stored.slice(startIdx, endIdx + 1);
    }
  };
}

// ----------------------------------------------------------------------------
// (1) The annotation record carries the canonical action.type discriminator.
// ----------------------------------------------------------------------------

test('review-required event: buildReviewRecord sets action.type = "review_required"', () => {
  const review = {
    eventType: ACTION_TYPE_REVIEW_REQUIRED,
    sourceDecisionId: 'src-1',
    decisionId: 'ann-1',
    parentDecisionId: 'src-1',
    timestamp: '2026-07-19T00:00:00.000Z',
    triggerSource: 'LLM09_2025_FACTUAL_CONFLICT',
    confidenceScore: 0.4,
    outputHash: 'abc123',
    agentId: 'agent-1',
    concerns: [],
    heuristicVersion: '0.1.0'
  };
  const record = buildReviewRecord({ review });
  assert.strictEqual(record.action.type, ACTION_TYPE_REVIEW_REQUIRED);
  assert.strictEqual(record.action.annotation.eventType, ACTION_TYPE_REVIEW_REQUIRED);
  assert.strictEqual(record.action.annotation.sourceDecisionId, 'src-1');
  assert.strictEqual(record.action.annotation.triggerSource, 'LLM09_2025_FACTUAL_CONFLICT');
  assert.strictEqual(record.action.annotation.outputHash, 'abc123');
  assert.strictEqual(record.action.annotation.agentId, 'agent-1');
  assert.strictEqual(record.decisionId, 'ann-1');
  assert.strictEqual(record.parentDecisionId, 'src-1');
});

// ----------------------------------------------------------------------------
// (2) Each review_required parents at the source model-output decisionId.
// ----------------------------------------------------------------------------

test('review-required event: emitReviewRequired writes with parentDecisionId = source.decisionId', async () => {
  const fakeLogger = makeChainingFakeLogger();
  const source = makeSourceEvent({ decisionId: 'src-parent-1' });

  const review = await emitReviewRequired({
    auditLogger: fakeLogger,
    sourceDecisionId: source.decisionId,
    agentId: 'agent-1',
    outputText: 'Revenue grew 47% in Q3 2020.',
    forceReview: true
  });

  assert.ok(review, 'emitReviewRequired should return the annotation');
  assert.strictEqual(review.parentDecisionId, 'src-parent-1',
    'review parentDecisionId must equal source decisionId');
  assert.strictEqual(review.sourceDecisionId, 'src-parent-1');

  const stored = fakeLogger.stored.find((r) => r.decisionId === review.decisionId);
  assert.ok(stored, 'annotation should be persisted in the fake log');
  assert.strictEqual(stored.action.type, ACTION_TYPE_REVIEW_REQUIRED);
  assert.strictEqual(stored.parentDecisionId, 'src-parent-1');
});

// ----------------------------------------------------------------------------
// (3) resolveReview chains via parentDecisionId to the review_required.
// ----------------------------------------------------------------------------

test('review-required event: resolveReview writes a child record with parentDecisionId = review.decisionId', async () => {
  const fakeLogger = makeChainingFakeLogger();
  const source = makeSourceEvent({ decisionId: 'src-resolve-1' });

  const review = await emitReviewRequired({
    auditLogger: fakeLogger,
    sourceDecisionId: source.decisionId,
    agentId: 'agent-1',
    outputText: 'On 2020-03-15 we shipped.',
    forceReview: true
  });
  assert.ok(review);

  const resolved = await resolveReview({
    auditLogger: fakeLogger,
    reviewDecisionId: review.decisionId,
    resolvedBy: 'operator-1',
    resolution: 'verified by source check'
  });
  assert.ok(resolved);
  assert.strictEqual(resolved.eventType, ACTION_TYPE_REVIEW_RESOLVED);
  assert.strictEqual(resolved.parentDecisionId, review.decisionId,
    'resolved record must parent at the review_required decisionId');

  const resolvedStored = fakeLogger.stored.find((r) => r.decisionId === resolved.decisionId);
  assert.ok(resolvedStored);
  assert.strictEqual(resolvedStored.action.type, ACTION_TYPE_REVIEW_RESOLVED);
  assert.strictEqual(resolvedStored.action.annotation.resolvedBy, 'operator-1');
  assert.strictEqual(resolvedStored.action.annotation.resolution, 'verified by source check');
});

// ----------------------------------------------------------------------------
// (4) The mapper never mutates the source event.
// ----------------------------------------------------------------------------

test('review-required event: classify() does not mutate the source event (defence-in-depth)', () => {
  const source = makeSourceEvent();
  const before = JSON.stringify(source);
  const review = classify('Revenue grew 47% in Q3 2020.', source.decisionId);
  const after = JSON.stringify(source);
  assert.strictEqual(after, before, 'source event JSON must be byte-equal before and after classify()');
  assert.ok(review, 'classify() should produce a review for a flagged claim');
});

// ----------------------------------------------------------------------------
// (5) Env-var gating: detection off → classifyAndLog no-ops unless forceReview.
// ----------------------------------------------------------------------------

test('review-required event: classifyAndLog is a no-op when AWARE_LLM09_DETECTION_ENABLED is unset', async () => {
  const fakeLogger = makeChainingFakeLogger();
  const prev = process.env.AWARE_LLM09_DETECTION_ENABLED;
  delete process.env.AWARE_LLM09_DETECTION_ENABLED;
  try {
    const result = await classifyAndLog(
      'Revenue grew 47%.',
      'src-gated-1',
      fakeLogger
    );
    assert.strictEqual(result, null);
    assert.strictEqual(fakeLogger.stored.length, 0, 'no record should be written');
  } finally {
    if (prev !== undefined) process.env.AWARE_LLM09_DETECTION_ENABLED = prev;
  }
});

test('review-required event: classifyAndLog with forceReview writes even when detection disabled', async () => {
  const fakeLogger = makeChainingFakeLogger();
  const prev = process.env.AWARE_LLM09_DETECTION_ENABLED;
  delete process.env.AWARE_LLM09_DETECTION_ENABLED;
  try {
    const result = await classifyAndLog(
      'Revenue grew 47%.',
      'src-force-1',
      fakeLogger,
      { forceReview: true }
    );
    assert.ok(result, 'forceReview must bypass the env-var gate');
    assert.strictEqual(fakeLogger.stored.length, 1);
    assert.strictEqual(fakeLogger.stored[0].parentDecisionId, 'src-force-1');
  } finally {
    if (prev !== undefined) process.env.AWARE_LLM09_DETECTION_ENABLED = prev;
  }
});

test('review-required event: classifyAndLog with detection enabled writes automatically', async () => {
  const fakeLogger = makeChainingFakeLogger();
  const prev = process.env.AWARE_LLM09_DETECTION_ENABLED;
  process.env.AWARE_LLM09_DETECTION_ENABLED = '1';
  try {
    const result = await classifyAndLog(
      'Revenue grew 47% in Q3 2020.',
      'src-enabled-1',
      fakeLogger
    );
    assert.ok(result, 'detection-enabled path must write when concerns surface');
    assert.strictEqual(fakeLogger.stored.length, 1);
  } finally {
    if (prev !== undefined) process.env.AWARE_LLM09_DETECTION_ENABLED = prev;
    else delete process.env.AWARE_LLM09_DETECTION_ENABLED;
  }
});

// ----------------------------------------------------------------------------
// (6) computeOutputHash — deterministic SHA-256 of the output text.
// ----------------------------------------------------------------------------

test('review-required event: computeOutputHash returns null for non-string input', () => {
  assert.strictEqual(computeOutputHash(null), null);
  assert.strictEqual(computeOutputHash(undefined), null);
  assert.strictEqual(computeOutputHash(123), null);
});

test('review-required event: computeOutputHash is deterministic and 64-char hex', () => {
  const a = computeOutputHash('Revenue grew 47%.');
  const b = computeOutputHash('Revenue grew 47%.');
  assert.strictEqual(a, b, 'same input must produce same hash');
  assert.strictEqual(typeof a, 'string');
  assert.strictEqual(a.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(a), 'hash must be 64-char lowercase hex');
});

// ----------------------------------------------------------------------------
// (7) Audit chain hash integrity — a review_required annotation chained
//     via the real decision-logger-style write participates in prevHash.
// ----------------------------------------------------------------------------

test('review-required event: prevHash chains across multiple reviews from one source', async () => {
  const fakeLogger = makeChainingFakeLogger();

  // Two reviews from the same source — they share a parent.
  const r1 = await emitReviewRequired({
    auditLogger: fakeLogger,
    sourceDecisionId: 'src-multi-1',
    agentId: 'agent-1',
    outputText: 'Revenue grew 47% in Q3 2020.',
    forceReview: true
  });
  const r2 = await emitReviewRequired({
    auditLogger: fakeLogger,
    sourceDecisionId: 'src-multi-1',
    agentId: 'agent-1',
    outputText: 'On 2019-01-01 the product launched.',
    forceReview: true
  });
  assert.ok(r1 && r2);

  // Both records parent at the same source. The chain between them
  // (in log order) should be source → r1 → r2.
  const stored = fakeLogger.stored;
  assert.strictEqual(stored.length, 2);

  // First record chains from genesis (no explicit prevHash in this fake).
  assert.ok(stored[0].hash, 'first record must have a hash');
  // Second record chains from the first.
  assert.strictEqual(stored[1].prevHash, stored[0].hash,
    'second review must chain via prevHash to the first review hash');
});

// ----------------------------------------------------------------------------
// (8) Defensive: missing auditLogger returns null without throwing.
// ----------------------------------------------------------------------------

test('review-required event: emitReviewRequired returns null when auditLogger missing', async () => {
  const result = await emitReviewRequired({
    auditLogger: null,
    sourceDecisionId: 'src-x',
    forceReview: true
  });
  assert.strictEqual(result, null);
});

test('review-required event: resolveReview returns null when auditLogger missing', async () => {
  const result = await resolveReview({
    auditLogger: null,
    reviewDecisionId: 'whatever'
  });
  assert.strictEqual(result, null);
});

test('review-required event: emitReviewRequired throws on missing sourceDecisionId', async () => {
  await assert.rejects(
    () => emitReviewRequired({ auditLogger: makeChainingFakeLogger(), forceReview: true }),
    /sourceDecisionId is required/
  );
});

// ----------------------------------------------------------------------------
// (9) buildResolvedRecord — same chain-shape discipline as buildReviewRecord.
// ----------------------------------------------------------------------------

test('review-required event: buildResolvedRecord sets action.type = "review_required_resolved"', () => {
  const resolved = {
    eventType: ACTION_TYPE_REVIEW_RESOLVED,
    sourceDecisionId: 'review-1',
    decisionId: 'res-1',
    parentDecisionId: 'review-1',
    timestamp: '2026-07-19T00:00:01.000Z',
    resolvedBy: 'operator-1',
    resolution: 'verified'
  };
  const record = buildResolvedRecord({ resolved });
  assert.strictEqual(record.action.type, ACTION_TYPE_REVIEW_RESOLVED);
  assert.strictEqual(record.action.annotation.eventType, ACTION_TYPE_REVIEW_RESOLVED);
  assert.strictEqual(record.action.annotation.sourceDecisionId, 'review-1');
  assert.strictEqual(record.decisionId, 'res-1');
  assert.strictEqual(record.parentDecisionId, 'review-1');
  assert.strictEqual(record.action.annotation.resolvedBy, 'operator-1');
  assert.strictEqual(record.actor.agentId, 'operator-1');
});
