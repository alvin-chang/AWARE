// src/coordinator/lora-reloader.js — Phase 4 deliverable 3 (ADR (internal) 618-627)
//
// Watch the trainer's active-weights symlink and hot-reload Ollama
// when it changes.
//
// Background
// ----------
// The trainer (src/trainer/index.js:_atomicSymlinkSwap) writes a
// new LoRA adapter directory to the Modal Volume and atomically
// renames a symlink at `${AWARE_TRAINER_WEIGHTS_DIR}/active` to
// point at the new adapter. The coordinator process (this service)
// watches that symlink and, when the target changes, tells Ollama
// to load the new adapter into a custom model.
//
// Decision Y (per Phase 4 architectural choice): HTTP/Ollama adapter
// reload. We POST to Ollama's `/api/create` endpoint with a
// Modelfile that includes the new ADAPTER path. Ollama hot-reloads
// the model in-place. The coordinator's model router then picks up
// the new model on the next request (no router-side code change —
// the router already calls Ollama with the configured model name).
//
// What this module does
// ---------------------
// - Polls `${weightsDir}/active` for its symlink target on a
//   fixed interval (default 5s; configurable via `pollIntervalMs`).
// - Compares the current target to the last-known target. Different
//   → trigger reload. Same → no-op.
// - Reload path:
//   1. Read the ADAPTER env from the Modelfile template (or accept
//      a pre-built Modelfile via `modelfileTemplate`).
//   2. POST `/api/create` with { name, modelfile } — Ollama writes
//      a new model to its local store.
//   3. The next `/api/generate` call with `model = modelName` will
//      hit the new adapter. (Ollama's hot-reload is implicit on
//      next request.)
// - Errors are non-fatal: log + retry on next poll. The poll loop
//   never throws.
//
// What this module does NOT do
// -----------------------------
// - It does NOT change the model router. The router already calls
//   Ollama with the configured model name; the model name is
//   `${baseModel}-aware-lora` (configurable via `modelName`).
// - It does NOT verify the LoRA adapter files. Ollama does that
//   when it loads.
// - It does NOT snapshot the previous model before reloading. If
//   you need rollback, set `modelfileTemplate` to a known-good
//   fallback before the reload.
//
// Usage
// -----
//   import { makeLoraReloader } from './lora-reloader.js';
//   const reloader = makeLoraReloader({
//     weightsDir: '/root/aware-weights',
//     ollamaUrl: 'http://127.0.0.1:11434',
//     modelName: 'trained-model',
//     baseModel: 'qwen2.5:7b',
//     pollIntervalMs: 5_000,
//   });
//   reloader.start();   // begins polling
//   // ... later ...
//   await reloader.stop();
//
// Pure-function helpers (for tests)
// ---------------------------------
// - `resolveActiveTarget(weightsDir)` → reads the symlink, returns
//   the absolute target path or null if the symlink doesn't exist.
// - `buildModelfile({baseModel, adapterPath, template})` → returns
//   the Modelfile string Ollama's /api/create expects.
// - `shouldReload(prevTarget, currentTarget)` → true if they differ.

import fsp from 'node:fs/promises';
import path from 'node:path';

const ACTIVE_SYMLINK = 'active';

/**
 * Resolve the absolute path of the active symlink inside `weightsDir`.
 * Returns null if the symlink doesn't exist (operator hasn't
 * deployed any weights yet — common at first boot).
 *
 * @param {string} weightsDir
 * @returns {string|null} absolute path of the symlink, or null
 */
export function resolveActiveSymlinkPath(weightsDir) {
  if (typeof weightsDir !== 'string' || weightsDir.length === 0) return null;
  return path.join(weightsDir, ACTIVE_SYMLINK);
}

/**
 * Read the symlink target. Returns the absolute path the symlink
 * points at, or null if the symlink doesn't exist / isn't a symlink.
 *
 * @param {string} weightsDir
 * @returns {Promise<string|null>}
 */
export async function resolveActiveTarget(weightsDir) {
  const linkPath = resolveActiveSymlinkPath(weightsDir);
  if (!linkPath) return null;
  let lst;
  try {
    lst = await fsp.lstat(linkPath);
  } catch (e) {
    // ENOENT (or any read failure) → no active symlink yet
    return null;
  }
  if (!lst.isSymbolicLink()) return null;
  try {
    // readlink returns the *raw* target, which may be relative
    // (the trainer's _atomicSymlinkSwap uses relative targets like
    // 'r-2026-06-12-abc/checkpoint-42'). Resolve to absolute.
    const target = await fsp.readlink(linkPath);
    if (path.isAbsolute(target)) return target;
    return path.resolve(path.dirname(linkPath), target);
  } catch (e) {
    return null;
  }
}

/**
 * Should we trigger a reload? True iff the two targets differ
 * (string compare after null-normalization). Both null = no.
 *
 * @param {string|null} prev
 * @param {string|null} current
 * @returns {boolean}
 */
export function shouldReload(prev, current) {
  if (prev === current) return false;
  // null vs. string always reloads; this is the "first poll" case.
  if (prev === null || current === null) return true;
  return prev !== current;
}

/**
 * Build the Modelfile string for Ollama's /api/create endpoint.
 *
 * Default template:
 *   FROM <baseModel>
 *   ADAPTER <adapterPath>
 *
 * Custom template (via `template` option) replaces both lines with
 * arbitrary Modelfile content; use this to add system prompts,
 * parameters, etc.
 *
 * @param {Object} opts
 * @param {string} opts.baseModel — e.g. 'qwen2.5:7b'
 * @param {string} opts.adapterPath — absolute path to the LoRA adapter dir
 * @param {string} [opts.template] — full Modelfile override
 * @returns {string}
 */
export function buildModelfile({ baseModel, adapterPath, template }) {
  if (typeof template === 'string' && template.length > 0) {
    return template;
  }
  return [
    `FROM ${baseModel}`,
    `ADAPTER ${adapterPath}`,
  ].join('\n') + '\n';
}

/**
 * Trigger Ollama to (re)load the model with the new adapter.
 *
 * POSTs /api/create with { name, modelfile }. Returns { status,
 * statusText, body } on completion. Throws on network / parse
 * failure. Callers (the reloader) should catch + log; the poll
 * loop continues regardless.
 *
 * @param {Object} opts
 * @param {string} opts.ollamaUrl
 * @param {string} opts.modelName
 * @param {string} opts.modelfile
 * @param {number} [opts.timeoutMs=30_000]
 * @param {typeof fetch} [opts._fetch] — injection for tests
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
export async function postOllamaCreate({ ollamaUrl, modelName, modelfile, timeoutMs = 30_000, _fetch = globalThis.fetch }) {
  if (typeof ollamaUrl !== 'string' || ollamaUrl.length === 0) {
    throw new Error('postOllamaCreate: ollamaUrl is required');
  }
  if (typeof modelName !== 'string' || modelName.length === 0) {
    throw new Error('postOllamaCreate: modelName is required');
  }
  if (typeof modelfile !== 'string' || modelfile.length === 0) {
    throw new Error('postOllamaCreate: modelfile is required');
  }
  const url = `${ollamaUrl.replace(/\/+$/, '')}/api/create`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: modelName, modelfile }),
      signal: ac.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build a LoRA reloader.
 *
 * @param {Object} opts
 * @param {string} opts.weightsDir
 * @param {string} opts.ollamaUrl
 * @param {string} opts.modelName
 * @param {string} opts.baseModel
 * @param {string} [opts.modelfileTemplate] — full Modelfile override
 * @param {number} [opts.pollIntervalMs=5_000]
 * @param {number} [opts.reloadTimeoutMs=30_000]
 * @param {Object} [opts.logger] — { info, warn, error, debug }
 * @returns {{
 *   start: () => void,
 *   stop: () => Promise<void>,
 *   reloadNow: (adapterPath: string) => Promise<{ok: boolean, status: number, body: string}>,
 *   _state: () => {lastTarget: string|null, inFlight: boolean},
 * }}
 */
export function makeLoraReloader(opts) {
  const {
    weightsDir,
    ollamaUrl,
    modelName,
    baseModel,
    modelfileTemplate,
    pollIntervalMs = 5_000,
    reloadTimeoutMs = 30_000,
    _fetch = globalThis.fetch,
    logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} },
  } = opts || {};

  if (typeof weightsDir !== 'string' || weightsDir.length === 0) {
    throw new Error('makeLoraReloader: weightsDir is required');
  }
  if (typeof ollamaUrl !== 'string' || ollamaUrl.length === 0) {
    throw new Error('makeLoraReloader: ollamaUrl is required');
  }
  if (typeof modelName !== 'string' || modelName.length === 0) {
    throw new Error('makeLoraReloader: modelName is required');
  }
  if (typeof baseModel !== 'string' || baseModel.length === 0) {
    throw new Error('makeLoraReloader: baseModel is required');
  }

  let lastTarget = null;
  let inFlight = false;
  let timer = null;
  let stopped = true;
  let tickPromise = null;

  async function _doReload(adapterPath) {
    const modelfile = buildModelfile({ baseModel, adapterPath, template: modelfileTemplate });
    return await postOllamaCreate({
      ollamaUrl,
      modelName,
      modelfile,
      timeoutMs: reloadTimeoutMs,
      _fetch,
    });
  }

  async function _tick() {
    if (inFlight) return;        // serialize; never overlap polls
    let current;
    try {
      current = await resolveActiveTarget(weightsDir);
    } catch (e) {
      logger.warn(`lora-reloader: resolveActiveTarget failed: ${e?.message || e}`);
      return;
    }
    if (!shouldReload(lastTarget, current)) {
      return;        // no change
    }
    inFlight = true;
    const previous = lastTarget;
    lastTarget = current;        // optimistic — track the new target even if reload fails
    try {
      if (current === null) {
        // Symlink disappeared (operator wiped weightsDir). Don't
        // reload; just clear the index. Ollama keeps the previously-
        // loaded adapter in memory — it has no 'unload' call and
        // we don't try to synthesize one here. The gateway will keep
        // serving with the stale adapter until a new symlink swap
        // triggers a successful reload. This is a known doc-vs-
        // behavior gap (F-006) — the comment used to claim "next
        // /coordinate call will fail" but Ollama silently serves the
        // last-known-good adapter.
        logger.warn(
          `lora-reloader: active symlink missing (was=${previous}); ` +
          `clearing lastTarget without reload. Ollama will keep ` +
          `serving the prior adapter until a new symlink swap succeeds.`
        );
        return;
      }
      logger.info(`lora-reloader: reloading ollama model=${modelName} from ${current}`);
      const res = await _doReload(current);
      if (res.ok) {
        logger.info(
          `lora-reloader: reload ok status=${res.status} ` +
          `body=${res.body.slice(0, 200)}`
        );
      } else {
        // Restore lastTarget so we retry on the next poll rather
        // than thinking the reload succeeded.
        lastTarget = previous;
        logger.error(
          `lora-reloader: reload failed status=${res.status} ` +
          `body=${res.body.slice(0, 500)}; will retry on next poll`
        );
      }
    } catch (e) {
      lastTarget = previous;     // restore
      logger.error(
        `lora-reloader: reload threw: ${e?.message || e}; will retry on next poll`
      );
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (!stopped) return;        // already started
    stopped = false;
    // Fire an immediate tick, then schedule recurring ticks.
    tickPromise = _tick();
    timer = setInterval(() => { _tick(); }, pollIntervalMs);
    logger.info(
      `lora-reloader: started weightsDir=${weightsDir} ` +
      `ollamaUrl=${ollamaUrl} modelName=${modelName} ` +
      `pollIntervalMs=${pollIntervalMs}`
    );
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (tickPromise) {
      await tickPromise.catch(() => {});
      tickPromise = null;
    }
    logger.info('lora-reloader: stopped');
  }

  /**
   * Force a reload of a specific adapter path. Used by tests and
   * by the CLI tool. Not part of the normal poll-driven path.
   */
  async function reloadNow(adapterPath) {
    if (typeof adapterPath !== 'string' || adapterPath.length === 0) {
      throw new Error('reloadNow: adapterPath is required');
    }
    return await _doReload(adapterPath);
  }

  function _state() {
    return { lastTarget, inFlight };
  }

  return { start, stop, reloadNow, _state };
}

// -- default export for ESM consumers ----------------------------------

export default {
  makeLoraReloader,
  resolveActiveTarget,
  resolveActiveSymlinkPath,
  shouldReload,
  buildModelfile,
  postOllamaCreate,
};
