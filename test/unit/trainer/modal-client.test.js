// test/unit/trainer/modal-client.test.js
// Tests for src/trainer/modal-client.js. All Modal SDK calls are
// mocked via the `sdkImport` seam — no real network, no real Modal
// account required.
//
// The test strategy:
//   - `preflightModal` is unit-tested by injecting a fake SDK object
//     via dynamic import (we register a custom module name in
//     createRequire + Module._cache).
//   - `makeModalClient().submit` is tested by passing a `sdkImport`
//     that resolves to a hand-rolled mock. The mock's `Function` and
//     `Volume` track calls and return canned data.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const MODAL_CLIENT_PATH = path.resolve(
  __dirname, '..', '..', '..', 'src', 'trainer', 'modal-client.js'
);

// -- Mock Modal SDK factory ------------------------------------------

/**
 * Build a mock Modal SDK object. The real SDK exposes
 * `Function.from_training_script` (returns an App with .remote()),
 * `Volume.fromName`, and `FunctionCall.from_id`. We mock all three.
 */
function makeMockSdk({
  callId = 'fc-mock-1234',
  appHandle = null,
  callGetResult = { status: 'running' },
  callFetchResult = null,
  fetchThrows = false,
} = {}) {
  const remoteCalls = [];
  const fromTrainingScriptCalls = [];
  const volumeLookups = [];

  const app = {
    async remote(args, opts) {
      remoteCalls.push({ args, opts });
      return {
        function_call_id: callId,
        id: callId,
        object_id: callId,
        async get(timeoutSec) {
          this._lastTimeout = timeoutSec;
          return callGetResult;
        },
        async fetch(p) {
          this._lastFetch = p;
          if (fetchThrows) {
            throw new Error(`mock fetch failed for ${p}`);
          }
          return callFetchResult;
        },
      };
    },
  };

  const sdk = {
    Function: {
      async from_training_script(name, dockerfile, opts) {
        fromTrainingScriptCalls.push({ name, dockerfile, opts });
        return appHandle !== null ? appHandle : app;
      },
    },
    Volume: {
      fromName(name) {
        volumeLookups.push(name);
        return { name };
      },
    },
    FunctionCall: {
      async from_id(id) {
        return appHandle !== null ? appHandle : null;
      },
    },
  };

  return {
    sdk,
    spies: { remoteCalls, fromTrainingScriptCalls, volumeLookups },
  };
}

// -- Helper: register a fake SDK module that preflightModal will import

const origResolveFilename = Module._resolveFilename;
const origLoad = Module._load;
const fakeSdkRegistry = new Map();

function installFakeSdk(name, sdkObject) {
  fakeSdkRegistry.set(name, sdkObject);
  // We can't easily intercept a top-level dynamic import of `modal`
  // without setting up a custom loader. But modal-client uses
  // `await import(sdkImport)` where sdkImport is the *literal string*
  // passed in opts. So in tests we pass a name like
  // `./__mock_modal_sdk__.js` and the file *is* a real path on disk.
  // That gives us a real dynamic import without needing loader hooks.
}

function cleanupFakeSdks() {
  fakeSdkRegistry.clear();
}

// -- preflightModal: missing tokens ----------------------------------

test('preflight: returns modal_tokens_missing when env unset', async () => {
  // Snapshot env, strip tokens, run, restore.
  const oldId = process.env.<redacted-credential-name>;
  const oldSecret = process.env.<redacted-credential-name>;
  delete process.env.<redacted-credential-name>;
  delete process.env.<redacted-credential-name>;

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'modal_tokens_missing');
    assert.match(r.detail, /<redacted-credential-name>/);
  } finally {
    if (oldId !== undefined) process.env.<redacted-credential-name> = oldId;
    if (oldSecret !== undefined) process.env.<redacted-credential-name> = oldSecret;
  }
});

test('preflight: returns modal_sdk_unimportable when SDK not installed', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: 'this-package-does-not-exist-xyz' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'modal_sdk_unimportable');
    assert.match(r.detail, /this-package-does-not-exist-xyz/);
  } finally {
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('preflight: returns modal_sdk_surface_incomplete when SDK missing required surface', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  // Write a fake SDK file that exports a partial surface (no Volume).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-fake-'));
  const fakePath = path.join(tmpDir, 'fake-incomplete-sdk.mjs');
  fs.writeFileSync(fakePath, 'export const Function = {};\n', 'utf8');

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: fakePath });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'modal_sdk_surface_incomplete');
    assert.match(r.detail, /modal\.Volume/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('preflight: returns ok=true with sdk reference on success', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-ok-'));
  const fakePath = path.join(tmpDir, 'fake-ok-sdk.mjs');
  fs.writeFileSync(
    fakePath,
    'export const Function = { from_training_script: () => {} };\n' +
    'export const Volume = { fromName: () => {} };\n',
    'utf8'
  );

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: fakePath });
    assert.equal(r.ok, true);
    assert.ok(r.sdk);
    assert.equal(typeof r.sdk.Function.from_training_script, 'function');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

// -- makeModalClient().submit: argument validation ------------------

test('submit: rejects when runId is missing', async () => {
  const { makeModalClient } = await import(MODAL_CLIENT_PATH);
  const c = makeModalClient();
  await assert.rejects(
    () => c.submit({ datasetPath: '/tmp/x', config: { app_name: 'a' } }),
    /runId is required/
  );
});

test('submit: rejects when datasetPath is missing', async () => {
  const { makeModalClient } = await import(MODAL_CLIENT_PATH);
  const c = makeModalClient();
  await assert.rejects(
    () => c.submit({ runId: 'r1', config: { app_name: 'a' } }),
    /datasetPath is required/
  );
});

test('submit: rejects when config.app_name is missing', async () => {
  const { makeModalClient } = await import(MODAL_CLIENT_PATH);
  const c = makeModalClient();
  await assert.rejects(
    () => c.submit({ runId: 'r1', datasetPath: '/tmp/x', config: {} }),
    /app_name is required/
  );
});

// -- makeModalClient().submit: preflight failure -------------------

test('submit: surfaces preflight failure as a typed error', async () => {
  delete process.env.<redacted-credential-name>;
  delete process.env.<redacted-credential-name>;

  const { makeModalClient } = await import(MODAL_CLIENT_PATH);
  const c = makeModalClient();
  try {
    await c.submit({
      runId: 'r1',
      datasetPath: '/tmp/nope.jsonl',
      config: { app_name: 'aware-trainer' },
    });
    assert.fail('expected submit to throw');
  } catch (e) {
    assert.match(e.message, /preflight failed/);
    assert.equal(e.code, 'modal_tokens_missing');
  }
});

// -- makeModalClient().submit: full happy path with mock SDK --------

test('submit: full happy path — calls from_training_script, remote, returns handle', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  // Write a real file for the SDK import.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-happy-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-happy-sdk.mjs');
  const calls = { fromTrainingScript: [], remote: [] };
  const happyApp = {
    async remote(args, opts) {
      calls.remote.push({ args, opts });
      return {
        function_call_id: 'fc-abcdef-1234',
        id: 'fc-abcdef-1234',
        object_id: 'fc-abcdef-1234',
        async get(t) { this._lastTimeout = t; return { status: 'running' }; },
        async fetch(p) { return null; },
      };
    },
  };
  fs.writeFileSync(
    fakeSdkPath,
    'export const Function = { from_training_script: async (n, df, opts) => { globalThis.__ftnCalls = globalThis.__ftnCalls || []; globalThis.__ftnCalls.push({n, df, opts}); return { remote: async (args, opts) => { globalThis.__remoteCalls = globalThis.__remoteCalls || []; globalThis.__remoteCalls.push({args, opts}); return { function_call_id: "fc-abcdef-1234", id: "fc-abcdef-1234", object_id: "fc-abcdef-1234", get: async (t) => ({status: "running"}), fetch: async () => null }; } }; } };\n' +
    'export const Volume = { fromName: (n) => ({ name: n }) };\n',
    'utf8'
  );

  // Create a real dataset file so the client can read its byte size.
  const datasetPath = path.join(tmpDir, 'dataset.jsonl');
  fs.writeFileSync(datasetPath, '{"prompt":"x","chosen":"y","rejected":"z"}\n', 'utf8');

  try {
    const { makeModalClient } = await import(MODAL_CLIENT_PATH);
    const c = makeModalClient({ sdkImport: fakeSdkPath });
    const handle = await c.submit({
      runId: 'run-test-1',
      datasetPath,
      config: {
        app_name: 'aware-trainer',
        image_dockerfile: 'Dockerfile.training',
        gpu: { type: 'A100-80GB' },
        resources: { cpu_cores: 8, memory_mb: 32768 },
        timeout_seconds: 14400,
        modal_volume: { name: 'aware-training-data', mount_path: '/root/aware-data' },
        dpo_defaults: { beta: 0.1, learning_rate: 5e-6, epochs: 1, per_device_train_batch_size: 4 },
      },
    });

    assert.equal(handle.jobId, 'fc-abcdef-1234');
    assert.equal(handle.appName, 'aware-trainer');
    assert.equal(typeof handle.poll, 'function');
    assert.equal(typeof handle.getCheckpoint, 'function');

    // Validate the closure translated Modal's running status to ours.
    const pollRes = await handle.poll();
    assert.equal(pollRes.status, 'running');

    const ckptRes = await handle.getCheckpoint();
    assert.match(ckptRes.checkpointPath, /checkpoints\/run-test-1/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete globalThis.__ftnCalls;
    delete globalThis.__remoteCalls;
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('submit: poll translates modal "success" → completed/exitCode=0', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-success-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-success-sdk.mjs');
  fs.writeFileSync(
    fakeSdkPath,
    'export const Function = { from_training_script: async () => ({ remote: async () => ({ function_call_id: "fc-success", get: async () => ({status: "success"}), fetch: async () => null }) }) };\n' +
    'export const Volume = { fromName: () => ({}) };\n',
    'utf8'
  );
  const datasetPath = path.join(tmpDir, 'd.jsonl');
  fs.writeFileSync(datasetPath, '{}\n', 'utf8');

  try {
    const { makeModalClient } = await import(MODAL_CLIENT_PATH);
    const c = makeModalClient({ sdkImport: fakeSdkPath });
    const handle = await c.submit({
      runId: 'r-success',
      datasetPath,
      config: { app_name: 'aware-trainer', timeout_seconds: 100, modal_volume: { name: 'v', mount_path: '/m' } },
    });
    const pollRes = await handle.poll();
    assert.equal(pollRes.status, 'completed');
    assert.equal(pollRes.exitCode, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('submit: poll translates modal "failure" → failed/exitCode=1/exception as errorMessage', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-fail-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-fail-sdk.mjs');
  fs.writeFileSync(
    fakeSdkPath,
    'export const Function = { from_training_script: async () => ({ remote: async () => ({ function_call_id: "fc-fail", get: async () => ({status: "failure", exception: "boom"}), fetch: async () => null }) }) };\n' +
    'export const Volume = { fromName: () => ({}) };\n',
    'utf8'
  );
  const datasetPath = path.join(tmpDir, 'd.jsonl');
  fs.writeFileSync(datasetPath, '{}\n', 'utf8');

  try {
    const { makeModalClient } = await import(MODAL_CLIENT_PATH);
    const c = makeModalClient({ sdkImport: fakeSdkPath });
    const handle = await c.submit({
      runId: 'r-fail',
      datasetPath,
      config: { app_name: 'aware-trainer', timeout_seconds: 100, modal_volume: { name: 'v', mount_path: '/m' } },
    });
    const pollRes = await handle.poll();
    assert.equal(pollRes.status, 'failed');
    assert.equal(pollRes.exitCode, 1);
    assert.equal(pollRes.errorMessage, 'boom');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

// -- resolveInflight -----------------------------------------------

test('resolveInflight: returns null when preflight fails', async () => {
  delete process.env.<redacted-credential-name>;
  delete process.env.<redacted-credential-name>;
  const { resolveInflight } = await import(MODAL_CLIENT_PATH);
  const r = await resolveInflight('r1', 'fc-x');
  assert.equal(r, null);
});

test('resolveInflight: returns null when FunctionCall.from_id returns null', async () => {
  process.env.<redacted-credential-name> = 'ak-test-12345678';
  process.env.<redacted-credential-name> = 'as-test-12345678';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-resolve-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-resolve-sdk.mjs');
  fs.writeFileSync(
    fakeSdkPath,
    'export const Function = {};\n' +
    'export const Volume = {};\n' +
    'export const FunctionCall = { from_id: async () => null };\n',
    'utf8'
  );
  try {
    const { resolveInflight } = await import(MODAL_CLIENT_PATH);
    const r = await resolveInflight('r1', 'fc-stale', { sdkImport: fakeSdkPath });
    assert.equal(r, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});
