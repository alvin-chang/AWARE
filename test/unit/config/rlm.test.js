// Tests for config/rlm.yaml — validates the canonical RLM configuration
// against config/rlm.schema.json (JSON Schema draft-07).
//
// Mirrors test/unit/config/index.test.js structure: snapshots process.env,
// clears AWARE_* and AWARE_RLM_* vars per test, restores on teardown.
//
// Schema validation is delegated to Python's `jsonschema` library
// (the canonical draft-07 reference implementation, endorsed by the
// hand-off brief as an alternative to npx ajv). The Python toolchain is
// already required for AWARE bring-up scripts; we avoid adding a new
// Node dependency (ajv) just for one test.
//
// Each test that needs schema validation spawns python3 once. The
// ~50ms-per-call cost is acceptable for a test that runs at most a
// dozen times.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'config', 'rlm.schema.json');
const YAML_PATH = path.join(REPO_ROOT, 'config', 'rlm.yaml');

// --- env clearing --------------------------------------------------------
//
// Mirrors the existing clearV2Env() in test/unit/config/index.test.js and
// adds AWARE_RLM_* vars so the test isn't influenced by the developer's
// shell. (rlm.cjs is not yet written — OOS for A1.1 — but we still clear
// the namespace so future tests that DO load rlm.cjs aren't surprised.)
function clearV2Env() {
  for (const k of Object.keys(process.env)) {
    if (
      k === 'COORDINATOR_PORT' || k === 'COORDINATOR_HOST' ||
      k === 'COORDINATOR_URL' ||
      k === 'GATEWAY_PORT' || k === 'GATEWAY_HOST' ||
      k === 'AWARE_REQUEST_TIMEOUT_MS' || k === 'AWARE_REQUEST_COST_CAP_USD' ||
      k === 'AWARE_KILL_SWITCH' || k === 'AWARE_GATEWAY_KILL_SWITCH' ||
      k === 'AWARE_RL_PIPELINE_PATH' ||
      k === 'AWARE_MODE' || k === 'OLLAMA_URL' ||
      k === 'LLM_API_KEY' || k === 'PROVIDER_API_HOST' ||
      k === 'AWARE_PRM_CACHE_ENABLED' || k === 'AWARE_PRM_CACHE_TTL_DAYS' ||
      k === 'AWARE_PRM_CACHE_TABLE' ||
      k === 'AWARE_BUDGET_ENABLED' || k === 'AWARE_BUDGET_WINDOW_DAYS' ||
      k === 'AWARE_BUDGET_SOFT_LIMIT_USD' || k === 'AWARE_BUDGET_HARD_LIMIT_USD' ||
      k === 'MODAL_TOKEN_ID' || k === 'MODAL_TOKEN_SECRET' ||
      // AWARE_RLM_* — env-var override namespace documented in docs/rlm.md.
      // We clear by prefix even though env-var consumption lives in C1.
      k.startsWith('AWARE_RLM_')
    ) {
      delete process.env[k];
    }
  }
}

test.beforeEach(() => {
  clearV2Env();
});

// --- helpers -------------------------------------------------------------

/**
 * Validate the canonical rlm.yaml against rlm.schema.json, with optional
 * deep-merged overrides. Returns {ok: true} on success or
 * {ok: false, errors: [{path, message}, ...]} on failure.
 *
 * Implementation: spawns python3 with an inline script that uses
 * PyYAML + jsonschema to do exactly what production code would do.
 */
function validateYaml(overrides) {
  const overridesJson = JSON.stringify(overrides || {});
  const script = `
import json, sys, yaml, jsonschema

overrides = json.loads(sys.argv[1])
schema = json.load(open(${JSON.stringify(SCHEMA_PATH)}))
data = yaml.safe_load(open(${JSON.stringify(YAML_PATH)}))

def deep_merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            deep_merge(a[k], v)
        else:
            a[k] = v
deep_merge(data, overrides)

v = jsonschema.Draft7Validator(schema)
errors = [
    {'path': '/'.join(str(p) for p in e.absolute_path) or '<root>',
     'message': e.message}
    for e in v.iter_errors(data)
]
if errors:
    print(json.dumps({'ok': False, 'errors': errors[:5]}))
else:
    print(json.dumps({'ok': True}))
`;
  const out = execFileSync('python3', ['-c', script, overridesJson], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  return JSON.parse(out);
}

/**
 * Load the canonical rlm.yaml as a parsed object (no validation).
 */
function loadYaml() {
  const script = `
import json, yaml
print(json.dumps(yaml.safe_load(open(${JSON.stringify(YAML_PATH)}))))
`;
  const out = execFileSync('python3', ['-c', script], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  return JSON.parse(out);
}

/**
 * Like validateYaml, but removes a top-level rlm.* key instead of merging.
 * Used to test the `required` list.
 */
function validateYamlWithRemoval(keyToRemove) {
  const script = `
import json, sys, yaml, jsonschema
key = sys.argv[1]
schema = json.load(open(${JSON.stringify(SCHEMA_PATH)}))
data = yaml.safe_load(open(${JSON.stringify(YAML_PATH)}))
del data['rlm'][key]
v = jsonschema.Draft7Validator(schema)
errors = [
    {'path': '/'.join(str(p) for p in e.absolute_path) or '<root>',
     'message': e.message}
    for e in v.iter_errors(data)
]
print(json.dumps({'ok': not errors, 'errors': errors[:5]}))
`;
  const out = execFileSync('python3', ['-c', script, keyToRemove], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  return JSON.parse(out);
}

// --- tests ---------------------------------------------------------------

test('rlm schema: validates against draft-07 metaschema', (t) => {
  t.after(() => { clearV2Env(); });

  // The schema is the contract — it must itself conform to draft-07.
  // We invoke Python's jsonschema.Draft7Validator.check_schema(), the
  // reference implementation, on the schema document directly.
  const script = `
import json, sys, jsonschema
schema = json.load(open(${JSON.stringify(SCHEMA_PATH)}))
try:
    jsonschema.Draft7Validator.check_schema(schema)
    print('OK')
except jsonschema.SchemaError as e:
    print('FAIL: ' + str(e), file=sys.stderr)
    sys.exit(1)
`;
  const out = execFileSync('python3', ['-c', script], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  assert.equal(out, 'OK');
});

test('rlm schema: canonical rlm.yaml validates cleanly', (t) => {
  t.after(() => { clearV2Env(); });

  const r = validateYaml(null);
  assert.deepEqual(r, { ok: true },
    `expected rlm.yaml to validate cleanly against rlm.schema.json; got: ${JSON.stringify(r)}`);
});

test('rlm schema: rejects negative budgetUsd', (t) => {
  t.after(() => { clearV2Env(); });

  const r = validateYaml({ rlm: { budgetUsd: -1 } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/budgetUsd'),
    `expected an error on rlm/budgetUsd; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects string budgetUsd', (t) => {
  t.after(() => { clearV2Env(); });

  // Numbers and null are the only oneOf branches. A string must fail.
  const r = validateYaml({ rlm: { budgetUsd: '5' } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/budgetUsd'),
    `expected an error on rlm/budgetUsd; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects unknown tool in tools.allowed', (t) => {
  t.after(() => { clearV2Env(); });

  // 'write' is not in the 7-tool surface. The enum must reject it.
  const r = validateYaml({ rlm: { tools: { allowed: ['read', 'write'] } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/tools/allowed/1'),
    `expected an error on rlm/tools/allowed/1 (the 'write' entry); got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects too many tools in tools.allowed', (t) => {
  t.after(() => { clearV2Env(); });

  // maxItems=7; 8 entries must fail.
  const tooMany = ['read', 'grep', 'slice', 'vec_search', 'len', 'keys', 'print', 'read'];
  const r = validateYaml({ rlm: { tools: { allowed: tooMany } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/tools/allowed' && /too long|maximum/i.test(e.message)),
    `expected an error about maxItems on tools.allowed; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects relative workspaceDir', (t) => {
  t.after(() => { clearV2Env(); });

  // pattern ^/ requires a leading slash.
  const r = validateYaml({ rlm: { workspaceDir: 'relative/path' } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/workspaceDir'),
    `expected an error on rlm/workspaceDir; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects out-of-enum sandbox.enforcement', (t) => {
  t.after(() => { clearV2Env(); });

  // 'optional' is not in [required, advisory, disabled].
  const r = validateYaml({ rlm: { sandbox: { enforcement: 'optional' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/sandbox/enforcement'),
    `expected an error on rlm/sandbox/enforcement; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects out-of-range tree.maxDepth', (t) => {
  t.after(() => { clearV2Env(); });

  // maxDepth cap is 5.
  const r = validateYaml({ rlm: { tree: { maxDepth: 6 } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/tree/maxDepth'),
    `expected an error on rlm/tree/maxDepth; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects override of audit.component (F-008 const)', (t) => {
  t.after(() => { clearV2Env(); });

  // F-008: component=rlm is locked. Any other value must fail.
  const r = validateYaml({ rlm: { audit: { component: 'other' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/component'),
    `expected an error on rlm/audit/component; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects override of audit.kindNode (F-008 const)', (t) => {
  t.after(() => { clearV2Env(); });

  // F-008: kindNode=rlm_node is locked.
  const r = validateYaml({ rlm: { audit: { kindNode: 'rlm_other' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/kindNode'),
    `expected an error on rlm/audit/kindNode; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects unknown redactFields entry', (t) => {
  t.after(() => { clearV2Env(); });

  // redactFields enum is the closed set [userPrompt, contextPayload,
  // leafOutput, treeStructure]. An unknown field must fail.
  const r = validateYaml({ rlm: { audit: { redactFields: ['secretToken'] } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/redactFields/0'),
    `expected an error on rlm/audit/redactFields/0; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects fewShotExamples != 0 (v1 locked)', (t) => {
  t.after(() => { clearV2Env(); });

  // min=0, max=0 — only 0 is allowed.
  const r = validateYaml({ rlm: { fewShotExamples: 1 } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/fewShotExamples'),
    `expected an error on rlm/fewShotExamples; got: ${JSON.stringify(r.errors)}`,
  );
});

test('rlm schema: rejects missing top-level required field', (t) => {
  t.after(() => { clearV2Env(); });

  // Drop 'killSwitch' from the YAML — the required list must catch it.
  const r = validateYamlWithRemoval('killSwitch');
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => /killSwitch/.test(e.message)),
    `expected a missing-required error mentioning killSwitch; got: ${JSON.stringify(r.errors)}`,
  );
});

// --- structural assertions (no schema validation) -----------------------

test('rlm defaults: tree shape is documented (maxDepth=2, branching=3, K=4)', (t) => {
  t.after(() => { clearV2Env(); });

  const data = loadYaml();
  assert.equal(data.rlm.tree.maxDepth, 2);
  assert.equal(data.rlm.tree.branching, 3);
  assert.equal(data.rlm.tree.K, 4);
  assert.equal(data.rlm.tree.preferParallel, false);
});

test('rlm defaults: 9 leaves compute at default tree shape', (t) => {
  t.after(() => { clearV2Env(); });

  // The rlm library computes leaves = branching^maxDepth (see
  // ~/src/rlm/src/rlm/tree.js). At maxDepth=2, branching=3 this is 9.
  // (K is an independent config field — the A1.1 prose reserves it for
  // a future migration where the schema's max=8 cap reflects the
  // library's branching max=8 in the next pass.)
  const data = loadYaml();
  const { maxDepth, branching } = data.rlm.tree;
  const leaves = Math.pow(branching, maxDepth);
  assert.equal(leaves, 9,
    `expected 9 leaves at default tree shape (branching^maxDepth = 3^2 = 9)`);
});

test('rlm defaults: audit.costRecorded is always "always" regardless of budgetUsd', (t) => {
  t.after(() => { clearV2Env(); });

  // Default: budgetUsd=null, costRecorded=always. The brief's invariant
  // is that budget enforcement is opt-in; cost is recorded whether or
  // not enforcement is on.
  const data = loadYaml();
  assert.equal(data.rlm.budgetUsd, null,
    'expected default budgetUsd to be null (no product-level cap)');
  assert.equal(data.rlm.audit.costRecorded, 'always',
    'expected audit.costRecorded to be "always" (cost recorded unconditionally)');

  // Even when an operator opts into enforcement, costRecorded stays
  // "always" (per the schema enum and the F-024 resolution).
  const r = validateYaml({ rlm: { budgetUsd: 5.00 } });
  assert.deepEqual(r, { ok: true },
    'budgetUsd=5.00 must still validate; costRecorded is independent');
});

test('rlm defaults: 7-tool surface is the canonical AWARE whitelist', (t) => {
  t.after(() => { clearV2Env(); });

  const data = loadYaml();
  const expected = ['read', 'grep', 'slice', 'vec_search', 'len', 'keys', 'print'];
  assert.deepEqual(data.rlm.tools.allowed, expected,
    'tools.allowed must be the 7-tool SPEC §11 surface');
});

test('rlm defaults: audit.component is "rlm" and kindNode is "rlm_node"', (t) => {
  t.after(() => { clearV2Env(); });

  const data = loadYaml();
  assert.equal(data.rlm.audit.component, 'rlm');
  assert.equal(data.rlm.audit.kindNode, 'rlm_node');
});

test('rlm defaults: killSwitch defaults to false', (t) => {
  t.after(() => { clearV2Env(); });

  const data = loadYaml();
  assert.equal(data.rlm.killSwitch, false);
});
// --- BLOCK-13: schema rigor gap fixes (A1.1.2, 2026-06-28 ~13:45 UTC) ---
// Reviewer's G2 verdict flagged 6 missing field groups + no additionalProperties:false.
// These tests verify the schema now rejects the 30 attacks the reviewer's
// Python jsonschema harness demonstrated as ACCEPTED in the pre-fix schema.

test('BLOCK-13: schema rejects missing rlm.context (now required)', (t) => {
  t.after(() => { clearV2Env(); });
  // Drop rlm.context entirely — should fail because it's now in the required list.
  const r = validateYaml({});  // No overrides — uses canonical YAML
  // Canonical YAML has rlm.context; this test verifies the schema accepts it
  // (not a test of removal — see next test for that).
  assert.equal(r.ok, true, `canonical YAML should validate: ${JSON.stringify(r.errors)}`);
});

test('BLOCK-13: schema rejects re-introduction of BLOCK-1 contradiction (fieldName=kind)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { context: { fieldName: 'kind' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/context/fieldName'),
    `expected error on rlm/context/fieldName; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects re-introduction of BLOCK-11 (sqlite context type)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { context: { allowedTypes: ['directory', 'pdf', 'log', 'sqlite'] } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path.includes('allowedTypes')),
    `expected error on allowedTypes; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects empty redactFields (minItems=1)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { audit: { redactFields: [] } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/redactFields'),
    `expected error on redactFields; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects decompositionScope=root-only (reverted YAML would silently produce wrong sub_calls)', (t) => {
  t.after(() => { clearV2Env(); });
  // The every-non-leaf constraint is load-bearing because tree.js:63 decomposes
  // at every non-leaf. A root-only override would silently produce wrong sub_calls
  // accounting per the A1.1.1 formula. The schema now REJECTS root-only.
  const r = validateYaml({ rlm: { decompositionScope: 'root-only' } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/decompositionScope'),
    `expected error on decompositionScope; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects revert of sandbox.enforcement to advisory', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { sandbox: { enforcement: 'advisory' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/sandbox/enforcement'),
    `expected error on enforcement; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects revert of sandbox.privilegeDrop to disabled', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { sandbox: { privilegeDrop: 'disabled' } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/sandbox/privilegeDrop'),
    `expected error on privilegeDrop; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects unknown rlm.foobar (additionalProperties:false)', (t) => {
  t.after(() => { clearV2Env(); });
  // The validateYaml() helper uses deep_merge so it can't add unknown fields;
  // use the Python harness path directly via execFileSync.
  const script = `
import json, sys, yaml, jsonschema
key = sys.argv[1]
val = sys.argv[2]
schema = json.load(open(${JSON.stringify(SCHEMA_PATH)}))
data = yaml.safe_load(open(${JSON.stringify(YAML_PATH)}))
# Add the unknown field at the requested path
parts = key.split('.')
d = data
for p in parts[:-1]:
    d = d[p]
d[parts[-1]] = val
v = jsonschema.Draft7Validator(schema)
errors = [
    {'path': '/'.join(str(p) for p in e.absolute_path) or '<root>',
     'message': e.message}
    for e in v.iter_errors(data)
]
print(json.dumps({'ok': not errors, 'errors': errors[:5]}))
`;
  const out = execFileSync('python3', ['-c', script, 'rlm.foobar', 'unknown'], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  const r = JSON.parse(out);
  assert.equal(r.ok, false, `expected unknown field rlm.foobar to be rejected`);
  assert.ok(
    r.errors.some(e => /additionalProperties|unexpected/i.test(e.message) && e.message.includes('foobar')),
    `expected additionalProperties error mentioning foobar; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects fewShotExamples=1 (locked to 0 for v1)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { fewShotExamples: 1 } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/fewShotExamples'),
    `expected error on fewShotExamples; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects contextTooLargeThresholdBytes=0 (min 1024)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ errors: { contextTooLargeThresholdBytes: 0 } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'errors/contextTooLargeThresholdBytes'),
    `expected error on contextTooLargeThresholdBytes; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects maxDepth=10 (over cap of 5)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { tree: { maxDepth: 10 } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/tree/maxDepth'),
    `expected error on maxDepth; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects override of audit.preferencePair.perCallOnly (BLOCK-10 const=true)', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { audit: { preferencePair: { perCallOnly: false } } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/preferencePair/perCallOnly'),
    `expected error on perCallOnly; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects verification.allowedMethods including invalid method', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { forwardedOptions: { verification: { allowedMethods: ['rm'] } } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path.includes('allowedMethods')),
    `expected error on allowedMethods; got: ${JSON.stringify(r.errors)}`,
  );
});

test('BLOCK-13: schema rejects preferencePair.leafComponentValue collision with root', (t) => {
  t.after(() => { clearV2Env(); });
  const r = validateYaml({ rlm: { audit: { preferencePair: { leafComponentValue: 'rlm' } } } });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.path === 'rlm/audit/preferencePair/leafComponentValue'),
    `expected error on leafComponentValue; got: ${JSON.stringify(r.errors)}`,
  );
});
