# AWARE Privacy Filter — 4-Layer Architecture

**Privacy filter (post 2026-06-23 the auditor audit).**
**Author:** Coder (Coder), Phase A2.
**Status:** Active (Layers 1, 2 client-side; Layer 3 install pending the release agent).

---

## Why this exists

the auditor's 2026-06-23 private-data sweep of `github.com/GoodCISO/aware`
(audit `audit-goodciso-aware-private-data-2026-06-23.md`) found **no real
secrets** but **3 anti-patterns** on the public repo:

1. `src/data/users.json` ships with **password hashes + salts** committed
2. `src/data/agents.json` ships with **agent credential hashes** committed
3. `docs/audits/aware-2.0-trainer-env-audit-2026-06-13.md` exposes
   **internal host paths, LAN IP pattern, credential-store layout**

Phase A1 fixed the **content** — replaced the `*.json` files with
`*.json.template` plus install-time seeders, added 4 custom gitleaks
rules, and added CI lint jobs. Phase A2 (this doc) adds the **filter
infrastructure** so the patterns cannot re-appear in any future commit
or push to the repo.

## The 4 layers at a glance

| Layer | When it fires | Where it lives | Can be bypassed? | Owner |
|---|---|---|---|---|
| **1. pre-commit** | `git commit` (staged content) | Client `.git/hooks/pre-commit` → `scripts/hooks/pre-commit` | Yes — `git commit --no-verify` | Coder (this commit) |
| **2. pre-push** | `git push` (full diff of all changed refs + working tree) | Client `.git/hooks/pre-push` → `scripts/hooks/pre-push` | Yes — `git push --no-verify` | Coder (this commit) |
| **3. pre-receive (gitea)** | `git push` arrives on gitea server | Gitea bare repo `custom_hooks/pre-receive` → `scripts/hooks/pre-receive` | **No** (gitea admin only) | the release agent (install) |
| **4. CI guard** | Every PR + every push to main | `.github/workflows/lint-private-data.yml` (existing, A1) **+** `.gitea/workflows/lint-private-data.yml` (new, A2) | No (CI environment) | Coder (this commit) |

Each layer is a **defence in depth** measure. The order is intentional:
the earlier the block happens, the cheaper the developer feedback loop.
But each layer also adds a unique check the others don't, so the
combination is meaningfully stronger than any single layer.

## Layer 1 — pre-commit (client-side)

**Purpose:** Catch privacy patterns in staged content at commit time. Fast
feedback for the contributor.

**Source of truth:** `scripts/pre-commit-check.sh` (Phase A1). The hook
`scripts/hooks/pre-commit` is a thin wrapper that:

1. Calls `scripts/pre-commit-check.sh` (content rules).
2. Runs `gitleaks protect --staged` against the staged content (using
   `.gitleaks.toml` ruleset from A1).

**Hard-block behavior:** Exits 1 → `git commit` fails. Exits 0 → commit
proceeds.

**What it checks:**

- `docs/audits/*.md` — no host-specific paths (`/Users/<name>/`,
  `<canonical-credential-store>/`, `<canonical-credential-store>/`, `<canonical-credential-store>/`, `<canonical-credential-store>/`, `<canonical-credential-store>/`)
- `STATUS.md` — no LAN IPs (`192.168.x.x`, `10.x.x.x.x`), no
  `<redacted-credential-path>*.env` references
- `src/data/users.json` and `src/data/agents.json` — must NOT be tracked
  in git (only the `.template` files should be)
- `src/data/*.json.template` — must NOT contain `passwordHash` or
  `credentials` fields
- gitleaks — all custom rules in `.gitleaks.toml`
  (`aware-agent-credential-hash`, `aware-user-password-hash`,
  `aware-lan-ip-disclosure`, `aware-host-path-disclosure`)

**Install:** `bash scripts/install-hooks.sh` (creates a relative
symlink in `.git/hooks/pre-commit`).

**Important environment note:** If `git config --get core.hooksPath`
returns a non-empty value (e.g. `<HOME>/.githooks` in OpenClaw-
managed environments), git uses THAT directory instead of `.git/hooks/`.
The install script detects this and prints a warning. In that case,
copy `scripts/hooks/pre-commit` and `scripts/hooks/pre-push` to the
global hooks path, or chain them into the existing global pre-commit
hook (e.g. by adding `bash <repo>/scripts/hooks/pre-commit "$@"` at
the end of the global hook).

**Bypass:** `--no-verify` flag, or `rm .git/hooks/pre-commit`. Caught by
Layer 2 + Layer 3.

## Layer 2 — pre-push (client-side)

**Purpose:** Catch privacy patterns in the **full diff** being pushed,
not just staged content. Catches the case where a contributor commits
with `--no-verify` and then pushes, or where they modified files but
didn't stage them.

**Source of truth:** `scripts/hooks/pre-push`.

**What it checks:**

- `gitleaks detect --source .` (full working tree, not just staged)
- For each ref being pushed (`<old>..<new>` or full tree for new refs):
  - Same content rules as Layer 1, applied to the changed file list
    (so the check is fast even on a large repo)

**Hard-block behavior:** Exits 1 → `git push` fails. Exits 0 → push
proceeds.

**Bypass:** `--no-verify` flag, or `rm .git/hooks/pre-push`. Caught by
Layer 3.

**Why a separate layer from pre-commit?**

- Pre-commit only sees staged content. A contributor could `git add` a
  clean file but forget to `git add` a file with a banned pattern.
- Pre-commit runs once per commit. Pre-push runs once per push, scanning
  the **accumulated** diff across all commits being pushed.

## Layer 3 — gitea pre-receive (server-side)

**Purpose:** The last line of defense. Runs on the **gitea host** when a
push arrives. A contributor with shell access on the dev machine cannot
bypass it without gitea admin rights.

**Source of truth:** `scripts/hooks/pre-receive`. Lives on the gitea
host at `<bare-repo>.git/custom_hooks/pre-receive`.

**Install instructions:** `docs/security/gitea-pre-receive-install.md`
(the release agent owns the install; this doc explains the steps).

**What it checks:**

- For each ref being updated, scans the new content from the bare repo's
  object store (uses `git --git-dir=<bare> show <sha>:<file>` to read
  the new file content).
- Runs the same content rules as Layer 1 + 2 (host paths, LAN IPs,
  fixture shape).
- Runs `gitleaks detect` against a tar archive of the pushed pack (the
  one thing Layers 1 and 2 cannot do — they only see staged / working
  tree content, not the pack as it arrives at the server).

**Hard-block behavior:** Exits 1 → gitea rejects the push with a
non-zero status. The client's `git push` shows the hook's output as an
error.

**Bypass analysis (the "cannot be bypassed" guarantee):**

| Bypass attempt | Caught? |
|---|---|
| `git commit --no-verify` to skip Layer 1 | Pushed content still scanned by Layer 3 |
| `git push --no-verify` to skip Layer 2 | Pushed content still scanned by Layer 3 |
| `rm .git/hooks/*` on dev machine | Pushed content still scanned by Layer 3 |
| Push via raw `git+ssh` to the bare repo (bypassing gitea) | NOT caught by Layer 3 (bypasses gitea entirely) — mitigation is to disable direct SSH access to bare repos for non-gitea users. Out of scope for this filter doc. |
| Gitea admin modifies the hook to do nothing | the auditor's weekly scan re-runs `/tmp/scan_aware.py`; if banned patterns reappear in any ref, the hook is broken or missing. |

**Recovery if broken:** the release agent can temporarily disable the hook by
renaming `pre-receive` → `pre-receive.disabled` in the bare repo. This
unblocks pushes. Re-enable as soon as fixed.

**Container-without-gitleaks fallback:** If the gitea container does not
have `gitleaks` installed, the hook still runs the content rules. It
prints a warning. This is by design — install the hook either way.

## Layer 4 — CI guard (server-side, post-receive)

**Purpose:** Catch privacy patterns that somehow made it past Layers
1-3 — for example, a force-push that landed in a ref before the hook
was installed, or a mirror sync from a different source.

**Two implementations** (defence in depth at the CI level too):

| Implementation | Where | What it does |
|---|---|---|
| (a) GitHub Actions | `.github/workflows/lint-private-data.yml` (A1, existing) | Runs on every PR + push to main on github.com. 4 jobs: host paths, STATUS.md, fixture shape, gitleaks. |
| (b) Gitea Actions | `.gitea/workflows/lint-private-data.yml` (A2, new) | Same 4 jobs, runs on the local gitea mirror. Catches issues before they reach github. |

**Decision (A2):** **Both (a) and (b) are deployed.** (a) is the public
repo's CI; (b) is the local gitea's CI. The two are intentionally
redundant — if github is down or a contributor forks to gitea only, the
local gitea CI still catches patterns. If gitea Actions isn't enabled
on the local instance, (b) is a no-op; (a) is the primary check.

**Why not just (c) a the release agent cron?** The cron is a good **detection**
mechanism (the auditor's weekly scan), but not a **prevention** mechanism
like (a) and (b) are. Pre-merge is cheaper than post-merge revert.

## What all 4 layers check (the union)

| Pattern | Layer 1 | Layer 2 | Layer 3 | Layer 4 |
|---|:-:|:-:|:-:|:-:|
| Host-specific path in `docs/audits/*.md` | ✓ | ✓ | ✓ | ✓ |
| LAN IP in `STATUS.md` | ✓ | ✓ | ✓ | ✓ |
| `<redacted-credential-path>*.env` reference in `STATUS.md` | ✓ | ✓ | ✓ | ✓ |
| Tracked `src/data/users.json` or `agents.json` | ✓ | ✓ | ✓ | ✓ |
| `passwordHash` / `credentials` in `*.json.template` | ✓ | ✓ | ✓ | ✓ |
| gitleaks rules in `.gitleaks.toml` (custom) | ✓ (staged) | ✓ (working tree) | ✓ (pushed pack) | ✓ (full) |
| gitleaks rules in `.gitleaks.toml` (default) | ✓ | ✓ | ✓ | ✓ |

**Defense in depth:** Any one layer is enough to catch the pattern.
Having all 4 means a misconfigured CI, a disabled hook, or a contributor
bypassing client-side checks still gets caught by a later layer.

## How to add a new pattern (allowlist workflow)

When a new false-positive pattern emerges (e.g. a test fixture that
intentionally contains a hash that looks like a credential), the
workflow is:

1. **Update `.gitleaks.toml`** to add a `[[rules]]` block for the new
   pattern, OR add a path to the `[allowlist].paths` list.
2. **Update `scripts/pre-commit-check.sh`** if the pattern is a
   content-level rule (e.g. a new file type or a new directory).
3. **Verify all 4 layers still pass** by running:
   ```bash
   bash scripts/pre-commit-check.sh        # Layer 1 logic
   gitleaks detect --source . --config .gitleaks.toml  # Layer 2 logic
   # Layer 3 logic = Layer 1 + Layer 2 + gitleaks on the pack
   # Layer 4 logic = same checks on the CI runner
   ```
4. **Commit the allowlist rule on the `chore/aware-a2-filter-hooks`
   branch** (or a follow-up) so it ships with the filter.

## Recovery procedure if a hook is broken

If a hook is blocking legitimate commits / pushes (e.g. a new false
positive that the maintainers want to allow):

| Layer | Recovery |
|---|---|
| 1 (pre-commit) | `bash scripts/install-hooks.sh --uninstall` (removes the symlink). Edit the rule in `scripts/pre-commit-check.sh` or `.gitleaks.toml`. Re-run `bash scripts/install-hooks.sh` to reinstall. |
| 2 (pre-push) | Same as Layer 1. |
| 3 (pre-receive) | the release agent SSHes into the gitea container and renames `custom_hooks/pre-receive` → `custom_hooks/pre-receive.disabled`. Edit the rule in `scripts/hooks/pre-receive` in the working copy. Re-copy the fixed script into the container. |
| 4 (CI) | Fix the rule in `.gitleaks.toml` / `.github/workflows/lint-private-data.yml` / `.gitea/workflows/lint-private-data.yml`. Push the fix. |

## Why the 4 layers are worth the cost

The 2026-06-23 audit caught the pattern **after** it shipped to
public github. The cost of a single re-do (filter-repo + force-push +
D coordination + E verification) is roughly 4-8 hours of human time
across the release agent, Coder, and Alvin, plus the security risk of leaving the
pattern in any ref for the duration of the rewrite.

The 4-layer filter runs on every commit, every push, every PR, and
every gitea receive. The marginal cost is a few hundred milliseconds of
CI time and a small amount of maintainer cognitive load (mostly
reviewing the allowlist). That's strictly less than the cost of
cleaning up after a single re-emergence.

## Future work (out of scope for A2)

- **Signed commits** — Gitea supports `receive.advertisePushOptions`
  and signed-commit enforcement. Adding this would prevent impersonation
  on force-push.
- **CODEOWNERS** — the `.gitea/CODEOWNERS` file (or its github
  equivalent) could require review from `@goodciso/security` on any
  change to `docs/security/` or `scripts/hooks/`.
- **Branch protection** — `chore/aware-*` and `docs/security-*`
  branches should require review from Coder + the release agent before merge to
  `main`. (Today they don't.)
- **Secret scanning on github** — github has built-in secret scanning
  (separate from gitleaks). Turning it on would catch patterns that
  gitleaks misses.

These are tracked in `docs/security/history-rewrites.md` "Future
work" section, not in this A2 spec.

## Related docs

- `docs/security/history-rewrites.md` — context for the filter rollout
- `docs/security/gitea-pre-receive-install.md` — the release agent's install guide
- `scripts/pre-commit-check.sh` — Layer 1 content rules (A1)
- `scripts/hooks/pre-commit` — Layer 1 wrapper (A2)
- `scripts/hooks/pre-push` — Layer 2 (A2)
- `scripts/hooks/pre-receive` — Layer 3 (A2)
- `scripts/install-hooks.sh` — installer for Layers 1 + 2
- `scripts/seed-dev-users.js` + `scripts/seed-dev-agents.js` — what
  generates the data the filter protects (A1)
- `.gitleaks.toml` — the ruleset (A1)
- `.github/workflows/lint-private-data.yml` — Layer 4(a) (A1)
- `.gitea/workflows/lint-private-data.yml` — Layer 4(b) (A2)
- `audit-goodciso-aware-private-data-2026-06-23.md` — the source audit
  (the auditor, 2026-06-23)
