# Heavy-Think — Vendored Copy

**Source**: ~/src/heavy-think @ v0.2.2-1-g78eb10e (commit 78eb10e)
**Vendored on**: 2026-06-29
**Reason**: AWARE v2.8.0 vendor-copy. Heavy-think + T=0 PRM fix.

⚠️ **Status: SANITIZED FOR GH PUSH**

This copy has been processed by `scripts/sanitize-vendor-for-gh.sh`. The
upstream-exact state (with original provider-name + host-path references)
is NOT what's tracked here. See "GH-push sanitization" below.

## Source commits pulled

- `78eb10e` feat(heavy-think): MR-HIGH-002 fix — system-prompt isolation via { system, user } message shape
- `1a876c1` feat(heavy-think): contract test + pretest stub guard (v0.2.2)
- `99c3d4d` fix(heavy-think): restore real source from old image, fix scoreWithPRM NPE
- `f6f772e` feat(client): PRM temperature=0 by default for phase=prm_score + _fetch injection
- `b2cb9b1` chore: initial sync (host source tree, pre-clients/)

## Provenance

- Source license: see LICENSE (Apache-2.0, matches AWARE)
- Source upstream: ~/src/heavy-think (Hermes fork — Nous Research agent)
- Per v2.7.1 sanitize verdict (Archimedes a633528b, 2026-06-26): the vendor copy is SHA-rewrite-safe per `preference-pair.js:hashContent()` content-derived SHA-256 + `trainer/index.js:_fetchUnconsumedPairPaths()` opaque path resolution

## GH-push sanitization

The vendored source was processed by `scripts/sanitize-vendor-for-gh.sh` to
remove provider-name + host-path disclosures before pushing to GitHub public.

### Transformations applied

| Original | Replaced with |
|---|---|
| `MINIMAX_API_KEY` (env var) | `LLM_API_KEY` |
| `~/.openclaw/openclaw.json` | `${OPENCLAW_CONFIG}/openclaw.json` |
| `~/.openclaw/audit/rlm/security.jsonl` | `${OPENCLAW_AUDIT_LOG}/security.jsonl` |

These are the public-surface scrubs the (b)+(c) PR-input from Herald called for.
Real secrets were never embedded — these were provider-identity + private-host
references that wouldn't belong on a public repo.

### Env var rename impact (LLM_API_KEY)

GH-pushed AWARE reads `process.env.LLM_API_KEY`, NOT `MINIMAX_API_KEY`.
Operators deploying the GH build MUST set `LLM_API_KEY` in their env.

The internal/private (gitea) build of AWARE can use either name — most
internal flows still reference the old name in their deploy scripts; that's
fine because the local install has its own build pipeline.

### Why sanitization as commit, not upstream-exact

Two reasons:

1. **Re-sync safety**: If we wanted pristine-exact, we'd need to re-sanitize
   on every re-sync from upstream. The current model — sanitize once per
   re-sync, commit, push — keeps the sanitization step visible and reviewable.

2. **Auditability**: The sanitization commit is a single atomic change so
   reviewers can see exactly what was rewritten. No diff noise from ongoing
   syncs.

## How to re-sync from upstream

```bash
# 1. Save the current sanitization-layer deltas (none — sed handles it
#    idempotently):
git diff backend/heavy-think/ > /tmp/last-vendor-diff.patch  # optional sanity

# 2. Re-sync from upstream (this re-introduces MINIMAX_API_KEY + ~/.openclaw/*):
rsync -av --delete \
  --exclude=VENDORED.md \
  ~/src/heavy-think/ \
  backend/heavy-think/

# 3. Re-sanitize (idempotent — only rewrites the patterns):
bash scripts/sanitize-vendor-for-gh.sh backend/heavy-think/

# 4. Verify tests still pass:
cd backend/heavy-think/ && npm test  # expect 116/116 green

# 5. Commit and push the re-sync as a single chore commit:
cd ~/src/AWARE
git add backend/heavy-think/
git commit -m "chore(heavy-think): re-sync + re-sanitize from upstream"
```

## Local modifications

None. Sanitization is reproducible via `sanitize-vendor-for-gh.sh`.
