// AWARE 2.0 coordinator service — HTTP API
// Per ADR-020 Decision 1: persistent coordinator session + lightweight task workers
// Per ADR-020 Decision 3: 3-tier model fallback (minimax → Ollama)
// Per ADR-020 Decision 4: T0-T4 enforcement (timeout, retry, cost-cap, fallback, kill-switch)
//
// This module is the *service surface* for the coordinator. It exposes:
//   - POST /coordinate  → run heavy-think on a problem, return selected answer
//   - GET  /health      → router health snapshot (200 healthy, 503 degraded)
//   - GET  /version     → coordinator version + build phase
//
// It uses Node's built-in `http` module — no Express — so the surface stays
// small and the deployable artifact is just `node src/coordinator/http-server.js`.
//
// T0-T4 enforcement (this layer):
//   - T0 timeout:    per-request wall-clock cap (env AWARE_REQUEST_TIMEOUT_MS, default 120_000)
//   - T2 cost-cap:   per-request USD cap (env AWARE_REQUEST_COST_CAP_USD, default 1.00)
//   - T4 kill-switch: global env AWARE_KILL_SWITCH=1 returns 503 immediately
// T3 fallback lives in the router. T1 retry is handled by heavy-think itself.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { coordinate, buildDefaultRouter, COORDINATOR_VERSION, COORDINATOR_BUILD_PHASE } from './index.js';
import config from '../config/index.cjs';
import { logConversationFireAndForget } from '../db/logger.js';
import { runMigrations } from '../db/index.js';
import { checkBudget, getBudgetStatus, isEnabled as isBudgetEnabled } from '../budget/watchdog.js';
import { makeLoraReloader } from './lora-reloader.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB — coordinator inputs are prompts, not file uploads

// T0-T4 limits live in the centralized config module (src/config/index.js).
// Lazy getters re-read env on each access so toggling AWARE_KILL_SWITCH
// or AWARE_REQUEST_TIMEOUT_MS at runtime does not require a restart.
// Validate at boot so bad env values fail fast, not on first request.
config.validate();

// Phase 2.1: run Postgres migrations on boot. Best-effort — if the DB is
// unreachable, log a warning to stderr and continue. The logger itself is
// a no-op when AWARE_DB_ENABLED=false.
if (config.db.enabled) {
  runMigrations().then((r) => {
    if (!r.ran && r.reason !== 'already-run') {
      // eslint-disable-next-line no-console
      console.warn(`[aware-coordinator] db migrations did not run: ${r.reason}${r.error ? ` (${r.error})` : ''}`);
    }
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[aware-coordinator] db migrations threw:', err.message);
  });
}

function isKilled() {
  return config.coordinator.killSwitch;
}

/**
 * Read the full request body as a UTF-8 string, up to MAX_BODY_BYTES.
 * Rejects with a 413 if the body exceeds the cap.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response. `status` defaults to 200.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Send a plain-text response. Used for 404s.
 */
function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Run the HTTP server. Resolves with a `close()` function that gracefully
 * shuts the server down. The server is bound to `opts.host`:`opts.port`.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port=8080]
 * @param {string} [opts.host='127.0.0.1']
 * @param {Object} [opts.router] — pre-built router (defaults to buildDefaultRouter())
 * @param {Function} [opts.coordinateFn] — override the coordinate function (used in tests)
 * @param {boolean} [opts.disableLoraReloader=false] — skip wiring the
 *   lora-reloader on startup. Used by tests so the reloader's poll
 *   interval doesn't keep the test process alive.
 * @returns {Promise<{server: http.Server, port: number, host: string, close: () => Promise<void>, loraReloader: object|null}>}
 */
export async function startServer(opts = {}) {
  const host = opts.host ?? config.coordinator.host;
  // `opts.port === 0` is a valid request (OS picks a free port) — use ??
  // not || so the fallback doesn't kick in for the zero value.
  const port = opts.port ?? config.coordinator.port;
  const router = opts.router || (await buildDefaultRouter(opts.routerOpts || {}));
  const coordinateFn = opts.coordinateFn || coordinate;

  const server = http.createServer(async (req, res) => {
    // Per-request id for log correlation
    const requestId = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', requestId);
    try {
      // Routing
      if (req.method === 'GET' && req.url === '/health') {
        return handleHealth(req, res, router, requestId);
      }
      if (req.method === 'GET' && req.url === '/version') {
        return sendJson(res, 200, {
          version: COORDINATOR_VERSION,
          build_phase: COORDINATOR_BUILD_PHASE,
          kill_switch: isKilled(),
          request_id: requestId,
        });
      }
      if (req.method === 'GET' && req.url === '/budget/status') {
        return await handleBudgetStatus(req, res, requestId);
      }
      if (req.method === 'POST' && req.url === '/coordinate') {
        return await handleCoordinate(req, res, router, coordinateFn, requestId);
      }
      return sendJson(res, 404, { error: 'not found', kind: 'request', request_id: requestId });
    } catch (err) {
      // Internal error envelope
      const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
      const body = {
        error: err.message || 'internal error',
        kind: status === 500 ? 'internal' : 'request',
        request_id: requestId,
      };
      return sendJson(res, status, body);
    }
  });

  // Listen on the requested port; resolve when ready.
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  // Bug #15 (2026-06-13): the lora-reloader module was previously
  // exported from coordinator/index.js but never invoked from the
  // server's startup path. The reloader is the thing that watches
  // the trainer's active-weights symlink and tells Ollama to
  // /api/create with the new adapter. Without it, a successful
  // training run never produces an inference-usable LoRA on the
  // gateway.
  //
  // Wire it up here, gated on config.coordinator.loraReloaderEnabled
  // (default true). The reloader's start() begins polling on a
  // timer; the close() returned below stops it on shutdown.
  //
  // Tests can opt out via `opts.disableLoraReloader` (the
  // reloader would otherwise keep the test process alive on its
  // 5-second poll interval). The OLLAMA_URL-missing case below
  // is the dev-env fallback for when the reloader is wanted but
  // the env var isn't set.
  //
  // Note: this fix only wires the reloader into the coordinator
  // process. Bug #14 (the trainer's symlink swap targets a Modal
  // Volume path the host can't see) is a separate, architectural
  // issue and is documented in <internal-doc>. With bug #14 still open,
  // the reloader will poll forever and never see a target change —
  // which is the correct, safe behavior: the gateway stays on the
  // base model instead of serving a broken LoRA. Once #14 is
  // fixed, this wiring becomes the load-bearing piece that
  // actually delivers a trained LoRA to the gateway.
  const loraReloaderEnabled = config.coordinator.loraReloaderEnabled;
  let loraReloader = null;
  if (loraReloaderEnabled && !opts.disableLoraReloader) {
    // The actual opt-out is AWARE_LORA_RELOADER_ENABLED=false.
    // config.model.ollamaUrl always falls back to a default via
    // str() so we don't need a defensive empty-URL guard here.
    const ollamaUrl = config.model?.ollamaUrl;
    loraReloader = makeLoraReloader({
      weightsDir: config.trainer.weightsDir,
      ollamaUrl,
      modelName: config.coordinator.loraReloaderModelName,
      baseModel: config.trainer.baseModel,
      pollIntervalMs: config.coordinator.loraReloaderPollIntervalMs,
      reloadTimeoutMs: config.coordinator.loraReloaderTimeoutMs,
      logger: {
        info: (...a) => console.log('[aware-coordinator:lora]', ...a),
        warn: (...a) => console.warn('[aware-coordinator:lora]', ...a),
        error: (...a) => console.error('[aware-coordinator:lora]', ...a),
        debug: () => {},
      },
    });
    loraReloader.start();
  }

  const actualPort = server.address().port;

  const close = async () => {
    // F-003: stop the reloader BEFORE closing the server. The
    // previous version ran loraReloader.stop() fire-and-forget and
    // server.close() synchronously, which could leave a half-
    // completed Ollama POST in flight when the process tears down.
    if (loraReloader) {
      try {
        await loraReloader.stop();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[aware-coordinator] lora-reloader.stop() failed during close: ${e?.message || e}`);
      }
      loraReloader = null;
    }
    return await new Promise((resolve) => server.close(() => resolve()));
  };

  return { server, port: actualPort, host, close, loraReloader };
}

/**
 * GET /budget/status — read-only budget watchdog status.
 *
 * Returns the current rolling-window spend, the configured soft/hard
 * limits, the tier (ok | soft | hard), and the projected reset time.
 * Read-only; never mutates anything.
 */
async function handleBudgetStatus(req, res, requestId) {
  let status;
  try {
    status = await getBudgetStatus();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[aware-coordinator] getBudgetStatus threw:', err.message);
    return sendJson(res, 500, {
      error: 'budget status query failed',
      kind: 'internal',
      request_id: requestId,
    });
  }
  return sendJson(res, 200, { ...status, request_id: requestId });
}

/**
 * GET /health — router health snapshot.
 * - 200 if at least one backend is healthy (or if the router has no health probes)
 * - 503 if all backends are unhealthy
 * - 500 if the router itself throws (degraded but server stays up)
 */
async function handleHealth(req, res, router, requestId) {
  let snapshot;
  try {
    snapshot = await router.health();
  } catch (err) {
    return sendJson(res, 500, {
      status: 'degraded',
      error: err.message || 'router health() threw',
      kind: 'internal',
      request_id: requestId,
    });
  }
  // The router's health() returns { mode, ok, at, clients: { [name]: { ok, cached, at } } }.
  // The legacy `backends` field is also accepted for back-compat.
  const entries = snapshot.clients || snapshot.backends || {};
  const backends = Object.entries(entries).map(([name, info]) => ({
    name,
    healthy: !!info.ok,
    cached: !!info.cached,
    checked_at: info.at || snapshot.at || new Date().toISOString(),
  }));
  const allDown = backends.length > 0 && backends.every((b) => !b.healthy);
  const status = allDown ? 503 : 200;
  return sendJson(res, status, {
    status: allDown ? 'down' : 'ok',
    mode: snapshot.mode,
    backends,
    kill_switch: isKilled(),
    checked_at: snapshot.at || new Date().toISOString(),
    request_id: requestId,
  });
}

/**
 * POST /coordinate — run heavy-think on a problem.
 *
 * Request body: { problem: string, task_type?: string, K?: number, context?: object, sessionId?: string, agentId?: string, timeout_ms?: number, cost_cap_usd?: number }
 *
 * Response shape (success):  200 with the coordinate() result envelope
 * Response shape (failure):  400 / 402 / 503 / 504 / 500 with the error envelope
 *
 * The coordinator returns `{ok: false, error: {type, message}}` on failure (does not throw).
 * We map `error.type` to HTTP status:
 *   - 'invalid_input'  → 400
 *   - 'upstream_error' → 503 (the upstream model API failed)
 *   - 'internal_error' → 500
 * A thrown error is treated as 500 unless the message matches a known pattern.
 *
 * T0-T4 enforcement:
 *   - T4 kill-switch: 503 immediately, no work done
 *   - T0 timeout:    Promise.race against REQUEST_TIMEOUT_MS (or body.timeout_ms); 504 on timeout
 *   - T2 cost-cap:   per-request USD ceiling (default REQUEST_COST_CAP_USD); 402 on overrun
 */
async function handleCoordinate(req, res, router, coordinateFn, requestId) {
  const startMs = Date.now();
  const log = (extra) => logConversationFireAndForget({
    requestId,
    problem: extra && extra.problem,
    taskType: extra && extra.taskType,
    k: extra && extra.k,
    sessionId: extra && extra.sessionId,
    agentId: extra && extra.agentId,
    result: extra && extra.result,
    durationMs: Date.now() - startMs,
    errorKind: extra && extra.errorKind,
    errorMessage: extra && extra.errorMessage,
  });

  if (isKilled()) {
    log({ errorKind: 'killed', errorMessage: 'kill-switch is engaged' });
    return sendJson(res, 503, {
      error: 'kill-switch is engaged (AWARE_KILL_SWITCH=1)',
      kind: 'killed',
      request_id: requestId,
    });
  }

  // Phase 2.3 — Budget watchdog: read rolling-window spend BEFORE
  // doing work. Hard tier → 402. Soft tier → proceed + warn header.
  // On watchdog failure: log + fail-open (tier=ok). Never break the path.
  let budget;
  try {
    budget = await checkBudget();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[aware-coordinator] checkBudget threw, failing open:', err.message);
    budget = { ok: true, tier: 'ok', spendUsd: 0 };
  }
  res.setHeader('x-budget-tier', budget.tier);
  if (budget.tier === 'hard') {
    log({ errorKind: 'budget_exhausted', errorMessage: `rolling-window spend $${budget.spendUsd} >= hard limit $${budget.hardLimitUsd}` });
    return sendJson(res, 402, {
      error: 'budget exhausted — rolling-window spend has reached the hard limit',
      kind: 'budget_exhausted',
      spend_usd: budget.spendUsd,
      soft_limit_usd: budget.softLimitUsd,
      hard_limit_usd: budget.hardLimitUsd,
      window_days: budget.windowDays,
      resets_at: budget.resetsAt,
      request_id: requestId,
    });
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    log({ errorKind: 'request', errorMessage: err.message });
    return sendJson(res, err.statusCode || 400, { error: err.message, kind: 'request', request_id: requestId });
  }

  let body;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch (err) {
    log({ errorKind: 'request', errorMessage: 'invalid JSON in request body' });
    return sendJson(res, 400, { error: 'invalid JSON in request body', kind: 'request', request_id: requestId });
  }

  if (typeof body.problem !== 'string' || body.problem.length === 0) {
    log({ problem: body.problem, errorKind: 'request', errorMessage: '`problem` is required and must be a non-empty string' });
    return sendJson(res, 400, {
      error: '`problem` is required and must be a non-empty string',
      kind: 'request',
      request_id: requestId,
    });
  }
  if (body.problem.length > 100_000) {
    log({ problem: body.problem, errorKind: 'request', errorMessage: '`problem` exceeds 100,000 chars' });
    return sendJson(res, 413, { error: '`problem` exceeds 100,000 chars', kind: 'request', request_id: requestId });
  }

  // Per-request T0/T2 limits (defaults from env)
  const timeoutMs = clampMs(body.timeout_ms, config.coordinator.requestTimeoutMs, 100, 600_000);
  const costCapUsd = clampNumber(body.cost_cap_usd, config.coordinator.requestCostCapUsd, 0, 1000);

  // Phase 1 passthrough (ADR-022): `pluginConfig` is the per-call
  // plugin-local config from the OC shim. It's a free-form object
  // — the coordinator validates it in `coordinate()` and uses it
  // for K resolution. Unknown keys are silently dropped; bad
  // shapes are logged on the envelope but don't break the call.
  const pluginConfig = body.pluginConfig;

  // T0: race the work against a wall-clock deadline
  let result;
  try {
    result = await raceWithTimeout(
      coordinateFn({
        problem: body.problem,
        task_type: body.task_type,
        K: body.K,
        context: { ...(body.context || {}), cost_cap_usd: costCapUsd },
        sessionId: body.sessionId,
        agentId: body.agentId,
        // The HTTP layer is the wiring point: the router lives at the
        // service surface, and we pass the router itself as the
        // heavy-think-compatible client. heavy-think expects a client
        // *object* with a `generate(prompt, opts)` method, and that's
        // exactly what `router` is. By passing the router here we get
        // the 3-tier fallback (minimax → Ollama) for free, and tests
        // can still override `coordinateFn` to bypass the router.
        client: router,
        // ADR-022 pluginConfig passthrough. The coordinator validates
        // and uses this; we pass it through unchanged so the
        // validator is the single source of truth for the shape.
        pluginConfig,
      }),
      timeoutMs,
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      log({ problem: body.problem, taskType: body.task_type, k: body.K, sessionId: body.sessionId, agentId: body.agentId, errorKind: 'timeout', errorMessage: `request exceeded ${timeoutMs}ms timeout` });
      return sendJson(res, 504, {
        error: `request exceeded ${timeoutMs}ms timeout`,
        kind: 'timeout',
        request_id: requestId,
      });
    }
    const message = err && err.message ? err.message : 'coordinate failed';
    const isBackend = /all .* backends failed|no healthy backends|cannot generate/i.test(message);
    const kind = isBackend ? 'backend' : 'internal';
    log({ problem: body.problem, taskType: body.task_type, k: body.K, sessionId: body.sessionId, agentId: body.agentId, errorKind: kind, errorMessage: message });
    return sendJson(res, isBackend ? 503 : 500, { error: message, kind, request_id: requestId });
  }

  // T2: cost-cap check — coordinate() should have honored it via context.cost_cap_usd,
  // but if a backend doesn't report cost, the result envelope can't enforce it. We surface
  // a 402 if the result reports a cost_usd that exceeds the cap.
  if (result && result.cost_usd != null && Number(result.cost_usd) > costCapUsd) {
    log({ problem: body.problem, taskType: body.task_type, k: body.K, sessionId: body.sessionId, agentId: body.agentId, result, errorKind: 'cost_cap', errorMessage: `cost_usd ${result.cost_usd} exceeded cap ${costCapUsd}` });
    return sendJson(res, 402, {
      error: `cost_usd ${result.cost_usd} exceeded cap ${costCapUsd}`,
      kind: 'cost_cap',
      cost_usd: result.cost_usd,
      cost_cap_usd: costCapUsd,
      request_id: requestId,
    });
  }

  // Normal envelope path
  if (result && result.ok === false) {
    const errType = (result.error && result.error.type) || 'internal_error';
    const errMessage = (result.error && result.error.message) || 'coordinate failed';
    log({ problem: body.problem, taskType: body.task_type, k: body.K, sessionId: body.sessionId, agentId: body.agentId, result, errorKind: errType, errorMessage: errMessage });
    const status = errType === 'invalid_input' ? 400 : errType === 'upstream_error' ? 503 : 500;
    return sendJson(res, status, { error: errMessage, kind: errType, request_id: requestId });
  }

  // Success path
  log({ problem: body.problem, taskType: body.task_type, k: body.K, sessionId: body.sessionId, agentId: body.agentId, result });
  return sendJson(res, 200, { ...(result || {}), request_id: requestId });
}

/**
 * Race a promise against a timeout. Rejects with a TimeoutError on expiry.
 * Does not cancel the underlying promise (Node fetch has its own AbortController,
 * but heavy_think doesn't expose one). The abandoned promise will still settle
 * and may emit a result — the caller is responsible for the resource lifetime.
 */
function raceWithTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(makeTimeoutError(ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function makeTimeoutError(ms) {
  const err = new Error(`timeout after ${ms}ms`);
  err.code = 'AWARE_TIMEOUT';
  return err;
}

function isTimeoutError(err) {
  return err && (err.code === 'AWARE_TIMEOUT' || /timeout/i.test(err.message || ''));
}

function clampMs(value, fallback, min, max) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNumber(value, fallback, min, max) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Allow direct execution: `node src/coordinator/http-server.js`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer()
    .then(({ port, host }) => {
      // eslint-disable-next-line no-console
      console.log(`[aware-coordinator] listening on http://${host}:${port} (${COORDINATOR_VERSION})`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[aware-coordinator] failed to start:', err);
      process.exit(1);
    });
}
