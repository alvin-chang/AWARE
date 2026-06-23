# ADR-042: Heavy-think source restore + <redacted-credential-name> env-var bridge

**Date:** 2026-06-23
**Status:** Active (operational fix)
**Author:** Orchestrator (Alfie)
**Supersedes:** (none)
**Refs:** ADR-020 (HeavySkill integration), ADR-038 (PRM temp=0), ADR-040 (auto-interception), ADR-041 (hook scope + audit)

## Context

Two related bugs blocked `/coordinate` end-to-end after the AWARE 2.0 stack
came back up on 2026-06-23 with Ollama removed:

### Bug A — heavy-think source was silently a stub

The local `~/src/heavy-think/src/` tree was a stub. `src/index.js` was 11
lines and exported `heavy_think` as `{ run: async () => ... }`. Every other
file (`parallel.js`, `prm.js`, `refine.js`, `verify.js`, `config.js`,
`preference-pair.js`) was also a stub — but `src/dpo-format.js` was
**missing entirely**.

The AWARE coordinator imports heavy-think as:

```js
import { heavy_think as heavyThink, ... } from '../../heavy-think/src/index.js';
// ...
const result = await heavyThink({ problem, K, ... });
```

So it expected `heavy_think` to be a **callable function**, not an object
with a `.run` method. The image build copied the stub source from the
build-context (`~/src/heavy-think/`) verbatim, so the broken shape
shipped into the container. Result on `/coordinate`:

```
TypeError: heavyThink is not a function
```

The pre-existing smoke-test rows in postgres (21 successful `/coordinate`
calls) must have come from a previous image version that had the real
heavy-think source. The local checkout was overwritten at some point with
a stub scaffold but no rollback was made.

### Bug B — env-var name mismatch: <redacted-credential-name> vs <redacted-credential-name>

The canonical host credential store at `<canonical-credential-store>/credentials/ACTIVE-CREDENTIALS.env`
exports `<redacted-credential-name>` (and `MINIMAX_API_HOST`). Heavy-think's
`src/clients/minimax.js` reads `process.env.<redacted-credential-name>` directly.

But the AWARE `src/config/index.cjs:268` gates `AWARE_MODE=online` on
**`<redacted-credential-name>`** being set:

```js
if (mode === 'online' && !process.env.<redacted-credential-name>) {
  throw new Error('AWARE_MODE=online requires <redacted-credential-name>');
}
```

This is the **AWARE-source** name. The compose file's env interpolation
does `${<redacted-credential-name>:-}` — so if the host shell has not exported
`<redacted-credential-name>`, the container starts without it and the coordinator crashes
on boot with:

```
Error: Config: AWARE_MODE=online requires <redacted-credential-name>
```

Two names, one value. The coordinator and heavy-think disagree on which
to read.

## Decision

**Bug A — restore real heavy-think source from the old image.**

Extract the real source from `aware-coordinator:0.2.0-phase-1-router`
(the last known-good image) via `docker cp`:

```bash
docker create --name htrecover2 aware-coordinator:0.2.0-phase-1-router
docker cp htrecover2:/app/heavy-think/src/index.js ./
docker cp htrecover2:/app/heavy-think/src/parallel.js ./
# ... 8 files total
docker rm htrecover2
```

Restore 8 files to `~/src/heavy-think/src/`, **keeping the local
`src/clients/minimax.js`** (which has ADR-038's `resolveTemperature` and
`_fetch` injection — newer than the old image's client). Add the missing
`src/dpo-format.js`. While restoring, also fix a one-line bug in
`prm.js:21` where `prmConfig` was destructured without a `= {}` default,
causing NPE on `prmConfig.system_prompt` in test (and possibly in
production paths that omit it).

Commit: `fix(heavy-think): restore real source from old image, fix scoreWithPRM NPE`
at `~/src/heavy-think` HEAD = `99c3d4d`.

**Bug B — bridge `<redacted-credential-name>` → `<redacted-credential-name>` in the bring-up
script.**

In `scripts/bring-up-coordinator.sh`, after sourcing the credential file,
add:

```bash
if [[ -z "${<redacted-credential-name>:-}" && -n "${<redacted-credential-name>:-}" ]]; then
  log "  bridging <redacted-credential-name> → <redacted-credential-name> (compose needs both names)"
  export <redacted-credential-name>="$<redacted-credential-name>"
fi
```

This is one line of code; no need to touch the credential store, no need
to change `config/index.cjs` or `clients/minimax.js`, no operator burden.

## Consequences

### Positive

- `/coordinate` returns 200 with full HeavySkill output (verified
  2026-06-23, see `Verification` section below).
- Heavy-think tests go from 23/24 → **24/24 passing**.
- Bring-up script is now self-healing on the env-var name discrepancy.
- Both bugs were **silent at build time** — the image built successfully
  and only failed at runtime. We've added CI guards (below) to catch
  silent re-stubbing.

### Negative / trade-offs

- The env-var bridge is a workaround. The proper fix is to pick **one
  canonical name** across AWARE source, heavy-think source, and the
  credential store. Tracked as ADR-042 follow-up #1.
- Heavy-think source restore was a manual recovery from a Docker image
  baked months ago. The original git history is lost (heavy-think repo
  has only 2 commits). The restored code is correct against the old
  image's behavior but lacks intermediate history — future debugging of
  "why was this line added" is harder.

## Verification

1. `node --test 'test/**/*.test.js'` in `~/src/heavy-think`: **24/24 pass**
   (was 23/24 with stub + NPE).
2. `node /tmp/heavy-think-smoke.mjs`: `heavy_think({K:2, ...})` returns
   `{refined_trace, confidence, attempts, verification, cost}` — full
   pipeline runs end-to-end with stub client.
3. AWARE coordinator image rebuilt as
   `aware-coordinator:0.4.1-phase4-heavy-think-restored`.
4. `docker compose -f docker-compose.coordinator.yml up -d coordinator`
   — coordinator healthy.
5. `curl -X POST /coordinate` with `K=2`, `task_type=standard` returns
   `ok: true`, 2 attempts with PRM scores 0.3 and 0.7, confidence 0.75,
   cost_usd ~0.0018 per attempt, real minimax API calls (not cached).

## Follow-ups (filed for ADR-043)

1. **Pick a single canonical env-var name.** Recommended: `<redacted-credential-name>`
   (matches the canonical credential store + heavy-think source). Rename
   in `src/config/index.cjs` from `<redacted-credential-name>` to `<redacted-credential-name>`, drop
   the bridge in `bring-up-coordinator.sh`.
2. **CI guard against silent re-stubbing of heavy-think.** A 2-line
   shell test in heavy-think's `package.json` `pretest` hook:

   ```bash
   test $(wc -l < src/index.js) -gt 50 || {
     echo "FAIL: src/index.js looks like a stub (≤50 lines). " \
          "Did someone overwrite the real source?"
     exit 1
   }
   ```

   Would have caught Bug A immediately.
3. **Contract test: heavy-think callable as a function.** Add to
   `~/src/heavy-think/test/`:

   ```js
   test('heavy_think is a callable function (not an object)', () => {
     import('../src/index.js').then(({ heavy_think }) => {
       assert.equal(typeof heavy_think, 'function');
     });
   });
   ```

4. **Mirror heavy-think source to a registry.** Publish
   `heavy-think:0.2.0` to npm or GHCR. Replace the
   `additional_contexts: heavy-think=../heavy-think` Dockerfile pattern
   with `npm install heavy-think@0.2.0` (ADR-020 Decision 7 already
   mentions this as the production alternative; this incident is the
   trigger to actually do it).

## Rollback

If `0.4.1-phase4-heavy-think-restored` misbehaves:

```bash
cd ~/src/AWARE
docker compose -f docker-compose.coordinator.yml up -d \
  --force-recreate \
  -e AWARE_COORDINATOR_IMAGE=aware-coordinator:0.4.0-phase4-complete-ollama-removed \
  coordinator
```

(or edit `docker-compose.coordinator.yml:124` back to the old tag and
re-up).
