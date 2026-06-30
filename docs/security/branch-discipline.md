# Branch Discipline — gitea vs github remotes

This repo publishes to **two remotes** with very different audiences:

| Remote | URL | Audience | What it sees |
|---|---|---|---|
| `origin` | `http://localhost:4001/alvin/aware.git` | Internal (gitea) | The full development tree, including operator-internal markers with literal values |
| `github` | `https://github.com/GoodCISO/aware.git` | Public (GitHub) | A sanitized subset: polished artefacts only, no operator-literal values |

The two remotes are NOT kept in sync by git's branch tracking. They are kept
in sync **by humans (or agents acting on human instruction)** using the
discipline below. This document is that discipline.

## The two branches

| Branch | Role | Default push target | Tracking |
|---|---|---|---|
| `main` | Integration — every commit lands here first | `origin` (gitea) | Tracks the latest gitea-accepted commit |
| `public/v2.X.x` | Polished-release — cherry-picked, sanitized | `github` (public) | Tracks the latest github-accepted commit, branched from a sanitized checkpoint |

Both branches **share the same root commits** up to the most recent
sanitization checkpoint. `main` accumulates everything since then;
`public/v2.X.x` does not.

```
github/main  ──► a2ff4b4 ──► 08a6523 (public/v2.8.x HEAD)
                              │
                              └──► no public-side commits past a2ff4b4

origin/main  ──► 18b394c ──► 8b85bee ──► a2ff4b4 ──► d5acb36 (main HEAD)
                                                  │
                                                  └──► public-side commits cherry-picked onto public/v2.8.x
```

## What "polished" means on the github side

A commit is **public-safe** iff all of the following are true:

1. `node scripts/check-public-boundary.mjs` exits 0 on the resulting tree.
2. `gitleaks detect` (with `.gitleaks.toml`) reports no leaks.
3. `bash scripts/pre-commit-check.sh` passes.
4. No operator-literal values appear in *any* comment, doc string, or commit
   message: localhost ports, `/Users/<name>/` paths, the operator's org
   names (e.g. Modal workspace), the operator's GitHub handles, bearer
   tokens, common secret prefixes, or `postgres://user:***@…` strings.

   **Note for the public-boundary checker:** the literals that count as
   "operator values" are listed in `PATTERNS` in `scripts/check-public-
   boundary.mjs`. Do NOT enumerate them in this doc — the doc would
   trip its own checker. The pattern categories (host path, env dir,
   LAN IP, non-default localhost, operator org, bearer, secret prefix,
   connection string) are the stable taxonomy.

The public-boundary checker enforces (1) and (2) mechanically.
Conditions (3) and (4) are policy — covered by the pre-commit hook and
manual review.

## What "full development" means on the gitea side

A commit is **gitea-safe** iff:

1. `git push origin main` succeeds — the 4-layer privacy filter on gitea's
   pre-receive hook accepts it.
2. Operators can read the commit and understand the operator-specific
   binding (which ports, which org, which paths). The
   `# public-boundary: operator-internal` marker is allowed to contain
   literal operator values here.

Gitea is the canonical development record. Operator-internal scripts
that bind to your local infrastructure live here, with their actual
values in the comments so anyone reading the repo (or future you) knows
what they're touching.

## Workflow — committing new work

```bash
# 1. Make your changes on main (or a feature branch that lands into main)
git checkout main

# 2. Edit, stage, commit. The pre-commit hook enforces the 4-layer filter.
git add scripts/<file>
git commit -m "..."

# 3. Push to gitea. The pre-push hook re-runs the filter on the full diff
#    being pushed (gitleaks + public-boundary check on changed scripts/).
git push origin main

# 4. DO NOT push to github from main. See "Cutting a public release" below.
```

## Workflow — cutting a public release

```bash
# 1. Decide which main commits are public-ready.
#    Rule of thumb: anything that ships a feature, fix, or refactor with
#    public-safe diff is ready. Anything that adds operator-literal
#    markers or new operator-internal scripts is NOT ready.

# 2. Switch to the public branch and fast-forward / cherry-pick.
git checkout public/v2.8.x

# 3. For each main commit you want to ship:
#    a. Identify the public-safe files (typically everything EXCEPT
#       operator-internal markers with literal values).
#    b. Cherry-pick or checkout those files from main.
git checkout main -- scripts/check-public-boundary.mjs \
                       scripts/hooks/pre-push \
                       scripts/run-phase4-d5.sh \
                       .gitleaks.toml

# 4. If the cherry-pick included scripts/aware-up (or any script that
#    has a `# public-boundary: operator-internal` marker with literal
#    values), rewrite the marker comment to use placeholder language:
#
#       # public-boundary: operator-internal
#       #   Binds to the operator's local stack topology (the docker-compose
#       #   v2 port map + the operator's Modal workspace). Configure your
#       #   own topology in deploy/env.example and set MODAL_PROFILE before
#       #   running. See scripts/check-public-boundary.mjs for the convention.
#
#    The marker itself (the `# public-boundary: operator-internal` line)
#    stays; only the descriptive comment is rewritten to use generic
#    placeholders. The checker still passes.

# 5. Verify public safety before committing:
node scripts/check-public-boundary.mjs        # must exit 0
git diff --cached                             # audit the staged tree

# 6. Commit the public-safe subset.
git commit -m "chore(security): add public-boundary checker (cherry-pick from main <sha>)"

# 7. Push to github. The github-side CI (lint-private-data.yml) re-runs
#    the same checks. If anything is wrong, the push is rejected.
git push github public/v2.8.x
```

## Workflow — checking the public branch is in sync

```bash
# Is github ahead of the public branch?
git log --oneline public/v2.8.x..github/main

# Is the public branch ahead of github?
git log --oneline github/main..public/v2.8.x

# What's on main but not yet on the public branch?
git log --oneline public/v2.8.x..main

# What's the diff between branches' last sanitization checkpoint?
git merge-base public/v2.8.x main
```

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-30 | Adopted the main + public/v2.8.x split | After GH-push-prep commits 8b85bee + a2ff4b4 showed the previous approach (strip on main, no separate branch) loses operator-literal context in the internal record. The split lets gitea keep full operator-internal truth while github sees polished artefacts only. |
| 2026-06-30 | Added scripts/check-public-boundary.mjs | The 4-layer privacy filter caught secrets but not operator-internal script binding (localhost stack topology, Modal workspace name, ~/.openclaw paths). The new checker is the missing Layer 2.5: a pre-push companion to gitleaks that flags operator binding and enforces per-file markers. |
| 2026-06-30 | Placeholder language for public-side markers | Operator-internal markers on github can't enumerate the actual values they're marking against (that would leak them). The marker itself stays (so the checker passes and downstream readers see the boundary); only the descriptive comment is genericized. |

## See also

- `scripts/check-public-boundary.mjs` — file-header doc has the marker
  grammar, pattern categories, and decision logic.
- `.gitleaks.toml` — Layer 1 / Layer 4 secret-leak allowlist (mirror of
  gitleaks' own rule definitions; same allowlist pattern this doc
  follows for self-defining files).
- `.gitea/workflows/lint-private-data.yml` — gitea-side CI mirror of
  `.github/workflows/lint-private-data.yml` (dormant until gitea Actions
  is enabled in the gitea container config).
- `scripts/hooks/pre-push` — Layer 2 client-side filter that runs
  gitleaks + the public-boundary check on the full diff being pushed.
- `scripts/hooks/pre-commit` — Layer 1 client-side filter that runs
  the content rules in `scripts/pre-commit-check.sh`.
- `docs/security/filter-architecture.md` — *(missing from this checkout;
  referenced from `scripts/hooks/pre-push`. If you need the full filter
  spec before the next GH push, flag the release agent.)*