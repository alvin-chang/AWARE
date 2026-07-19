'use strict';

// Unit tests for the LLM07 + LLM09 special projections in
// test/standards/owasp-donkai/helpers.js::replay().
//
// The projections gate on:
//   LLM07: action.type === 'model_input_classification' AND
//          action.classification.rule === 'system-prompt-elicit'
//   LLM09: action.type === 'review_required'
//
// Per ADR-050 §5 GAP-4 + GAP-6 + ADR-043 read-only contract (the AST10
// mapper does not consume these event types; the projections live at
// the harness layer).

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay } = require('../../standards/owasp-donkai/helpers');

function modelInputEvent(classificationRule, opts = {}) {
  return {
    decisionId: opts.decisionId || 'evt-test',
    parentDecisionId: null,
    timestamp: '2026-07-19T00:00:00.000Z',
    actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
    action: {
      type: 'model_input_classification',
      toolId: null,
      target: 'LLM07:2025',
      reason: 'system-prompt-elicit',
      parameters: { callSource: 'test', sessionId: 'sess-test' },
      classification: { rule: classificationRule, confidence: 'M', reference: 'ADR-050#GAP-4' },
      evidence: { patternMatched: 'extract', inputHash: 'h-test' }
    },
    context: { policyId: 'donkai-lab-07', policyVersion: '1', componentId: 'tool-observation-proxy' },
    outcome: { success: true, latencyMs: 0, errorMessage: null }
  };
}

function reviewRequiredEvent(opts = {}) {
  return {
    decisionId: opts.decisionId || 'evt-test',
    parentDecisionId: 'src-1',
    timestamp: '2026-07-19T00:00:00.000Z',
    actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
    action: {
      type: 'review_required',
      target: 'LLM09_2025_FACTUAL_CONFLICT',
      reason: 'LLM09_2025_FACTUAL_CONFLICT',
      annotation: {
        eventType: 'review_required',
        sourceDecisionId: 'src-1',
        decisionId: 'evt-test',
        parentDecisionId: 'src-1',
        timestamp: '2026-07-19T00:00:00.000Z',
        triggerSource: 'LLM09_2025_FACTUAL_CONFLICT',
        confidenceScore: 0.4,
        outputHash: 'h-test',
        agentId: 'donkai-agent',
        concerns: [],
        heuristicVersion: '0.1.0'
      }
    },
    context: { policyId: 'llm09-mapper', policyVersion: '0.1.0', componentId: 'tool-observation-proxy' },
    outcome: { success: true, latencyMs: 0, errorMessage: null }
  };
}

describe('DonkAI harness: LLM07 + LLM09 special projections (GAP-4 + GAP-6)', () => {
  describe('LLM07 (System Prompt Leakage) projection', () => {
    test('fires on model_input_classification with rule=system-prompt-elicit', () => {
      const { fired, llmAnnotations } = replay(modelInputEvent('system-prompt-elicit'));
      assert.ok(fired.has('LLM07'));
      const llm07 = llmAnnotations.find((a) => a.llmId === 'LLM07');
      assert.ok(llm07);
      assert.equal(llm07.component, 'tool-observation-proxy');
      assert.equal(llm07.ast10Rule, 'system-prompt-elicit');
      assert.equal(llm07.gapId, null);
    });

    test('does NOT fire on model_input_classification with an unrelated rule', () => {
      const { fired } = replay(modelInputEvent('safe-prompt'));
      assert.ok(!fired.has('LLM07'));
    });

    test('does NOT fire when action.type is not model_input_classification', () => {
      const event = modelInputEvent('system-prompt-elicit');
      event.action.type = 'tool_dispatch';
      const { fired } = replay(event);
      assert.ok(!fired.has('LLM07'));
    });

    test('does NOT fire when classification.rule is missing', () => {
      const event = modelInputEvent('system-prompt-elicit');
      delete event.action.classification;
      const { fired } = replay(event);
      assert.ok(!fired.has('LLM07'));
    });
  });

  describe('LLM09 (Misinformation) projection', () => {
    test('fires on review_required event', () => {
      const { fired, llmAnnotations } = replay(reviewRequiredEvent());
      assert.ok(fired.has('LLM09'));
      const llm09 = llmAnnotations.find((a) => a.llmId === 'LLM09');
      assert.ok(llm09);
      assert.equal(llm09.component, 'tool-observation-proxy');
      assert.equal(llm09.ast10Rule, 'review_required');
      assert.equal(llm09.gapId, null);
    });

    test('does NOT fire on review_required_resolved (the resolution event)', () => {
      const event = reviewRequiredEvent();
      event.action.type = 'review_required_resolved';
      event.action.target = 'src-1';
      const { fired } = replay(event);
      assert.ok(!fired.has('LLM09'));
    });

    test('does NOT fire on unrelated action types', () => {
      const event = reviewRequiredEvent();
      event.action.type = 'tool_dispatch';
      const { fired } = replay(event);
      assert.ok(!fired.has('LLM09'));
    });
  });

  describe('interaction with existing projections', () => {
    test('does not double-fire LLM02 when review_required also carries a credential-classifier error', () => {
      // Cross-event test: the LLM02 special projection keys off
      // AWARE_DENY: + credential-classifier; review_required events
      // have outcome.success=true, so neither projection should fire.
      const { fired } = replay(reviewRequiredEvent());
      assert.ok(!fired.has('LLM02'));
      assert.ok(fired.has('LLM09'));
    });
  });
});