# Branch Discipline — gitea vs github remotes

The AWARE repo publishes to two remotes with different audiences. This
document is the discipline that keeps them in sync.

## Remotes

| Remote | URL | Audience |
|---|---|---|
| `origin` | `http://localhost:4001/alvin/aware.git` | Internal (gitea) |
| `github` | `https://github.com/GoodCISO/aware.git` | Public (GitHub) |

## Branch model

| Branch | Role | Push target |
|---|---|---|
| `main` | Integration — every commit lands here first | `origin` (gitea) |
| `public/v2.X.x` | Polished release — cherry-picked, sanitized | `github` (public) |

Both branches share a common root up to the last sanitization
checkpoint. `main` accumulates every commit since; `public/v2.X.x`
advances only when a checkpoint is cherry-picked onto it. Pushes are
manual — `main` does **not** auto-push to `github`, and `public/v2.X.x`
does **not** auto-push to `origin`. Feature branches (e.g.
`chore/...`, `fix/...`, `feature/...`) land into `main` first and
follow the same gitea-only discipline.

### Current state

Verified at the time of writing; check with the sync commands below.

| Branch | HEAD | Remote |
|---|---|---|
| `main` | latest gitea-pushed commit | `origin/main` (gitea) |
| `public/v2.8.x` | latest public-cherry-picked commit | `github/main` (public) |

## The boundary rule

**A commit is public-safe iff:**

1. `node scripts/check-public-boundary.mjs` exits 0 on the resulting tree.
2. `gitleaks detect` (with `.gitleaks.toml`) reports no leaks.
3. `bash scripts/pre-commit-check.sh` passes.
4. No operator-literal value appears in *any* comment, doc string, or
   commit message in the pushed diff. The list of what counts as an
   "operator-literal value" lives in `scripts/check-public-boundary.mjs`
   under `PATTERNS` — consult it before reviewing a cherry-pick.

**A commit is gitea-safe iff:**

1. `git push origin main` succeeds — the 4-layer privacy filter on
   gitea's pre-receive hook accepts it.
2. An operator reading the commit can identify which local resources it
   binds to (ports, paths, org names). Operator-internal marker
   comments on `main` are allowed to enumerate these literals; that's
   why they live on `main` and not on `public/v2.X.x`.

Conditions (1)-(3) for public-safety are enforced mechanically by the
pre-commit hook, the pre-push hook, and the public-boundary checker.
Condition (4) and gitea-safety condition (2) are policy — covered by
manual review of the staged diff.

## Workflow — committing new work

```bash
git checkout main
# ... edit, stage ...
git commit -m "..."
git push origin main   # pre-push hook re-runs gitleaks + public-boundary on the diff
```

`main` does not push to `github` automatically. To publish a subset of
`main` work, follow the next workflow.

## Workflow — cutting a public release

```bash
# 1. Identify which main commits are public-ready.
#    Rule of thumb: anything that ships a feature, fix, or refactor with
#    public-safe diff is ready. Anything that adds operator-literal
#    markers or new operator-internal scripts is NOT ready until those
#    values are either removed or genericised.

# 2. Switch to the public branch and pull the public-safe subset.
git checkout public/v2.8.x
git checkout main -- <public-safe-files>

# 3. If the cherry-pick included scripts that have a
#    '# public-boundary: operator-internal' marker, genericise the
#    descriptive comment on the public branch — keep the marker line,
#    replace literal values (port numbers, org names, container names)
#    with placeholder language. The checker still passes; the public
#    tree doesn't enumerate your local topology.

# 4. Verify before committing:
node scripts/check-public-boundary.mjs    # must exit 0
gitleaks detect --no-git --source . --config .gitleaks.toml --redact
git diff --cached                          # manual review

# 5. Commit and push.
git commit -m "..."
git push github public/v2.8.x              # github-side CI re-runs the same checks
```

## Workflow — checking sync state

```bash
# What's on main but not yet on the public branch (work to cherry-pick)?
git log --oneline public/v2.8.x..main

# What's the latest shared ancestor (the sanitization checkpoint)?
git merge-base public/v2.8.x main

# Has github accepted the public branch's tip?
git rev-parse github/main
```

## Operator workflow changes

When `scripts/run-phase4-d5.sh` was parameterised for public-safety, its
`MODAL_PROFILE` default changed from the operator's workspace to
`default`. Operator deployments now require:

```bash
MODAL_PROFILE=<your-workspace> ./scripts/run-phase4-d5.sh
```

If your workspace is the one previously hardcoded, that variable
already lives in your shell history or shell config — but explicit
passing keeps the script self-documenting.

## Decision log

| Date | Decision | Driver |
|---|---|---|
| 2026-06-30 | Adopted `main` + `public/v2.X.x` split | Commits `8b85bee` (sanitize for GH push) and `a2ff4b4` (strip BEFORE strings) showed that sanitising on `main` loses operator-literal context in the internal record. The split lets gitea keep full operator-internal truth while github sees sanitised artefacts only. |
| 2026-06-30 | Added `scripts/check-public-boundary.mjs` | The 4-layer privacy filter catches secrets but not operator-internal script binding (local stack topology, Modal workspace, operator env dirs). The checker is the missing pre-push companion to gitleaks: it flags operator binding and enforces per-file markers. See `scripts/check-public-boundary.mjs` header for the marker grammar and pattern categories. |
| 2026-06-30 | Genericised descriptive comments in public-side markers | Operator-internal markers on github cannot enumerate the values they mark against (that would leak them). The marker line itself stays so the checker passes and downstream readers see the boundary; only the descriptive comment is genericised. |

## See also

- `scripts/check-public-boundary.mjs` — marker grammar, pattern
  categories, and decision logic live in the file-header comment.
- `scripts/hooks/pre-push` — Layer 2 client-side filter (gitleaks +
  public-boundary check on changed `scripts/` files).
- `scripts/hooks/pre-commit` — Layer 1 client-side filter (content
  rules from `scripts/pre-commit-check.sh`).
- `.gitleaks.toml` — secret-leak rules + allowlist for
  rule-defining files (the same self-defining-file pattern
  `check-public-boundary.mjs` uses).
- `.github/workflows/lint-private-data.yml` — github-side CI mirror
  of the privacy-filter checks.
- `.gitea/workflows/lint-private-data.yml` — gitea-side mirror
  (dormant until gitea Actions is enabled in the gitea container
  config; reference for parity with the github workflow).