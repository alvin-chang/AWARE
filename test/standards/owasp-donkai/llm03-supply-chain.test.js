'use strict';

// LLM03:2025 — Supply Chain (DonkAI lab-03).
//
// DonkAI lab-03 exercises a compromised skill/plugin publisher. AWARE's
// coverage of LLM03 is M (per ADR-050 §6): the publisher-key machinery
// in `identity-provider` and `agent-registry` attest provenance on the
// tooling side; training-set provenance is GAP-2 (architect follow-up).
//
// Day-one cascade:
//   - When the agent loads a skill from an unknown publisher (no
//     publisherKey on the actor), AST02 `supply-chain-unknown-publisher`
//     fires in the AST10 mapper; the AWARE component is `agent-registry`,
//     which covers LLM03 via OWASP_LLM_TOP_10.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { replay, assertAst10Shape, buildSarifResults } = require('./helpers');

describe('LLM03:2025 — Supply Chain (DonkAI lab-03)', () => {
  test('cascade: skill_load from unknown publisher → AST02 → LLM03', () => {
    const event = {
      decisionId: 'lab03-evt-1',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 /* no publisherKey */ },
      action: {
        type: 'skill_load',
        target: 'compromised/skill',
        parameters: {
          manifest: { name: 'compromised/skill', version: '1.0.0' /* no content_hash */ }
        }
      },
      context: { policyId: 'donkai-lab-03', policyVersion: '1', componentId: 'agent-registry' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { ast10Annotations, llmAnnotations, fired } = replay(event);

    const ast02 = ast10Annotations.find((a) => a.matchedClasses.includes('AST02'));
    assert.ok(ast02, 'AST02 must fire on a skill_load with no publisherKey');
    assertAst10Shape(ast02, 'supply-chain-unknown-publisher', 'M');

    // AST07 `update-without-pinning` ALSO fires (no content_hash). Both
    // map to LLM03 via agent-registry's OWASP_LLM_TOP_10 row.
    const ast07 = ast10Annotations.find((a) => a.matchedClasses.includes('AST07'));
    assert.ok(ast07, 'AST07 must fire on a skill_load with no content_hash');

    const llm03 = llmAnnotations.find((a) => a.llmId === 'LLM03');
    assert.ok(llm03, 'LLM03 must be projected from AST02/AST07 cascade');
    assert.equal(llm03.component, 'agent-registry');
    assert.equal(llm03.gapId, null);
    assert.ok(fired.has('LLM03'));
  });

  test('SARIF: lab-03 emits a fired LLM03 result with AST02 cascade', () => {
    const event = {
      decisionId: 'lab03-evt-2',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: { agentId: 'donkai-agent', role: 'coder', trustScore: 0.8 },
      action: {
        type: 'skill_load',
        target: 'compromised/skill',
        parameters: { manifest: { name: 'compromised/skill', version: '1.0.0' } }
      },
      context: { policyId: 'donkai-lab-03', policyVersion: '1', componentId: 'agent-registry' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { llmAnnotations, fired } = replay(event);
    const sarif = buildSarifResults({
      labId: 'lab-03-supply-chain',
      llmAnnotations,
      fired,
      expectedLlmId: 'LLM03'
    });

    assert.equal(sarif.ruleId, 'LLM03');
    assert.equal(sarif.properties.fired, true);
    assert.equal(sarif.properties.gap_id, null);
    assert.ok(sarif.properties.ast10_cascade.includes('supply-chain-unknown-publisher'));
  });

  test('defence: skill_load with publisherKey + content_hash fires no supply-chain AST', () => {
    const event = {
      decisionId: 'lab03-evt-3',
      parentDecisionId: null,
      timestamp: '2026-07-19T00:00:00.000Z',
      actor: {
        agentId: 'donkai-agent',
        role: 'coder',
        trustScore: 0.8,
        publisherKey: 'trusted-publisher-2026'
      },
      // AST10 rule 6 reads `action.manifest` (NOT `parameters.manifest`)
      // for the content_hash check. See src/compliance/ast10-mapper.js
      // lines around the `update-without-pinning` rule.
      action: {
        type: 'skill_load',
        target: 'trusted/skill',
        manifest: { name: 'trusted/skill', version: '1.0.0', content_hash: 'a'.repeat(64) }
      },
      context: { policyId: 'donkai-lab-03', policyVersion: '1', componentId: 'agent-registry' },
      outcome: { success: true, latencyMs: 1, errorMessage: null }
    };

    const { ast10Annotations } = replay(event);
    // AST10 cross-platform-skill-load still fires (that's unconditional
    // for skill_load), but AST02 / AST07 must NOT.
    assert.ok(!ast10Annotations.some((a) => a.matchedClasses.includes('AST02')));
    assert.ok(!ast10Annotations.some((a) => a.matchedClasses.includes('AST07')));
  });
});
