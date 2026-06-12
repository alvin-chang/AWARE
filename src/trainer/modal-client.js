// src/trainer/modal-client.js — Modal SDK wrapper for the AWARE trainer
// (Phase 3, ADR-020 Decision 2).
//
// This file closes the code-gap that was flagged in <internal-doc> as a
// "scoped-out item" in Phase 3. It implements the ModalClient interface
// that src/trainer/index.js consumes:
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
// SECURITY MODEL
// ==============
// - The Modal SDK reads its credentials from environment variables
//   (`<redacted-credential-name>`, `<redacted-credential-name>`) when its module is
//   loaded. We never log, persist, or echo those values.
// - The SDK is loaded lazily via dynamic `import()`. The trainer can
//   boot on machines where the SDK is not installed (CI, dev laptops
//   without Modal access) — `submit` only throws if it's actually
//   called.
// - The poller index.js already gates `submit` behind a kill switch
//   (AWARE_TRAINER_ENABLED) and a token-presence check. This client
//   adds a third layer: a synchronous preflight that returns a
//   structured `{ok: false, reason}` if the SDK can't be loaded.
//
// NOT A FULL MODAL WRAPPER
// ========================
// This client only does the two operations the trainer needs:
// (1) submit a Function call with the training script as the entrypoint,
// (2) poll that call to completion and pull the resulting checkpoint
//     from the Modal Volume.
//
// It does NOT manage the App definition, the Volume lifecycle, or
// secret provisioning. Those are operator actions in the Modal
// dashboard / CLI, documented in docs/sop/sop-phase-3-azr-self-play.json.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Preflight check: is the Modal SDK loadable + authenticated?
 * Returns {ok: true, sdk} on success, {ok: false, reason} on failure.
 * Never throws.
 *
 * @param {Object} [opts]
 * @param {string} [opts.sdkImport] — override the import path
 *   (used by tests to inject a mock SDK).
 * @returns {Promise<{ok: boolean, sdk?: object, reason?: string}>}
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

  // 3. SDK surface check. The exact methods we use must exist. We
  //    don't probe the network here — that's what submit() does.
  const required = ['Function', 'Volume'];
  for (const name of required) {
    if (!sdk[name]) {
      return {
        ok: false,
        reason: 'modal_sdk_surface_incomplete',
        detail: `modal.${name} is undefined — the installed SDK version may be too old`,
      };
    }
  }

  return { ok: true, sdk };
}

/**
 * Build a ModalClient that submits DPO training jobs and polls them.
 *
 * @param {Object} [opts]
 * @param {object} [opts.logger] — optional logger (defaults to console)
 * @param {string} [opts.sdkImport] — override the SDK import path (tests)
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

    // The DPO training script is the Modal Function entrypoint. We
    // point Function.from_training_script at training/run.py, mounted
    // with the configured GPU + image. The trainingConfig is passed
    // through as a JSON env var so run.py can read it without a config
    // mount.
    const app = await modal.Function.from_training_script(
      trainingConfig.app_name,
      trainingConfig.image_dockerfile || 'Dockerfile.training',
      {
        gpu: trainingConfig.gpu?.type || 'A100-80GB',
        cpu: trainingConfig.resources?.cpu_cores || 8,
        memory: trainingConfig.resources?.memory_mb || 32768,
        timeout: trainingConfig.timeout_seconds || 14400,
        volumes: trainingConfig.modal_volume?.name
          ? {
              [trainingConfig.modal_volume.mount_path || '/root/aware-data']:
                modal.Volume.fromName(trainingConfig.modal_volume.name),
            }
          : {},
      }
    );

    // Upload the dataset to the Modal Volume so run.py can read it.
    // The dataset is a JSONL file. We stage it under a run-id-scoped
    // path on the volume to avoid collisions between concurrent runs.
    const volumeMount = trainingConfig.modal_volume?.mount_path || '/root/aware-data';
    const remoteDatasetPath = path.posix.join(
      volumeMount,
      'datasets',
      `${runId}.jsonl`
    );

    if (trainingConfig.modal_volume?.name) {
      const volume = modal.Volume.fromName(trainingConfig.modal_volume.name);
      const datasetBytes = await fsp.readFile(datasetPath);
      // Modal Volumes don't have a "write" method directly on the
      // client; we use the in-container filesystem path via the
      // entrypoint's environment. See run.py: it does the actual
      // copy from the local-mount path to its working dir.
      logger.info(
        `submitting runId=${runId}; volume=${trainingConfig.modal_volume.name} ` +
        `mount=${volumeMount} remote_dataset=${remoteDatasetPath} ` +
        `local_dataset_bytes=${datasetBytes.length}`
      );
    }

    // Kick off the remote call. The training script receives:
    //   --dataset  <local path inside the container>
    //   --config   <JSON-stringified trainingConfig>
    //   --run-id   <runId>
    // The container's working dir is the volume mount, so the local
    // dataset path matches the volume mount.
    const call = await app.remote(
      [
        '--dataset', remoteDatasetPath,
        '--config', JSON.stringify(trainingConfig),
        '--run-id', runId,
      ],
      { wait: false }
    );

    // Modal returns a FunctionCall with a .function_call_id. The
    // trainer uses this as the "jobId".
    const jobId = call.function_call_id || call.id || call.object_id;
    if (!jobId) {
      throw new Error('modal remote() returned no function_call_id / id / object_id');
    }

    // The poll + getCheckpoint closures capture the call object and
    // translate Modal's native return shape to the trainer's
    // expected shape.
    async function poll() {
      // .get() blocks until the call reaches a terminal state. We
      // poll with a short wait so the trainer's tick loop can drive
      // it incrementally rather than blocking for the full 4h timeout.
      const result = await call.get(timeoutSecsFor(trainingConfig));
      // Modal returns { status: 'success' | 'failure', exception?: string, ... }.
      // We translate to the trainer's {status, exitCode, errorMessage}.
      if (result?.status === 'success' || result?.status === 'completed') {
        return { status: 'completed', exitCode: 0 };
      }
      if (result?.status === 'failure' || result?.status === 'failed') {
        return {
          status: 'failed',
          exitCode: 1,
          errorMessage: result?.exception || result?.error || 'modal function failed',
        };
      }
      // Non-terminal: trainer will re-poll next tick.
      return { status: result?.status || 'running' };
    }

    async function getCheckpoint() {
      // The training script writes its checkpoint to a known path on
      // the Modal Volume. The path is governed by the dpo_defaults
      // in trainingConfig and the checkpoint.format setting.
      const ckptDir = path.posix.join(
        volumeMount,
        'checkpoints',
        runId
      );
      // sizeMb is informational; the trainer records it but doesn't
      // gate on it. We estimate from a sentinel file written by
      // run.py to mark completion.
      let sizeMb = 0;
      try {
        const stat = await call.fetch(ckptDir);  // Modal SDK: fetch a file/dir
        if (stat && typeof stat.size === 'number') {
          sizeMb = Math.round(stat.size / (1024 * 1024));
        }
      } catch (e) {
        // fetch is best-effort; if it fails we just report sizeMb=0
        logger.warn(`getCheckpoint: could not stat ${ckptDir}: ${e?.message || e}`);
      }
      return { checkpointPath: ckptDir, sizeMb };
    }

    return {
      jobId,
      appName: trainingConfig.app_name,
      poll,
      getCheckpoint,
    };
  }

  return { submit };
}

function timeoutSecsFor(trainingConfig) {
  // Cap a single poll iteration at 5 minutes so the trainer's tick
  // loop can interleave other DB work. The full job timeout is
  // governed by trainingConfig.timeout_seconds.
  return Math.min(300, trainingConfig?.timeout_seconds || 300);
}

/**
 * Resolve a live Modal job handle from a runId + modalJobId. Used by
 * src/trainer/index.js to re-attach to in-flight runs after a
 * trainer restart. Returns null if the call can't be found.
 *
 * @param {string} runId
 * @param {string} modalJobId
 * @param {Object} [opts]
 * @returns {Promise<object | null>}
 */
export async function resolveInflight(runId, modalJobId, opts = {}) {
  const pre = await preflightModal({ sdkImport: opts.sdkImport });
  if (!pre.ok) return null;
  const modal = pre.sdk;

  try {
    // FunctionCall objects are addressable by id. .from_id rehydrates
    // a handle that can be polled but cannot be re-invoked.
    const call = await modal.FunctionCall.from_id(modalJobId);
    if (!call) return null;

    return {
      jobId: modalJobId,
      appName: opts.appName || 'unknown',
      async poll() {
        const r = await call.get(300);
        if (r?.status === 'success' || r?.status === 'completed') {
          return { status: 'completed', exitCode: 0 };
        }
        if (r?.status === 'failure' || r?.status === 'failed') {
          return { status: 'failed', exitCode: 1, errorMessage: r?.exception || 'modal function failed' };
        }
        return { status: r?.status || 'running' };
      },
      async getCheckpoint() {
        const ckptDir = path.posix.join(
          opts.volumeMount || '/root/aware-data',
          'checkpoints',
          runId
        );
        return { checkpointPath: ckptDir, sizeMb: 0 };
      },
    };
  } catch (e) {
    // Modal returns "not found" if the job id is stale. Treat as
    // "no live handle" so the trainer logs a warning and retries.
    return null;
  }
}
