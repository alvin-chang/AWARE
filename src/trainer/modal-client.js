// src/trainer/modal-client.js — Modal SDK wrapper for the AWARE trainer
// (Phase 3 R2, after the from_training_script bug fix at 6ff1cd2).
//
// This file implements the ModalClient interface that
// src/trainer/index.js consumes:
//
//   {
//     submit({runId, datasetPath, config}) → Promise<ModalJobHandle>
//   }
//
// where ModalJobHandle is:
//
//   {
//     jobId: string,
//     appName: string,
//     poll() → Promise<{status, exitCode?, errorMessage?}>,
//     getCheckpoint() → Promise<{checkpointPath, sizeMb}>,
//   }
//
// RUNTIME MODEL (post-R2)
// =======================
// The Modal JS SDK (modal@0.8.0) does NOT expose a
// `modal.Function.from_training_script(path)` idiom — that exists
// only in the Python SDK and even there, only in older versions.
// The real JS SDK workflow is:
//
//   1. Operator runs `modal deploy training/run.py` ONCE. This
//      registers the App "aware-trainer" (or whatever
//      config.modal_training.json's app_name says) with Modal.
//      The training script is decorated with @app.function()
//      and exposes a function with a known name (default: "train").
//      The deploy step costs $0 in GPU credit — it just pushes
//      the image to Modal's registry.
//
//   2. The poller (this code) does:
//
//        const client = new ModalClient();
//        const fn = await client.functions.fromName("aware-trainer", "train");
//        const call = await fn.spawn([runId, datasetPath, config]);
//        const result = await call.get({timeoutMs: 300_000});
//
//   3. The training script writes its checkpoint to a Modal Volume
//      (config.modal_volume.name). The poller polls for completion
//      and then does the atomic symlink swap on the local
//      AWARE_TRAINER_WEIGHTS_DIR.
//
// SECURITY MODEL
// ==============
// - The Modal SDK reads its credentials from environment variables
//   (MODAL_TOKEN_ID, MODAL_TOKEN_SECRET) when the ModalClient is
//   constructed. We never log, persist, or echo those values.
// - The SDK is loaded lazily via dynamic `import()`. The trainer can
//   boot on machines where the SDK is not installed (CI, dev laptops
//   without Modal access) — `submit` only throws if it's actually
//   called.
// - The poller index.js already gates `submit` behind a kill switch
//   (AWARE_TRAINER_ENABLED) and a token-presence check. This client
//   adds a third layer: a synchronous preflight that returns a
//   structured `{ok: false, reason}` if the SDK can't be loaded or
//   the expected surface is missing.
//
// NOT A FULL MODAL WRAPPER
// ========================
// This client only does the two operations the trainer needs:
// (1) submit a call to a pre-deployed Modal function, (2) poll that
// call to completion. It does NOT deploy the App (operator action)
// or manage Volume lifecycles (Modal handles those).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Preflight check: is the Modal SDK loadable + does it expose the
 * surface we depend on? Returns {ok: true, sdk} on success,
 * {ok: false, reason, detail} on failure. Never throws.
 *
 * @param {Object} [opts]
 * @param {string} [opts.sdkImport] — override the import path
 *   (used by tests to inject a mock SDK).
 * @returns {Promise<{ok: boolean, sdk?: object, reason?: string, detail?: string}>}
 */
export async function preflightModal(opts = {}) {
  const sdkImportPath = opts.sdkImport || 'modal';

  // 1. Token presence. The poller already checks this at boot, but we
  //    re-check here because `submit` could be called by a manually
  //    driven test that skipped `start()`.
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
    return {
      ok: false,
      reason: 'modal_tokens_missing',
      detail: 'MODAL_TOKEN_ID or MODAL_TOKEN_SECRET not set in environment',
    };
  }

  // 2. SDK loadability. We use a dynamic import so this module is
  //    cheap to require on machines where the SDK is not installed.
  let sdk;
  try {
    sdk = await import(sdkImportPath);
  } catch (e) {
    return {
      ok: false,
      reason: 'modal_sdk_unimportable',
      detail: `Failed to import '${sdkImportPath}': ${e?.message || e}`,
    };
  }

  // 3. SDK surface check. R2 fix: the real JS SDK exposes ModalClient
  //    as the top-level class, with .volumes.fromName() and
  //    .functions.fromName() on the client. There is NO
  //    modal.Function.from_training_script in JS.
  if (typeof sdk.ModalClient !== 'function') {
    return {
      ok: false,
      reason: 'modal_sdk_surface_incomplete',
      detail: "modal.ModalClient is undefined — the installed SDK version may be too old",
    };
  }

  // 4. Try constructing a client. This actually attempts the gRPC
  //    handshake with Modal's control plane. We do NOT call .close()
  //    here — the client is cheap and the poller reuses the same
  //    instance for every job. If the token is invalid, .functions.
  //    fromName() (called from submit) will throw NotFoundError or
  //    UnauthenticatedError.
  //
  //    Note: ModalClient construction is also lazy — it doesn't open
  //    a connection until a method is called. So this is a cheap
  //    surface check, not a network call.
  try {
    const _client = new sdk.ModalClient();
    if (!_client.volumes || typeof _client.volumes.fromName !== 'function') {
      return {
        ok: false,
        reason: 'modal_sdk_surface_incomplete',
        detail: "modal.ModalClient instance has no .volumes.fromName method",
      };
    }
    if (!_client.functions || typeof _client.functions.fromName !== 'function') {
      return {
        ok: false,
        reason: 'modal_sdk_surface_incomplete',
        detail: "modal.ModalClient instance has no .functions.fromName method",
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'modal_client_construction_failed',
      detail: `new ModalClient() threw: ${e?.message || e}`,
    };
  }

  return { ok: true, sdk };
}

/**
 * Build a ModalClient that submits DPO training jobs and polls them.
 *
 * @param {Object} [opts]
 * @param {object} [opts.logger] — optional logger (defaults to console)
 * @param {string} [opts.sdkImport] — override the SDK import path (tests)
 * @param {string} [opts.appName] — override the App name (default: from config)
 * @param {string} [opts.functionName] — override the function name (default: "train")
 * @returns {{
 *   submit: (args: {runId: string, datasetPath: string, config: object}) => Promise<object>
 * }}
 */
export function makeModalClient(opts = {}) {
  const logger = opts.logger || {
    info: (...a) => console.log('[aware-trainer:modal]', ...a),
    warn: (...a) => console.warn('[aware-trainer:modal]', ...a),
    error: (...a) => console.error('[aware-trainer:modal]', ...a),
  };
  // Inherit the SDK import path so resolveInflight (which doesn't
  // take a sdkImport option in its public signature) uses the same
  // mock SDK that submit() does. Tests inject this via
  // makeModalClient({ sdkImport: ... }).
  const optsSdkImport = opts.sdkImport;

  /**
   * @param {{runId: string, datasetPath: string, config: object}} args
   * @returns {Promise<{jobId: string, appName: string, poll: Function, getCheckpoint: Function}>}
   */
  async function submit(args) {
    const { runId, datasetPath, config: trainingConfig } = args;
    if (!runId) throw new Error('submit: runId is required');
    if (!datasetPath) throw new Error('submit: datasetPath is required');
    if (!trainingConfig || !trainingConfig.app_name) {
      throw new Error('submit: trainingConfig.app_name is required');
    }

    const pre = await preflightModal({ sdkImport: opts.sdkImport });
    if (!pre.ok) {
      const err = new Error(`modal preflight failed: ${pre.reason} (${pre.detail})`);
      err.code = pre.reason;
      throw err;
    }
    const modal = pre.sdk;

    const appName = opts.appName || trainingConfig.app_name;
    const functionName = opts.functionName || trainingConfig.function_name || 'train';

    // Build the ModalClient. It reads MODAL_TOKEN_ID/SECRET from env
    // at construction. We do NOT pass the token to the constructor —
    // that's a 12-factor pattern that keeps secrets out of code.
    const client = new modal.ModalClient();

    // Look up the deployed function by (app, function) name. The
    // operator must have run `modal deploy training/run.py` first
    // (see docs/sop/sop-phase-3-azr-self-play.json). The deploy step
    // registers the App; this fromName call resolves the function
    // handle. If the App isn't deployed, this throws NotFoundError
    // ("Function 'aware-trainer/train' not found").
    const fn = await client.functions.fromName(appName, functionName);

    // Stage the dataset in the volume mount path the training script
    // expects. The script reads from this path; in the production
    // deployment the volume is mounted inside the Modal container.
    //
    // R3 contract: the JS Modal SDK (modal@0.8.x) does NOT expose a
    // Volume.writeFile / Volume.putFiles API (see node_modules/modal
    // /dist/index.d.ts — `declare class Volume` has no write method).
    // We pass the dataset BYTES as a function arg. The Python
    // `train()` in training/app.py writes the bytes to
    // <volume_mount>/datasets/<runId>.jsonl. This is the simplest
    // way to get the dataset into the Modal container's Volume
    // without an SDK upload method. The dataset is small (KB-MB for
    // D5; for real D5 with 100K+ pairs we'd want a proper
    // multipart upload via the Modal REST API, which is a follow-up).
    //
    // The poller writes to datasetPath locally; the Python `train()`
    // synthesizes argv with --dataset <remoteDatasetPath> and reads
    // that file inside the Modal container's Volume mount.
    const volumeName = trainingConfig.modal_volume?.name;
    const volumeMount = trainingConfig.modal_volume?.mount_path || '/root/aware-data';
    const remoteDatasetPath = path.posix.join(
      volumeMount, 'datasets', `${runId}.jsonl`
    );

    // Ensure the parent dir exists locally (the poller runs on the
    // host; this is just a safety net for the bytes-read).
    await fsp.mkdir(path.dirname(datasetPath), { recursive: true });
    if (!fs.existsSync(datasetPath)) {
      // Phase 4 deliverable 1: outcome filter writes the actual DPO
      // dataset content here. The trainer packaging flow
      // (src/trainer/index.js:_packageDataset) populates this file
      // BEFORE calling submit(). If the file is still empty, the
      // script's --smoke path can handle 1-pair dry runs but a real
      // job will fail with dataset_not_found.
      await fsp.writeFile(datasetPath, '');
    }
    const datasetBytes = await fsp.readFile(datasetPath);

    if (volumeName) {
      logger.info(
        `submitting runId=${runId}; app=${appName} fn=${functionName} ` +
        `volume=${volumeName} mount=${volumeMount} ` +
        `remote_dataset=${remoteDatasetPath} local_dataset=${datasetPath} ` +
        `bytes=${datasetBytes.length}`
      );
    } else {
      logger.info(
        `submitting runId=${runId}; app=${appName} fn=${functionName} ` +
        `remote_dataset=${remoteDatasetPath} bytes=${datasetBytes.length}`
      );
    }

    // Submit the function call. Signature:
    //   def train(run_id: str, dataset_path: str, config: dict, dataset_bytes: bytes) -> int
    // We pass the dataset bytes as a 4th arg; the Python `train()`
    // writes them to <volume_mount>/datasets/<runId>.jsonl before
    // calling main().
    const call = await fn.spawn(
      [runId, remoteDatasetPath, trainingConfig, datasetBytes],
      {}
    );

    // call.functionCallId is the Modal-side job id. We use it as
    // the trainer's `jobId`.
    const jobId = call.functionCallId;
    if (!jobId) {
      throw new Error('modal spawn() returned no functionCallId');
    }

    // Wrap the call's terminal-state result into the trainer's
    // expected {status, exitCode, errorMessage} shape. Shared with
    // resolveInflight() below so both call sites have identical
    // success/failure/timeout semantics.
    const handle = _wrapCallHandle(call, {
      jobId,
      appName,
      runId,
      volumeMount,
      pollTimeoutMs: Math.min(300_000, (trainingConfig?.timeout_seconds || 300) * 1000),
      logger,
    });

    return handle;
  }

  /**
   * Re-attach to an in-flight Modal function call by its job id.
   * Returns the same handle shape as submit() so the trainer's
   * _pollInflightRun() can use it interchangeably.
   *
   * Implementation: the JS SDK exposes
   * `client.functionCalls.fromId(jobId) → FunctionCall`, where
   * FunctionCall has `.get({timeoutMs})` and `.cancel()`. There is
   * no `.poll()` directly, so we wrap get() to convert its
   * resolved-value / thrown-error / FunctionTimeoutError outcomes
   * into the trainer's {status, exitCode, errorMessage} shape.
   *
   * @param {string} jobId
   * @param {Object} [opts]
   * @param {string} [opts.appName] — for the handle's metadata
   * @param {string} [opts.runId]   — for getCheckpoint() path
   * @param {string} [opts.volumeMount] — for getCheckpoint() path
   * @param {number} [opts.pollTimeoutMs] — per-tick wait window
   * @returns {Promise<{jobId, appName, poll, getCheckpoint} | null>}
   *   null if the SDK can't resolve the call (e.g. unknown id).
   */
  async function resolveInflight(jobId, opts = {}) {
    if (!jobId) {
      logger.warn('resolveInflight: missing jobId; returning null');
      return null;
    }
    // Lazily load the SDK via preflightModal so the same
    // sdkImport + surface-check contract applies as submit(). If
    // preflight fails (no tokens, no SDK, no surface), we return
    // null and let the trainer log+continue. The sdkImport is
    // inherited from makeModalClient's opts (passed in by the
    // trainer / tests) and can be overridden per-call.
    const pre = await preflightModal({ sdkImport: opts.sdkImport || optsSdkImport });
    if (!pre.ok) {
      logger.warn(
        `resolveInflight: preflight failed (${pre.reason}: ${pre.detail}); ` +
        `cannot re-attach to ${jobId}`
      );
      return null;
    }
    const _sdk = pre.sdk;
    let call;
    try {
      const client = new _sdk.ModalClient();
      if (!client.functionCalls || typeof client.functionCalls.fromId !== 'function') {
        logger.warn(
          'resolveInflight: SDK has no client.functionCalls.fromId; ' +
          'returning null. Bump the modal JS SDK to >=0.8.0 if this ' +
          'persists.'
        );
        return null;
      }
      call = await client.functionCalls.fromId(jobId);
    } catch (e) {
      // NotFoundError or auth error — call is gone or unreachable.
      logger.warn(
        `resolveInflight: functionCalls.fromId(${jobId}) threw: ` +
        `${e?.message || e}`
      );
      return null;
    }
    if (!call || typeof call.get !== 'function') {
      logger.warn(`resolveInflight: fromId returned a non-call object for ${jobId}`);
      return null;
    }
    return _wrapCallHandle(call, {
      jobId,
      appName: opts.appName,
      runId: opts.runId,
      // For getCheckpoint(): volume mount + runId both come from the
      // caller's trainingConfig (the trainer's `_trainingConfig`).
      // If the caller doesn't supply them, getCheckpoint returns
      // {checkpointPath: null, sizeMb: 0} and the trainer still
      // records the run as completed — just without the size
      // sentinel.
      volumeMount: opts.volumeMount,
      pollTimeoutMs: opts.pollTimeoutMs
        || Math.min(300_000, (opts.timeoutSeconds || 300) * 1000),
      logger,
    });
  }

  return { submit, resolveInflight };
}

/**
 * Wrap a Modal FunctionCall object into the trainer's expected
 * `{jobId, appName, poll, getCheckpoint}` handle shape. Shared by
 * `submit` (which holds the live call from fn.spawn) and
 * `resolveInflight` (which re-fetches the call by id from
 * client.functionCalls.fromId). Idempotent on success/failure
 * outcomes — both call sites need identical semantics so the
 * trainer's _pollInflightRun() can treat them interchangeably.
 *
 * @param {object} call — Modal FunctionCall with .get({timeoutMs})
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.appName
 * @param {string} [opts.runId] — needed by getCheckpoint()
 * @param {string} [opts.volumeMount] — needed by getCheckpoint()
 * @param {number} opts.pollTimeoutMs
 * @param {object} opts.logger
 * @returns {{jobId, appName, poll, getCheckpoint}}
 */
function _wrapCallHandle(call, opts) {
  const { jobId, appName, runId, volumeMount, pollTimeoutMs, logger } = opts;
  const _logger = logger || { info() {}, warn() {}, error() {} };

  async function poll() {
    // get({timeoutMs: N}) blocks until the call reaches a
    // terminal state OR N ms elapses. We use the supplied
    // pollTimeoutMs (caller decides based on the trainer's tick
    // interval) so the poller's tick loop can interleave other
    // DB work.
    try {
      const result = await call.get({ timeoutMs: pollTimeoutMs });
      // Modal returns a generic object on success — there isn't
      // a typed "status" field. We use try/catch semantics:
      // resolved promise = completed, thrown = failed.
      return { status: 'completed', exitCode: 0, result };
    } catch (e) {
      // Modal throws RemoteError on function failure, and
      // FunctionTimeoutError if the call is still running.
      const msg = e?.message || String(e);
      if (/timeout/i.test(msg) || /deadline/i.test(msg) || e?.name === 'FunctionTimeoutError') {
        // Not yet terminal — caller will retry on next tick.
        return { status: 'running' };
      }
      return { status: 'failed', exitCode: 1, errorMessage: msg };
    }
  }

  async function getCheckpoint() {
    // The training script writes its checkpoint to the Modal
    // Volume. The path is governed by config.checkpoint and
    // the run-id. The script is responsible for placing a
    // sentinel file the poller can read.
    const ckptDir = volumeMount
      ? path.posix.join(volumeMount, 'checkpoints', runId || jobId)
      : null;
    // sizeMb is informational; the trainer records it but
    // doesn't gate on it. Best-effort stat via the volume
    // (the poller's host sees the same volume as the script
    // if the volume mount is on the host filesystem).
    let sizeMb = 0;
    if (ckptDir) {
      try {
        // The checkpoint is written inside the Modal container
        // and persisted to the volume on commit. The poller
        // doesn't have direct access to the Modal volume's
        // content from outside the container — it relies on
        // the checkpoint existing on the shared volume mount
        // path. The sizeMb is best-effort; the training script
        // should write a `<runId>.size` sentinel that we read.
        const sizeFile = path.join(ckptDir, `${runId || jobId}.size`);
        if (fs.existsSync(sizeFile)) {
          const bytes = parseInt(await fsp.readFile(sizeFile, 'utf8'), 10);
          if (!isNaN(bytes)) sizeMb = Math.round(bytes / (1024 * 1024));
        }
      } catch (e) {
        _logger.warn(`getCheckpoint: could not stat ${ckptDir}: ${e?.message || e}`);
      }
    }
    return { checkpointPath: ckptDir, sizeMb };
  }

  return {
    jobId,
    appName,
    poll,
    getCheckpoint,
  };
}

