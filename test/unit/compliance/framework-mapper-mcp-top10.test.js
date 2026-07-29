// SPDX-License-Identifier: Apache-2.0
// test/unit/compliance/framework-mapper-mcp-top10.test.js
//
// Per ADR-051 §2.3 acceptance criteria + the 9 ACs on the kanban card body:
//   - All 10 control IDs present in getFrameworkControls('OWASP_MCP_TOP_10')
//   - Each AWARE component's mapping resolves the listed MCP control IDs
//     via componentCoversControl
//   - pheromone-specialists correctly has no OWASP_MCP_TOP_10 key
//   - The catalog file exports MCP_TOP_10_CONTROLS + MCP_TOP_10_CONTROL_IDS
//
// pattern: node:test + node:assert (matches sibling test files
// under test/unit/compliance/*.test.js).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const { MCP_TOP_10_CONTROLS, MCP_TOP_10_CONTROL_IDS } =
  require('../../../src/compliance/mcp-top10-catalog');
const {
  FRAMEWORKS,
  AWARE_COMPONENT_MAPPINGS,
  getFrameworkMapper
} = require('../../../src/compliance/framework-mapper');

// ---------------------------------------------------------------------------
// Expected universe — pinned by ADR-051 §2.2 + the upstream README
// ---------------------------------------------------------------------------

const EXPECTED_CONTROL_IDS = [
  'MCP01', 'MCP02', 'MCP03', 'MCP04', 'MCP05',
  'MCP06', 'MCP07', 'MCP08', 'MCP09', 'MCP10'
];

// All 9 component mappings per ADR-051 §2.2. pheromone-specialists is
// intentionally omitted (heuristic-only per ADR-043 §1).
const EXPECTED_COMPONENT_MAPPINGS = {
  'sandbox-policies': ['MCP05'],
  'identity-provider': ['MCP01', 'MCP04', 'MCP07'],
  'anomaly-detection': ['MCP03', 'MCP06'],
  'tool-access-control': ['MCP02', 'MCP03', 'MCP05', 'MCP07'],
  'compliance-mapping': ['MCP08', 'MCP09'],
  'tool-observation-proxy': ['MCP03', 'MCP06', 'MCP08', 'MCP10'],
  'permission-model': ['MCP02', 'MCP07'],
  'shadow-detector': ['MCP09'],
  'credential-classifier': ['MCP01']
};

// ---------------------------------------------------------------------------
// Catalog file — shape + completeness (AC #1)
// ---------------------------------------------------------------------------

test('mcp-top10-catalog: control IDs are exactly MCP01..MCP10 in order', () => {
  assert.deepStrictEqual([...MCP_TOP_10_CONTROL_IDS], EXPECTED_CONTROL_IDS);
});

test('mcp-top10-catalog: each control has name, severity, description', () => {
  for (const cid of EXPECTED_CONTROL_IDS) {
    const entry = MCP_TOP_10_CONTROLS[cid];
    assert.ok(entry, `missing control entry for ${cid}`);
    assert.strictEqual(typeof entry.name, 'string');
    assert.ok(entry.name.length > 0, `${cid} name is empty`);
    assert.strictEqual(typeof entry.severity, 'string');
    assert.ok(
      ['Critical', 'High', 'Medium', 'Low'].includes(entry.severity),
      `${cid} severity "${entry.severity}" not in canonical enum`
    );
    assert.strictEqual(typeof entry.description, 'string');
    assert.ok(entry.description.length > 20, `${cid} description too short`);
  }
});

test('mcp-top10-catalog: catalog is frozen (no runtime mutation)', () => {
  assert.ok(Object.isFrozen(MCP_TOP_10_CONTROLS), 'MCP_TOP_10_CONTROLS not frozen');
  assert.ok(Object.isFrozen(MCP_TOP_10_CONTROL_IDS), 'MCP_TOP_10_CONTROL_IDS not frozen');
  assert.throws(() => {
    'use strict';
    MCP_TOP_10_CONTROLS.MCP01 = {};
  }, TypeError);
});

// ---------------------------------------------------------------------------
// Framework block — registration + control enumeration (AC #2, #3)
// ---------------------------------------------------------------------------

test('framework-mapper: OWASP_MCP_TOP_10 is registered in FRAMEWORKS', () => {
  assert.ok(FRAMEWORKS.OWASP_MCP_TOP_10, 'OWASP_MCP_TOP_10 missing from FRAMEWORKS');
  assert.strictEqual(FRAMEWORKS.OWASP_MCP_TOP_10.id, 'OWASP_MCP_TOP_10');
  assert.strictEqual(FRAMEWORKS.OWASP_MCP_TOP_10.version, '2025');
  assert.strictEqual(
    FRAMEWORKS.OWASP_MCP_TOP_10.source,
    'https://github.com/OWASP/www-project-mcp-top-10'
  );
  assert.strictEqual(FRAMEWORKS.OWASP_MCP_TOP_10.catalogRef, './mcp-top10-catalog');
});

test('framework-mapper: getFrameworkControls returns 10 entries for OWASP_MCP_TOP_10', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('OWASP_MCP_TOP_10');
  assert.strictEqual(controls.length, 10, `expected 10 controls, got ${controls.length}`);
});

test('framework-mapper: getFrameworkControls returns all 10 IDs MCP01..MCP10', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('OWASP_MCP_TOP_10');
  const ids = controls.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, EXPECTED_CONTROL_IDS.slice().sort());
});

test('framework-mapper: each MCP control has expected fields (id, category, severity, description)', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('OWASP_MCP_TOP_10');
  for (const c of controls) {
    assert.strictEqual(typeof c.id, 'string');
    assert.match(c.id, /^MCP\d{2}$/);
    assert.strictEqual(typeof c.categoryName, 'string');
    assert.ok(c.categoryName.length > 0);
    assert.strictEqual(typeof c.severity, 'string');
    assert.ok(c.severity);
    assert.strictEqual(typeof c.description, 'string');
    assert.ok(c.description.length > 20);
  }
});

// ---------------------------------------------------------------------------
// Component → control mappings (AC #4, #5, #6, #7)
// ---------------------------------------------------------------------------

test('framework-mapper: mapComponent(tool-access-control) → MCP02, MCP03, MCP05, MCP07 (AC #4)', () => {
  const mcp = AWARE_COMPONENT_MAPPINGS['tool-access-control']['OWASP_MCP_TOP_10'];
  assert.deepStrictEqual(mcp.slice().sort(), ['MCP02', 'MCP03', 'MCP05', 'MCP07']);
});

test('framework-mapper: mapComponent(credential-classifier) → [MCP01] (AC #5)', () => {
  const mcp = AWARE_COMPONENT_MAPPINGS['credential-classifier']['OWASP_MCP_TOP_10'];
  assert.deepStrictEqual(mcp, ['MCP01']);
});

test('framework-mapper: componentCoversControl(credential-classifier, OWASP_MCP_TOP_10, MCP01) === true (AC #6)', () => {
  const fm = getFrameworkMapper();
  assert.strictEqual(
    fm.componentCoversControl('credential-classifier', 'OWASP_MCP_TOP_10', 'MCP01'),
    true
  );
});

test('framework-mapper: every component mapping resolves via componentCoversControl (AC #4-#6)', () => {
  const fm = getFrameworkMapper();
  for (const [component, ids] of Object.entries(EXPECTED_COMPONENT_MAPPINGS)) {
    assert.ok(
      AWARE_COMPONENT_MAPPINGS[component],
      `component ${component} missing from AWARE_COMPONENT_MAPPINGS`
    );
    const actual = AWARE_COMPONENT_MAPPINGS[component]['OWASP_MCP_TOP_10'] || [];
    assert.strictEqual(
      actual.length,
      ids.length,
      `${component} length mismatch: expected ${ids.length}, got ${actual.length}`
    );
    for (const cid of ids) {
      assert.ok(
        actual.includes(cid),
        `${component} missing ${cid} (actual: ${JSON.stringify(actual)})`
      );
      assert.strictEqual(
        fm.componentCoversControl(component, 'OWASP_MCP_TOP_10', cid),
        true,
        `${component} does not cover ${cid} via componentCoversControl`
      );
    }
  }
});

test('framework-mapper: pheromone-specialists has NO OWASP_MCP_TOP_10 key (AC #7)', () => {
  const m = AWARE_COMPONENT_MAPPINGS['pheromone-specialists'];
  assert.ok(m, 'pheromone-specialists missing from AWARE_COMPONENT_MAPPINGS');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(m, 'OWASP_MCP_TOP_10'),
    false,
    'pheromone-specialists should NOT have an OWASP_MCP_TOP_10 key (heuristic-only per ADR-043 §1)'
  );
});

test('framework-mapper: componentCoversControl returns false for pheromone-specialists × MCP01', () => {
  const fm = getFrameworkMapper();
  assert.strictEqual(
    fm.componentCoversControl('pheromone-specialists', 'OWASP_MCP_TOP_10', 'MCP01'),
    false
  );
});

// ---------------------------------------------------------------------------
// Catalog ↔ framework consistency — controls list cannot drift
// ---------------------------------------------------------------------------

test('framework-mapper: FRAMEWORKS.OWASP_MCP_TOP_10.controls shape matches the catalog', () => {
  const fw = FRAMEWORKS.OWASP_MCP_TOP_10;
  assert.ok(fw.controls, 'framework has no controls');
  // The controls object is the catalog object (referenced, not copied).
  // If it ever drifts, drift detector should catch it.
  const fwIds = Object.keys(fw.controls).sort();
  const catalogIds = Object.keys(MCP_TOP_10_CONTROLS).sort();
  assert.deepStrictEqual(fwIds, catalogIds);
});

test('framework-mapper: controlIds in framework block matches the catalog order', () => {
  const fw = FRAMEWORKS.OWASP_MCP_TOP_10;
  assert.deepStrictEqual([...fw.controlIds], [...MCP_TOP_10_CONTROL_IDS]);
});

test('framework-mapper: every MCP control referenced by an AWARE component exists in the catalog', () => {
  const referenced = new Set();
  for (const mapping of Object.values(AWARE_COMPONENT_MAPPINGS)) {
    const mcpList = mapping['OWASP_MCP_TOP_10'] || [];
    for (const cid of mcpList) referenced.add(cid);
  }
  for (const cid of referenced) {
    assert.ok(
      MCP_TOP_10_CONTROLS[cid],
      `component mapping references ${cid} but catalog has no entry for it`
    );
  }
});
