'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MAPPER_PATH = path.join(__dirname, '../../../src/compliance/ast10-mapper.js');

function loadMapper() {
  delete require.cache[require.resolve(MAPPER_PATH)];
  return require(MAPPER_PATH);
}

function mapper(options = {}) {
  const { createAST10Mapper } = loadMapper();
  return createAST10Mapper({ enableWrites: false, ...options });
}

function sourceEvent(overrides = {}) {
  const base = {
    decisionId: `source-${Math.random().toString(36).slice(2)}`,
    parentDecisionId: null,
    timestamp: '2026-07-14T00:00:00.000Z',
    actor: { agentId: 'standards-agent', role: 'coder', trustScore: 0.8 },
    action: {
      type: 'tool_dispatch',
      toolId: 'write_file',
      target: '/tmp/output.txt',
      parameters: {}
    },
    context: { policyId: 'standards-fixture', policyVersion: '1' },
    outcome: { success: true, latencyMs: 1, errorMessage: null }
  };
  return {
    ...base,
    ...overrides,
    actor: { ...base.actor, ...(overrides.actor || {}) },
    action: { ...base.action, ...(overrides.action || {}) },
    context: { ...base.context, ...(overrides.context || {}) },
    outcome: { ...base.outcome, ...(overrides.outcome || {}) }
  };
}

function classifyEvent(event, options = {}) {
  const { classify } = loadMapper();
  return classify(mapper(options), event);
}

function assertAnnotationShape(annotation, source, expectedClass, expectedRule) {
  assert.equal(annotation.sourceDecisionId, source.decisionId);
  assert.equal(annotation.eventType, source.action.type);
  assert.deepEqual(annotation.matchedClasses, [expectedClass]);
  assert.equal(annotation.classification.rule, expectedRule);
  assert.match(annotation.classification.confidence, /^[HML]$/);
  assert.equal(typeof annotation.classification.reference, 'string');
  assert.equal(typeof annotation.evidence, 'object');
  assert.equal(typeof annotation.timestamp, 'string');
}

function capturingMapper() {
  const decisions = [];
  const auditLogger = {
    async logDecision(decision) {
      decisions.push(structuredClone(decision));
      return `hash-${decisions.length}`;
    }
  };
  const { createAST10Mapper } = loadMapper();
  return {
    mapper: createAST10Mapper({ enableWrites: true, auditLogger }),
    decisions
  };
}

function assertDecisionShape(decision, source, expectedClass, expectedRule) {
  assert.equal(typeof decision.decisionId, 'string');
  assert.equal(decision.parentDecisionId, source.decisionId);
  assert.equal(typeof decision.timestamp, 'string');
  assert.equal(typeof decision.actor, 'object');
  assert.equal(decision.action.type, 'ast10_annotation');
  assert.equal(decision.action.target, expectedClass);
  assert.equal(decision.action.reason, expectedRule);
  assert.equal(decision.action.annotation.sourceDecisionId, source.decisionId);
  assert.equal(decision.context.policyId, 'ast10-mapper');
  assert.equal(decision.context.policyVersion, '1.0.0');
  assert.equal(decision.outcome.success, true);
}

module.exports = {
  describe,
  test,
  assert,
  loadMapper,
  mapper,
  sourceEvent,
  classifyEvent,
  assertAnnotationShape,
  capturingMapper,
  assertDecisionShape
};
