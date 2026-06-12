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
//   (<redacted-credential-name>, <redacted-credential-name>) when the ModalClient is
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
  if (!process.env.<redacted-credential-name> || !process.env.<redacted-credential-name>) {
    return {
      ok: false,
      reason: 'modal_tokens_missing',
      detail: '<redacted-credential-name> or <redacted-credential-name> not set in environment',
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

    // Build the ModalClient. It reads <redacted-credential-name>/SECRET from env
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
    // For the pre-deployed model, the dataset is uploaded as a
    // function argument (the script's `dataset_path` kwarg).
    //
    // R2 design note: we pass `datasetPath` (a local file path) as
    // the spawn kwarg. The training script reads that file. The
    // Modal container's filesystem is fresh per-job, so the file
    // content needs to be passed either as bytes or as a Volume
    // mount. We do the latter: the script expects the dataset at
    // /root/aware-data/datasets/<runId>.jsonl on a mounted volume.
    // The poller writes to that path locally (the modal volume
    // mount), and the training script reads it.
    const volumeName = trainingConfig.modal_volume?.name;
    const volumeMount = trainingConfig.modal_volume?.mount_path || '/root/aware-data';
    const remoteDatasetPath = path.posix.join(
      volumeMount, 'datasets', `${runId}.jsonl`
    );

    // The training script expects the dataset to be at
    // <volume_mount>/datasets/<runId>.jsonl. Ensure the parent dir
    // exists locally (the poller runs on the host; the volume mount
    // is the host's local path). The training container inherits
    // the same volume and sees the file.
    await fsp.mkdir(path.dirname(datasetPath), { recursive: true });
    // The actual write of DPO pair content is part of Phase 4 (the
    // outcome filter). For now the trainer writes an empty
    // placeholder, which the training script's --smoke path can
    // handle (1-pair dry run).
    if (!fs.existsSync(datasetPath)) {
      await fsp.writeFile(datasetPath, '');
    }

    if (volumeName) {
      logger.info(
        `submitting runId=${runId}; app=${appName} fn=${functionName} ` +
        `volume=${volumeName} mount=${volumeMount} ` +
        `remote_dataset=${remoteDatasetPath} local_dataset=${datasetPath}`
      );
    } else {
      logger.info(
        `submitting runId=${runId}; app=${appName} fn=${functionName} ` +
        `remote_dataset=${remoteDatasetPath}`
      );
    }

    // Submit the function call. The training script signature is:
    //   def train(run_id: str, dataset_path: str, config: dict) -> dict
    // In JS, we pass positional args + kwargs to match.
    const call = await fn.spawn(
      [runId, remoteDatasetPath, trainingConfig],
      {}
    );

    // call.functionCallId is the Modal-side job id. We use it as
    // the trainer's `jobId`.
    const jobId = call.functionCallId;
    if (!jobId) {
      throw new Error('modal spawn() returned no functionCallId');
    }

    // Wrap the call's terminal-state result into the trainer's
    // expected {status, exitCode, errorMessage} shape.
    async function poll() {
      // get({timeoutMs: N}) blocks until the call reaches a
      // terminal state OR N ms elapses. We use a 5-minute window
      // so the poller's tick loop can interleave other DB work.
      const timeoutMs = Math.min(300_000, (trainingConfig?.timeout_seconds || 300) * 1000);
      try {
        const result = await call.get({ timeoutMs });
        // Modal returns a generic object on success — there isn't
        // a typed "status" field. We use try/catch semantics:
        // resolved promise = completed, thrown = failed.
        return { status: 'completed', exitCode: 0, result };
      } catch (e) {
        // Modal throws a RemoteError on function failure. We
        // translate to our {status: 'failed', exitCode: 1,
        // errorMessage}.
        const msg = e?.message || String(e);
        if (/timeout/i.test(msg) || /deadline/i.test(msg)) {
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
      const ckptDir = path.posix.join(volumeMount, 'checkpoints', runId);
      // sizeMb is informational; the trainer records it but
      // doesn't gate on it. Best-effort stat via the volume
      // (the poller's host sees the same volume as the script
      // if the volume mount is on the host filesystem).
      let sizeMb = 0;
      try {
        // The checkpoint is written inside the Modal container
        // and persisted to the volume on commit. The poller
        // doesn't have direct access to the Modal volume's
        // content from outside the container — it relies on
        // the checkpoint existing on the shared volume mount
        // path. The sizeMb is best-effort; the training script
        // should write a `<runId>.size` sentinel that we read.
        const sizeFile = path.join(ckptDir, `${runId}.size`);
        if (fs.existsSync(sizeFile)) {
          const bytes = parseInt(await fsp.readFile(sizeFile, 'utf8'), 10);
          if (!isNaN(bytes)) sizeMb = Math.round(bytes / (1024 * 1024));
        }
      } catch (e) {
        logger.warn(`getCheckpoint: could not stat ${ckptDir}: ${e?.message || e}`);
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

  return { submit };
}

/**
 * Resolve a live Modal job handle from a runId + modalJobId. Used
 * by src/trainer/index.js to re-attach to in-flight runs after a
 * trainer restart. Returns null if the call can't be found.
 *
 * R2: there is no public `modal.FunctionCall.from_id` factory in
 * the JS SDK. Instead, the client exposes a low-level lookup via
 * the gRPC client. We DO NOT implement the re-attach here — the
 * trainer restart path is a known follow-up (see <internal-doc> "Known
 * scoped-out items"). This function is a stub that always returns
 * null, matching the Node trainer's `_resolveInflight` default.
 *
 * @param {string} runId
 * @param {string} modalJobId
 * @param {Object} [opts]
 * @returns {Promise<object | null>}
 */
export async function resolveInflight(_runId, _modalJobId, _opts = {}) {
  // See the comment above. The trainer logs "no live job handle
  // for run X; will retry next tick" and continues. After several
  // retries, the run stays in 'pending'/'running' state in
  // Postgres and the operator can investigate via the Modal
  // dashboard.
  return null;
}
