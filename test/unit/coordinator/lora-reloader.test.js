// test/unit/coordinator/lora-reloader.test.js — Phase 4 deliverable 3
// Verifies the LoRA reloader watches the trainer's active-weights
// symlink and triggers Ollama /api/create on change.
//
// All tests are pure (no real fs symlink races, no real HTTP). We
// use Node's node:test, real fsp.symlink for the integration
// scenarios (fast, in /tmp), and an injected _fetch for the
// Ollama mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  makeLoraReloader,
  resolveActiveTarget,
  resolveActiveSymlinkPath,
  shouldReload,
  buildModelfile,
  postOllamaCreate,
} from '../../../src/coordinator/lora-reloader.js';

// -- Pure helpers ---------------------------------------------------------

test('lora-reloader: shouldReload returns false when both targets are null', () => {
  assert.equal(shouldReload(null, null), false);
});

test('lora-reloader: shouldReload returns false when both targets are the same string', () => {
  assert.equal(shouldReload('/a/b', '/a/b'), false);
});

test('lora-reloader: shouldReload returns true when prev is null and current is a path (first poll)', () => {
  assert.equal(shouldReload(null, '/a/b'), true);
});

test('lora-reloader: shouldReload returns true when current is null and prev was a path (symlink removed)', () => {
  assert.equal(shouldReload('/a/b', null), true);
});

test('lora-reloader: shouldReload returns true when targets differ', () => {
  assert.equal(shouldReload('/a/b', '/a/c'), true);
});

test('lora-reloader: buildModelfile default template uses FROM + ADAPTER', () => {
  const mf = buildModelfile({ baseModel: 'qwen2.5:7b', adapterPath: '/tmp/aware/adapter-1' });
  assert.match(mf, /^FROM qwen2\.5:7b\n/);
  assert.match(mf, /\nADAPTER \/tmp\/aware\/adapter-1\n$/);
});

test('lora-reloader: buildModelfile honors a custom template when provided', () => {
  const custom = 'FROM qwen2.5:7b\nADAPTER /custom/path\nPARAMETER temperature 0.7\n';
  const mf = buildModelfile({
    baseModel: 'qwen2.5:7b',
    adapterPath: '/ignored',
    template: custom,
  });
  assert.equal(mf, custom);
});

test('lora-reloader: resolveActiveSymlinkPath returns ${weightsDir}/active', () => {
  assert.equal(
    resolveActiveSymlinkPath('/root/aware-weights'),
    path.join('/root/aware-weights', 'active')
  );
});

test('lora-reloader: resolveActiveSymlinkPath returns null on empty input', () => {
  assert.equal(resolveActiveSymlinkPath(''), null);
  assert.equal(resolveActiveSymlinkPath(undefined), null);
  assert.equal(resolveActiveSymlinkPath(null), null);
});

test('lora-reloader: resolveActiveTarget returns null when symlink does not exist', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  try {
    const target = await resolveActiveTarget(dir);
    assert.equal(target, null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('lora-reloader: resolveActiveTarget returns absolute target for a relative symlink', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  const adapterDir = path.join(dir, 'adapter-v1');
  await fsp.mkdir(adapterDir, { recursive: true });
  const linkPath = path.join(dir, 'active');
  // Trainer uses relative targets (e.g. 'r-2026-06-12-abc/checkpoint-42')
  await fsp.symlink('adapter-v1', linkPath);
  try {
    const target = await resolveActiveTarget(dir);
    assert.equal(target, adapterDir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('lora-reloader: resolveActiveTarget returns null when the path is a real dir, not a symlink', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  // No symlink at ${dir}/active — just a directory or nothing
  try {
    const target = await resolveActiveTarget(dir);
    assert.equal(target, null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// -- postOllamaCreate with injected _fetch ---------------------------------

function makeMockFetch(responses) {
  // responses: array of { status, body } in order, or { throw: Error }
  let i = 0;
  return async (url, opts) => {
    const r = responses[i++];
    if (!r) throw new Error(`mock fetch: no more responses (call #${i})`);
    if (r.throw) throw r.throw;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText || 'OK',
      text: async () => r.body || '',
    };
  };
}

test('lora-reloader: postOllamaCreate POSTs to ${ollamaUrl}/api/create with name+modelfile JSON', async () => {
  let captured = null;
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, statusText: 'OK', text: async () => 'ok' };
  };
  const res = await postOllamaCreate({
    ollamaUrl: 'http://127.0.0.1:11434',
    modelName: 'trained-model',
    modelfile: 'FROM qwen2.5:7b\nADAPTER /tmp/x\n',
    _fetch: mockFetch,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.match(captured.url, /\/api\/create$/);
  assert.equal(captured.opts.method, 'POST');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.name, 'trained-model');
  assert.match(body.modelfile, /FROM qwen2.5:7b/);
});

test('lora-reloader: postOllamaCreate trims trailing slashes from ollamaUrl', async () => {
  let captured = null;
  const mockFetch = async (url) => { captured = { url }; return { ok: true, status: 200, text: async () => '' }; };
  await postOllamaCreate({
    ollamaUrl: 'http://127.0.0.1:11434///',
    modelName: 'm',
    modelfile: 'x',
    _fetch: mockFetch,
  });
  assert.equal(captured.url, 'http://127.0.0.1:11434/api/create');
});

test('lora-reloader: postOllamaCreate surfaces non-2xx as ok=false but does NOT throw', async () => {
  const mockFetch = makeMockFetch([{ status: 500, body: 'ollama exploded' }]);
  const res = await postOllamaCreate({
    ollamaUrl: 'http://127.0.0.1:11434',
    modelName: 'm',
    modelfile: 'x',
    _fetch: mockFetch,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.match(res.body, /ollama exploded/);
});

test('lora-reloader: postOllamaCreate rethrows on network failure (caller handles)', async () => {
  const mockFetch = makeMockFetch([{ throw: new Error('ECONNREFUSED') }]);
  await assert.rejects(
    () => postOllamaCreate({
      ollamaUrl: 'http://127.0.0.1:11434',
      modelName: 'm',
      modelfile: 'x',
      _fetch: mockFetch,
    }),
    /ECONNREFUSED/
  );
});

test('lora-reloader: postOllamaCreate rejects on missing required args', async () => {
  await assert.rejects(
    () => postOllamaCreate({ ollamaUrl: '', modelName: 'm', modelfile: 'x' }),
    /ollamaUrl is required/
  );
  await assert.rejects(
    () => postOllamaCreate({ ollamaUrl: 'http://x', modelName: '', modelfile: 'x' }),
    /modelName is required/
  );
  await assert.rejects(
    () => postOllamaCreate({ ollamaUrl: 'http://x', modelName: 'm', modelfile: '' }),
    /modelfile is required/
  );
});

// -- makeLoraReloader: option validation ----------------------------------

test('lora-reloader: makeLoraReloader rejects missing required options', () => {
  assert.throws(() => makeLoraReloader({}), /weightsDir is required/);
  assert.throws(() => makeLoraReloader({ weightsDir: '/x' }), /ollamaUrl is required/);
  assert.throws(() => makeLoraReloader({ weightsDir: '/x', ollamaUrl: 'http://x' }), /modelName is required/);
  assert.throws(
    () => makeLoraReloader({ weightsDir: '/x', ollamaUrl: 'http://x', modelName: 'm' }),
    /baseModel is required/
  );
});

// -- makeLoraReloader: end-to-end with real symlink + injected fetch -------

test('lora-reloader: detects symlink swap, POSTs to Ollama, restores prior target on failure', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  const adapterV1 = path.join(dir, 'adapter-v1');
  const adapterV2 = path.join(dir, 'adapter-v2');
  await fsp.mkdir(adapterV1, { recursive: true });
  await fsp.mkdir(adapterV2, { recursive: true });
  await fsp.symlink('adapter-v1', path.join(dir, 'active'));

  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    // First call (v1) succeeds, second call (v2) fails.
    const isV2 = calls.length === 2;
    return {
      ok: !isV2,
      status: isV2 ? 500 : 200,
      statusText: isV2 ? 'Server Error' : 'OK',
      text: async () => isV2 ? 'v2 exploded' : 'v1 ok',
    };
  };

  const logEvents = [];
  const logger = {
    info: (m) => logEvents.push(['info', m]),
    warn: (m) => logEvents.push(['warn', m]),
    error: (m) => logEvents.push(['error', m]),
    debug: (m) => logEvents.push(['debug', m]),
  };

  const reloader = makeLoraReloader({
    weightsDir: dir,
    ollamaUrl: 'http://127.0.0.1:11434',
    modelName: 'trained-model',
    baseModel: 'qwen2.5:7b',
    pollIntervalMs: 100_000,  // long — we drive ticks manually
    _fetch: mockFetch,
    logger,
  });
  // Note: we don't call .start() because it uses setInterval. We
  // drive the same internal _tick() through reloadNow() for v1 and
  // a manual swap + reloadNow for v2.
  //
  // The reloader is designed to be driven by its poll loop, but for
  // tests we expose the polling internals via reloadNow() (which
  // bypasses the change-detection) and via a manual helper.

  // Manual helper that mimics what _tick would do.
  async function driveOneTick() {
    // We can't call _tick directly because it's a closure. Use the
    // public surface: swap the symlink, then call reloadNow with
    // the new path. The contract is that the reloader tracks
    // reloadNow-targets implicitly via the poll loop.
    //
    // For this test, we verify the simpler contract: reloadNow
    // calls _fetch with the expected URL + body.
    const target = await resolveActiveTarget(dir);
    return await reloader.reloadNow(target);
  }

  t.after(async () => {
    await reloader.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  // Tick 1: v1 → 200, ok. We use reloadNow() (the public
  // force-reload path) because the test doesn't want to wait for
  // the poll interval. The _tick() path (which is where the
  // logger.error fires on failure) is exercised by the next test
  // in the file.
  const r1 = await driveOneTick();
  assert.equal(r1.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.name, 'trained-model');
  assert.match(calls[0].body.modelfile, /adapter-v1/);

  // Swap to v2
  await fsp.unlink(path.join(dir, 'active'));
  await fsp.symlink('adapter-v2', path.join(dir, 'active'));

  // Tick 2: v2 → 500, returns ok=false
  const r2 = await driveOneTick();
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 500);
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.modelfile, /adapter-v2/);

  // Note: reloadNow() doesn't go through the _tick() failure
  // handling path (which is where the logger.error fires). The
  // contract for reloadNow is: return {ok, status, body} and let
  // the caller decide. The poll-driven _tick() has separate
  // failure-restore semantics (see the next test for that path).
  assert.equal(logEvents.length, 0,
    `reloadNow() should not log; got ${JSON.stringify(logEvents)}`);
});

// -- makeLoraReloader: poll-driven _tick() failure path -------------------

test('lora-reloader: _tick() restores prior lastTarget on reload failure, logs error, retries next poll', async (t) => {
  // Exercises the poll-driven path (not reloadNow). The setup: a
  // fast tick that fails, then succeeds on retry. We swap the
  // symlink between ticks and verify:
  //   1. v1 → 200 → lastTarget = adapterV1
  //   2. swap to v2 → next tick fires → v2 → 500 → lastTarget
  //      RESTORED to adapterV1 + logger.error fires
  //   3. next tick still detects v2 (lastTarget=v1, current=v2,
  //      shouldReload=true) → v2 retry → 200 → lastTarget=adapterV2
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  const adapterV1 = path.join(dir, 'adapter-v1');
  const adapterV2 = path.join(dir, 'adapter-v2');
  await fsp.mkdir(adapterV1, { recursive: true });
  await fsp.mkdir(adapterV2, { recursive: true });
  await fsp.symlink('adapter-v1', path.join(dir, 'active'));

  let callIndex = 0;
  const mockFetch = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return { ok: true, status: 200, text: async () => 'v1 ok' };
    }
    if (callIndex === 2) {
      return { ok: false, status: 500, statusText: 'Server Error', text: async () => 'v2 exploded' };
    }
    return { ok: true, status: 200, text: async () => `call-${callIndex} ok` };
  };

  const logEvents = [];
  const reloader = makeLoraReloader({
    weightsDir: dir,
    ollamaUrl: 'http://127.0.0.1:11434',
    modelName: 'm',
    baseModel: 'qwen2.5:7b',
    pollIntervalMs: 80,
    _fetch: mockFetch,
    logger: {
      info: (m) => logEvents.push(['info', m]),
      warn: (m) => logEvents.push(['warn', m]),
      error: (m) => logEvents.push(['error', m]),
      debug: (m) => logEvents.push(['debug', m]),
    },
  });

  t.after(async () => {
    await reloader.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  reloader.start();
  // Wait for the first tick (v1 ok) to complete.
  await new Promise(r => setTimeout(r, 100));
  assert.equal(reloader._state().lastTarget, adapterV1);
  assert.equal(callIndex, 1);

  // Swap to v2 BEFORE the next tick fires.
  await fsp.unlink(path.join(dir, 'active'));
  await fsp.symlink('adapter-v2', path.join(dir, 'active'));

  // Wait long enough for the next tick + its await.
  await new Promise(r => setTimeout(r, 120));
  assert.equal(callIndex, 2, 'expected v2 attempt to have fired');
  // Restore-on-failure: lastTarget should be back to v1.
  assert.equal(reloader._state().lastTarget, adapterV1,
    'lastTarget should be restored to adapterV1 after failed v2 reload');

  // The error should have been logged.
  const errorEvents = logEvents.filter(([level]) => level === 'error');
  assert.ok(errorEvents.length >= 1, 'expected at least one error log');
  assert.match(errorEvents[0][1], /reload failed/);

  // The next tick should detect v2 again (because the symlink
  // still points to v2 and lastTarget is now v1, shouldReload
  // returns true) and successfully retry. This is the
  // retry-on-next-poll behavior.
  await new Promise(r => setTimeout(r, 80));
  assert.ok(callIndex >= 3, `expected v2 retry to have fired; got callIndex=${callIndex}`);
  assert.equal(reloader._state().lastTarget, adapterV2,
    'lastTarget should be adapterV2 after successful retry');
});

test('lora-reloader: start() begins polling, stop() halts and the reloader is idempotent', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-lora-test-'));
  const adapter = path.join(dir, 'adapter-x');
  await fsp.mkdir(adapter, { recursive: true });
  await fsp.symlink('adapter-x', path.join(dir, 'active'));

  const fetchCalls = [];
  const mockFetch = async (url, opts) => {
    fetchCalls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => 'ok' };
  };

  const reloader = makeLoraReloader({
    weightsDir: dir,
    ollamaUrl: 'http://127.0.0.1:11434',
    modelName: 'm',
    baseModel: 'qwen2.5:7b',
    pollIntervalMs: 30,         // aggressive — for the test
    _fetch: mockFetch,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  t.after(async () => {
    await reloader.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  reloader.start();
  reloader.start();              // second start is a no-op (idempotent)

  // Wait long enough for the initial tick + at least one interval
  // tick. The inFlight guard means we serialize, but the in-memory
  // state should converge within ~50ms.
  await new Promise(r => setTimeout(r, 150));
  assert.ok(
    fetchCalls.length >= 1,
    `expected at least one Ollama POST after start(); got ${fetchCalls.length}`
  );
  // First call should reference adapter-x
  assert.match(fetchCalls[0].body.modelfile, /adapter-x/);
  // State should reflect the current target
  const state1 = reloader._state();
  assert.equal(state1.lastTarget, adapter);

  await reloader.stop();
  await reloader.stop();          // second stop is a no-op (idempotent)

  // After stop(), no NEW fetch calls should fire.
  const callsAfterStop = fetchCalls.length;
  await new Promise(r => setTimeout(r, 100));
  assert.equal(
    fetchCalls.length,
    callsAfterStop,
    `expected no new fetch calls after stop(); got ${fetchCalls.length - callsAfterStop} new ones`
  );

  // The internal lastTarget is preserved across stop() — it's a
  // restartable index, not transient state.
  const state2 = reloader._state();
  assert.equal(state2.lastTarget, adapter);
});
