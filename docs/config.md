# AWARE 2.0 — Configuration

This document describes the centralized configuration system for AWARE 2.0, implemented as of commit `880a47c`. See [ADR (internal)](adr/ADR (internal).md) for the architectural decision and alternatives considered.

## Quick Start

```javascript
// In any v2 service:
const config = require('../config/index.cjs');  // CJS (gateway)
import config from '../config/index.cjs';        // ESM (coordinator)

// Read a value (lazy — re-reads process.env on every access)
const port = config.gateway.port;          // 18080
const mode = config.model.mode;            // "hybrid"
const url = config.gateway.coordinatorUrl; // "http://coordinator:8080"

// Validate at startup
try {
  config.validate();
} catch (e) {
  console.error('Invalid config:', e.message);
  process.exit(1);
}

// Get soft warnings (don't throw, just collect)
console.warn(config.warnings());

// Print a redacted snapshot for debugging
console.log(JSON.stringify(config.snapshot(), null, 2));
```

## Namespaces

### `config.coordinator` — read by `src/coordinator/http-server.js`

| Property             | Env var                       | Type    | Default              | Notes                                     |
|----------------------|-------------------------------|---------|----------------------|-------------------------------------------|
| `port`               | `COORDINATOR_PORT`            | number  | `8080`               | Container port; host-mapped to 18081      |
| `host`               | `COORDINATOR_HOST`            | string  | `127.0.0.1`          | `0.0.0.0` in container                    |
| `requestTimeoutMs`   | `AWARE_REQUEST_TIMEOUT_MS`    | number  | `120000`             | Per-request cap                           |
| `requestCostCapUsd`  | `AWARE_REQUEST_COST_CAP_USD`  | number  | `1.0`                | Per-request cost cap (observability)      |
| `killSwitch`         | `AWARE_KILL_SWITCH`           | boolean | `false`              | Toggling to `1`/`true` disables coordinator |

### `config.gateway` — read by `src/gateway/server.js`

| Property           | Env var                  | Type    | Default                  | Notes                                    |
|--------------------|--------------------------|---------|--------------------------|------------------------------------------|
| `port`             | `GATEWAY_PORT`           | number  | `18080`                  | Public-facing gateway port                |
| `host`             | `GATEWAY_HOST`           | string  | `0.0.0.0`                |                                          |
| `proxyTimeoutMs`   | `GATEWAY_PROXY_TIMEOUT_MS` | number | `120000`                 | Upstream timeout                          |
| `coordinatorUrl`   | `COORDINATOR_URL`        | string  | `http://coordinator:8080` | Container: `coordinator:8080`; host: `http://127.0.0.1:18081` |
| `killSwitch`       | `AWARE_GATEWAY_KILL_SWITCH` | boolean | `false`                | Toggling to `1`/`true` disables gateway  |

### `config.model` — read by `src/coordinator/index.js`

| Property         | Env var                | Type   | Default                                          | Notes                       |
|------------------|------------------------|--------|--------------------------------------------------|-----------------------------|
| `mode`           | `AWARE_MODE`           | string | `hybrid`                                         | Enum: `online`/`hybrid`/`offline` |
| `providerApiKey`     | `redacted-credential-name`      | string | (none)                                           | **Secret** — redacted in snapshot as `<unset>` or `<redacted length=N>` |
| `providerHost`    | `LLM_API_HOST`         | string | (none)                                           | Optional LLM API host override (see `src/config/index.cjs:164` for the canonical env var name) |
| `ollamaUrl`      | `OLLAMA_URL`           | string | `http://127.0.0.1:11434`                         | Local Ollama instance       |

### `config.rlPipeline` — read by `src/coordinator/index.js`

| Property | Env var                  | Type   | Default                                                       | Notes                          |
|----------|--------------------------|--------|---------------------------------------------------------------|--------------------------------|
| `path`   | `AWARE_RL_PIPELINE_PATH` | string | `<repo>/../../rl-pipeline/src/index.js` (sibling-repo path)   | rl-pipeline-bridge reasoning layer     |

### `config.warnings`

Array of soft validation issues, accumulated by `config.warnings()`. Examples:

- `redacted-credential-name not set; required in online mode`
- `OLLAMA_URL unreachable`
- `AWARE_REFINEMENT_COUNT=0; K must be >= 1`

Warnings are logged at startup but do not throw.

## API

### `config.<namespace>.<property>`

Lazy getter. Re-reads `process.env` on every access. **No caching.** This is intentional — see [Why lazy getters?](#why-lazy-getters) below.

```javascript
config.gateway.port           // reads GATEWAY_PORT or returns 18080
config.model.providerApiKey       // reads redacted-credential-name (secret; redact in snapshot)
config.coordinator.killSwitch // reads AWARE_KILL_SWITCH; bool coercion: "0"/"false" → false, "1"/"true"/"yes" → true
```

### `config.validate()`

Throws on hard validation failures:

- `mode=online` but `redacted-credential-name` is unset (no API key to call → hard fail)
- `GATEWAY_PORT === COORDINATOR_PORT` (must differ — they'd collide)
- Invalid `mode` enum (not in `{online, hybrid, offline}`)
- Out-of-bounds port (`<0` or `>65535`)
- Non-numeric values where a number is required
- Non-numeric / out-of-range where a finite number is required

```javascript
try {
  config.validate();
} catch (e) {
  console.error('Config error:', e.message);
  process.exit(1);
}
```

Called at module top in `src/gateway/server.js`. Coordinator and tests call it as needed.

### `config.warnings()`

Returns an array of soft validation issues. **Never throws.**

```javascript
const warns = config.warnings();
if (warns.length) console.warn('Config warnings:', warns);
```

### `config.snapshot()`

Returns a plain object suitable for debug dumps. Secret keys are replaced with `<redacted length=N>`. Useful for `console.log(JSON.stringify(config.snapshot(), null, 2))` or telemetry.

```javascript
{
  coordinator: { port: 8080, host: '127.0.0.1', requestTimeoutMs: 120000, requestCostCapUsd: 1, killSwitch: false },
  gateway:     { port: 18080, host: '0.0.0.0', proxyTimeoutMs: 120000, coordinatorUrl: 'http://coordinator:8080', killSwitch: false },
  model:       { mode: 'hybrid', providerApiKey: '<unset>' or '<redacted length=125>', ollamaUrl: 'http://127.0.0.1:11434' /* providerHost appears only when set */ },
  rlPipeline:  { path: '<repo-root>/src/index.js' },
  warnings:    []
}
```

> **JSON.stringify note:** `providerHost` is omitted from the JSON output when undefined (which is the common case). It appears in the JS object literal as `providerHost: undefined`, but `JSON.stringify` drops undefined values.

**Never write the value of `config.model.providerApiKey` (or any other secret) to logs/telemetry. Use `config.snapshot()`.**

## Why lazy getters?

Two reasons:

1. **Test override pattern.** Tests mutate `process.env.X` between calls and expect to see the new value. A cached config would force tests to call a refresh function on every override.

2. **Immediate kill-switch toggling.** Toggling `AWARE_KILL_SWITCH=1` (or `AWARE_GATEWAY_KILL_SWITCH=1`) takes effect on the next request, no restart. The kill-switch check in `isKilled()` reads the env var on every call, so the consumer doesn't need to coordinate config-refresh with the kill-switch decision.

The cost is a single `process.env.X` lookup per property access — negligible (<1µs). The trade-off is worth it.

## Why CJS (.cjs)?

- `src/gateway/server.js` is CJS (`require()`)
- `src/coordinator/http-server.js` is ESM (`import`)
- Node's CJS-to-ESM interop handles both directions
- `.cjs` extension forces Node to parse as CommonJS regardless of the package's `"type"` field in `package.json`

If you add a new module, **pick the extension that matches the dominant call site** (.cjs for gateway-style services, .mjs or .js with `"type": "module"` for coordinator-style services).

## Common tasks

### Set the model mode to offline (no API calls)

```bash
export AWARE_MODE=offline
```

### Disable the gateway without changing code

```bash
export AWARE_GATEWAY_KILL_SWITCH=1
```

### Print current config (debug)

```bash
cd <HOME>/src/AWARE && node -e "const c = require('./src/config/index.cjs'); console.log(JSON.stringify(c.snapshot(), null, 2))"
```

### Run the config tests

```bash
cd <HOME>/src/AWARE && node --test test/unit/config/index.test.js
```

## See also

- [ADR (internal)](adr/ADR (internal).md) — the architectural decision
- [ADR (internal)](adr/ADR (internal).md) — AWARE 2.0 architecture
- `src/config/index.cjs` — implementation
- `test/unit/config/index.test.js` — 18 tests
- `.env.example` — env-var reference
