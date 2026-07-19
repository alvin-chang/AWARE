// SPDX-License-Identifier: Apache-2.0
// test/integration/api/compliance-misinformation-review.test.js
//
// Integration test for GET /api/compliance/llm-top-10/misinformation-review.
// Per ADR-050 §5 GAP-6.
//
// What this test pins:
//
//   1. Missing fromDecisionId / toDecisionId → 400 FROM_AND_TO_DECISION_ID_REQUIRED
//   2. Invalid status filter → 400 INVALID_STATUS_FILTER
//   3. Chain-unavailable (decision-logger throws) → 200 with empty list and
//      rangeStatus='CHAIN_UNAVAILABLE' (NOT a 500)
//   4. Non-review records in the segment are filtered out (only
//      action.type === 'review_required' is returned)
//   5. Each review_required annotation's status is derived from the
//      presence of a `review_required_resolved` child record in the same
//      segment: open by default, resolved when the chain has a child
//      annotation pointing at it via parentDecisionId
//   6. The status filter restricts the response to matching rows only
//   7. The response shape mirrors the other compliance annotation routes
//      (decisionId, parentDecisionId, timestamp, hash) plus LLM09-specific
//      fields (triggerSource, confidenceScore, outputHash, agentId, concerns,
//      status, heuristicVersion)
//
// Test-pollution note: every test overrides decision-logger.getChainBetween
// and restores the original in `finally`. To avoid the "restore to a stale
// override" trap, we capture the genuine `getChainBetween` reference ONCE at
// module load and restore to that reference in every test's `finally`.
//
// Discovery: `npm test` globs `test/integration/**/*.test.js` via
// `npm run test:integration`.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const ROUTE_URL = pathToFileURL(
  path.join(__dirname, '../../../src/api/routes/compliance.js')
).href;

const DECISION_LOGGER_PATH = require.resolve('../../../src/audit/decision-logger');
const decisionLoggerModule = require(DECISION_LOGGER_PATH);
const TRUE_GET_CHAIN_BETWEEN = decisionLoggerModule.getChainBetween;

// ----------------------------------------------------------------------------
// Fake req/res helpers — minimal Express-shaped objects so we can drive
// the route handler directly without spinning up a server.
// ----------------------------------------------------------------------------

function makeRecorder() {
  const responses = [];
  let lastStatus = 200;
  const res = {
    status(code) { lastStatus = code; return res; },
    json(payload) {
      responses.push({ status: lastStatus, payload });
      lastStatus = 200;
      return res;
    }
  };
  return { res, responses };
}

// ----------------------------------------------------------------------------
// Fixture builder — a 6-record segment with two review_required records
// (one with a child review_required_resolved, one without) plus noise.
// ----------------------------------------------------------------------------

function makeMixedSegment() {
  return [
    {
      decisionId: 'src-1',
      timestamp: '2026-07-19T00:00:00.000Z',
      parentDecisionId: null,
      actor: { agentId: 'a' },
      action: { type: 'model_output', target: 'tool-output' },
      outcome: { success: true }
    },
    {
      decisionId: 'rev-open-1',
      timestamp: '2026-07-19T00:00:00.100Z',
      parentDecisionId: 'src-1',
      actor: { agentId: 'llm09-mapper' },
      action: {
        type: 'review_required',
        target: 'LLM09_2025_FACTUAL_CONFLICT',
        reason: 'LLM09_2025_FACTUAL_CONFLICT',
        annotation: {
          eventType: 'review_required',
          sourceDecisionId: 'src-1',
          triggerSource: 'LLM09_2025_FACTUAL_CONFLICT',
          confidenceScore: 0.4,
          outputHash: 'abc123',
          agentId: 'agent-1',
          concerns: [{ rule: 'LLM09_2025_FACTUAL_CONFLICT', raw: '2020-03-15' }],
          heuristicVersion: '0.1.0'
        }
      },
      outcome: { success: true },
      hash: 'h-rev-open-1'
    },
    {
      decisionId: 'src-2',
      timestamp: '2026-07-19T00:00:01.000Z',
      parentDecisionId: 'rev-open-1',
      actor: { agentId: 'a' },
      action: { type: 'model_output', target: 'tool-output' },
      outcome: { success: true }
    },
    {
      decisionId: 'rev-resolved-1',
      timestamp: '2026-07-19T00:00:01.100Z',
      parentDecisionId: 'src-2',
      actor: { agentId: 'llm09-mapper' },
      action: {
        type: 'review_required',
        target: 'LLM09_2025_CITATION_MISSING',
        reason: 'LLM09_2025_CITATION_MISSING',
        annotation: {
          eventType: 'review_required',
          sourceDecisionId: 'src-2',
          triggerSource: 'LLM09_2025_CITATION_MISSING',
          confidenceScore: 0.7,
          outputHash: 'def456',
          agentId: 'agent-2',
          concerns: [{ rule: 'LLM09_2025_CITATION_MISSING', raw: '47%' }],
          heuristicVersion: '0.1.0'
        }
      },
      outcome: { success: true },
      hash: 'h-rev-resolved-1'
    },
    {
      decisionId: 'resolved-1',
      timestamp: '2026-07-19T00:00:02.000Z',
      parentDecisionId: 'rev-resolved-1',
      actor: { agentId: 'operator-1' },
      action: {
        type: 'review_required_resolved',
        target: 'rev-resolved-1',
        reason: 'verified by source check',
        annotation: {
          eventType: 'review_required_resolved',
          sourceDecisionId: 'rev-resolved-1',
          resolvedBy: 'operator-1',
          resolution: 'verified by source check'
        }
      },
      outcome: { success: true }
    },
    {
      decisionId: 'unrelated-1',
      timestamp: '2026-07-19T00:00:03.000Z',
      parentDecisionId: null,
      actor: { agentId: 'sys' },
      action: { type: 'health_check', target: 'coordinator' },
      outcome: { success: true }
    }
  ];
}

/**
 * Run the misinformation-review route handler with a stubbed
 * getChainBetween and ensure the stub is restored to the TRUE original
 * after the test (defence against stale-override pollution).
 *
 * @param {Object} query
 * @param {Function|null} stub - returns the segment, or null to throw
 * @returns {Promise<{status: number, payload: any}>}
 */
async function runRouteWithStub(query, stub) {
  if (stub) {
    decisionLoggerModule.getChainBetween = stub;
  } else {
    decisionLoggerModule.getChainBetween = async () => { throw new Error('SIMULATED_CHAIN_OUTAGE'); };
  }
  try {
    delete require.cache[require.resolve('../../../src/api/routes/compliance.js')];
    const routePath = pathToFileURL(
      path.join(__dirname, '../../../src/api/routes/compliance.js')
    ).href;
    const mod = await import(routePath + '?cb=' + Date.now());
    const router = mod.default || mod;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/llm-top-10/misinformation-review' && l.route.methods.get
    );
    assert.ok(layer, 'misinformation-review GET route must be registered');
    const handler = layer.route.stack[0].handle;

    const { res, responses } = makeRecorder();
    await handler({ query }, res, () => {});
    assert.strictEqual(responses.length, 1);
    return responses[0];
  } finally {
    // Always restore to the TRUE original — never to a stale override.
    decisionLoggerModule.getChainBetween = TRUE_GET_CHAIN_BETWEEN;
    delete require.cache[require.resolve('../../../src/api/routes/compliance.js')];
  }
}

// ----------------------------------------------------------------------------
// (1) Input validation — missing required query params.
// ----------------------------------------------------------------------------

test('route /misinformation-review: missing fromDecisionId and toDecisionId → 400 FROM_AND_TO_DECISION_ID_REQUIRED', async () => {
  // Use the un-stubbed path: no override needed, the route's input
  // validation runs before getChainBetween is called.
  delete require.cache[require.resolve('../../../src/api/routes/compliance.js')];
  const mod = await import(ROUTE_URL + '?cb=' + Date.now());
  const router = mod.default || mod;
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/llm-top-10/misinformation-review' && l.route.methods.get
  );
  const handler = layer.route.stack[0].handle;

  const { res, responses } = makeRecorder();
  await handler({ query: {} }, res, () => {});

  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].status, 400);
  assert.strictEqual(responses[0].payload.error, 'FROM_AND_TO_DECISION_ID_REQUIRED');
});

// ----------------------------------------------------------------------------
// (2) Invalid status filter.
// ----------------------------------------------------------------------------

test('route /misinformation-review: invalid status filter → 400 INVALID_STATUS_FILTER', async () => {
  delete require.cache[require.resolve('../../../src/api/routes/compliance.js')];
  const mod = await import(ROUTE_URL + '?cb=' + Date.now());
  const router = mod.default || mod;
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/llm-top-10/misinformation-review' && l.route.methods.get
  );
  const handler = layer.route.stack[0].handle;

  const { res, responses } = makeRecorder();
  await handler(
    { query: { fromDecisionId: 'a', toDecisionId: 'b', status: 'pending' } },
    res,
    () => {}
  );

  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].status, 400);
  assert.strictEqual(responses[0].payload.error, 'INVALID_STATUS_FILTER');
});

// ----------------------------------------------------------------------------
// (3) Chain unavailable → graceful 200 with empty list.
// ----------------------------------------------------------------------------

test('route /misinformation-review: getChainBetween throws → 200 with empty annotations + rangeStatus CHAIN_UNAVAILABLE', async () => {
  const r = await runRouteWithStub(
    { fromDecisionId: 'a', toDecisionId: 'b' },
    null
  );
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.payload.annotations, []);
  assert.strictEqual(r.payload.total, 0);
  assert.strictEqual(r.payload.rangeStatus, 'CHAIN_UNAVAILABLE');
  assert.strictEqual(r.payload.status, 'all');
});

// ----------------------------------------------------------------------------
// (4) Mixed segment — only review_required records are returned, with
//     open/resolved status derived from chain topology.
// ----------------------------------------------------------------------------

test('route /misinformation-review: filters non-review records and derives status from chain topology', async () => {
  const r = await runRouteWithStub(
    { fromDecisionId: 'src-1', toDecisionId: 'unrelated-1' },
    async () => makeMixedSegment()
  );

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.total, 2,
    `expected 2 review_required in the filtered response, got ${r.payload.total}`);

  const byId = new Map(r.payload.annotations.map((a) => [a.decisionId, a]));

  // rev-open-1 has NO child resolution in the segment → status='open'
  const openReview = byId.get('rev-open-1');
  assert.ok(openReview, 'rev-open-1 must be returned');
  assert.strictEqual(openReview.status, 'open');
  assert.strictEqual(openReview.triggerSource, 'LLM09_2025_FACTUAL_CONFLICT');
  assert.strictEqual(openReview.confidenceScore, 0.4);
  assert.strictEqual(openReview.outputHash, 'abc123');
  assert.strictEqual(openReview.agentId, 'agent-1');
  assert.strictEqual(openReview.sourceDecisionId, 'src-1');
  assert.strictEqual(openReview.parentDecisionId, 'src-1');
  assert.deepStrictEqual(openReview.concerns, [
    { rule: 'LLM09_2025_FACTUAL_CONFLICT', raw: '2020-03-15' }
  ]);

  // rev-resolved-1 has a child resolution → status='resolved'
  const resolvedReview = byId.get('rev-resolved-1');
  assert.ok(resolvedReview, 'rev-resolved-1 must be returned');
  assert.strictEqual(resolvedReview.status, 'resolved');
  assert.strictEqual(resolvedReview.triggerSource, 'LLM09_2025_CITATION_MISSING');
  assert.strictEqual(resolvedReview.confidenceScore, 0.7);

  // The unrelated-1 record (health_check) must NOT be returned.
  assert.strictEqual(byId.has('unrelated-1'), false);

  // The resolved-1 record (review_required_resolved) is metadata for
  // status derivation, NOT itself a review annotation in the response.
  assert.strictEqual(byId.has('resolved-1'), false);
});

// ----------------------------------------------------------------------------
// (5) Status filter — `status=open` returns only open reviews.
// ----------------------------------------------------------------------------

test('route /misinformation-review: status=open filter returns only open reviews', async () => {
  const r = await runRouteWithStub(
    { fromDecisionId: 'src-1', toDecisionId: 'unrelated-1', status: 'open' },
    async () => makeMixedSegment()
  );

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.total, 1,
    `status=open filter should leave only the unresolved review, got ${r.payload.total}`);
  assert.strictEqual(r.payload.annotations[0].decisionId, 'rev-open-1');
  assert.strictEqual(r.payload.annotations[0].status, 'open');
  assert.strictEqual(r.payload.status, 'open');
});

// ----------------------------------------------------------------------------
// (6) Status filter — `status=resolved` returns only resolved reviews.
// ----------------------------------------------------------------------------

test('route /misinformation-review: status=resolved filter returns only resolved reviews', async () => {
  const r = await runRouteWithStub(
    { fromDecisionId: 'src-1', toDecisionId: 'unrelated-1', status: 'resolved' },
    async () => makeMixedSegment()
  );

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.total, 1);
  assert.strictEqual(r.payload.annotations[0].decisionId, 'rev-resolved-1');
  assert.strictEqual(r.payload.annotations[0].status, 'resolved');
  assert.strictEqual(r.payload.status, 'resolved');
});

// ----------------------------------------------------------------------------
// (7) Empty segment — 200 with empty annotations list and rangeStatus OK.
// ----------------------------------------------------------------------------

test('route /misinformation-review: empty segment returns 200 with empty list', async () => {
  const r = await runRouteWithStub(
    { fromDecisionId: 'a', toDecisionId: 'b' },
    async () => []
  );

  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.payload.annotations, []);
  assert.strictEqual(r.payload.total, 0);
  assert.strictEqual(r.payload.rangeStatus, 'OK');
});

// ----------------------------------------------------------------------------
// (8) Test-pollution guard — after all tests, the real getChainBetween
//     reference is still the one captured at module load. This is the
//     assertion that the runRouteWithStub helper restores correctly.
// ----------------------------------------------------------------------------

test('route /misinformation-review: test pollution guard — real getChainBetween is restored', () => {
  assert.strictEqual(decisionLoggerModule.getChainBetween, TRUE_GET_CHAIN_BETWEEN,
    'after all tests, getChainBetween must be the true original (no stale override)');
});
