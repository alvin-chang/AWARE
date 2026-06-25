# RESULT — Task 1: passthrough wrap + api.pluginConfig plumbing

**Date:** 2026-06-21 22:00 BST
**Branch:** `feature/aware-2.0`
**Commit:** `2fda6555bc875f6b0223a46fedaf4aad0d370681`
**Author:** Coder (sub-agent, dispatched by Reviewer via the coordinator)
**Source brief:** the coordinator dispatch, 2026-06-21 21:08 BST → Reviewer revision 21:33 → the coordinator 21:48 (push deferred)

---

## Summary

Closed the two open items from commit `301f672d` on `feature/aware-2.0`:

1. **Passthrough wrap (gateway proxy body-handling)** — the proxy now
   forwards the request body byte-for-byte. Replaced the global
   `express.json` middleware with a path-scoped `express.raw` (10 MiB
   default, `AWARE_GATEWAY_MAX_BODY_BYTES` override). The previous
   implementation parsed JSON via `express.json` and re-serialized
   the body on every request, which (a) lost byte-perfect fidelity,
   (b) capped bodies at 1 MiB, and (c) only worked for JSON. The
   new implementation accepts any content type, forwards the bytes
   verbatim, and rejects oversized bodies with `413 + body_too_large`
   before the proxy fires.

2. **`api.pluginConfig` plumbing (plugin-local config namespace)** —
   `coordinate()` now accepts a `pluginConfig` argument and uses it
   to resolve K (priority: explicit K > `agentDefaults.K` when
   enabled > `defaultK` > per-task-type fallback). The HTTP layer
   reads `pluginConfig` from the `/coordinate` request body and
   passes it to `coordinate()`. The validated `pluginConfig` and
   the validation result are echoed in the result envelope for
   audit. Core zod schemas are untouched — the plugin's own shape
   is the single source of truth, per ADR-022.

---

## Files changed

| Path | Change | Notes |
|------|--------|-------|
| `src/gateway/server.js` | rewrite of proxy path | `express.json` removed; `express.raw` on the catch-all proxy path; `getMaxBodyBytes()` re-reads env on every call; new `x-forwarded-by: aware-gateway` header; build_phase bumped to `phase-1-passthrough` |
| `src/coordinator/plugin-config.js` | new file (192 lines) | `validatePluginConfig()`, `resolveKFromPluginConfig()`, `sanitizePluginConfig()`, `K_PLUGIN_CONFIG_VERSION=1` |
| `src/coordinator/index.js` | +44 lines | `coordinate()` accepts `pluginConfig`; K resolution moved to a separate module; `COORDINATOR_VERSION` and `COORDINATOR_BUILD_PHASE` bumped to `0.3.0-phase-1-pluginconfig` and `phase-1-passthrough` |
| `src/coordinator/heavyskill-integration.js` | +35 lines | `awareHeavyThink` accepts `pluginConfig` + `pluginConfigValidation`; echoes both in the envelope |
| `src/coordinator/http-server.js` | +11 lines | `/coordinate` reads `body.pluginConfig` and passes it to `coordinateFn` |
| `test/unit/coordinator/plugin-config.test.js` | new (25 tests) | sanitize + validate + K resolution priority end-to-end |
| `test/unit/coordinator/http-server.test.js` | +131 lines (4 new tests) | pluginConfig passthrough, bad-shape silent, empty-object OK |
| `test/unit/gateway/server.test.js` | +280 lines (7 new tests + version assertion) | non-JSON byte-perfect, JSON byte-perfect, 3 MiB body, x-forwarded-by, /version max_body_bytes, getMaxBodyBytes helper, GET no-body clean |
| `test/unit/coordinator/heavyskill-integration.test.js` | version assertion bumped | reflects the new `COORDINATOR_VERSION` / `COORDINATOR_BUILD_PHASE` |
| `test/unit/coordinator/index.test.js` | version assertion bumped | reflects the new `COORDINATOR_VERSION` / `COORDINATOR_BUILD_PHASE` |

**Total:** 1125 insertions, 75 deletions across 10 files.

---

## Test results

### Baseline (before this work) — `301f672d` HEAD

| Suite | Pass | Fail | Skip | Notes |
|-------|------|------|------|-------|
| AWARE unit | 319 | 3 | 0 | 3 fails = pre-existing `toDpoDataset is not a function` in trainer tests |
| AWARE integration | 12 | 1 | 1 | 1 fail = pre-existing compose-file assertion (missing `/weight-store/`); 1 skip = env-gated |
| Heavy-think | 10 | 0 | 0 | All pass; the 74 in the original <internal-doc> is from an older baseline |
| **Total** | **341** | **4** | **1** | |

### After this work — `2fda6555` HEAD

| Suite | Pass | Fail | Skip | Δ Pass | Δ Fail |
|-------|------|------|------|--------|--------|
| AWARE unit | 356 | 3 | 0 | +37 | 0 |
| AWARE integration | 12 | 1 | 1 | 0 | 0 |
| Heavy-think | 10 | 0 | 0 | 0 | 0 |
| **Total** | **378** | **4** | **1** | **+37** | **0** |

**0 new failures introduced.** All 3 failing trainer tests are pre-existing
(missing `toDpoDataset` export in heavy-think — out of scope for Task 1;
tracked in the trainer issues for follow-up). The 1 failing integration
test is the pre-existing compose-file assertion.

### Coverage of the new contract

| Test | What it pins down |
|------|-------------------|
| `sanitize: returns null for null/undefined input` | null is a valid "no config" signal |
| `sanitize: returns null for arrays` | arrays are rejected (caller error) |
| `sanitize: drops unknown keys` | strict shape; future keys go through the schema |
| `sanitize: drops out-of-range K` | K clamped to [1, 16]; bad types dropped silently |
| `validate: array input is not ok` | caller error path returns `ok: false` + `errors: [...]` |
| `validate: object with only unknown keys is not ok` | catches wrong schema versions |
| `resolveK: explicit K wins over pluginConfig and taskType` | priority 1 |
| `resolveK: agentDefaults.K wins over pluginConfig.defaultK when enabled` | priority 2 |
| `resolveK: agentDefaults.K ignored when agentDefaults.enabled is false` | priority 2 only when enabled |
| `resolveK: pluginConfig.defaultK wins over taskType` | priority 3 |
| `resolveK: null/empty pluginConfig falls through to defaultKForTaskType` | priority 4 |
| `resolveK: end-to-end priority demo` | all four sources, full priority chain |
| `passthrough: forwards a non-JSON body byte-for-byte (text/plain)` | the core passthrough contract |
| `passthrough: forwards a JSON body byte-for-byte (no re-serialization)` | numbers with extreme precision survive |
| `passthrough: forwards a body larger than the previous 1 MiB cap (3 MiB)` | the 10x cap increase is real |
| `passthrough: rejects a body above the max with 413 + body_too_large` | hard limit; no partial forward |
| `passthrough: adds x-forwarded-by header` | audit; coordinator can tell gateway traffic from direct |
| `passthrough: /version reports max_body_bytes` | operator can verify the cap without restarting |
| `passthrough: getMaxBodyBytes() returns the env override` | helper is exported for tests + tooling |
| `passthrough: GET (no body) still proxies cleanly` | GETs strip Content-Length, no phantom |
| `POST /coordinate passes pluginConfig through to coordinate()` | wire-up works end-to-end |
| `POST /coordinate omits pluginConfig when not in the body (back-compat)` | no breaking change |
| `POST /coordinate with a bad-shape pluginConfig still processes the request (200)` | silent on bad shape, doesn't 4xx |
| `POST /coordinate with an empty pluginConfig object works` | edge case |

---

## End-to-end smoke tests (manual, both passed)

- **Passthrough byte-perfect**: real gateway + fake upstream.
  Sent a 52-byte JSON body with `1.7976931348623157e+308` (a value
  that would not roundtrip through `JSON.parse + JSON.stringify`).
  Upstream received exactly those 52 bytes; `x-forwarded-by` was
  `aware-gateway`; `x-request-id` was echoed. ✓
- **pluginConfig K resolution**: real `coordinate()` with a
  pluginConfig that puts `agentDefaults.enabled: true, K: 6` ahead
  of `defaultK: 3`. The result envelope included
  `plugin_config: { defaultK: 3, agentDefaults: { enabled: true, K: 6 } }`
  and `plugin_config_validation: { ok: true }`. ✓

---

## ADR-022 contract — what we shipped

ADR-022 specifies the plugin-local config surface:

> All config lives in `api.pluginConfig` (the parsed
> `plugins.entries.<id>.config` object). The manifest's `configSchema`
> declares the shape. Core zod schemas are NOT touched.

What this commit ships:

- **Wire format**: `pluginConfig` is an object with `defaultK`
  (1..16), `autoEnable` (boolean), `agentDefaults.enabled` (boolean),
  `agentDefaults.K` (1..16). Unknown keys are stripped; bad shapes
  are returned as `ok: false` with a human-readable `errors` array.
- **K resolution priority**: explicit K > agentDefaults.K (when
  enabled) > defaultK > per-task-type. The `source` field on the
  result tells the caller which source won.
- **Silent on bad shape**: a misbehaving caller cannot break the
  request path. The validation result is logged on the envelope
  for observability.
- **Core zod untouched**: `api.pluginConfig` is opaque to the core
  zod schema; the plugin's own `configSchema` (in the OC manifest)
  is the source of truth.

---

## Risks / known issues

1. **`AWARE_GATEWAY_MAX_BODY_BYTES` is read at module load by
   `express.raw({ limit })`.** The middleware instance captures
   the limit once and uses it for the lifetime of the process.
   Hot re-config would require re-requiring the module. The
   `/version` endpoint re-reads the env on every request so
   operators can verify the cap at runtime.

2. **OC shim is not yet calling AWARE coordinator.** The v4
   HeavySkill strategy in `<heavyskill-plugin-source>/` does K+S
   via the agent's own model client; it doesn't proxy through
   AWARE. The `api.pluginConfig` plumbing I added here is the
   receiving end of a future wire-up: when the OC shim is
   updated to call AWARE for K+S (or when the AWARE coordinator
   is wired into the model-router), the API contract is ready.
   This is a known gap and tracked separately (the actual
   HeavySkill v4 paper-faithful K+S lives in the heavyskill-plugin
   repo, which is Task 2 of this dispatch).

3. **The `attempts` envelope from heavy-think is still v1-style
   (K+1 calls with PRM + refine).** This is a separate concern
   from the passthrough + pluginConfig work; the paper-faithful
   v2 K+S is in the heavyskill-plugin. The wire contract I
   shipped (pluginConfig shape, K priority, envelope fields)
   is forward-compatible with v2.

4. **3 pre-existing trainer test failures** (`toDpoDataset is not
   a function`) are unrelated to this work and out of scope. They
   were failing before `301f672d` and continue to fail. Track in
   a follow-up for the trainer code.

5. **1 pre-existing integration test failure** in
   `test/integration/bring-up-coordinator.test.js` (compose file
   missing `/weight-store/`) is also pre-existing and out of scope.

---

## Follow-ups

- Wire the OC shim to call AWARE `/coordinate` with `pluginConfig`
  set to `api.pluginConfig` (so the coordinator's K resolution
  actually gets exercised in production). This is the missing
  half of the contract.
- Once OC calls AWARE, add an integration test that boots the
  real OC shim + AWARE coordinator and exercises the four
  activation surfaces end-to-end.
- The 3 pre-existing trainer test failures and the 1 pre-existing
  compose-file integration failure should be triaged separately
  (out of scope for Task 1).

---

## Operational notes

- **Branch:** `feature/aware-2.0`
- **Commit:** `2fda6555bc875f6b0223a46fedaf4aad0d370681`
- **Files changed:** 10 (4 src + 6 test, including 2 new files)
- **Diff size:** +1125 / -75
- **Push deferred — Gitea credential rotation in progress, awaiting Reviewer/Alvin.**
- Branch is 2 commits ahead of `origin/feature/aware-2.0` (this + `24d82ee`).

[RESULT]
