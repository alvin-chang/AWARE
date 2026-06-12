// test/unit/trainer/modal-client.test.js
// Tests for src/trainer/modal-client.js. The mock SDK uses the
// REAL JS SDK method shapes (verified against modal@0.8.0's
// index.d.ts by venv-introspection in 6ff1cd2+R2):
//
//   - modal.ModalClient (class, no from_training_script anywhere)
//   - client.volumes.fromName(name, {createIfMissing: true})
//   - client.functions.fromName(appName, functionName)
//   - fn.spawn(args, kwargs) → FunctionCall
//   - call.functionCallId (the job id)
//   - call.get({timeoutMs: N}) — resolves on success, throws on failure
//
// The pre-flight smoke (bring-up 8e) does the same checks against
// the REAL modal@0.8.0 SDK, not a mock. Mocks with the wrong shape
// passed tests but broke in production (R1 bug at 6ff1cd2).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const MODAL_CLIENT_PATH = path.resolve(
  __dirname, '..', '..', '..', 'src', 'trainer', 'modal-client.js'
);

// -- Mock Modal SDK factory ------------------------------------------
// Mirrors the REAL JS SDK surface: ModalClient is the top-level
// class, with .volumes.fromName() and .functions.fromName().
// There is no `modal.Function.from_training_script` — verified.

function makeMockSdk({
  callId = 'fc-mock-1234',
  getResult = { ok: true, value: { status: 'completed' } },
  getThrows = null,
} = {}) {
  const fromNameCalls = [];
  const spawnCalls = [];
  const getCalls = [];

  const call = {
    functionCallId: callId,
    async get(params) {
      getCalls.push(params);
      if (getThrows) throw getThrows;
      return getResult.value;
    },
  };

  const fn = {
    async spawn(args, kwargs) {
      spawnCalls.push({ args, kwargs });
      return call;
    },
  };

  const client = {
    volumes: {
      async fromName(name, params) {
        fromNameCalls.push({ name, params });
        return { name, _id: 'vol-mock' };
      },
    },
    functions: {
      async fromName(appName, functionName) {
        fromNameCalls.push({ appName, functionName });
        return fn;
      },
    },
  };

  const sdk = {
    ModalClient: function MockModalClient() {
      return client;
    },
    // The real SDK also exports these as named classes; tests don't
    // use them directly but we mirror the shape for completeness.
    Function_: class {},
    Volume: class {},
    FunctionCall: class {},
  };

  return { sdk, spies: { fromNameCalls, spawnCalls, getCalls }, client, fn, call };
}

// -- Helper: write a fake SDK file that preflightModal can import

function writeFakeSdkFile(impl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-mock-'));
  const fakePath = path.join(tmpDir, 'fake-sdk.mjs');
  fs.writeFileSync(fakePath, impl, 'utf8');
  return { fakePath, tmpDir };
}

// -- preflightModal: missing tokens ----------------------------------

test('preflight: returns modal_tokens_missing when env unset', async () => {
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
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

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

test('preflight: returns modal_sdk_surface_incomplete when ModalClient missing', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  // Fake SDK that exports the wrong shape (Python-shaped: modal.Function
  // with from_training_script, no ModalClient class).
  const { fakePath, tmpDir } = writeFakeSdkFile(
    'export const Function = { from_training_script: () => {} };\n' +
    'export const Volume = { fromName: () => {} };\n'
  );

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: fakePath });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'modal_sdk_surface_incomplete');
    assert.match(r.detail, /ModalClient/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('preflight: returns modal_sdk_surface_incomplete when client lacks .volumes.fromName', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  // Fake SDK where ModalClient exists but the instance doesn't
  // expose .volumes. This catches a future SDK version that
  // breaks the surface.
  const { fakePath, tmpDir } = writeFakeSdkFile(
    'export class ModalClient { constructor() { return { functions: { fromName: () => {} } }; } }\n'
  );

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: fakePath });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'modal_sdk_surface_incomplete');
    assert.match(r.detail, /\.volumes\.fromName/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('preflight: returns ok=true with sdk reference on success', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  const { fakePath, tmpDir } = writeFakeSdkFile(
    'export class ModalClient { constructor() { return { volumes: { fromName: () => {} }, functions: { fromName: () => {} } }; } }\n'
  );

  try {
    const { preflightModal } = await import(MODAL_CLIENT_PATH);
    const r = await preflightModal({ sdkImport: fakePath });
    assert.equal(r.ok, true);
    assert.ok(r.sdk);
    assert.equal(typeof r.sdk.ModalClient, 'function');
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
//
// The mock uses the REAL JS SDK method shapes: ModalClient → client.
// volumes.fromName + client.functions.fromName(app, fn) + fn.spawn → FunctionCall

test('submit: full happy path — calls fromName, spawn, returns handle', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  const mock = makeMockSdk({ callId: 'fc-real-shape-1234' });

  // Create a real dataset file so the client can read its byte size.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-happy-'));
  const datasetPath = path.join(tmpDir, 'dataset.jsonl');
  fs.writeFileSync(datasetPath, '{"prompt":"x","chosen":"y","rejected":"z"}\n', 'utf8');

  try {
    const { makeModalClient } = await import(MODAL_CLIENT_PATH);
    // The mock uses the REAL JS SDK method shapes:
    //   client.functions.fromName(app, name) returns fn
    //   fn.spawn(args, kwargs) returns FunctionCall
    //   FunctionCall.functionCallId is the job id
    //   FunctionCall.get({timeoutMs}) resolves on success
    const fakeSdkPath = path.join(tmpDir, 'mock-sdk.mjs');
    fs.writeFileSync(
      fakeSdkPath,
      'export class ModalClient { constructor() { return { ' +
        'volumes: { fromName: () => ({}) }, ' +
        'functions: { fromName: (app, name) => { ' +
          'globalThis.__fromNameCalls = globalThis.__fromNameCalls || []; ' +
          'globalThis.__fromNameCalls.push({app, name}); ' +
          'return { spawn: async (args, kwargs) => { ' +
            'globalThis.__spawnCalls = globalThis.__spawnCalls || []; ' +
            'globalThis.__spawnCalls.push({args, kwargs}); ' +
            'return { functionCallId: "fc-real-shape-1234", get: async (p) => ({}) }; ' +
          '}}; ' +
        '} } ' +
      '}; } }\n',
      'utf8'
    );
    const c = makeModalClient({ sdkImport: fakeSdkPath });
    const handle = await c.submit({
      runId: 'run-test-1',
      datasetPath,
      config: {
        app_name: 'aware-trainer',
        function_name: 'train',
        gpu: { type: 'A100-80GB' },
        resources: { cpu_cores: 8, memory_mb: 32768 },
        timeout_seconds: 14400,
        modal_volume: { name: 'aware-training-data', mount_path: '/root/aware-data' },
        dpo_defaults: { beta: 0.1, learning_rate: 5e-6, epochs: 1, per_device_train_batch_size: 4 },
      },
    });

    assert.equal(handle.jobId, 'fc-real-shape-1234');
    assert.equal(handle.appName, 'aware-trainer');
    assert.equal(typeof handle.poll, 'function');
    assert.equal(typeof handle.getCheckpoint, 'function');

    // Verify the SDK was called with the right names
    const fromNameCalls = globalThis.__fromNameCalls || [];
    assert.equal(fromNameCalls.length, 1, 'client.functions.fromName called once');
    assert.equal(fromNameCalls[0].app, 'aware-trainer');
    assert.equal(fromNameCalls[0].name, 'train');

    // Verify spawn was called with positional args matching the
    // training script's signature: (run_id, dataset_path, config)
    const spawnCalls = globalThis.__spawnCalls || [];
    assert.equal(spawnCalls.length, 1, 'fn.spawn called once');
    assert.equal(spawnCalls[0].args[0], 'run-test-1');        // run_id
    assert.match(spawnCalls[0].args[1], /\/root\/aware-data\/datasets\/run-test-1\.jsonl/);
    assert.equal(spawnCalls[0].args[2].app_name, 'aware-trainer');

    // Cleanup globals
    delete globalThis.__fromNameCalls;
    delete globalThis.__spawnCalls;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.<redacted-credential-name>;
    delete process.env.<redacted-credential-name>;
  }
});

test('submit: poll translates modal success (resolved promise) → completed/exitCode=0', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-success-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-success-sdk.mjs');
  fs.writeFileSync(
    fakeSdkPath,
    'export class ModalClient { constructor() { return { ' +
      'volumes: { fromName: () => ({}) }, ' +
      'functions: { fromName: () => ({ spawn: async () => ({ ' +
        'functionCallId: "fc-success", ' +
        'get: async () => ({status: "completed"}) ' +
      '}) }) } ' +
    '}; } }\n',
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
      config: { app_name: 'aware-trainer', function_name: 'train', timeout_seconds: 100, modal_volume: { name: 'v', mount_path: '/m' } },
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

test('submit: poll translates modal failure (thrown) → failed/exitCode=1/exception as errorMessage', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-fail-'));
  const fakeSdkPath = path.join(tmpDir, 'fake-fail-sdk.mjs');
  fs.writeFileSync(
    fakeSdkPath,
    'export class ModalClient { constructor() { return { ' +
      'volumes: { fromName: () => ({}) }, ' +
      'functions: { fromName: () => ({ spawn: async () => ({ ' +
        'functionCallId: "fc-fail", ' +
        'get: async () => { throw new Error("boom"); } ' +
      '}) }) } ' +
    '}; } }\n',
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
      config: { app_name: 'aware-trainer', function_name: 'train', timeout_seconds: 100, modal_volume: { name: 'v', mount_path: '/m' } },
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

test('resolveInflight: returns null (R2 — no from_id in JS SDK)', async () => {
  process.env.<redacted-credential-name> = 'ak-test-token-id-1234567890';
  process.env.<redacted-credential-name> = 'as-test-token-secret-1234567890abcdef';
  const { resolveInflight } = await import(MODAL_CLIENT_PATH);
  const r = await resolveInflight('r1', 'fc-x');
  assert.equal(r, null);
  delete process.env.<redacted-credential-name>;
  delete process.env.<redacted-credential-name>;
});
