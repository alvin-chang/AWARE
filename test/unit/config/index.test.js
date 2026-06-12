// Tests for src/config/index.js — the centralized v2 configuration module.
//
// These tests run against a clean env to make assertions independent of
// whatever the host shell happens to have set. We snapshot process.env,
// mutate it as needed, and restore on teardown.

const test = require('node:test');
const assert = require('node:assert/strict');

// Each test starts with a known env. We clear every AWARE_* / coord /
// gateway / model / heavy-think / ollama var so the test isn't influenced
// by the developer's shell.
function clearV2Env() {
  for (const k of Object.keys(process.env)) {
    if (
      k === 'COORDINATOR_PORT' || k === 'COORDINATOR_HOST' ||
      k === 'COORDINATOR_URL' ||
      k === 'GATEWAY_PORT' || k === 'GATEWAY_HOST' ||
      k === 'AWARE_REQUEST_TIMEOUT_MS' || k === 'AWARE_REQUEST_COST_CAP_USD' ||
      k === 'AWARE_KILL_SWITCH' || k === 'AWARE_GATEWAY_KILL_SWITCH' ||
      k === 'AWARE_HEAVY_THINK_PATH' ||
      k === 'AWARE_MODE' || k === 'OLLAMA_URL' ||
      k === 'LLM_API_KEY' || k === 'MINIMAX_API_HOST'
    ) {
      delete process.env[k];
    }
  }
}

test.beforeEach(() => {
  clearV2Env();
});

test('config: defaults are sane', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.equal(config.coordinator.port, 8080);
  assert.equal(config.coordinator.host, '127.0.0.1');
  assert.equal(config.coordinator.requestTimeoutMs, 120_000);
  assert.equal(config.coordinator.requestCostCapUsd, 1.0);
  assert.equal(config.coordinator.killSwitch, false);

  assert.equal(config.gateway.port, 18080);
  assert.equal(config.gateway.host, '0.0.0.0');
  assert.equal(config.gateway.proxyTimeoutMs, 120_000);
  assert.equal(config.gateway.coordinatorUrl, 'http://coordinator:8080');
  assert.equal(config.gateway.killSwitch, false);

  assert.equal(config.model.mode, 'hybrid');
  assert.equal(config.model.minimaxKey, undefined);
  assert.equal(config.model.ollamaUrl, 'http://127.0.0.1:11434');
});

test('config: env overrides take effect', (t) => {
  process.env.COORDINATOR_PORT = '9100';
  process.env.COORDINATOR_HOST = '0.0.0.0';
  process.env.AWARE_REQUEST_TIMEOUT_MS = '5000';
  process.env.AWARE_REQUEST_COST_CAP_USD = '0.25';
  process.env.AWARE_KILL_SWITCH = '1';
  process.env.GATEWAY_PORT = '19090';
  process.env.GATEWAY_HOST = '127.0.0.1';
  process.env.GATEWAY_PROXY_TIMEOUT_MS = '30000';
  process.env.COORDINATOR_URL = 'http://upstream:9999';
  process.env.AWARE_GATEWAY_KILL_SWITCH = '1';
  process.env.AWARE_MODE = 'online';
  process.env.LLM_API_KEY='***';
  process.env.OLLAMA_URL = 'http://ollama:11434';

  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.equal(config.coordinator.port, 9100);
  assert.equal(config.coordinator.host, '0.0.0.0');
  assert.equal(config.coordinator.requestTimeoutMs, 5000);
  assert.equal(config.coordinator.requestCostCapUsd, 0.25);
  assert.equal(config.coordinator.killSwitch, true);
  assert.equal(config.gateway.port, 19090);
  assert.equal(config.gateway.host, '127.0.0.1');
  assert.equal(config.gateway.proxyTimeoutMs, 30000);
  assert.equal(config.gateway.coordinatorUrl, 'http://upstream:9999');
  assert.equal(config.gateway.killSwitch, true);
  assert.equal(config.model.mode, 'online');
  assert.equal(config.model.minimaxKey, '***');
  assert.equal(config.model.ollamaUrl, 'http://ollama:11434');
});

test('config: lazy reads see env mutations between accesses', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.equal(config.gateway.port, 18080);
  process.env.GATEWAY_PORT = '19999';
  assert.equal(config.gateway.port, 19999);
  process.env.GATEWAY_PORT = '0';
  assert.equal(config.gateway.port, 0);
});

test('config: kill-switch is bool, not just string "1"', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  process.env.AWARE_KILL_SWITCH = '1';
  assert.equal(config.coordinator.killSwitch, true);
  process.env.AWARE_KILL_SWITCH = 'true';
  assert.equal(config.coordinator.killSwitch, true);
  process.env.AWARE_KILL_SWITCH = 'yes';
  assert.equal(config.coordinator.killSwitch, true);
  process.env.AWARE_KILL_SWITCH = '0';
  assert.equal(config.coordinator.killSwitch, false);
  process.env.AWARE_KILL_SWITCH = 'no';
  assert.equal(config.coordinator.killSwitch, false);
  delete process.env.AWARE_KILL_SWITCH;
  assert.equal(config.coordinator.killSwitch, false);
});

test('config: validate() throws on mode=online without key', (t) => {
  process.env.AWARE_MODE = 'online';
  // no LLM_API_KEY
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.throws(() => config.validate(), /AWARE_MODE=online requires LLM_API_KEY/);
});

test('config: validate() throws on GATEWAY_PORT == COORDINATOR_PORT', (t) => {
  process.env.COORDINATOR_PORT = '8080';
  process.env.GATEWAY_PORT = '8080';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.throws(
    () => config.validate(),
    /GATEWAY_PORT .* must differ from COORDINATOR_PORT/
  );
});

test('config: validate() throws on non-numeric numeric env', (t) => {
  process.env.AWARE_REQUEST_TIMEOUT_MS = 'not-a-number';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.throws(() => config.validate(), /AWARE_REQUEST_TIMEOUT_MS=.*not a finite number/);
});

test('config: validate() throws on out-of-range numeric env', (t) => {
  process.env.GATEWAY_PORT = '99999';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.throws(() => config.validate(), /GATEWAY_PORT=99999 is out of range/);
});

test('config: validate() throws on unknown mode', (t) => {
  process.env.AWARE_MODE = 'warp-drive';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.throws(
    () => config.validate(),
    /AWARE_MODE="warp-drive" is not one of \[online, hybrid, offline\]/
  );
});

test('config: validate() passes with mode=hybrid (no key required)', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.doesNotThrow(() => config.validate());
});

test('config: validate() passes with mode=online + key', (t) => {
  process.env.AWARE_MODE = 'online';
  process.env.LLM_API_KEY = 'present';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.doesNotThrow(() => config.validate());
});

test('config: warnings() lists missing key for online-ish modes', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  // Default mode=hybrid, no key → should warn
  const w = config.warnings();
  assert.ok(w.some(s => s.includes('LLM_API_KEY is not set')));
});

test('config: warnings() is empty when configured', (t) => {
  process.env.AWARE_MODE = 'online';
  process.env.LLM_API_KEY = 'present';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.deepEqual(config.warnings(), []);
});

test('config: snapshot() redacts secrets', (t) => {
  process.env.LLM_API_KEY = 'PLACEHOLDER';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  const snap = config.snapshot();
  const json = JSON.stringify(snap);
  // The actual key value must never appear in the snapshot
  assert.ok(!json.includes('PLACEHOLDER'),
    'snapshot must not contain secret value');
  // But we should know the length so debug logs are useful
  assert.match(snap.model.minimaxKey, /length=11/);
});

test('config: snapshot() shape is stable', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  const snap = config.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), [
    'coordinator', 'gateway', 'heavyThink', 'model', 'warnings',
  ]);
  assert.deepEqual(Object.keys(snap.coordinator).sort(), [
    'host', 'killSwitch', 'port', 'requestCostCapUsd', 'requestTimeoutMs',
  ]);
  assert.deepEqual(Object.keys(snap.gateway).sort(), [
    'coordinatorUrl', 'host', 'killSwitch', 'port', 'proxyTimeoutMs',
  ]);
  assert.deepEqual(Object.keys(snap.model).sort(), [
    'minimaxHost', 'minimaxKey', 'mode', 'ollamaUrl',
  ]);
  assert.deepEqual(Object.keys(snap.heavyThink), ['path']);
});

test('config: heavy-think path defaults to dev-layout sibling', (t) => {
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  // The default resolves to /Users/alfie/src/heavy-think/src/index.js
  // (or wherever heavy-think lives on the dev host).
  assert.match(config.heavyThink.path, /heavy-think[\\\/]src[\\\/]index\.js$/);
});

test('config: heavy-think path honors env override', (t) => {
  process.env.AWARE_HEAVY_THINK_PATH = '/custom/path/heavy-think/src/index.js';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  assert.equal(config.heavyThink.path, '/custom/path/heavy-think/src/index.js');
});

test('config: 0 is a valid port (OS picks)', (t) => {
  process.env.GATEWAY_PORT = '0';
  const config = require('../../../src/config/index.cjs');
  t.after(() => { clearV2Env(); });

  // num() allows 0 because min=1 would reject it; port 0 is the OS-pick
  // convention. Validation should not throw.
  assert.equal(config.gateway.port, 0);
  assert.doesNotThrow(() => config.validate());
});
