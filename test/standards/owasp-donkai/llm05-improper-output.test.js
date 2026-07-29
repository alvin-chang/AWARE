'use strict';

// LLM05:2025 — Improper Output Handling (DonkAI lab-05).
//
// DonkAI lab-05 exercises the integration layer where model output is
// passed to downstream interpreters without sanitization. AWARE's
// coverage is H per ADR-050 §6 — `parameter-validator.js` sanitises
// every value the agent returns from the model layer before it reaches
// a downstream interpreter.
//
// Day-one cascade:
//   - When the proxy denies an unsafe shell command (e.g. one with
//     semicolon-injected shell syntax), AST09 fires. tool-access-control
//     covers LLM05 in its OWASP_LLM_TOP_10 row. LLM05 fires.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, assertAst10Shape, buildSarifResults } = require('./helpers');

describe('LLM05:2025 — Improper Output Handling (DonkAI lab-05)', () => {
  test('cascade: shell injection from model output → AWARE_DENY → AST09 → LLM05', () => {
    const event = {
      decisionId: 'lab05-evt-1',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'tool_dispatch',
        toolId: 'exec',
        target: '/bin/sh',
        parameters: { command: 'echo hello; rm -rf /tmp/sensitive' }
      },
      context: { policyId: 'donkai-lab-05', policyVersion: '1', componentId: 'tool-access-control' },
      outcome: {
        success: false,
        latencyMs: 1,
        errorMessage: 'AWARE_DENY: parameter-validator flagged shell injection pattern'
      }
    };

    const { ast10Annotations, llmAnnotations, fired } = replay(event);

    const ast09 = ast10Annotations.find((a) => a.matchedClasses.includes('AST09'));
    assert.ok(ast09, 'AST09 must fire on AWARE_DENY: outcome');
    assertAst10Shape(ast09, 'denied-before-dispatch', 'H');

    const llm05 = llmAnnotations.find((a) => a.llmId === 'LLM05');
    assert.ok(llm05, 'LLM05 must be projected from AST09 cascade (tool-access-control covers LLM05)');
    assert.equal(llm05.component, 'tool-access-control');
    assert.ok(fired.has('LLM05'));
  });

  test('SARIF: lab-05 emits a fired LLM05 result with AST09 cascade', () => {
    const event = {
      decisionId: 'lab05-evt-2',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'tool_dispatch',
        toolId: 'exec',
        target: '/bin/sh',
        parameters: { command: 'echo hello; rm -rf /tmp/sensitive' }
      },
      context: { policyId: 'donkai-lab-05', policyVersion: '1', componentId: 'tool-access-control' },
      outcome: {
        success: false,
        latencyMs: 1,
        errorMessage: 'AWARE_DENY: parameter-validator flagged shell injection pattern'
      }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-05-improper-output',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM05'
    });

    assert.equal(sarif.ruleId, 'LLM05');
    assert.equal(sarif.properties.fired, true);
    assert.equal(sarif.properties.gap_id, null);
    assert.deepEqual(sarif.properties.ast10_cascade, ['denied-before-dispatch']);
    assert.equal(sarif.properties.aware_component, 'tool-access-control');
  });

  test('defence: clean shell command fires no annotation', () => {
    const event = {
      decisionId: 'lab05-evt-3',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'tool_dispatch',
        toolId: 'exec',
        target: '/bin/echo',
        parameters: { command: 'echo hello' }
      },
      context: { policyId: 'donkai-lab-05', policyVersion: '1', componentId: 'tool-access-control' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { ast10Annotations, fired } = replay(event);
    assert.equal(ast10Annotations.length, 0);
    assert.ok(!fired.has('LLM05'));
  });
});
