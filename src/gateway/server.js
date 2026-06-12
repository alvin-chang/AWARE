// AWARE 2.0 gateway — thin BFF in front of the coordinator.
//
// Per ADR-020 Phase 1, gateway extraction is option A: a thin HTTP proxy
// that adds the v1-style middleware (helmet, cors, rate-limit, json) in
// front of the coordinator, and a kill-switch that takes precedence
// over the coordinator's kill-switch (defense in depth).
//
// What this service does:
//   - Adds helmet, cors, express-rate-limit, json middleware
//   - Adds a per-request X-Request-Id (or echoes the inbound one)
//   - Forwards /coordinate, /health, /version to the coordinator
//   - Exposes its own /version (gateway version, not coordinator version)
//   - Honors AWARE_GATEWAY_KILL_SWITCH=1 (returns 503 immediately, even
//     if the coordinator's kill-switch is off)
//
// What this service does NOT do:
//   - Auth / JWT (Phase 5 decision; matches v1's auth posture today)
//   - Local state (the coordinator is the model layer)
//   - Model fallback (the coordinator owns the 3-tier router)
//   - Persistent preferences / DPO / training (Phase 2+)
//
// The gateway is intentionally a small dependency footprint (express,
// helmet, cors, express-rate-limit) so its image can stay small and
// auditable. No http-proxy-middleware: the proxy is implemented with
// node:http directly, ~30 lines, no third-party trust chain.
//
// In docker compose, the gateway sits behind `profiles: ["full"]` so
// the bring-up script's default 4-service stack works without it; the
// full 5-service stack runs with `--profile full`.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const config = require('../config/index.cjs');

const GATEWAY_VERSION = '0.1.0-phase-1-gateway';

// All env reads live in src/config/index.js. We validate at boot so a
// bad value (e.g. non-numeric GATEWAY_PORT) fails fast here, not on
// the first request. The kill-switch, COORDINATOR_URL, etc. are
// re-read on every access (config getters are lazy) so toggling
// process.env at runtime still works — that's how the tests work,
// and how the gateway's per-request upstream switch could work.
config.validate();

function isKilled() {
  return config.gateway.killSwitch;
}

const app = express();

// --- Middleware: in the same order as the v1 server.js ------------------
app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limit: 600 requests / minute / IP. Same posture as the v1 server
// (express-rate-limit default is much higher; we set this so a misbehaving
// client cannot saturate the coordinator with retries).
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Request id: use inbound X-Request-Id if present, else generate one.
// Propagated to the coordinator so a single request can be traced
// end-to-end through gateway -> coordinator -> router -> model client.
app.use((req, res, next) => {
  const inbound = req.header('x-request-id');
  const id = (typeof inbound === 'string' && inbound.length > 0 && inbound.length < 200)
    ? inbound
    : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
});

// --- Health & version (gateway's own) ---------------------------------
app.get('/health', (req, res) => {
  const killed = isKilled();
  res.status(killed ? 503 : 200).json({
    status: killed ? 'down' : 'ok',
    service: 'aware-gateway',
    version: GATEWAY_VERSION,
    kill_switch: killed,
    upstream: config.gateway.coordinatorUrl,
    request_id: req.id,
  });
});

app.get('/version', (req, res) => {
  res.json({
    service: 'aware-gateway',
    version: GATEWAY_VERSION,
    coordinator_url: config.gateway.coordinatorUrl,
    build_phase: 'phase-1-gateway',
    request_id: req.id,
  });
});

// --- Proxy: forward /coordinate to the coordinator --------------------
//
// We use node:http directly rather than http-proxy-middleware to keep
// the dep tree small. The proxy is generic: any path that isn't handled
// above gets forwarded. This means new coordinator routes work without
// gateway code changes.
app.all(/^\/(coordinate|coordinate\/.*|.*)$/, (req, res) => {
  // Gateway kill-switch takes precedence over coordinator kill-switch.
  // Defense in depth: an operator who only knows the gateway env var
  // can still halt traffic.
  if (isKilled()) {
    res.status(503).json({
      error: 'gateway kill-switch engaged',
      kind: 'killed',
      request_id: req.id,
    });
    return;
  }

  // The regex above always matches, so we just need the upstream URL.
  // We exclude /health and /version because those are handled above.
  if (req.path === '/health' || req.path === '/version') {
    res.status(404).json({ error: 'not found', request_id: req.id });
    return;
  }

  proxyToCoordinator(req, res);
});

function proxyToCoordinator(req, res) {
  // Bypass the express.json body parser for proxy traffic. The body
  // parser runs at the application level for all routes; for the
  // proxy, we want the raw IncomingMessage so we can pipe it cleanly
  // to the upstream. We do this by re-constructing a passthrough on
  // the request stream.
  return new Promise((resolve) => {
    proxyRequest(req, res, resolve);
  });
}

function proxyRequest(req, res, done) {
  const target = new URL(config.gateway.coordinatorUrl);
  // Build the upstream options. We re-derive the body if express.json
  // has already consumed it (we have the parsed object in req.body),
  // and we strip Content-Length when there's no body so the upstream
  // doesn't hang waiting for bytes that won't arrive.
  let bodyBytes = null;
  if (req.readableEnded || req.complete) {
    if (req.body && Object.keys(req.body).length > 0) {
      // Re-serialize the parsed body and re-derive Content-Length.
      bodyBytes = Buffer.from(JSON.stringify(req.body), 'utf8');
    }
  }

  const fwdHeaders = { ...req.headers };
  delete fwdHeaders['content-length'];  // we'll re-set below
  if (bodyBytes) {
    fwdHeaders['content-length'] = String(bodyBytes.length);
  }
  // The 127.0.0.1:18080 gateway host:port is meaningless to the
  // upstream; replace with the coordinator's expected Host.
  delete fwdHeaders.host;
  Object.assign(fwdHeaders, {
    'x-request-id': req.id,
    'x-forwarded-host': req.header('host') || '',
    'x-forwarded-proto': req.protocol,
  });

  const opts = {
    method: req.method,
    hostname: target.hostname,
    port: target.port || 80,
    path: req.originalUrl,
    headers: fwdHeaders,
    timeout: config.gateway.proxyTimeoutMs,
  };

  const upstream = http.request(opts, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
    upstreamRes.on('end', () => done && done());
  });

  upstream.on('timeout', () => {
    upstream.destroy(new Error('upstream timeout'));
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: `upstream error: ${err.message}`,
        kind: 'upstream',
        request_id: req.id,
      });
      done && done();
    } else {
      res.destroy();
    }
  });

  req.on('aborted', () => upstream.destroy());

  // Body is always fully buffered by express.json before this handler
  // runs, so `req.readableEnded` is always true at this point and we
  // can re-serialize req.body if present, or send empty.
  upstream.end(bodyBytes || undefined);
}

// --- Start server ----------------------------------------------------
//
// The gateway's production entry is the `require.main === module` block
// below. We do not extract this into a testable function because:
//   - app.listen() is already trivially callable in tests via the
//     `startGateway()` helper in test/unit/gateway/server.test.js
//   - The `process.on('SIGTERM'/'SIGINT')` handlers call process.exit()
//     which is not safe to invoke from a test runner
//   - The `console.log` boot lines are observable but not contract
//
// Uncovered lines (L227-248 in the original numbering) are a known
// coverage gap by design.
if (require.main === module) {
  const server = app.listen(config.gateway.port, config.gateway.host, () => {
    // eslint-disable-next-line no-console
    console.log(`[aware-gateway] listening on http://${config.gateway.host}:${config.gateway.port}`);
    // eslint-disable-next-line no-console
    console.log(`[aware-gateway] upstream: ${config.gateway.coordinatorUrl}`);
    // eslint-disable-next-line no-console
    console.log(`[aware-gateway] kill-switch: ${isKilled() ? 'ENGAGED' : 'off'}`);
  });

  // Graceful shutdown: the coordinator's Dockerfile uses node:22-alpine
  // and sends SIGTERM on `docker stop`. Drain in-flight requests, then
  // close. (Phase 1 bring-up tears down with `down -v`; this matters
  // for Phase 2+ rolling restarts.)
  const shutdown = (signal) => () => {
    // eslint-disable-next-line no-console
    console.log(`[aware-gateway] received ${signal}, draining...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

module.exports = { app, GATEWAY_VERSION, isKilled };
