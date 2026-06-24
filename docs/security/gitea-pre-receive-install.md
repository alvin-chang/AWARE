# Layer 3 — Gitea Pre-Receive Hook Install Guide

**Privacy filter (post 2026-06-23 audit).**
**Owner of install:** Herald (PR agent).
**Owner of doc:** Forge (Coder) — drafted 2026-06-24, A2 phase.

---

## Purpose

Layer 3 is the **server-side last line of defense** for the AWARE 4-layer privacy
filter. It runs on the local Gitea host when a `git push` arrives, regardless of
whether the client has client-side hooks (Layer 1 + 2) installed or not. A
contributor who runs `git push --no-verify` skips Layer 1 + 2 but cannot skip
Layer 3.

This doc is a step-by-step install guide for Herald. The actual hook script is
checked in alongside this file (`scripts/hooks/pre-receive`) and is identical in
shape to the client-side `scripts/hooks/pre-commit` + `scripts/hooks/pre-push`
pair. Layer 3 also runs `gitleaks detect` against the pushed pack, which neither
Layer 1 nor 2 can do (they only see staged / working-tree content).

## Pre-flight: find the bare repo

The local Gitea container stores bare repos under a different path than the
official docs (the docs say `<GITEA_APP_DATA>/gitea-repositories/<owner>/<repo>.git/`,
but the local Gitea is configured with `REPOSITORY_ROOT = /data/git/repositories`).

**To confirm on this host:**

```bash
docker exec gitea cat /data/gitea/conf/app.ini | grep -E "REPOSITORY_ROOT|ROOT_URL"
# Expected: ROOT = /data/git/repositories
#           ROOT_URL = http://localhost:4001/
```

**The bare repo path inside the container is:**

```
/data/git/repositories/alvin/aware.git
```

(If the Gitea container ever moves, re-run the command above to find the new path.)

## Install steps

Herald runs these as the `alvin` user (gitea container is owned by root:0, so
the install needs `docker exec ... bash -c`):

```bash
# 1. Confirm gitleaks is available in the container
docker exec gitea sh -c 'command -v gitleaks || (apk add --no-cache gitleaks 2>/dev/null || echo "gitleaks not in container — see step 1b")'

# 1b. If gitleaks isn't in the container (Alpine doesn't ship it by default):
#     install a static gitea-side hook that doesn't need gitleaks in-container.
#     See "Container without gitleaks" below for the fallback.
```

### Path A — Container has gitleaks (preferred)

```bash
# 2. Create the custom_hooks directory in the bare repo
docker exec gitea mkdir -p /data/git/repositories/alvin/aware.git/custom_hooks

# 3. Copy the hook script from the working copy into the container.
#    (This works because the AWARE source is bind-mounted at the standard
#    <HOME>/src/AWARE path on the host.)
docker cp <repo-root>/scripts/hooks/pre-receive \
    gitea:/data/git/repositories/alvin/aware.git/custom_hooks/pre-receive

# 4. Mark executable
docker exec gitea chmod +x /data/git/repositories/alvin/aware.git/custom_hooks/pre-receive

# 5. Verify
docker exec gitea ls -la /data/git/repositories/alvin/aware.git/custom_hooks/
# Expected: -rwxr-xr-x ... pre-receive
```

### Path B — Container does NOT have gitleaks (fallback)

Gitea's pre-receive hook is plain shell. If `gitleaks` is missing in the
container, the hook falls back to running only the A1 content rules
(host paths, LAN IPs, fixture shape). That's still 3 of 4 checks — the
server-side protection is not zero. Document the limitation in
`docs/security/filter-architecture.md` Layer 3 notes.

```bash
# The script in scripts/hooks/pre-receive auto-detects: if gitleaks is
# missing, it prints a warning and continues with content rules only.
# This is by design — install the hook either way.
```

## Verification (Herald runs these)

```bash
# 1. Push a test commit from a working copy — the hook should run and pass.
cd ~/src/AWARE
git commit --allow-empty -m "test: verify Layer 3 fires on push"
git push origin chore/aware-a2-filter-hooks
# Expected: push succeeds; gitea log shows pre-receive output.

# 2. Verify the hook ran in the gitea log
docker exec gitea tail -n 50 /data/gitea/log/gitea.log | grep -E "pre-receive|aware-filter"
# Expected: a line confirming the hook ran and returned 0

# 3. Negative test: try to push a commit that has a banned pattern
#    (use a temp branch, not the real one)
cd /tmp && rm -rf aware-negative-test && git clone ~/src/AWARE aware-negative-test
cd aware-negative-test
git checkout -b test/layer3-negative
echo "Internal: <redacted-lan-ip>" > docs/audits/test-192.md
git add docs/audits/test-192.md
git commit -m "test: should be blocked by Layer 3"
git push origin test/layer3-negative
# Expected: push is REJECTED with a message from the pre-receive hook
#           containing "✗ pre-receive blocked" and the file path.

# 4. Clean up the negative test
docker exec gitea sh -c 'cd /data/git/repositories/alvin/aware.git && \
    git update-ref -d refs/heads/test/layer3-negative || true'
git branch -D test/layer3-negative
```

## Bypass analysis

| Bypass | Effect | Mitigation |
|---|---|---|
| Contributor pushes to a branch that doesn't have Layer 3 hook yet | Push succeeds without check | N/A — the hook is at the repo level, not per-branch. It applies to every push. |
| Contributor bypasses Gitea and pushes via `git+ssh` directly to the bare repo | Bypasses Gitea entirely (and the hook) | Mitigation: disable direct SSH git access to `/data/git/repositories/` for non-gitea users. Out of scope for the filter doc. |
| Gitea admin modifies the hook to do nothing | Hook is no longer enforced | Mitigation: Sentinel's weekly scan re-runs `/tmp/scan_aware.py`; if a banned pattern reappears in any ref, the hook is either missing or broken. |
| Gitea container is replaced (e.g. after a Docker upgrade) | Custom_hooks/ is wiped (rebuilt from image) | Mitigation: re-run the install steps above. The `scripts/hooks/pre-receive` source of truth is in git, so `docker cp` is idempotent. |

## Recovery

If a hook is broken and blocking all pushes, Herald can disable it temporarily:

```bash
docker exec gitea sh -c 'mv /data/git/repositories/alvin/aware.git/custom_hooks/pre-receive \
    /data/git/repositories/alvin/aware.git/custom_hooks/pre-receive.disabled'
```

This unblocks pushes. **Re-enable as soon as the issue is fixed** (the filter
stays at 3 layers instead of 4 during the outage).

## What Layer 3 is NOT

- It is not a substitute for the github-side secret-scanning
  (`.github/workflows/lint-private-data.yml`, A1). Layer 3 catches pushes
  **before they reach any mirror**; the github workflow catches pushes **on
  the public mirror** that might have been rewritten after a Layer 3/4
  bypass.
- It is not signed-commit enforcement. A separate initiative (per
  `docs/security/history-rewrites.md` future work) will add signed-commit
  + CODEOWNERS + branch protection. The Layer 3 hook is filter-only.

## Related docs

- `docs/security/filter-architecture.md` — full 4-layer spec
- `docs/security/history-rewrites.md` — context for the filter (Phase D)
- `scripts/hooks/pre-receive` — the actual hook script (Herald copies
  this into the gitea container)
- `scripts/hooks/pre-commit` — Layer 1 (client-side)
- `scripts/hooks/pre-push` — Layer 2 (client-side)

---

**This is a server-side install — there is no way for a contributor with
local shell access to bypass it without gitea admin rights. That is the
"cannot be bypassed" guarantee.**
