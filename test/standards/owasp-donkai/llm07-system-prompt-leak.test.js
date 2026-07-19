'use strict';

// LLM07:2025 — System Prompt Leakage (DonkAI lab-07).
//
// DonkAI lab-07 exercises extraction of the hidden system prompt.
// LLM07 is **net-new** in the 2025 spec vs v1.1 (per ADR-050 §1.1
// drift table); v1.1's LLM07 was the *plugin design* risk class,
// whereas 2025's LLM07 is the *model-layer* system-prompt leakage
// risk. AWARE's detection rule lands at commit 3d299d6
// (`src/policies/tool-observation-proxy.js::observeModelInput()`),
// emitting `model_input_classification` source events with
// `action.classification.rule === 'system-prompt-elicit'`. The harness
// projects those events to LLM07:2025 via the special-projection in
// `helpers.js::replay()`. Per ADR-050 §5 GAP-4.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, buildSarifResults } = require('./helpers');

describe('LLM07:2025 — System Prompt Leakage (DonkAI lab-07)', () => {
  test('cascade: model_input_classification with system-prompt-elicit rule fires LLM07 (H)', () => {
    // Mirrors the shape emitted by
    // src/policies/tool-observation-proxy.js:1074-1104.
    const event = {
      decisionId: 'lab07-evt-1',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'model_input_classification',
        toolId: null,
        target: 'LLM07:2025',
        reason: 'system-prompt-elicit',
        parameters: { callSource: 'donkai-lab-07', sessionId: 'sess-donkai-07' },
        classification: {
          rule: 'system-prompt-elicit',
          confidence: 'M',
          reference: 'ADR-050#GAP-4'
        },
        evidence: { patternMatched: 'verbatim-extract', inputHash: 'h-lab07-1' }
      },
      context: { policyId: 'donkai-lab-07', policyVersion: '1', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { ast10Annotations, llmAnnotations, fired } = replay(event);
    // AST10 mapper has no rule for this event type (by design — it's a
    // dedicated LLM-layer detection, not an AST10 risk class). The LLM07
    // projection happens via the harness's special-projection path.
    assert.equal(ast10Annotations.length, 0);
    const llm07 = llmAnnotations.find((a) => a.llmId === 'LLM07');
    assert.ok(llm07, 'LLM07 must be projected from the model_input_classification event');
    assert.equal(llm07.component, 'tool-observation-proxy');
    assert.equal(llm07.gapId, null, 'GAP-4 closed: gap_id drops to null');
    assert.ok(fired.has('LLM07'));
  });

  test('SARIF: lab-07 emits a fired LLM07 result with system-prompt-elicit cascade', () => {
    const event = {
      decisionId: 'lab07-evt-2',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'model_input_classification',
        toolId: null,
        target: 'LLM07:2025',
        reason: 'system-prompt-elicit',
        parameters: { callSource: 'donkai-lab-07', sessionId: 'sess-donkai-07' },
        classification: {
          rule: 'system-prompt-elicit',
          confidence: 'M',
          reference: 'ADR-050#GAP-4'
        },
        evidence: { patternMatched: 'what-are-your-instructions', inputHash: 'h-lab07-2' }
      },
      context: { policyId: 'donkai-lab-07', policyVersion: '1', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-07-system-prompt-leak',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM07'
    });

    assert.equal(sarif.ruleId, 'LLM07');
    assert.equal(sarif.properties.fired, true);
    assert.equal(sarif.properties.gap_id, null, 'GAP-4 closed: gap_id drops to null');
    assert.equal(sarif.level, 'note', 'covered risks surface as SARIF notes');
  });

  test('defence: model_input_classification with unrelated rule does NOT fire LLM07', () => {
    const event = {
      decisionId: 'lab07-evt-3',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'model_input_classification',
        toolId: null,
        target: 'safe-prompt',
        reason: 'safe',
        parameters: { callSource: 'donkai-lab-07', sessionId: 'sess-donkai-07' },
        classification: { rule: 'safe-prompt', confidence: 'H' },
        evidence: { patternMatched: 'normal-user-input', inputHash: 'h-lab07-3' }
      },
      context: { policyId: 'donkai-lab-07', policyVersion: '1', componentId: 'tool-observation-proxy' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { fired } = replay(event);
    assert.ok(!fired.has('LLM07'));
  });
});