'use strict';

// LLM09:2025 — Misinformation (DonkAI lab-09).
//
// DonkAI lab-09 exercises the agent generating confident false
// content. LLM09 in 2025 covers BOTH model-originated false content
// AND downstream overreliance on it; v1.1's LLM09 was the overreliance
// half only. AWARE's review-loop mapper lands at commit 4abdc20
// (`src/compliance/llm09-mapper.js`) and emits `review_required`
// annotations chained to the source model-output event. The harness
// projects those events to LLM09:2025 via the special-projection in
// `helpers.js::replay()`. Per ADR-050 §5 GAP-6.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, buildSarifResults } = require('./helpers');

describe('LLM09:2025 — Misinformation (DonkAI lab-09)', () => {
  test('cascade: review_required event fires LLM09 (H)', () => {
    // Mirrors the shape emitted by
    // src/compliance/llm09-mapper.js::buildReviewRecord() (lines 127-154).
    const event = {
      decisionId: 'lab09-evt-1',
      parentDecisionId: 'lab09-source-1',
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'review_required',
        target: 'LLM09_2025_FACTUAL_CONFLICT',
        reason: 'LLM09_2025_FACTUAL_CONFLICT',
        annotation: {
          eventType: 'review_required',
          sourceDecisionId: 'lab09-source-1',
          decisionId: 'lab09-evt-1',
          parentDecisionId: 'lab09-source-1',
          timestamp: '2026-07-19T00:00:00.000Z',
          triggerSource: 'LLM09_2025_FACTUAL_CONFLICT',
          confidenceScore: 0.4,
          outputHash: 'h-lab09-1',
          agentId: 'donkai-agent',
          concerns: [],
          heuristicVersion: '0.1.0'
        }
      },
      context: { policyId: 'llm09-mapper', policyVersion: '0.1.0', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { ast10Annotations, llmAnnotations, fired } = replay(event);
    // AST10 mapper has no rule for this event type (by design — it's a
    // dedicated LLM-layer detection via the llm09-mapper). The LLM09
    // projection happens via the harness's special-projection path.
    assert.equal(ast10Annotations.length, 0);
    const llm09 = llmAnnotations.find((a) => a.llmId === 'LLM09');
    assert.ok(llm09, 'LLM09 must be projected from the review_required event');
    assert.equal(llm09.component, 'tool-observation-proxy');
    assert.equal(llm09.gapId, null, 'GAP-6 closed: gap_id drops to null');
    assert.ok(fired.has('LLM09'));
  });

  test('SARIF: lab-09 emits a fired LLM09 result with review_required cascade', () => {
    const event = {
      decisionId: 'lab09-evt-2',
      parentDecisionId: 'lab09-source-2',
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'review_required',
        target: 'LLM09_2025_CITATION_MISSING',
        reason: 'LLM09_2025_CITATION_MISSING',
        annotation: {
          eventType: 'review_required',
          sourceDecisionId: 'lab09-source-2',
          decisionId: 'lab09-evt-2',
          parentDecisionId: 'lab09-source-2',
          timestamp: '2026-07-19T00:00:00.000Z',
          triggerSource: 'LLM09_2025_CITATION_MISSING',
          confidenceScore: 0.7,
          outputHash: 'h-lab09-2',
          agentId: 'donkai-agent',
          concerns: [],
          heuristicVersion: '0.1.0'
        }
      },
      context: { policyId: 'llm09-mapper', policyVersion: '0.1.0', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-09-misinformation',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM09'
    });

    assert.equal(sarif.ruleId, 'LLM09');
    assert.equal(sarif.properties.fired, true);
    assert.equal(sarif.properties.gap_id, null, 'GAP-6 closed: gap_id drops to null');
    assert.equal(sarif.level, 'note', 'covered risks surface as SARIF notes');
  });

  test('defence: review_required_resolved (the resolution event) does NOT re-fire LLM09', () => {
    // Per llm09-mapper.js:170 the resolved event has action.type ===
    // 'review_required_resolved'. The harness projection keys off
    // 'review_required' only — resolutions close the review-loop without
    // re-firing LLM09.
    const event = {
      decisionId: 'lab09-evt-3-resolved',
      parentDecisionId: 'lab09-evt-1',
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'review_required_resolved',
        target: 'lab09-evt-1',
        reason: 'human-review-confirmed'
      },
      context: { policyId: 'llm09-mapper', policyVersion: '0.1.0', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { fired } = replay(event);
    assert.ok(!fired.has('LLM09'));
  });
});