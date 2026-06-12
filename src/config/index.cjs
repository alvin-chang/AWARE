// AWARE 2.0 — centralized configuration
//
// Single source of truth for every v2 env var the AWARE stack reads.
// Reads are LAZY (every property access re-reads process.env) so:
//   - Tests can override env between requests without import-cache gymnastics
//   - The gateway's per-request COORDINATOR_URL pattern keeps working
//   - The kill-switch toggle takes effect immediately (already a requirement)
//
// Validation runs at access time on the things that can fail loudly at boot
// (numeric parsing, mode enum, secret presence for online mode). Soft
// warnings (e.g. OLLAMA_URL when mode=offline) are surfaced via a sidecar
// `validation` snapshot — see snapshot() below.
//
// Out of scope:
//   - v1 code (src/server.js, src/api/*, src/audit/*, src/routing/*, src/ui/*)
//     stays on its own ad-hoc process.env reads; v1.0.0 is shipped and live.
//   - v1-style layered config (YAML file < env) — that's ADR-021 territory.
//
// Public API:
//   import config from './config/index.cjs';         // ESM consumers (coordinator)
//   const config = require('./config/index.cjs');    // CJS consumers (gateway, tests)
//   config.gateway.host            // '0.0.0.0' (or process.env.GATEWAY_HOST)
//   config.model.minimaxKey        // process.env.<redacted-credential-name> (string | undefined)
//   config.model.mode              // 'online' | 'hybrid' | 'offline'
//   config.ollama.url              // 'http://127.0.0.1:11434'
//   config.snapshot()              // redacted JSON for logging
//   config.validate()              // throws on hard failures
//   config.warnings()              // string[] of soft warnings

const path = require('node:path');

// --- helpers ------------------------------------------------------------

function str(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function num(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Config: ${name}=${JSON.stringify(raw)} is not a finite number`
    );
  }
  if (n < min || n > max) {
    throw new Error(
      `Config: ${name}=${n} is out of range [${min}, ${max}]`
    );
  }
  return n;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function enumOf(name, allowed, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  if (!allowed.includes(v)) {
    throw new Error(
      `Config: ${name}=${JSON.stringify(v)} is not one of [${allowed.join(', ')}]`
    );
  }
  return v;
}

const SECRET_NAMES = new Set(['minimaxKey', 'password']);

function redact(name, value) {
  if (SECRET_NAMES.has(name)) {
    if (value === undefined || value === null || value === '') return '<unset>';
    return `<redacted length=${String(value.length)}>`;
  }
  return value;
}

// --- dev-layout fallback path for heavy-think ---------------------------

function defaultHeavyThinkPath() {
  // src/config/index.js → ../../../heavy-think/src/index.js
  // The AWARE repo lives at <repo-root>/ and heavy-think is
  // a sibling at <repo-root>/. From this file:
  //   src/config/index.js → ../  → src
  //                          ../../  → AWARE repo root
  //                          ../../../  → <HOME>/src (parent of both repos)
  //                          ../../../heavy-think/src/index.js
  // __filename is the CJS path to this file.
  const here = path.dirname(__filename);
  return path.resolve(here, '..', '..', '..', 'heavy-think', 'src', 'index.js');
}

// --- the config object (lazy via getters) -------------------------------

const config = {
  // Coordinator HTTP service
  coordinator: {
    get port() { return num('COORDINATOR_PORT', 8080, { min: 0, max: 65535 }); },
    get host() { return str('COORDINATOR_HOST', '127.0.0.1'); },
    get requestTimeoutMs() { return num('AWARE_REQUEST_TIMEOUT_MS', 120_000, { min: 1000, max: 600_000 }); },
    get requestCostCapUsd() { return num('AWARE_REQUEST_COST_CAP_USD', 1.0, { min: 0, max: 1000 }); },
    get killSwitch() { return bool('AWARE_KILL_SWITCH', false); },
  },

  // Gateway HTTP service
  gateway: {
    get port() { return num('GATEWAY_PORT', 18080, { min: 0, max: 65535 }); },
    get host() { return str('GATEWAY_HOST', '0.0.0.0'); },
    get proxyTimeoutMs() { return num('GATEWAY_PROXY_TIMEOUT_MS', 120_000, { min: 1000, max: 600_000 }); },
    get coordinatorUrl() { return str('COORDINATOR_URL', 'http://coordinator:8080'); },
    get killSwitch() { return bool('AWARE_GATEWAY_KILL_SWITCH', false); },
  },

  // Model layer
  model: {
    get mode() { return enumOf('AWARE_MODE', ['online', 'hybrid', 'offline'], 'hybrid'); },
    get minimaxKey() { return str('<redacted-credential-name>', undefined); },
    get minimaxHost() { return str('MINIMAX_API_HOST', undefined); },
    get ollamaUrl() { return str('OLLAMA_URL', 'http://127.0.0.1:11434'); },
  },

  // Heavy-think (sibling repo) — path is computed but not validated here;
  // resolution is left to the coordinator so we can return a clean error
  // from the request handler if the file is missing.
  heavyThink: {
    get path() { return str('AWARE_HEAVY_THINK_PATH', defaultHeavyThinkPath()); },
  },

  // Postgres (Phase 2.1 conversation logger)
  // `enabled=false` makes the logger a no-op; useful for offline dev.
  // `password` is in SECRET_NAMES so it's redacted in snapshot().
  db: {
    get host() { return str('AWARE_DB_HOST', '127.0.0.1'); },
    get port() { return num('AWARE_DB_PORT', 5432, { min: 1, max: 65535 }); },
    get database() { return str('AWARE_DB_DATABASE', 'aware2'); },
    get user() { return str('AWARE_DB_USER', 'aware'); },
    get password() { return str('AWARE_POSTGRES_PASSWORD', undefined); },
    get enabled() { return bool('AWARE_DB_ENABLED', true); },
    get connectionTimeoutMs() { return num('AWARE_DB_CONNECTION_TIMEOUT_MS', 2000, { min: 100, max: 30_000 }); },
  },
};

// --- validation ---------------------------------------------------------

/**
 * Validate the current config. Throws on hard failures. Returns the same
 * config object on success.
 *
 * Hard failures (boot-blocking):
 *   - mode=online without <redacted-credential-name>
 *   - any numeric / enum parse error (already throws at access)
 *
 * Soft warnings (returned by warnings(), not thrown):
 *   - mode=offline without OLLAMA_URL reachable at startup is not checked
 *     here — that's a runtime check when the first request lands
 *   - heavyThink path doesn't exist on disk is not checked here
 */
config.validate = function validate() {
  if (config.model.mode === 'online' && !config.model.minimaxKey) {
    throw new Error(
      'Config: AWARE_MODE=online requires <redacted-credential-name> (set it via env_file or compose env)'
    );
  }
  if (config.gateway.port === config.coordinator.port) {
    throw new Error(
      `Config: GATEWAY_PORT (${config.gateway.port}) must differ from COORDINATOR_PORT (${config.coordinator.port})`
    );
  }
  // Force-evaluate all lazy accessors so a bad value fails at validate(),
  // not at first request.
  void config.coordinator.requestTimeoutMs;
  void config.coordinator.requestCostCapUsd;
  void config.gateway.proxyTimeoutMs;
  return config;
};

/**
 * Soft warnings (do not block boot).
 */
config.warnings = function warnings() {
  const out = [];
  if (config.model.mode === 'offline' && !config.ollamaUrl) {
    out.push('AWARE_MODE=offline but OLLAMA_URL is not set — fallback will be unavailable');
  }
  if (!config.model.minimaxKey && config.model.mode !== 'offline') {
    // Not a hard fail (we have a stub client) but worth flagging.
    out.push('<redacted-credential-name> is not set — primary tier will fail and fall through to Ollama');
  }
  return out;
};

/**
 * Return a redacted JSON-serializable snapshot of the current config.
 * Use this for /version logging, debug endpoints, and `npm run config:show`.
 */
config.snapshot = function snapshot() {
  const c = config;
  return {
    coordinator: {
      port: c.coordinator.port,
      host: c.coordinator.host,
      requestTimeoutMs: c.coordinator.requestTimeoutMs,
      requestCostCapUsd: c.coordinator.requestCostCapUsd,
      killSwitch: c.coordinator.killSwitch,
    },
    gateway: {
      port: c.gateway.port,
      host: c.gateway.host,
      proxyTimeoutMs: c.gateway.proxyTimeoutMs,
      coordinatorUrl: c.gateway.coordinatorUrl,
      killSwitch: c.gateway.killSwitch,
    },
    model: {
      mode: c.model.mode,
      minimaxKey: redact('minimaxKey', c.model.minimaxKey),
      minimaxHost: c.model.minimaxHost,
      ollamaUrl: c.model.ollamaUrl,
    },
    heavyThink: {
      path: c.heavyThink.path,
    },
    db: {
      host: c.db.host,
      port: c.db.port,
      database: c.db.database,
      user: c.db.user,
      password: redact('password', c.db.password),
      enabled: c.db.enabled,
      connectionTimeoutMs: c.db.connectionTimeoutMs,
    },
    warnings: c.warnings(),
  };
};

module.exports = config;
module.exports.default = config;
