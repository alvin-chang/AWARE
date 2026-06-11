// AWARE 2.0 coordinator service — HTTP API
// Per ADR-020 Decision 1: persistent coordinator session + lightweight task workers
// Per ADR-020 Decision 3: 3-tier model fallback (minimax → Ollama)
//
// This module is the *service surface* for the coordinator. It exposes:
//   - POST /coordinate  → run heavy-think on a problem, return selected answer
//   - GET  /health      → router health snapshot (200 healthy, 503 degraded)
//   - GET  /version     → coordinator version + build phase
//
// It uses Node's built-in `http` module — no Express — so the surface stays
// small and the deployable artifact is just `node src/coordinator/http-server.js`.
//
// Bounded by T0-T4 enforcement (see ADR-020 Decision 4): the router enforces
// timeout / cost-cap / fallback / kill-switch. This module does not duplicate
// those concerns; it delegates to the router and surfaces failures honestly.

import http from 'node:http';
import { coordinate, buildDefaultRouter, COORDINATOR_VERSION, COORDINATOR_BUILD_PHASE } from './index.js';

const DEFAULT_PORT = Number(process.env.COORDINATOR_PORT) || 8080;
const DEFAULT_HOST = process.env.COORDINATOR_HOST || '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB — coordinator inputs are prompts, not file uploads

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
 * @returns {Promise<{server: http.Server, port: number, host: string, close: () => Promise<void>}>}
 */
export async function startServer(opts = {}) {
  const host = opts.host ?? DEFAULT_HOST;
  // `opts.port === 0` is a valid request (OS picks a free port) — use ??
  // not || so the fallback doesn't kick in for the zero value.
  const port = opts.port ?? DEFAULT_PORT;
  const router = opts.router || (await buildDefaultRouter(opts.routerOpts || {}));
  const coordinateFn = opts.coordinateFn || coordinate;

  const server = http.createServer(async (req, res) => {
    try {
      // Routing
      if (req.method === 'GET' && req.url === '/health') {
        return handleHealth(req, res, router);
      }
      if (req.method === 'GET' && req.url === '/version') {
        return sendJson(res, 200, {
          version: COORDINATOR_VERSION,
          build_phase: COORDINATOR_BUILD_PHASE,
        });
      }
      if (req.method === 'POST' && req.url === '/coordinate') {
        return await handleCoordinate(req, res, router, coordinateFn);
      }
      return sendText(res, 404, 'not found');
    } catch (err) {
      // Internal error envelope
      const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
      const body = {
        error: err.message || 'internal error',
        kind: status === 500 ? 'internal' : 'request',
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

  const actualPort = server.address().port;

  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });

  return { server, port: actualPort, host, close };
}

/**
 * GET /health — router health snapshot.
 * - 200 if at least one backend is healthy (or if the router has no health probes)
 * - 503 if all backends are unhealthy
 * - 500 if the router itself throws (degraded but server stays up)
 */
async function handleHealth(req, res, router) {
  let snapshot;
  try {
    snapshot = await router.health();
  } catch (err) {
    return sendJson(res, 500, {
      status: 'degraded',
      error: err.message || 'router health() threw',
      kind: 'internal',
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
    checked_at: snapshot.at || new Date().toISOString(),
  });
}

/**
 * POST /coordinate — run heavy-think on a problem.
 *
 * Request body: { problem: string, task_type?: string, K?: number, context?: object, sessionId?: string, agentId?: string }
 *
 * Response shape (success):  200 with the coordinate() result envelope
 * Response shape (failure):  400 / 503 / 500 with the error envelope from the coordinator
 *
 * The coordinator returns `{ok: false, error: {type, message}}` on failure (does not throw).
 * We map `error.type` to HTTP status:
 *   - 'invalid_input'  → 400
 *   - 'upstream_error' → 503 (the upstream model API failed)
 *   - 'internal_error' → 500
 * A thrown error is treated as 500 unless the message matches a known pattern.
 */
async function handleCoordinate(req, res, router, coordinateFn) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message, kind: 'request' });
  }

  let body;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid JSON in request body', kind: 'request' });
  }

  if (typeof body.problem !== 'string' || body.problem.length === 0) {
    return sendJson(res, 400, {
      error: '`problem` is required and must be a non-empty string',
      kind: 'request',
    });
  }
  if (body.problem.length > 100_000) {
    return sendJson(res, 413, { error: '`problem` exceeds 100,000 chars', kind: 'request' });
  }

  let result;
  try {
    result = await coordinateFn({
      problem: body.problem,
      task_type: body.task_type,
      K: body.K,
      context: body.context,
      sessionId: body.sessionId,
      agentId: body.agentId,
    });
  } catch (err) {
    // The coordinate function threw rather than returning an error envelope.
    // Map by message pattern.
    const message = err && err.message ? err.message : 'coordinate failed';
    const isBackend = /all .* backends failed|no healthy backends|cannot generate/i.test(message);
    return sendJson(res, isBackend ? 503 : 500, { error: message, kind: isBackend ? 'backend' : 'internal' });
  }

  // Normal envelope path: result is { ok: true, ...result } or { ok: false, error: { type, message } }
  if (result && result.ok === false) {
    const errType = (result.error && result.error.type) || 'internal_error';
    const errMessage = (result.error && result.error.message) || 'coordinate failed';
    const status = errType === 'invalid_input' ? 400 : errType === 'upstream_error' ? 503 : 500;
    return sendJson(res, status, { error: errMessage, kind: errType });
  }

  return sendJson(res, 200, result);
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
