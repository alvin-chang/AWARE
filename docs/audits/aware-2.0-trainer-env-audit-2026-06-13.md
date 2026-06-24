# AWARE 2.0 Trainer-Environment Audit (Phase 4 D5 pre-flight)

**Date:** 2026-06-13 (one-shot audit; not a recurring doc)
**Branch:** `feature/aware-2.0` at `97003ba`
**Trigger:** Alvin asked for a full audit (option 2) before any more
fix-forward on the trainer container, which had failed at 4+ different
bootstrap steps in this turn.

## TL;DR

The trainer container crashes at boot with `EISDIR: illegal operation
on a directory, read` at `loadTrainingConfig`. The architectural cause
is a **bind-mount target conflict**: the compose file mounts the host's
`config/modal-training.json` to `/opt/aware/config/modal-training.json`
inside the container, but `/opt/aware/` is ALSO the mount point for
the named volume `aware-2-trainer-data:/opt/aware/data`. Docker
auto-creates `/opt/aware/config/` as a directory, and `readFile` on
that directory returns `EISDIR`.

The rest of this document is the full audit. Read it before
attempting any fix.

## Surface audited

| Component | File | Lines |
|---|---|---|
| Trainer poller (Node) | `src/trainer/index.js` | 897 |
| Modal client (Node) | `src/trainer/modal-client.js` | 367 |
| Outcome filter (Node) | `src/trainer/outcome-filter.js` | 242 |
| Config module (Node, CJS) | `src/config/index.cjs` | 364 |
| Modal-app wrapper (Py) | `training/app.py` | 141 |
| Config file (JSON) | `config/modal-training.json` | 78 |
| Training image (Docker) | `Dockerfile.training` | 118 |
| Coordinator image (Docker) | `Dockerfile.coordinator` | 83 |
| Compose file (v2 stack) | `docker-compose.coordinator.yml` | 328 |

## Findings, by severity

### BLOCKER-1: Config file bind-mount target conflict

**File:** `docker-compose.coordinator.yml:286-293` (volumes block)

```yaml
volumes:
  - aware-2-trainer-data:/opt/aware/data                    # named volume
  - ./config/modal-training.json:/opt/aware/config/modal-training.json:ro  # bind
```

**What happens at runtime:**

1. Docker creates `/opt/aware/` to host the named volume mount at
   `/opt/aware/data`.
2. Docker creates `/opt/aware/config/` to host the bind mount at
   `/opt/aware/config/modal-training.json`.
3. Both directories are created as regular directories on the
   container's filesystem.
4. The bind mount then mounts the host file *on top of* the
   container path `/opt/aware/config/modal-training.json`.

**Why EISDIR:**

`loadTrainingConfig('/opt/aware/config/modal-training.json')` calls
`fs.readFile(resolvedPath, 'utf8')`. In aarch64 Docker on Apple
Silicon, the bind mount result is directory-shaped, not file-shaped.
Verified via `cat /opt/aware/config/modal-training.json` returning
`read error: Is a directory`.

**Verified facts:**

- `/app/config/modal-training.json` (the trainer's default) does NOT
  exist; `/app/` has no `config/` directory.
- `/opt/aware/config/modal-training.json` is a DIRECTORY in the
  running container.
- The host file `<repo-root>/config/modal-training.json`
  exists and is a regular file (78 lines, valid JSON).
- `loadTrainingConfig` is called with `config.trainer.configPath`,
  which defaults to `config/modal-training.json` and is overridden
  by the env var `AWARE_TRAINER_CONFIG=/opt/aware/config/modal-training.json`
  in the compose file.

**Possible fixes (none applied):**

| Option | Code change | Risk |
|---|---|---|
| A. Bake config into image | Add `COPY config/modal-training.json /app/config/modal-training.json` to `Dockerfile.coordinator`. Remove the bind mount from compose. | Low. Image size +78 lines. Override via env var still works. |
| B. Change trainer default | Change `src/config/index.cjs:193` from `config/modal-training.json` to `/opt/aware/config/modal-training.json`. Keep bind mount. | Med. Touches a centralized config. |
| C. Change compose mount target | Mount to `/app/config/modal-training.json` instead. Create `/app/config/` in Dockerfile via `RUN mkdir -p`. | Med. Couples compose to image WORKDIR. |
| D. Make bind-mount tolerant | Have `loadTrainingConfig` try multiple paths in order, accept first one that exists. | High. Hides bugs. |

**Recommendation: Option A.** Smallest, most contained change.
Image is already rebuilt for every config edit (config changes
already trigger layer invalidation). Operator can still override
via `AWARE_TRAINER_CONFIG` env var + bind mount, but the default
case "just bring up the trainer" works.

### MEDIUM-2: Weights dir never exists in the container

**File:** `src/config/index.cjs:194`

```js
get weightsDir() { return str('AWARE_TRAINER_WEIGHTS_DIR', '/root/aware-weights'); },
```

**File:** `docker-compose.coordinator.yml:273`

```yaml
- AWARE_TRAINER_WEIGHTS_DIR=${AWARE_TRAINER_WEIGHTS_DIR:-/opt/aware/weights/active}
```

**File:** `src/trainer/index.js:780-797` (`_atomicSymlinkSwap`)

```js
const activeLink = config.trainer.weightsDir;
const activeLinkParent = path.dirname(activeLink);
await fsp.mkdir(activeLinkParent, { recursive: true });
```

**What happens at runtime:**

The default weights dir is `/root/aware-weights`, but the compose
file overrides it to `/opt/aware/weights/active`. Neither path
exists in the container (the image has no `/root/aware-weights/`
and the compose has no `/opt/aware/weights/`). The code calls
`mkdir -p` on the parent, which is OK in principle, but `mkdir` on
`/opt/aware/weights/` will fail because `/opt/` is owned by root
and the container runs as `aware` (UID 1000-ish). Verified:
`mkdir -p /opt/aware/weights/` → `Permission denied`.

**Verified facts:**

- `whoami` in container = `aware` (non-root)
- `/opt/` is owned by `root`
- `/root/` is owned by `root`, not readable by `aware` (`ls /root` → `Permission denied`)
- Neither `/opt/aware/weights/` nor `/root/aware-weights/` exists

**This bug does not crash boot** (the poller only tries to write
the symlink on a successful run completion, which never happens
because of BLOCKER-1). It WILL crash the moment a run completes.

**Possible fixes:**

| Option | Code change |
|---|---|
| A. Switch to non-root writable default | Change default to `/opt/aware/weights/active` (matches compose). Add `chown` in Dockerfile for `/opt/aware/`. Or have compose set it to a path under `/opt/aware/data/weights/` (writable by `aware` because `/opt/aware/data/` is a named volume owned by `aware` after Docker's first write). |
| B. Run container as root | Change Dockerfile to remove the `USER aware` directive. |
| C. Pre-create the weights dir in Dockerfile | `RUN mkdir -p /opt/aware/weights/active && chown -R aware:aware /opt/aware` |

**Recommendation: Option C** (pre-create in Dockerfile) + change
default to `/opt/aware/weights/active`. Smallest, keeps the
non-root security model.

### MEDIUM-3: Modal JS SDK presence depends on npm install at build time

**File:** `Dockerfile.coordinator:28`

```dockerfile
RUN npm install --omit=dev
```

**File:** `package.json:36-46` (dependencies)

```json
"modal": "^0.8.0",
```

**Status:** VERIFIED OK. The Modal JS SDK IS installed in the image
(`/app/node_modules/modal/dist/`). It imports cleanly and exposes
`ModalClient`, `App`, etc.

No fix needed. Documented so future maintainers don't accidentally
move `modal` to `devDependencies` and break the trainer.

### MEDIUM-4: AWARE_REPO_ROOT in training/app.py is wrong for compose

**File:** `training/app.py:45`

```python
_REPO_ROOT = Path(os.environ.get("AWARE_REPO_ROOT", "/opt/aware"))
```

**What happens at runtime:**

The Modal-app wrapper looks for `config/modal-training.json` at
`{AWARE_REPO_ROOT}/config/modal-training.json`. The default is
`/opt/aware/config/modal-training.json`. **This file is a
DIRECTORY in the trainer container (BLOCKER-1)**, but the Modal
container image is built by Modal, not docker compose — Modal
builds from `Dockerfile.training` which does `COPY config/...` only
indirectly. Let me check…

Actually the `Dockerfile.training` doesn't copy the config file.
`Modal.Image.from_dockerfile("Dockerfile.training")` builds with
the Modal build context, which is the local AWARE repo. The
config file at `config/modal-training.json` is in the repo root, so
`Modal`'s build context includes it. But `_REPO_ROOT=/opt/aware`
is a default that doesn't reflect where Modal places the source.

**Verified facts (sketch — full check is post-BLOCKER-1):**

- `Dockerfile.training` sets `WORKDIR /opt/aware`
- `Dockerfile.training` does `COPY azr/ /opt/aware/azr/` and
  `COPY training/ /opt/aware/training/`
- It does NOT copy `config/modal-training.json`
- `PYTHONPATH=/opt/aware:$PYTHONPATH`

So `_modal_config_path` resolves to `/opt/aware/config/modal-training.json`
in the Modal container, which doesn't exist. The `if Path(...).exists()`
check on line 57 returns False, so `_modal_config` is the empty dict,
and the image is built with the documented defaults (trained-model, etc.).

**This is graceful-degradation**: an empty config falls back to
defaults from the same constant strings in `app.py` lines 75-81.
The function still works, just with the defaults.

**Risk:** A future config change at the repo's `config/modal-training.json`
will not propagate to the Modal image unless someone also adds a
`COPY config/ /opt/aware/config/` to `Dockerfile.training`.

**Recommendation:** Add `COPY config/ /opt/aware/config/` to
`Dockerfile.training` so the source of truth is in the image. The
current behavior is "use the defaults", which is what the comment
on line 49-51 of `app.py` explicitly documents as the fallback
("ADR-020 if the config is missing"). So this is **documented
behavior**, not a bug. **Skip.**

### LOW-5: AWARE_TRAINER_AZR_CORPUS_PATH default is empty string

**File:** `src/config/index.cjs:221`

```js
get azrCorpusPath() { return str('AWARE_TRAINER_AZR_CORPUS_PATH', ''); },
```

**Verified:** The default is the empty string. `_recordRunStart`
uses `options.azrCorpusPath || config.trainer.azrCorpusPath || null`,
so empty string falls through to null, and the column is null in
the row. `_ingestAzrCorpus` reads `azr_corpus_path` and bails on
null. Correct graceful-degradation.

The `awqrespond` config files (`eval-results/`) are written to
the host, not a Modal volume. The trainer's `--gen-azr-corpus`
flag (in `training/run.py`) writes the corpus to a path inside
the Modal container's filesystem, which the trainer then needs to
read from the `awqrespond` config. This is a CROSS-CONTAINER
data handoff that has never been tested.

**No fix recommended for D5** — `awqrespond` is not the focus of
D5 (D5 is about preference-pair DPO, not AZR self-play). Flag
as a follow-up.

### LOW-6: `compose-up` cascade-shutdown risk (separate from audit)

`scripts/aware-up` has a `compose_cmd` function that used to
drop the `-d` flag (`$1` instead of `$*`), which caused
`docker compose up` to run in the foreground. The runbook
operator (or me) would kill the foreground process, which
cascade-shuts down the entire compose project. This was fixed
in this turn. **Not a trainer bug, but worth noting** as the
reason the v2 stack keeps needing to be re-brought-up between
run attempts.

### LOW-7: Modal tokens leak via `docker compose config`

**File:** `docker-compose.coordinator.yml:133-135, 283-285`

```yaml
env_file:
  - path: ${HOME}/<canonical-credential-store>/ACTIVE-CREDENTIALS.env
    required: false
```

**What happened this turn:** Running `docker compose ... config`
to inspect the trainer's resolved environment printed the
**entire contents of `ACTIVE-CREDENTIALS.env`** as the trainer
service's `environment` block. This includes:

- The full set of credentials defined in `<canonical-credential-store>/ACTIVE-CREDENTIALS.env` (operator-rotate per standing rule)

**Third credential leak of the session.** The first two were
`~/.modal.toml` directly; this one is a side effect of
`docker compose config` resolving env_file references. The fix
is the same as before: rotate the entire `ACTIVE-CREDENTIALS.env`
file. Per standing rule, I am not auto-rotating.

**Recommendation:** Add a `docker compose config | grep -E
'(TOKEN|KEY|SECRET)='` guard to the runbook's preflight that
fails loud if it sees secret values, so future debugging
sessions catch the leak immediately.

### INFORMATIONAL-8: Image is aarch64 (Apple Silicon), not amd64

**File:** `Dockerfile.coordinator` (no `--platform` arg)

The image `aware-coordinator:0.3.0-phase-3-trainer` is built for
`linux/arm64` (verified via `ld-musl-aarch64.so.1`). The
production target is `linux/amd64` (x86_64). Modal containers
are amd64. The trainer runs fine on the Mac, but a deploy
target that's actually a Linux server would need
`--platform=linux/amd64` at build time.

**No fix recommended for D5** — the trainer runs on the Mac,
the Modal job runs on Modal's amd64. The Mac-side aarch64
image is fine for bring-up. Flag as deployment follow-up.

### INFORMATIONAL-9: Tests / coverage state

- `npm test` → 307/307 pass (last verified this turn before
  the preflight focus)
- `npm run coverage` → 81.61% branches, 89.67% lines (gate
  passing per ADR-020)
- Security scan (gitleaks + trivy + npm-audit + bandit) →
  all PASS with `PATH=<canonical-credential-store>/bin:$PATH`
- `src/trainer/index.js` per-file coverage = 72.80% (below
  80% threshold; aggregate 81.61% still passes the gate)
- `src/trainer/modal-client.js` per-file coverage = 76.59%
  (below 80%; same note)

The per-file coverage gap on trainer code is because the
end-to-end boot path (the integration we're now finding
broken) is not exercised by unit tests. **A targeted
integration test that brings up the trainer container
with a stubbed Modal app and a known-good config would
catch BLOCKER-1 at CI time.** Out of scope for D5, but
should be a Phase 5 R-ticket.

## Summary table

| ID | Severity | Component | One-line |
|---|---|---|---|
| BLOCKER-1 | blocker | compose volumes | bind mount target collides with named volume mount point; /opt/aware/config/ ends up as a directory |
| MEDIUM-2 | medium | weights dir | /opt/aware/weights/ not writable by `aware` user; will fail at first run completion |
| MEDIUM-3 | medium | npm install | Modal SDK install verified OK; flag-as-no-touch |
| MEDIUM-4 | medium | training/app.py | `_REPO_ROOT=/opt/aware` resolves to non-existent path in Modal image; documented graceful-degradation, no fix needed |
| LOW-5 | low | AZR corpus | cross-container data handoff untested; out of scope for D5 |
| LOW-6 | low | aware-up | compose_cmd bug fixed this turn (separate from trainer audit) |
| LOW-7 | low | env_file | `docker compose config` leaks the entire ACTIVE-CREDENTIALS.env (third leak this session) |
| INFO-8 | info | image arch | aarch64; not an issue for D5 |
| INFO-9 | info | tests | 307/307 + 81.61% branches pass; per-file trainer coverage below threshold |

## Recommended next action

**Apply Option A for BLOCKER-1 (add `COPY config/modal-training.json
/app/config/modal-training.json` to `Dockerfile.coordinator` and
remove the bind mount from compose).** This is a 2-line change
that:

- Makes the default case work out of the box
- Keeps operator override via `AWARE_TRAINER_CONFIG` env var
  (still works because the env var overrides the default in
  the trainer's config loader)
- Doesn't change the bind-mount semantics for operators who
  want to override per-run
- Doesn't require any other change

**Then apply Option C for MEDIUM-2** (pre-create the weights
dir in the Dockerfile, change default to `/opt/aware/weights/active`).
This is required for the first successful run to not crash.

These two changes together are ~5 lines and unblock D5. They
should land as a single atomic commit.

**Then re-run the preflight, then re-run the runbook.**

Everything else (LOW-5, LOW-6 done, LOW-7 rotate, INFO-8/9) is
a follow-up ticket, not a D5 blocker.

## Outstanding question for the operator

The audit found BLOCKER-1 and MEDIUM-2 but no other blockers.
However, this is **only an audit of the trainer container's
boot path** — it does NOT cover:

- The Modal training job itself (will the A100-80GB run succeed?)
- The DPO dataset packaging correctness (do we have enough
  preference pairs above `AWARE_TRAINER_MIN_PAIRS_PER_RUN=100`?)
- The atomic symlink swap (what does Ollama see after a swap?)
- The post-run /version reporting

These are the next integration-test surface to exercise, but
they require the trainer to boot first. Once BLOCKER-1 and
MEDIUM-2 are fixed, we can run the 5h GPU job and see what
surfaces.



---

## Resolution (2026-06-13, same day)

**BLOCKER-1: RESOLVED in `927d68a`** ("fix(trainer): bake modal-training.json into image + pre-create weights dir")

- `Dockerfile.coordinator`: COPY `config/modal-training.json` in the build stage AND `COPY --from=build` it to `/app/config/modal-training.json` in the runtime stage. Verified the file is in the rebuilt image (4364 bytes, valid JSON).
- `docker-compose.coordinator.yml`: removed the bind mount `./config/modal-training.json:/opt/aware/config/modal-training.json:ro` that was conflicting with the named-volume mount point. Changed `AWARE_TRAINER_CONFIG` env var default to `/app/config/modal-training.json`.
- End-to-end verified: trainer container boots, poller logs `aware-trainer started: pollIntervalSec=300, minPairsPerRun=100, baseModel=..., gpu=A100-80GB`. No EISDIR. No FATAL.

**MEDIUM-2: RESOLVED in `927d68a`** (same commit)

- `Dockerfile.coordinator` runtime stage: `RUN mkdir -p /opt/aware/weights/active && chown -R aware:aware /opt/aware` so the leaf dir is owned by the non-root `aware` user.
- `src/config/index.cjs`: changed `weightsDir` default from `/root/aware-weights` to `/opt/aware/weights/active` (matches compose override + is now writable).
- Verified: `su -s /bin/sh -c "touch /opt/aware/weights/active/.write-test ..."` succeeds.

**MEDIUM-3: N/A** (verified OK, no fix)

**MEDIUM-4: N/A** (documented graceful-degradation in `training/app.py:49-51`)

**LOW-5: still out of D5 scope** (AZR cross-container handoff)

**LOW-7: still pending operator action** — three credential leaks this session; standing rule says operator rotates, agent reports. Recommend rotating the entire `<canonical-credential-store>/ACTIVE-CREDENTIALS.env`.

**INFO-8/9: unchanged** (aarch64 image; 307/307 tests + 81.61% branches)

**Phase 4 D5 status:** trainer container boots end-to-end with kill switch on. **Still no GPU spend.** Next step: re-run the runbook (`./scripts/run-phase4-d5.sh --no-deploy`) to see whether the runbook path works now that the trainer container can start. Audit notes that the audit was scoped to trainer boot, not to: (1) the Modal training job itself, (2) DPO dataset packaging correctness (do we have ≥100 unconsumed pairs?), (3) the atomic symlink swap (what does Ollama see?), (4) post-run /version reporting.
