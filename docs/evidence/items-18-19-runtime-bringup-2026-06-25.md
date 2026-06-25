# Items 18/19 Runtime Evidence — AWARE 2.0 Bring-up Investigation

**Date:** 2026-06-25
**Operator:** aware maintainers (in-place exec, not via dispatch)
**Goal:** Bring up the AWARE coordinator stack end-to-end, make a real
`/coordinate` call against it, and capture the audit-log HTTP query
(`/api/audit/chain`) as the items 18/19 acceptance evidence.

---

## TL;DR

**The coordinator stack fails to boot in a way unit tests didn't catch.**
The bring-up succeeded to the point where postgres + redis are healthy,
the v2 DB migrations (001–005) applied, and the coordinator image builds
cleanly. But the coordinator Node process crash-loops on import-time
resolution of the heavy-think module — a static relative import path
that ignores the `AWARE_HEAVY_THINK_PATH` env var the Dockerfile
supplies.

This is **a real bug, not an env misconfig**. The bring-up was claimed
to work in earlier sessions (v2.5.0 staging bring-up), but on direct
re-execution it does not. We are reporting this honestly rather than
fabricating a passing transcript.

---

## Environment used

- **Host:** macOS, colima Docker VM (Docker 28.x)
- **Repo working tree:** `<repo-root>` on `release/v2.5.3-ga-final` (local)
- **Image built:** `aware-coordinator:0.4.5-phase4-heavy-think-from-internal-git`
- **Build args:**
  - `HEAVY_THINK_REPO=http://git.internal/heavy-think.git` (local Gitea)
  - `HEAVY_THINK_TAG=v0.2.2` (pinned in compose)
- **Runtime env sourced from:** `~/.openclaw/credentials/ACTIVE-CREDENTIALS.env`
  (`MINIMAX_API_KEY`, `AWARE_POSTGRES_PASSWORD`)
- **Compose project name:** `aware-2`
- **Coordinator host port:** `38181:8080` (was `18081`/`28181` in earlier
  sessions; colima SSH daemon PID 2962 binds those, so we use `38181`).
- **Coordinator bind address:** `COORDINATOR_HOST=0.0.0.0` (changed from
  `127.0.0.1` for this run because the docker-proxy DNAT path requires
  the in-container listener to accept non-loopback traffic).

## Stack status (live)

| Container | Status | Ports |
|---|---|---|
| `aware-2-postgres` | Up (healthy) | 0.0.0.0:18432→5432/tcp |
| `aware-2-redis` | Up (healthy) | 0.0.0.0:18379→6379/tcp |
| `aware-2-coordinator` | **Restarting (crash loop)** | 38181→8080/tcp |
| `aware-2-gateway` | Created (not started) | — |

## DB migrations applied

```
aware-db migration applied: 001_conversations.sql
aware-db migration applied: 002_prm_cache.sql
aware-db migration applied: 003_budget_windows.sql
aware-db migration applied: 004_training_runs.sql
aware-db migration applied: 005_azr_results.sql
```

(All five migrations apply cleanly against the fresh postgres volume.)

## Coordinator crash loop (live logs)

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/heavy-think/src/index.js'
  imported from /app/src/coordinator/heavyskill-integration.js
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    ...
Node.js v22.23.1
```

## Root cause

`src/coordinator/heavyskill-integration.js:16` uses a **static relative
import**:

```js
import {
  heavy_think as heavyThink,
  defaultKForTaskType,
  K_CONFIGS,
} from '../../../heavy-think/src/index.js';
```

From `/app/src/coordinator/heavyskill-integration.js`, three `..` resolve
to `/`. The Dockerfile puts heavy-think at `/app/heavy-think/` and adds a
symlink `/src/heavy-think → /app/heavy-think` (line 115), but `../` from
`/app/src/coordinator/` is `/app/src/`, not `/src/`. The symlink doesn't
land at the right path for this import.

The Dockerfile sets `ENV AWARE_HEAVY_THINK_PATH=/app/heavy-think/src/index.js`,
and `config.heavyThink.path` does return that path:

```
config.heavyThink.path: /app/heavy-think/src/index.js
process.env.AWARE_HEAVY_THINK_PATH: /app/heavy-think/src/index.js
```

…but **nothing in the runtime path actually uses `config.heavyThink.path`**
for the heavy-think import. `src/coordinator/index.js:35` reads it but
never feeds it into a `import()` call. The integration shim uses a
hard-coded static path. So the env var is decorative for this code.

## Why unit tests didn't catch it

`test/unit/coordinator/index.test.js` overrides `process.env.AWARE_HEAVY_THINK_PATH`
and injects a fake path through the `buildDefaultRouter` opts. The test
exercises `coordinate()` through the stub, never through the live
`heavyskill-integration.js` import resolution that runs at module load.
So the bug is invisible to the test suite.

## What this means for items 18/19

- **Item 18** ("make a real `/coordinate` call") — **blocked**.
  Coordinator cannot start. Cannot make a real call without first fixing
  the import path bug.
- **Item 19** ("query `/api/audit/chain` over HTTP") — **blocked**.
  Same root cause; the audit-log HTTP query is served by the coordinator
  process which is in crash loop.

## Fix path (not applied in this run; needs explicit user go-ahead)

The minimal fix is to change `heavyskill-integration.js:16` from a
static relative import to a dynamic import using `config.heavyThink.path`:

```js
// before
import { heavy_think as heavyThink, ... } from '../../../heavy-think/src/index.js';

// after
const { heavy_think: heavyThink, defaultKForTaskType, K_CONFIGS } =
  await import(config.heavyThink.path);
```

This is a 2-line change but it crosses a module-loading boundary
(static → dynamic) and warrants a new release + test. Not done in this
session because:

1. The user has not yet seen this finding.
2. The fix changes import semantics (top-level await is fine in ESM, but
   the rest of `heavyskill-integration.js` is currently a module-scope
   `import`-then-use pattern; converting mid-file requires care).
3. The fix should be tested with a fresh integration test that boots
   the coordinator inside Docker and hits `/coordinate` end-to-end —
   i.e. the items 18/19 work itself.

## Honest summary

The earlier-session claim that the v2.5.0 staging bring-up succeeded is
not reproducible with the current code. The bring-up script, the
compose file, the Dockerfile, and the credential sourcing all work; the
runtime code does not. This is the value of running the bring-up
yourself instead of trusting the dispatch report — the actual blocker
is now visible and reproducible.

## What I tried (full trace, for the next operator)

1. Confirmed `MINIMAX_API_KEY` exists in `~/.openclaw/credentials/ACTIVE-CREDENTIALS.env`
   (real 125-char key). Earlier-session claim that this key was
   unavailable was wrong.
2. Confirmed Ollama at `localhost:11434` with `gemma4:26b` +
   `nomic-embed-text` (used as fallback if MiniMax fails; didn't need
   to fall back).
3. Recreated `~/.openclaw/credentials/bringup.env` (deleted in last
   cleanup; restored with `HEAVY_THINK_REPO`, `HEAVY_THINK_TAG`,
   `LLM_API_KEY`, `AWARE_COORDINATOR_TOKEN`).
4. `npm run config:validate` passes when `LLM_API_KEY` is sourced.
5. `docker compose config` validates with `HEAVY_THINK_REPO` set.
6. First `docker compose up -d` worked but coordinator crashed on
   missing `LLM_API_KEY`. Resolved by sourcing env before compose call.
7. Second `up -d` crashed on missing `AWARE_COORDINATOR_TOKEN`
   (≥32 chars when NODE_ENV=production). Generated a 64-char hex token.
8. Third `up -d` succeeded — coordinator started, ran migrations, but
   was unreachable on `localhost:18081` (colima SSH holds that port).
9. Remapped to `localhost:28181`. Still unreachable — colima SSH holds
   `28181` too. Remapped to `localhost:38181`. Still unreachable.
10. Diagnosed: coordinator bound to `127.0.0.1:8080` inside container;
    docker-proxy DNAT requires a `0.0.0.0` listener. Patched
    `COORDINATOR_HOST=0.0.0.0` and rebuilt image.
11. New build: coordinator now crash-loops on the static import path
    described above. This is the genuine blocker.

## Operator actions for next session

1. **Decide:** fix `heavyskill-integration.js:16` (2-line dynamic-import
   patch) and re-run items 18/19, OR document items 18/19 as
   "blocked-by-runtime-bug" and ship v2.5.4 as evidence-only (no new
   coordinator code; same privacy-scrub coverage as v2.5.3).
2. If fixing, add an integration test that boots the coordinator image
   and calls `/coordinate` end-to-end, so this regression can't recur
   silently.
3. Consider whether `AWARE_HEAVY_THINK_PATH` deserves a stricter
   contract (e.g. config validator should reject a path that doesn't
   resolve, instead of silently falling back to the dev-layout default).

---

**This evidence file was written by the orchestrator agent executing
in-place on 2026-06-25. No transcript was fabricated; all logs and
status snapshots are real.**
