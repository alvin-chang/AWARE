'use strict';

// OWASP Top 10 for LLM Applications — 2025 rebinding test suite
// Per ADR-050 §5 GAP-1, this test asserts the `framework-mapper` rebind
// from the deprecated v1.1 (2023) IDs to the canonical 2025 IDs
// (LLM01:2025–LLM10:2025).
//
// Each test corresponds 1:1 to a row in ADR-050 §3 (component map) and
// ADR-050 §1.1 (ID drift table). A failure here is a rebinding gap
// against the §3 source-of-truth table.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { FrameworkMapper } = require('../../../src/compliance/framework-mapper');

function mapper() {
  return new FrameworkMapper();
}

// Canonical 2025 control set per ADR-050 §2 (Decision 1) and §1.1
// (drift table). The control list is LLM01:2025..LLM10:2025 SEQUENTIAL.
// Names MUST match docs/compliance/llm-top-10.md §"Per-risk coverage"
// and ADR-050 §1.1 verbatim — any divergence is a rebinding bug.
const EXPECTED_2025_CONTROLS = {
  LLM01: 'Prompt Injection',
  LLM02: 'Sensitive Information Disclosure',
  LLM03: 'Supply Chain',
  LLM04: 'Data and Model Poisoning',
  LLM05: 'Improper Output Handling',
  LLM06: 'Excessive Agency',
  LLM07: 'System Prompt Leakage',
  LLM08: 'Vector and Embedding Weaknesses',
  LLM09: 'Misinformation',
  LLM10: 'Unbounded Consumption',
};

describe('OWASP_LLM_TOP_10 — 2025 framework block (ADR-050 §5 GAP-1)', () => {
  test('framework entry exists and version is the 2025 spec', () => {
    const fm = mapper();
    const framework = fm.getFramework('OWASP_LLM_TOP_10');
    assert.ok(framework, 'OWASP_LLM_TOP_10 framework entry must exist');
    assert.equal(
      framework.version,
      '2025',
      `framework-mapper OWASP_LLM_TOP_10.version MUST be '2025' after the GAP-1 rebinding (got: ${framework.version})`
    );
  });

  test('control list is exactly LLM01:2025..LLM10:2025 sequential with 2025 names', () => {
    const fm = mapper();
    const framework = fm.getFramework('OWASP_LLM_TOP_10');
    const controlIds = Object.keys(framework.controls);
    assert.deepEqual(
      controlIds,
      Object.keys(EXPECTED_2025_CONTROLS),
      'control IDs MUST be LLM01..LLM10 in order (no gaps, no extras)'
    );
    for (const [id, expectedName] of Object.entries(EXPECTED_2025_CONTROLS)) {
      assert.equal(
        framework.controls[id].name,
        expectedName,
        `${id} name MUST be '${expectedName}' (got: '${framework.controls[id].name}')`
      );
    }
  });

  test('getFrameworkControls returns 10 entries with id/category/categoryName/description', () => {
    const fm = mapper();
    const controls = fm.getFrameworkControls('OWASP_LLM_TOP_10');
    assert.equal(controls.length, 10, 'must return exactly 10 controls');
    for (const c of controls) {
      assert.match(c.id, /^LLM\d{2}$/, `id shape LLMNN expected, got ${c.id}`);
      assert.equal(c.category, c.id, 'category mirrors id (flat namespace)');
      assert.equal(c.categoryName, EXPECTED_2025_CONTROLS[c.id], `${c.id} name`);
      assert.ok(c.description && c.description.length > 0, `${c.id} description required`);
    }
  });
});

// Per ADR-050 §3 (component map), the 2025 ID set is the binding.
// Each row below corresponds to a row in §3 verbatim. The asserted
// arrays are the **target** IDs after rebinding; the test fails
// while v1.1 IDs are still in place.
describe('OWASP_LLM_TOP_10 — AWARE component mappings (ADR-050 §3)', () => {
  // Helper: assert a single component's OWASP_LLM_TOP_10 array matches.
  function assertComponentRow(componentId, expected2025Ids) {
    const fm = mapper();
    const mapping = fm.getComponentMapping(componentId);
    assert.ok(mapping, `${componentId} must have a component mapping`);
    assert.deepEqual(
      mapping.OWASP_LLM_TOP_10,
      expected2025Ids,
      `${componentId}.OWASP_LLM_TOP_10 must be ${JSON.stringify(expected2025Ids)} after rebinding ` +
        `(got: ${JSON.stringify(mapping.OWASP_LLM_TOP_10)})`
    );
  }

  test('agent-registry: rebind from v1.1 [LLM05, LLM10] to 2025 [LLM03, LLM02]', () => {
    assertComponentRow('agent-registry', ['LLM03', 'LLM02']);
  });

  test('sandbox-policies: rebind from v1.1 [LLM04, LLM07, LLM08] to 2025 [LLM10, LLM05, LLM06]', () => {
    assertComponentRow('sandbox-policies', ['LLM10', 'LLM05', 'LLM06']);
  });

  test('behavioral-baseline: rebind from v1.1 [LLM03, LLM09] to 2025 [LLM04, LLM09]', () => {
    assertComponentRow('behavioral-baseline', ['LLM04', 'LLM09']);
  });

  test('kill-switch: rebind from v1.1 [LLM04, LLM08] to 2025 [LLM10, LLM06]', () => {
    assertComponentRow('kill-switch', ['LLM10', 'LLM06']);
  });

  test('pheromone-specialists: stays [LLM09] (LLM09:2025 Misinformation)', () => {
    assertComponentRow('pheromone-specialists', ['LLM09']);
  });

  test('security-heuristic: rebind from v1.1 [LLM01, LLM02] to 2025 [LLM01, LLM05]', () => {
    assertComponentRow('security-heuristic', ['LLM01', 'LLM05']);
  });

  test('identity-provider: rebind from v1.1 [LLM05, LLM06, LLM07, LLM10] to 2025 [LLM03, LLM02, LLM02, LLM02]', () => {
    // v1.1 LLM07 (Plugin Design) drops; AST10 covers. v1.1 LLM06/05/10 fold
    // into LLM02 (Sensitive Information Disclosure) per ADR-050 §3.
    assertComponentRow('identity-provider', ['LLM03', 'LLM02', 'LLM02', 'LLM02']);
  });

  test('anomaly-detection: rebind from v1.1 [LLM01, LLM03, LLM06, LLM09, LLM10] to 2025 [LLM01, LLM04, LLM02, LLM09, LLM02]', () => {
    // v1.1 LLM03 (Training Data Poisoning) → 2025 LLM04 (Data and Model Poisoning).
    // v1.1 LLM06 + LLM10 → 2025 LLM02 (Sensitive Information Disclosure).
    assertComponentRow('anomaly-detection', ['LLM01', 'LLM04', 'LLM02', 'LLM09', 'LLM02']);
  });

  test('tool-access-control: rebind from v1.1 [LLM01, LLM02, LLM04, LLM05, LLM07, LLM08] to 2025 [LLM01, LLM05, LLM10, LLM03, LLM03, LLM06]', () => {
    // v1.1 LLM02 (Insecure Output Handling) → 2025 LLM05 (Improper Output Handling).
    // v1.1 LLM04 (Model DoS) → 2025 LLM10 (Unbounded Consumption).
    // v1.1 LLM05 (Supply Chain) → 2025 LLM03 (Supply Chain).
    // v1.1 LLM07 (Plugin Design) → drops; AST10 covers. v1.1 LLM08 (Excessive Agency) → 2025 LLM06.
    assertComponentRow('tool-access-control', ['LLM01', 'LLM05', 'LLM10', 'LLM03', 'LLM03', 'LLM06']);
  });

  test('compliance-mapping: stays [LLM09] (LLM09:2025 Misinformation)', () => {
    assertComponentRow('compliance-mapping', ['LLM09']);
  });
});
