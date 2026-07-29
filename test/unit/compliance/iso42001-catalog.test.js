// SPDX-License-Identifier: Apache-2.0
// test/unit/compliance/iso42001-catalog.test.js
//
// Per ADR-055 §"Acceptance criteria" + the 7 ACs on the kanban card body:
//   - All 38 control IDs present in the catalog
//   - Each entry has { name, description, awareness, awareComponents,
//     crosswalkConfidence, ismsRef, clause }
//   - Awareness class breakdown matches the research report §6.1: 13 mapped /
//     16 partial / 9 gap of 38
//   - Description length ≤200 chars; no entry is empty
//   - Catalog is frozen (no runtime mutation)
//   - Framework block registered in framework-mapper.js with the ADR-055
//     §D4 shape (pinDate, license, attribution, catalogRef, controls,
//     controlIds, awarenessBreakdown, scopeNote)
//   - getFrameworkControls('ISO_42001') returns 38 entries with the full
//     per-entry shape (awareness, awareComponents, crosswalkConfidence,
//     ismsRef, clause)
//   - Every AWARE component's ISO_42001 mapping (if present) resolves via
//     componentCoversControl
//   - Every ISO_42001 ID referenced by an AWARE component exists in the catalog
//   - The A.6.2.8 canonical mapping is wired (event logs → audit chain via
//     anomaly-detection + compliance-mapping)
//   - The catalog header carries the SPDX Apache-2.0 + ISMS.online attribution
//     + "NOT Creative Commons" + "no certification claim" disclaimers
//
// pattern: node:test + node:assert (matches sibling test files under
// test/unit/compliance/*.test.js).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  ISO_42001_CONTROLS,
  ISO_42001_CONTROL_IDS
} = require('../../../src/compliance/iso42001-catalog');
const {
  FRAMEWORKS,
  AWARE_COMPONENT_MAPPINGS,
  getFrameworkMapper
} = require('../../../src/compliance/framework-mapper');

// ---------------------------------------------------------------------------
// Expected universe — pinned by ADR-055 §D3 + research §2.2 + research §6.1
// ---------------------------------------------------------------------------

const EXPECTED_CONTROL_IDS = [
  'A.2.2', 'A.2.3', 'A.2.4',
  'A.3.2', 'A.3.3',
  'A.4.2', 'A.4.3', 'A.4.4', 'A.4.5', 'A.4.6',
  'A.5.2', 'A.5.3', 'A.5.4', 'A.5.5',
  'A.6.1.2', 'A.6.1.3',
  'A.6.2.2', 'A.6.2.3', 'A.6.2.4', 'A.6.2.5', 'A.6.2.6', 'A.6.2.7', 'A.6.2.8',
  'A.7.2', 'A.7.3', 'A.7.4', 'A.7.5', 'A.7.6',
  'A.8.2', 'A.8.3', 'A.8.4', 'A.8.5',
  'A.9.2', 'A.9.3', 'A.9.4',
  'A.10.2', 'A.10.3', 'A.10.4'
];

// Awareness class breakdown per research §6.1 / ADR-055 §D3.
const EXPECTED_MAPPED = [
  'A.3.2', 'A.4.2', 'A.4.4', 'A.6.1.3', 'A.6.2.3', 'A.6.2.4',
  'A.6.2.6', 'A.6.2.8', 'A.8.3', 'A.8.4', 'A.9.2', 'A.9.4', 'A.10.3'
];
const EXPECTED_PARTIAL = [
  'A.2.2', 'A.2.3', 'A.3.3', 'A.4.3', 'A.4.5', 'A.6.1.2',
  'A.6.2.2', 'A.6.2.5', 'A.6.2.7', 'A.7.2', 'A.7.3', 'A.7.5',
  'A.8.2', 'A.8.5', 'A.10.2', 'A.10.4'
];
const EXPECTED_GAP = [
  'A.2.4', 'A.4.6',
  'A.5.2', 'A.5.3', 'A.5.4', 'A.5.5',  // the headline impact-assessment cluster
  'A.7.4', 'A.7.6',
  'A.9.3'
];

// Per-component ISO 42001 mappings per ADR-055 §D5 / research §4. This is
// the contract this test file pins; if the implementation drifts, these
// tests fail and an operator must reconcile against the ADR.
const EXPECTED_COMPONENT_MAPPINGS = {
  'agent-registry': ['A.3.2', 'A.4.2', 'A.4.3', 'A.4.5', 'A.6.2.2', 'A.6.2.5', 'A.7.2', 'A.9.4', 'A.10.2'],
  'sandbox-policies': ['A.6.1.3'],
  'behavioral-baseline': ['A.6.2.4', 'A.9.4'],
  'kill-switch': ['A.6.2.6', 'A.8.4'],
  // pheromone-specialists intentionally has no ISO_42001 key (heuristic-only,
  // same posture as AST10/MCP/AIDEFEND exclusions per ADR-055 §D5).
  'security-heuristic': ['A.6.2.2', 'A.6.2.4'],
  'identity-provider': ['A.3.2', 'A.10.3'],
  'anomaly-detection': ['A.3.3', 'A.6.2.4', 'A.6.2.6', 'A.6.2.8', 'A.8.4'],
  'tool-access-control': ['A.6.1.3', 'A.7.3', 'A.9.2'],
  'tool-observation-proxy': ['A.3.3', 'A.4.3', 'A.6.2.6'],
  'compliance-mapping': ['A.2.2', 'A.2.3', 'A.2.4', 'A.6.1.2', 'A.6.2.3', 'A.6.2.7', 'A.6.2.8', 'A.7.5', 'A.8.2', 'A.8.3', 'A.8.5', 'A.9.3', 'A.10.4'],
  'credential-classifier': ['A.7.4']
  // permission-model + shadow-detector intentionally have no ISO_42001 key
  // (research §4 does not enumerate a per-component mapping for them;
  // tool-access-control's A.9.2 captures the per-call RBAC angle).
};

// ---------------------------------------------------------------------------
// Catalog file — shape + completeness
// ---------------------------------------------------------------------------

test('iso42001-catalog: control IDs are exactly the 38 ADR-055 controls, ISMS.online order', () => {
  assert.deepStrictEqual([...ISO_42001_CONTROL_IDS], EXPECTED_CONTROL_IDS);
});

test('iso42001-catalog: exactly 38 entries (AC #1 — "ships 38 controls")', () => {
  assert.strictEqual(ISO_42001_CONTROL_IDS.length, 38);
  assert.strictEqual(Object.keys(ISO_42001_CONTROLS).length, 38);
});

test('iso42001-catalog: no duplicate control IDs', () => {
  const unique = new Set(ISO_42001_CONTROL_IDS);
  assert.strictEqual(unique.size, ISO_42001_CONTROL_IDS.length);
});

test('iso42001-catalog: each entry has name, description, awareness, awareComponents, crosswalkConfidence, ismsRef, clause', () => {
  for (const cid of EXPECTED_CONTROL_IDS) {
    const entry = ISO_42001_CONTROLS[cid];
    assert.ok(entry, `missing control entry for ${cid}`);
    assert.strictEqual(typeof entry.name, 'string');
    assert.ok(entry.name.length > 0, `${cid} name is empty`);
    assert.strictEqual(typeof entry.description, 'string');
    assert.ok(entry.description.length > 0, `${cid} description is empty`);
    assert.ok(entry.description.length <= 200, `${cid} description ${entry.description.length} chars > 200 cap`);
    assert.ok(
      ['mapped', 'partial', 'gap'].includes(entry.awareness),
      `${cid} awareness "${entry.awareness}" not in canonical enum`
    );
    assert.ok(Array.isArray(entry.awareComponents), `${cid} awareComponents not an array`);
    assert.ok(
      ['H', 'M', 'L'].includes(entry.crosswalkConfidence),
      `${cid} crosswalkConfidence "${entry.crosswalkConfidence}" not in {H, M, L}`
    );
    assert.strictEqual(typeof entry.ismsRef, 'string');
    assert.ok(entry.ismsRef.startsWith('https://www.isms.online/'), `${cid} ismsRef missing ISMS.online URL`);
    assert.strictEqual(typeof entry.clause, 'string');
    assert.ok(entry.clause.length > 0, `${cid} clause is empty`);
  }
});

test('iso42001-catalog: every awareComponents reference exists in framework-mapper rows', () => {
  const componentIds = new Set(Object.keys(AWARE_COMPONENT_MAPPINGS));
  for (const cid of EXPECTED_CONTROL_IDS) {
    for (const comp of ISO_42001_CONTROLS[cid].awareComponents) {
      assert.ok(
        componentIds.has(comp),
        `${cid} awareComponents references unknown component "${comp}"`
      );
    }
  }
});

test('iso42001-catalog: awareness-class breakdown is exactly 13 mapped / 16 partial / 9 gap', () => {
  const actual = { mapped: [], partial: [], gap: [] };
  for (const [cid, entry] of Object.entries(ISO_42001_CONTROLS)) {
    actual[entry.awareness].push(cid);
  }
  actual.mapped.sort();
  actual.partial.sort();
  actual.gap.sort();
  assert.deepStrictEqual(actual.mapped, [...EXPECTED_MAPPED].sort());
  assert.deepStrictEqual(actual.partial, [...EXPECTED_PARTIAL].sort());
  assert.deepStrictEqual(actual.gap, [...EXPECTED_GAP].sort());
});

test('iso42001-catalog: catalog is frozen (no runtime mutation)', () => {
  assert.ok(Object.isFrozen(ISO_42001_CONTROLS), 'ISO_42001_CONTROLS not frozen');
  assert.ok(Object.isFrozen(ISO_42001_CONTROL_IDS), 'ISO_42001_CONTROL_IDS not frozen');
  assert.throws(() => {
    'use strict';
    ISO_42001_CONTROLS['A.6.2.8'] = {};
  }, TypeError);
});

// ---------------------------------------------------------------------------
// Catalog header — SPDX + attribution invariants (ADR-055 §D2 license posture)
// ---------------------------------------------------------------------------

test('iso42001-catalog: header carries SPDX Apache-2.0 + attribution + disclaimers', () => {
  const headerPath = path.join(__dirname, '..', '..', '..', 'src', 'compliance', 'iso42001-catalog.js');
  const text = fs.readFileSync(headerPath, 'utf8');
  // Read the first 80 lines (attribution block) and strip // markers + newlines.
  const headerLines = text.split('\n').slice(0, 80);
  const headerFlat = headerLines.map(l => l.replace(/^\/\/\s*/, '')).join(' ');

  assert.match(text, /^\/\/ SPDX-License-Identifier: Apache-2\.0$/m,
    'SPDX header must be exactly Apache-2.0');
  assert.match(headerFlat, /ISO\/IEC 42001:2023/,
    'ISO/IEC 42001:2023 identifier missing from header');
  assert.match(headerFlat, /isms\.online\/iso-42001\/annex-a-controls/,
    'ISMS.online source URL missing from header');
  assert.match(headerFlat, /NOT Creative Commons/,
    '"NOT Creative Commons" disclaimer missing from header');
  assert.match(headerFlat, /certification/,
    'certification-claim disclaimer missing from header');
});

// ---------------------------------------------------------------------------
// Framework block — registration + control enumeration (AC #2, #3, #4)
// ---------------------------------------------------------------------------

test('framework-mapper: ISO_42001 is registered in FRAMEWORKS with the ADR-055 §D4 shape', () => {
  const fw = FRAMEWORKS.ISO_42001;
  assert.ok(fw, 'ISO_42001 missing from FRAMEWORKS');
  assert.strictEqual(fw.id, 'ISO_42001');
  assert.strictEqual(fw.name, 'ISO/IEC 42001:2023 — AI Management System');
  assert.strictEqual(fw.version, 'v1.0-2026-07-28');
  assert.strictEqual(fw.source, 'https://www.isms.online/iso-42001/annex-a-controls/');
  assert.strictEqual(fw.pinDate, '2026-07-28');
  assert.strictEqual(fw.license, 'Apache-2.0 (code) / no upstream CC (control IDs + titles from ISMS.online)');
  assert.ok(fw.attribution && fw.attribution.length > 0, 'attribution missing');
  assert.match(fw.attribution, /ISMS\.online/);
  assert.match(fw.attribution, /fetched 2026-07-28/);
  assert.strictEqual(fw.catalogRef, './iso42001-catalog');
  assert.deepStrictEqual(fw.awarenessBreakdown, { mapped: 13, partial: 16, gap: 9, total: 38 });
  assert.match(fw.scopeNote, /Annex A control coverage only/);
  assert.match(fw.scopeNote, /does NOT claim/);
});

test('framework-mapper: getFrameworkControls returns 38 entries for ISO_42001', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('ISO_42001');
  assert.strictEqual(controls.length, 38, `expected 38 controls, got ${controls.length}`);
});

test('framework-mapper: getFrameworkControls returns all 38 IDs in expected order', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('ISO_42001');
  const ids = controls.map((c) => c.id);
  assert.deepStrictEqual(ids, EXPECTED_CONTROL_IDS);
});

test('framework-mapper: each ISO_42001 control carries awareness, awareComponents, crosswalkConfidence, ismsRef, clause', () => {
  const fm = getFrameworkMapper();
  const controls = fm.getFrameworkControls('ISO_42001');
  for (const c of controls) {
    assert.strictEqual(typeof c.id, 'string');
    assert.match(c.id, /^A\.\d+(?:\.\d+)+$/);
    assert.strictEqual(typeof c.categoryName, 'string');
    assert.ok(c.categoryName.length > 0);
    assert.strictEqual(typeof c.description, 'string');
    assert.ok(c.description.length > 0);
    assert.ok(c.description.length <= 200, `${c.id} description ${c.description.length} chars > 200`);
    assert.ok(
      ['mapped', 'partial', 'gap'].includes(c.awareness),
      `${c.id} awareness "${c.awareness}" not in enum`
    );
    assert.ok(Array.isArray(c.awareComponents));
    assert.ok(['H', 'M', 'L'].includes(c.crosswalkConfidence));
    assert.strictEqual(typeof c.ismsRef, 'string');
    assert.match(c.ismsRef, /^https:\/\/www\.isms\.online\//);
    assert.strictEqual(typeof c.clause, 'string');
  }
});

// ---------------------------------------------------------------------------
// Component → control mappings (AC #5, #6)
// ---------------------------------------------------------------------------

test('framework-mapper: each component with ISO_42001 mapping resolves via componentCoversControl', () => {
  const fm = getFrameworkMapper();
  for (const [component, ids] of Object.entries(EXPECTED_COMPONENT_MAPPINGS)) {
    assert.ok(
      AWARE_COMPONENT_MAPPINGS[component],
      `component ${component} missing from AWARE_COMPONENT_MAPPINGS`
    );
    const actual = AWARE_COMPONENT_MAPPINGS[component]['ISO_42001'] || [];
    assert.strictEqual(
      actual.length,
      ids.length,
      `${component} length mismatch: expected ${ids.length}, got ${actual.length} (${JSON.stringify(actual)})`
    );
    for (const cid of ids) {
      assert.ok(
        actual.includes(cid),
        `${component} missing ${cid} (actual: ${JSON.stringify(actual)})`
      );
      assert.strictEqual(
        fm.componentCoversControl(component, 'ISO_42001', cid),
        true,
        `${component} does not cover ${cid} via componentCoversControl`
      );
    }
  }
});

test('framework-mapper: every ISO_42001 ID referenced by an AWARE component exists in the catalog', () => {
  const referenced = new Set();
  for (const mapping of Object.values(AWARE_COMPONENT_MAPPINGS)) {
    const iso = mapping['ISO_42001'] || [];
    for (const cid of iso) referenced.add(cid);
  }
  for (const cid of referenced) {
    assert.ok(
      ISO_42001_CONTROLS[cid],
      `component mapping references ${cid} but catalog has no entry for it`
    );
  }
});

test('framework-mapper: A.6.2.8 (event logs, canonical mapping) is wired to anomaly-detection + compliance-mapping', () => {
  const a6628 = ISO_42001_CONTROLS['A.6.2.8'];
  assert.strictEqual(a6628.awareness, 'mapped');
  assert.strictEqual(a6628.crosswalkConfidence, 'H');
  assert.ok(
    a6628.awareComponents.includes('anomaly-detection'),
    'A.6.2.8 awareComponents must include anomaly-detection'
  );
  assert.ok(
    a6628.awareComponents.includes('compliance-mapping'),
    'A.6.2.8 awareComponents must include compliance-mapping'
  );
  // Framework-mapper surfaces the same cross-check.
  const fm = getFrameworkMapper();
  assert.strictEqual(fm.componentCoversControl('anomaly-detection', 'ISO_42001', 'A.6.2.8'), true);
  assert.strictEqual(fm.componentCoversControl('compliance-mapping', 'ISO_42001', 'A.6.2.8'), true);
});

test('framework-mapper: A.5 impact-assessment cluster is the headline gap (all 4 marked gap)', () => {
  for (const cid of ['A.5.2', 'A.5.3', 'A.5.4', 'A.5.5']) {
    const entry = ISO_42001_CONTROLS[cid];
    assert.ok(entry, `${cid} missing from catalog`);
    assert.strictEqual(entry.awareness, 'gap', `${cid} should be marked gap (headline follow-up)`);
    assert.strictEqual(entry.crosswalkConfidence, 'L');
    assert.deepStrictEqual(
      entry.awareComponents.filter(c => c !== ''),
      [],
      `${cid} awareComponents should be empty for gap entries`
    );
  }
});

test('framework-mapper: pheromone-specialists has NO ISO_42001 key (heuristic-only per ADR-055 §D5)', () => {
  const m = AWARE_COMPONENT_MAPPINGS['pheromone-specialists'];
  assert.ok(m, 'pheromone-specialists missing from AWARE_COMPONENT_MAPPINGS');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(m, 'ISO_42001'),
    false,
    'pheromone-specialists should NOT have an ISO_42001 key'
  );
  // componentCoversControl returns false when the framework key is absent.
  const fm = getFrameworkMapper();
  assert.strictEqual(
    fm.componentCoversControl('pheromone-specialists', 'ISO_42001', 'A.6.2.8'),
    false
  );
});

test('framework-mapper: permission-model + shadow-detector have NO ISO_42001 key (research §4 does not enumerate)', () => {
  for (const comp of ['permission-model', 'shadow-detector']) {
    const m = AWARE_COMPONENT_MAPPINGS[comp];
    assert.ok(m, `${comp} missing from AWARE_COMPONENT_MAPPINGS`);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(m, 'ISO_42001'),
      false,
      `${comp} should NOT have an ISO_42001 key (per research §4)`
    );
  }
});

// ---------------------------------------------------------------------------
// Catalog ↔ framework consistency — controls list cannot drift
// ---------------------------------------------------------------------------

test('framework-mapper: FRAMEWORKS.ISO_42001.controls shape matches the catalog', () => {
  const fw = FRAMEWORKS.ISO_42001;
  assert.ok(fw.controls, 'framework has no controls');
  const fwIds = Object.keys(fw.controls).sort();
  const catalogIds = Object.keys(ISO_42001_CONTROLS).sort();
  assert.deepStrictEqual(fwIds, catalogIds);
});

test('framework-mapper: controlIds in framework block matches the catalog order', () => {
  const fw = FRAMEWORKS.ISO_42001;
  assert.deepStrictEqual([...fw.controlIds], [...ISO_42001_CONTROL_IDS]);
});
