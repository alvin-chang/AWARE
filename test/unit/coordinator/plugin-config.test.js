// test/unit/coordinator/plugin-config.test.js
//
// Unit tests for the pluginConfig K resolver (ADR (internal) plugin-local
// config surface). These tests pin down the K priority order and
// the validation semantics so a future change to either has to
// update a test, not the spec.
//
// Per ADR (internal), the wire format is:
//   {
//     defaultK?: number,         // 1..16
//     autoEnable?: boolean,
//     agentDefaults?: { enabled?: boolean, K?: number }
//   }
//
// The K resolution priority (highest first):
//   1. explicit K (caller passed it)
//   2. pluginConfig.agentDefaults.K (only when agentDefaults.enabled === true)
//   3. pluginConfig.defaultK
//   4. defaultKForTaskType(taskType)  — rl-pipeline's per-task-type table
//
// The validator is strict on shape and silent on the request path —
// a bad pluginConfig returns ok:false but the coordinator still
// processes the call with no pluginConfig. This is so a misbehaving
// caller cannot break the request path; the validation result is
// echoed in the envelope for observability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveKFromPluginConfig,
  validatePluginConfig,
  sanitizePluginConfig,
  K_PLUGIN_CONFIG_VERSION,
  defaultKForTaskType,
} from '../../../src/coordinator/plugin-config.js';

// === sanitizePluginConfig ===

test('sanitize: returns null for null/undefined input', () => {
  assert.equal(sanitizePluginConfig(null), null);
  assert.equal(sanitizePluginConfig(undefined), null);
});

test('sanitize: returns null for non-object input', () => {
  assert.equal(sanitizePluginConfig('hello'), null);
  assert.equal(sanitizePluginConfig(42), null);
  assert.equal(sanitizePluginConfig(true), null);
});

test('sanitize: returns null for arrays (callers sometimes send an array by mistake)', () => {
  assert.equal(sanitizePluginConfig([]), null);
  assert.equal(sanitizePluginConfig([1, 2, 3]), null);
});

test('sanitize: keeps a well-formed object', () => {
  const out = sanitizePluginConfig({
    defaultK: 4,
    autoEnable: false,
    agentDefaults: { enabled: true, K: 6 },
  });
  assert.deepEqual(out, {
    defaultK: 4,
    autoEnable: false,
    agentDefaults: { enabled: true, K: 6 },
  });
});

test('sanitize: drops unknown keys', () => {
  const out = sanitizePluginConfig({
    defaultK: 4,
    someUnknownKey: 'nope',
    anotherUnknown: { nested: true },
  });
  assert.deepEqual(out, { defaultK: 4 });
});

test('sanitize: drops out-of-range K (must be 1..16)', () => {
  assert.equal(sanitizePluginConfig({ defaultK: 0 }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: -1 }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: 17 }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: 1.5 }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: '4' }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: null }).defaultK, undefined);
  assert.equal(sanitizePluginConfig({ defaultK: 4 }).defaultK, 4);
});

test('sanitize: agentDefaults block is dropped when all its keys are invalid', () => {
  const out = sanitizePluginConfig({
    defaultK: 4,
    agentDefaults: { enabled: 'yes', K: 'four' },
  });
  assert.equal(out.agentDefaults, undefined);
  assert.equal(out.defaultK, 4);
});

test('sanitize: agentDefaults block is kept when at least one key survives', () => {
  const out = sanitizePluginConfig({
    agentDefaults: { enabled: true, K: 'four' },
  });
  assert.deepEqual(out.agentDefaults, { enabled: true });
});

// === validatePluginConfig ===

test('validate: null/undefined input is ok with value=null', () => {
  assert.deepEqual(validatePluginConfig(null), { ok: true, value: null });
  assert.deepEqual(validatePluginConfig(undefined), { ok: true, value: null });
});

test('validate: empty object is ok with value={}', () => {
  const r = validatePluginConfig({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {});
});

test('validate: array input is not ok', () => {
  const r = validatePluginConfig([]);
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.ok(Array.isArray(r.errors));
  assert.match(r.errors[0], /array/);
});

test('validate: non-object input is not ok', () => {
  const r = validatePluginConfig('hello');
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.match(r.errors[0], /object/);
});

test('validate: object with only unknown keys is not ok (caller probably has wrong schema)', () => {
  const r = validatePluginConfig({ unknown1: 1, unknown2: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.ok(r.errors);
  assert.match(r.errors[0], /no recognized keys/);
});

test('validate: object with at least one known key is ok (with sanitized value)', () => {
  const r = validatePluginConfig({ defaultK: 4, mystery: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { defaultK: 4 });
});

test('K_PLUGIN_CONFIG_VERSION is a positive integer (callers can check this for backwards-compat)', () => {
  assert.equal(typeof K_PLUGIN_CONFIG_VERSION, 'number');
  assert.ok(Number.isInteger(K_PLUGIN_CONFIG_VERSION));
  assert.ok(K_PLUGIN_CONFIG_VERSION >= 1);
});

// === resolveKFromPluginConfig ===

test('resolveK: explicit K wins over pluginConfig and taskType', () => {
  const r = resolveKFromPluginConfig({
    explicitK: 7,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: true, K: 6 } },
    taskType: 'simple',
  });
  assert.deepEqual(r, { K: 7, source: 'explicit' });
});

test('resolveK: explicit K is ignored when out of range (fall through)', () => {
  // 0, -1, 17, NaN, "4" all fall through to pluginConfig/taskType
  const cases = [0, -1, 17, NaN, '4', null, undefined];
  for (const bad of cases) {
    const r = resolveKFromPluginConfig({
      explicitK: bad,
      pluginConfig: { defaultK: 5 },
      taskType: 'simple',
    });
    assert.equal(r.K, 5, `expected fallback to pluginConfig.defaultK=5 for explicitK=${JSON.stringify(bad)}, got ${r.K}`);
    assert.equal(r.source, 'pluginDefault');
  }
});

test('resolveK: agentDefaults.K wins over pluginConfig.defaultK when agentDefaults.enabled', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: true, K: 8 } },
    taskType: 'simple',
  });
  assert.equal(r.K, 8);
  assert.equal(r.source, 'agentDefaults');
});

test('resolveK: agentDefaults.K is ignored when agentDefaults.enabled is false', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: false, K: 8 } },
    taskType: 'simple',
  });
  assert.equal(r.K, 4);
  assert.equal(r.source, 'pluginDefault');
});

test('resolveK: agentDefaults without K falls through to defaultK', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: true } },
    taskType: 'simple',
  });
  assert.equal(r.K, 4);
  assert.equal(r.source, 'pluginDefault');
});

test('resolveK: pluginConfig.defaultK wins over taskType', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 6 },
    taskType: 'simple',  // simple default is 2
  });
  assert.equal(r.K, 6);
  assert.equal(r.source, 'pluginDefault');
});

test('resolveK: null pluginConfig falls through to defaultKForTaskType', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: null,
    taskType: 'simple',
  });
  assert.equal(r.K, defaultKForTaskType('simple'));
  assert.equal(r.source, 'taskType');
});

test('resolveK: empty pluginConfig falls through to defaultKForTaskType', () => {
  const r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: {},
    taskType: 'financial',
  });
  assert.equal(r.K, defaultKForTaskType('financial'));
  assert.equal(r.source, 'taskType');
});

test('resolveK: per-task-type fallback uses rl-pipeline K_CONFIGS', () => {
  // Sanity check: the table is what we expect. If rl-pipeline's
  // K_CONFIGS ever changes, this test surfaces it.
  assert.equal(defaultKForTaskType('simple'), 2);
  assert.equal(defaultKForTaskType('standard'), 4);
  assert.equal(defaultKForTaskType('security'), 6);
  assert.equal(defaultKForTaskType('financial'), 6);
  assert.equal(defaultKForTaskType('creative'), 3);
  // Unknown task type → 'standard' fallback.
  assert.equal(defaultKForTaskType('made-up'), defaultKForTaskType('standard'));
});

test('resolveK: end-to-end priority demo (the spec in one test)', () => {
  // All four sources present; explicit wins.
  let r = resolveKFromPluginConfig({
    explicitK: 5,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: true, K: 6 } },
    taskType: 'security',  // 6 by default
  });
  assert.equal(r.K, 5);
  assert.equal(r.source, 'explicit');

  // Drop explicit, agentDefaults wins.
  r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: true, K: 6 } },
    taskType: 'security',
  });
  assert.equal(r.K, 6);
  assert.equal(r.source, 'agentDefaults');

  // Disable agentDefaults; defaultK wins.
  r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: { defaultK: 4, agentDefaults: { enabled: false, K: 6 } },
    taskType: 'security',
  });
  assert.equal(r.K, 4);
  assert.equal(r.source, 'pluginDefault');

  // Drop defaultK; taskType wins.
  r = resolveKFromPluginConfig({
    explicitK: undefined,
    pluginConfig: {},
    taskType: 'security',
  });
  assert.equal(r.K, 6);
  assert.equal(r.source, 'taskType');
});
