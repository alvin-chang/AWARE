'use strict';

// LLM10:2025 — Unbounded Consumption (DonkAI lab-10).
//
// DonkAI lab-10 exercises volumetric / cost / scraping abuse against
// the LLM application. LLM10 in 2025 is broader than v1.1's Model
// DoS — it covers volumetric DoS, token-spend abuse, and scraping.
// AWARE's sandbox-policies / kill-switch cover per-agent caps and
// engagement-wide caps; the token-spend meter and retrieval-rate cap
// are net-new — GAP-7 child card for `consumption-budget.js`.
//
// Per the card body: this test is `xit` (not yet) until GAP-7 lands.
// The companion SARIF row in the integration test IS the live
// coverage matrix and DOES run, recording fired=false + gap_id=GAP-7.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, buildSarifResults } = require('./helpers');

// TODO: GAP-7 lands (`consumption-budget.js`) — flip `xit` → `it`
// when the token-spend / retrieval-rate caps ship.
describe('LLM10:2025 — Unbounded Consumption (DonkAI lab-10)', () => {
  test('honest day-one: AST10 mapper has no rule for consumption-budget breaches', () => {
    const event = {
      decisionId: 'lab10-evt-1',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'consumption_check',
        toolId: 'consumption_check',
        target: 'token_spend_window',
        parameters: {
          tokens_used: 1_000_000,
          window_seconds: 60,
          limit: 100_000
        }
      },
      context: { policyId: 'donkai-lab-10', policyVersion: '1', componentId: 'sandbox-policies' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { ast10Annotations, fired } = replay(event);
    assert.equal(ast10Annotations.length, 0);
    assert.ok(!fired.has('LLM10'));
  });

  test('SARIF: lab-10 emits a fired:false LLM10 result with GAP-7 marker', () => {
    const event = {
      decisionId: 'lab10-evt-2',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'consumption_check',
        toolId: 'consumption_check',
        target: 'token_spend_window',
        parameters: { tokens_used: 1_000_000, window_seconds: 60, limit: 100_000 }
      },
      context: { policyId: 'donkai-lab-10', policyVersion: '1', componentId: 'sandbox-policies' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-10-unbounded-consumption',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM10'
    });

    assert.equal(sarif.ruleId, 'LLM10');
    assert.equal(sarif.properties.fired, false);
    assert.equal(sarif.properties.gap_id, 'GAP-7');
    assert.equal(sarif.level, 'error');
    assert.match(sarif.message.text, /GAP-7/);
  });
});
