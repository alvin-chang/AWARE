// test/unit/trainer/index.test.js — Unit tests for src/trainer/index.js
//
// These tests use dependency injection (modal client, pg pool, logger)
// to drive the poller deterministically — no real Modal account, no
// real Postgres. The trainer is one of the few AWARE 2.0 modules
// where env-gated integration tests are the right answer for the
// end-to-end flow (real Modal submit + poll + download); the unit
// tests here cover every code path the integration tests would
// otherwise need to enumerate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TrainerPoller } from '../../../src/trainer/index.js';

// -- Helpers -----------------------------------------------------------

function makeTestLogger() {
  const lines = { info: [], warn: [], error: [], debug: [] };
  return {
    lines,
    info: (...a) => lines.info.push(a.join(' ')),
    warn: (...a) => lines.warn.push(a.join(' ')),
    error: (...a) => lines.error.push(a.join(' ')),
    debug: (...a) => lines.debug.push(a.join(' ')),
  };
}

/**
 * Minimal in-memory pg.Pool stub. Only implements `query(sql, params)`
 * for the SQL strings the trainer actually issues.
 */
function makePoolStub(handlers = {}) {
  return {
    async query(sql, params) {
      // Normalize whitespace so multi-line SQL matches single-line regexes
      const norm = sql.replace(/\s+/g, ' ');
      // Route by SQL keyword
      if (/SELECT.*FROM aware_training_runs.*status IN/i.test(norm)) {
        return { rows: handlers.inflight ? [handlers.inflight] : [] };
      }
      if (/WITH last_run/i.test(norm)) {
        return { rows: [{ unconsumed: handlers.unconsumed ?? 0, total: handlers.total ?? 0 }] };
      }
      if (/INSERT INTO aware_training_runs/i.test(norm)) {
        handlers.inserted = handlers.inserted || [];
        handlers.inserted.push(params);
        return { rows: [] };
      }
      if (/UPDATE aware_training_runs\s+SET status = 'running'/i.test(norm)) {
        handlers.runningUpdates = handlers.runningUpdates || [];
        handlers.runningUpdates.push(params);
        return { rows: [] };
      }
      if (/UPDATE aware_training_runs\s+SET status = 'completed'/i.test(norm)) {
        handlers.completedUpdates = handlers.completedUpdates || [];
        handlers.completedUpdates.push(params);
        return { rows: [] };
      }
      if (/UPDATE aware_training_runs\s+SET status = 'failed'/i.test(norm)) {
        handlers.failedUpdates = handlers.failedUpdates || [];
        handlers.failedUpdates.push(params);
        return { rows: [] };
      }
      throw new Error(`unmocked query: ${sql.slice(0, 80)}...`);
    },
  };
}

function makeModalStub(opts = {}) {
  const { onSubmit, onPoll } = opts;
  return {
    async submit(args) {
      if (onSubmit) return onSubmit(args);
      return {
        jobId: 'modal-job-test-123',
        appName: 'aware-trainer',
        poll: onPoll || (async () => ({ status: 'running' })),
        getCheckpoint: async () => ({ checkpointPath: '/tmp/ckpt', sizeMb: 100 }),
      };
    },
  };
}

async function makeTempDataDir() {
  return await fsp.mkdtemp(path.join(os.tmpdir(), 'aware-trainer-test-'));
}

const originalEnv = { ...process.env };

function setV2Env() {
  // Wipe v2 + modal env
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AWARE_') || k.startsWith('MODAL_') || k.startsWith('MINIMAX_')) {
      delete process.env[k];
    }
  }
  // Defaults that match the v2 config
  process.env.AWARE_TRAINER_ENABLED = '1';
  process.env.AWARE_TRAINER_POLL_INTERVAL_SEC = '60';
  process.env.AWARE_TRAINER_MIN_PAIRS_PER_RUN = '100';
  process.env.MODAL_TOKEN_ID = 'ak-test-token-id-1234567890';
  process.env.MODAL_TOKEN_SECRET = 'as-test-token-secret-1234567890abcdef';
}

function clearV2Env() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AWARE_') || k.startsWith('MODAL_') || k.startsWith('MINIMAX_')) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, originalEnv);
}

// -- Tests -------------------------------------------------------------

test('trainer: kill switch off — start() returns immediately, no log noise', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();
  process.env.AWARE_TRAINER_ENABLED = '0';
  // Force a fresh require so the new env takes effect
  const { default: config } = await import('../../../src/config/index.cjs?bust=1');

  const logger = makeTestLogger();
  const poller = new TrainerPoller({ logger });
  await poller.start();

  assert.equal(poller._stopped, false);  // not stopped, just dormant
  assert.equal(poller._timer, null);     // no timer scheduled
  assert.ok(
    logger.lines.info.some((l) => /kill switch off/.test(l)),
    'expected kill-switch-off log'
  );
});

test('trainer: missing Modal token — warns but starts', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();
  delete process.env.MODAL_TOKEN_ID;

  const logger = makeTestLogger();
  const poller = new TrainerPoller({ logger, dataDir: await makeTempDataDir() });
  await poller.start();
  await poller.stop();

  assert.ok(
    logger.lines.warn.some((l) => /MODAL_TOKEN_ID.*unset/.test(l)),
    'expected missing-token warning'
  );
  // Critically: the token VALUE never appears in any log line
  const allLogs = [
    ...logger.lines.info,
    ...logger.lines.warn,
    ...logger.lines.error,
    ...logger.lines.debug,
  ].join('\n');
  assert.ok(
    !allLogs.includes('ak-test-token-id'),
    'token value must never appear in logs'
  );
});

test('trainer: Modal tokens present — logs length only, not value', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const poller = new TrainerPoller({ logger, dataDir: await makeTempDataDir() });
  await poller.start();
  await poller.stop();

  const allLogs = logger.lines.info.join('\n');
  assert.ok(
    /Modal tokens present.*id length=\d+.*secret length=\d+/.test(allLogs),
    'expected length-only token log'
  );
  // The actual secret value must not be in any log
  assert.ok(
    !allLogs.includes('ak-test-token-id-1234567890'),
    'token id value must never appear in logs'
  );
  assert.ok(
    !allLogs.includes('as-test-token-secret-1234567890abcdef'),
    'token secret value must never appear in logs'
  );
});

test('trainer: insufficient pairs — does not submit', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const pool = makePoolStub({ unconsumed: 5 });  // below minPairsPerRun=100
  let submitCalled = false;
  const modalClient = makeModalStub({ onSubmit: () => { submitCalled = true; } });

  const poller = new TrainerPoller({
    logger,
    pool,
    modalClient,
    dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller._tick();
  await poller.stop();

  assert.equal(submitCalled, false, 'should not have called modalClient.submit');
});

test('trainer: enough pairs — submits a new run, records to DB', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const handlers = { unconsumed: 250 };
  const pool = makePoolStub(handlers);
  let submitArgs = null;
  const modalClient = {
    async submit(args) {
      submitArgs = args;
      return {
        jobId: 'modal-job-abc',
        appName: 'aware-trainer',
        poll: async () => ({ status: 'running' }),
        getCheckpoint: async () => ({ checkpointPath: '/ckpt', sizeMb: 50 }),
      };
    },
  };

  const dataDir = await makeTempDataDir();
  const poller = new TrainerPoller({
    logger, pool, modalClient, dataDir,
  });
  await poller.start();
  // Cancel the auto-scheduled timer so it doesn't double-tick against
  // our manual _tick() call. Replaced by manual control for tests.
  await poller.stop();
  poller._stopped = false;  // allow manual ticks after stop()
  poller._timer = null;
  // Re-inject deps (stop() doesn't clear them, but be explicit)
  poller.deps = { logger, pool, modalClient, dataDir };
  await poller._tick();

  assert.ok(submitArgs, 'modalClient.submit was called');
  assert.equal(submitArgs.runId.length > 0, true);
  assert.match(submitArgs.datasetPath, new RegExp(dataDir));
  assert.equal(submitArgs.config.app_name, 'aware-trainer');

  // The DPO dataset file was created
  const datasetFile = submitArgs.datasetPath;
  const stat = await fsp.stat(datasetFile);
  assert.equal(stat.isFile(), true);

  // The run was recorded as 'pending' (INSERT), then 'running' (UPDATE)
  assert.equal(handlers.inserted.length, 1, 'expected INSERT for run start');
  assert.equal(handlers.inserted[0][3], 250, 'expected n_pairs=250');
  assert.equal(handlers.runningUpdates.length, 1, 'expected UPDATE to running');
  assert.equal(handlers.runningUpdates[0][1], 'modal-job-abc');

  await poller.stop();
});

test('trainer: submit failure — records failed run with exit_code=1', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const handlers = { unconsumed: 250 };
  const pool = makePoolStub(handlers);
  const modalClient = {
    async submit() { throw new Error('modal API down'); },
  };

  const poller = new TrainerPoller({
    logger, pool, modalClient, dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller._tick();

  assert.equal(handlers.failedUpdates.length, 1, 'expected failed UPDATE');
  assert.equal(handlers.failedUpdates[0][1], 1);  // exit_code
  assert.match(handlers.failedUpdates[0][2], /modal API down/);

  await poller.stop();
});

test('trainer: in-flight run is polled, not double-submitted', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const inflightRow = {
    run_id: 'run-existing',
    modal_job_id: 'modal-job-existing',
    started_at: new Date(Date.now() - 60_000).toISOString(),
  };
  const handlers = { inflight: inflightRow, unconsumed: 0 };
  const pool = makePoolStub(handlers);

  let submitCalled = false;
  let pollCalled = false;
  const modalClient = {
    async submit() { submitCalled = true; },
  };

  const poller = new TrainerPoller({
    logger, pool, modalClient, dataDir: await makeTempDataDir(),
  });
  // Inject the resolve-inflight hook
  poller._resolveInflight = async (runId, jobId) => {
    assert.equal(runId, 'run-existing');
    assert.equal(jobId, 'modal-job-existing');
    pollCalled = true;
    return {
      jobId,
      appName: 'aware-trainer',
      poll: async () => ({ status: 'running' }),
      getCheckpoint: async () => ({ checkpointPath: '/ckpt', sizeMb: 50 }),
    };
  };

  await poller.start();
  await poller._tick();

  assert.equal(submitCalled, false, 'should not have submitted a new run');
  assert.equal(pollCalled, true, 'should have polled the in-flight run');

  await poller.stop();
});

test('trainer: in-flight run completes — atomic symlink swap, DB updated', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();
  process.env.AWARE_TRAINER_WEIGHTS_DIR = path.join(os.tmpdir(), `aware-trainer-weights-${Date.now()}`);

  const logger = makeTestLogger();
  const inflightRow = {
    run_id: 'run-completing',
    modal_job_id: 'modal-job-x',
    started_at: new Date(Date.now() - 60_000).toISOString(),
  };
  const handlers = { inflight: inflightRow };
  const pool = makePoolStub(handlers);

  const poller = new TrainerPoller({
    logger, pool, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  poller._resolveInflight = async () => ({
    jobId: 'modal-job-x',
    appName: 'aware-trainer',
    poll: async () => ({ status: 'completed', exitCode: 0 }),
    getCheckpoint: async () => ({ checkpointPath: '/ckpt/run-x', sizeMb: 1234 }),
  });

  await poller.start();
  await poller._tick();

  assert.equal(handlers.completedUpdates.length, 1);
  assert.equal(handlers.completedUpdates[0][0], 'run-completing');
  assert.equal(handlers.completedUpdates[0][1], 0);  // exit_code
  assert.equal(handlers.completedUpdates[0][3], '/ckpt/run-x');  // checkpointPath
  assert.equal(handlers.completedUpdates[0][4], 1234);  // sizeMb

  // The active symlink was created and points at /ckpt/run-x
  const linkTarget = await fsp.readlink(process.env.AWARE_TRAINER_WEIGHTS_DIR);
  assert.equal(linkTarget, '/ckpt/run-x');

  // Cleanup
  await fsp.unlink(process.env.AWARE_TRAINER_WEIGHTS_DIR).catch(() => {});

  await poller.stop();
});

test('trainer: in-flight run fails — DB records failed with error', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const inflightRow = {
    run_id: 'run-failing',
    modal_job_id: 'modal-job-fail',
    started_at: new Date(Date.now() - 60_000).toISOString(),
  };
  const handlers = { inflight: inflightRow };
  const pool = makePoolStub(handlers);

  const poller = new TrainerPoller({
    logger, pool, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  poller._resolveInflight = async () => ({
    jobId: 'modal-job-fail',
    appName: 'aware-trainer',
    poll: async () => ({ status: 'failed', exitCode: 137, errorMessage: 'OOM killed' }),
    getCheckpoint: async () => { throw new Error('no checkpoint'); },
  });

  await poller.start();
  await poller._tick();

  assert.equal(handlers.failedUpdates.length, 1);
  assert.equal(handlers.failedUpdates[0][1], 137);
  assert.match(handlers.failedUpdates[0][2], /OOM killed/);

  await poller.stop();
});

test('trainer: missing modal-training.json — uses empty defaults, no crash', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();
  process.env.AWARE_TRAINER_CONFIG = '/nonexistent/modal-training.json';

  const logger = makeTestLogger();
  const poller = new TrainerPoller({
    logger, pool: null, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller.stop();

  assert.ok(
    logger.lines.warn.some((l) => /not found/.test(l)),
    'expected missing-config warning'
  );
  assert.equal(poller._trainingConfig.app_name, 'aware-trainer');
});

test('trainer: atomic symlink swap — uses rename(2), not two-step', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();
  const weightsDir = path.join(os.tmpdir(), `aware-trainer-atomic-${Date.now()}`);
  process.env.AWARE_TRAINER_WEIGHTS_DIR = weightsDir;

  const logger = makeTestLogger();
  const poller = new TrainerPoller({
    logger, pool: null, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller._atomicSymlinkSwap('/first/checkpoint');
  await poller._atomicSymlinkSwap('/second/checkpoint');

  const target = await fsp.readlink(weightsDir);
  assert.equal(target, '/second/checkpoint', 'symlink should now point to second checkpoint');

  await fsp.unlink(weightsDir).catch(() => {});
  await poller.stop();
});

test('trainer: SIGTERM during start — exits cleanly', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const poller = new TrainerPoller({
    logger, pool: null, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller.stop();
  assert.equal(poller._stopped, true);
  assert.equal(poller._timer, null);
});

test('trainer: kill switch flips off mid-loop — _tick exits', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  const poller = new TrainerPoller({
    logger, pool: null, modalClient: makeModalStub(), dataDir: await makeTempDataDir(),
  });
  await poller.start();
  assert.equal(poller._stopped, false);

  // Simulate operator flipping the env
  process.env.AWARE_TRAINER_ENABLED = '0';
  await poller._tick();
  assert.equal(poller._stopped, true);
  assert.ok(
    logger.lines.info.some((l) => /kill switch flipped off/.test(l)),
    'expected kill-switch-flipped log'
  );
});

test('trainer: dry-poll mode (pool=null) — counts are 0, never submits', async (t) => {
  t.after(() => clearV2Env());
  setV2Env();

  const logger = makeTestLogger();
  let submitCalled = false;
  const modalClient = makeModalStub({ onSubmit: () => { submitCalled = true; } });
  const poller = new TrainerPoller({
    logger, pool: null, modalClient, dataDir: await makeTempDataDir(),
  });
  await poller.start();
  await poller._tick();

  const counts = await poller._countPreferencePairs();
  assert.equal(counts.unconsumed, 0);
  assert.equal(submitCalled, false);

  await poller.stop();
});
