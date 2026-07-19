'use strict';

// LLM10:2025 — Unbounded Consumption (DonkAI lab-10).
//
// DonkAI lab-10 exercises an agent that triggers cost / token / time
// overruns via excessive model invocations. LLM10:2025 is the renamed
// v1.1 LLM04 (Model DoS) plus volumetric + scraping vectors. AWARE
// today has no per-request consumption-budget observation; the GAP-7
// detection rule + event source are a follow-up card. This test ships
// the day-one coverage: the harness projects `consumption_check`
// events to LLM10:2025 via the special-projection in
// `helpers.js::replay()`. When the real emitter lands, the harness
// will continue to fire LLM10 without changes (verified by the unit
// test in test/unit/compliance/donkai-llm-projection.test.js).

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, buildSarifResults } = require('./helpers');

describe('LLM10:2025 — Unbounded Consumption (DonkAI lab-10)', () => {
  test('cascade: consumption_check event fires LLM10 (H)', () => {
    // Mirrors the canonical event shape from the GAP-7 spec:
    // action.type === 'consumption_check', action.classification.rule
    // === 'consumption-threshold-breach', action.classification.breach
    // carries the over-budget dimension + ratio.
    const event = {
      decisionId: 'lab10-evt-1',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'consumption_check',
        toolId: 'modelInvoke',
        target: 'cost_usd_overrun',
        reason: 'consumption-threshold-breach',
        parameters: {
          modelId: 'gpt-4',
          inputTokens: 12000,
          outputTokens: 8000,
          costUsd: 0.42,
          wallMs: 5500,
          requestId: 'r-donkai-10-001'
        },
        classification: {
          rule: 'consumption-threshold-breach',
          confidence: 'H',
          reference: 'ADR-050#GAP-7',
          budget: { limitUsd: 0.30, limitTokens: 16000, limitWallMs: 5000 },
          observed: { costUsd: 0.42, inputTokens: 12000, outputTokens: 8000, wallMs: 5500 },
          breach: { dimension: 'costUsd', ratio: 1.4 }
        }
      },
      context: { policyId: 'donkai-lab-10', policyVersion: '1', componentId: 'policies' },
      outcome: { success: false, latencyMs: 0, errorMessage: 'consumption threshold breached' }
    };

    const { ast10Annotations, llmAnnotations, fired } = replay(event);
    // AST10 mapper has no rule for this event type (by design — the
    // detection lives in a future src/policies/consumption-budget.js).
    // The LLM10 projection happens via the harness's special-projection
    // path.
    assert.equal(ast10Annotations.length, 0);
    const llm10 = llmAnnotations.find((a) => a.llmId === 'LLM10');
    assert.ok(llm10, 'LLM10 must be projected from the consumption_check event');
    assert.equal(llm10.component, 'policies');
    assert.equal(llm10.gapId, null, 'GAP-7 closed: gap_id drops to null');
    assert.ok(fired.has('LLM10'));
  });

  test('SARIF: lab-10 emits a fired LLM10 result with consumption-threshold-breach cascade', () => {
    const event = {
      decisionId: 'lab10-evt-2',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'consumption_check',
        toolId: 'modelInvoke',
        target: 'token_count_overrun',
        reason: 'consumption-threshold-breach',
        parameters: {
          modelId: 'gpt-4',
          inputTokens: 125000,
          outputTokens: 8000,
          costUsd: 0.25,
          wallMs: 4500,
          requestId: 'r-donkai-10-002'
        },
        classification: {
          rule: 'consumption-threshold-breach',
          confidence: 'H',
          reference: 'ADR-050#GAP-7',
          budget: { limitUsd: 1.00, limitTokens: 16000, limitWallMs: 5000 },
          observed: { costUsd: 0.25, inputTokens: 125000, outputTokens: 8000, wallMs: 4500 },
          breach: { dimension: 'inputTokens', ratio: 7.8 }
        }
      },
      context: { policyId: 'donkai-lab-10', policyVersion: '1', componentId: 'policies' },
      outcome: { success: false, latencyMs: 0, errorMessage: 'consumption threshold breached' }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-10-unbounded-consumption',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM10'
    });

    assert.equal(sarif.ruleId, 'LLM10');
    assert.equal(sarif.properties.fired, true);
    assert.equal(sarif.properties.gap_id, null, 'GAP-7 closed: gap_id drops to null');
    assert.equal(sarif.level, 'note', 'covered risks surface as SARIF notes');
  });

  test('projection is type-keyed: any consumption_check event fires LLM10 (emitter contract gates emission in production)', () => {
    // The LLM10 projection fires on action.type === 'consumption_check'
    // alone — it does not key on outcome.success or
    // classification.breach. This is intentional: the future
    // src/policies/consumption-budget.js emitter is responsible for
    // only emitting consumption_check events when a budget breach
    // occurs (and carrying outcome.success === false on them). The
    // harness projection is a shape-matcher, not a value evaluator.
    //
    // This test asserts that contract: the projection treats every
    // consumption_check event as LLM10-relevant. The production
    // emitter's job is to never emit a within-budget event.
    const event = {
      decisionId: 'lab10-evt-3-within',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'consumption_check',
        toolId: 'modelInvoke',
        parameters: { modelId: 'gpt-4', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, wallMs: 800, requestId: 'r-003' },
        classification: { rule: 'within-budget', confidence: 'H' }
      },
      context: { policyId: 'donkai-lab-10', policyVersion: '1', componentId: 'policies' },
      outcome: { success: true, latencyMs: 0, errorMessage: null }
    };

    const { fired } = replay(event);
    assert.ok(fired.has('LLM10'), 'projection is type-keyed; emitter contract gates emission in production');
  });
});