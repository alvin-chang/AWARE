# History Rewrites — GoodCISO/aware

**Status:** Draft for review (2026-06-24 06:30 BST)
**Author:** Herald (PR coordinator), on behalf of Sentinel (auditor)
**Target path in repo:** `docs/security/history-rewrites.md`

---

## Why this document exists

On **2026-06-23**, Sentinel ran an automated private-data sweep of `github.com/GoodCISO/aware` covering **40 refs** (2 main branches, 18 PR heads, 1 tag, 14 local Gitea branches, 5 working branches). The audit (`audit-goodciso-aware-private-data-2026-06-23.md` in `<canonical-credential-store>/workspace-auditor/reports/`) found **3 P1/P2 anti-patterns** and **3 P3 history-only issues**.

**No real secrets were exposed.** The audit confirmed: emails are `@example.com` (RFC 2606 reserved TLD), agent names are `Test Agent`, hashes are SHA-512 of known fixtures, and instance IDs are sequential low-entropy strings. The data risk is **near-zero** even in cached or archived copies.

The risk that drove the rewrite is **the anti-pattern itself**: the next contributor who swaps `example.com` for real data inherits the file shape, the hash schema, and the credential-naming convention. GitHub's secret-scanning won't catch it because the structure looks like legitimate seed data. This document records the discontinuity so future contributors understand why the history changed.

---

## What was rewritten

| # | File / pattern | Severity | Refs affected | Replacement |
|---|---|---|---|---|
| 1 | `src/data/users.json` — password hashes + salts committed | P1 HIGH | all 40 refs | `src/data/users.json.template` (empty array) + `scripts/seed-dev-users.js` for install-time fixtures |
| 2 | `src/data/agents.json` — agent credential hashes committed | P1 HIGH | all 40 refs | `src/data/agents.json.template` (empty array) + `scripts/seed-dev-agents.js` |
| 3 | `docs/audits/aware-2.0-trainer-env-audit-2026-06-13.md` — internal host paths, LAN IP pattern, credential-store layout | P2 MEDIUM | `github/main` + 3 feature branches | Path redaction: `<repo-root>/` → `<repo-root>/`, `~/.<host-secret-dir>/` → `<canonical-credential-store>/`, signature line dropped |
| 4 | `src/ui/.env` in history (Oct 2025) — port 3001 + localhost only | P3 LOW | 34 refs | Inverted via `git filter-repo --invert-paths` |
| 5 | `.env.production` in history (Oct 2025) — placeholder SECRET_KEY | P3 LOW | 28 refs | Inverted via `git filter-repo --invert-paths` |
| 6 | `STATUS.md` on feature branches — LAN IP `<redacted-lan-ip>:4001`, `<redacted-credential-path>` path | P3 LOW | 3 feature branches | Cleaned up before merge; LAN IP and secrets-path references removed |

---

## Who did what (chain of custody)

| Phase | Action | Owner | Date |
|---|---|---|---|
| **A1** | Source replacement (`*.json.template` + seeders) + `.gitleaks.toml` additions + 3 lint CI checks | Forge | TBD |
| **A2** | Filter infrastructure: pre-commit, pre-push, pre-receive on local Gitea, CI guard | Forge | After A1 lands on `main` |
| **B** | `git filter-repo` in `/tmp/aware-mirror` (mirror clone of local Gitea) | Herald coordinates, executes on Alvin's pre-surface ack | After A2 live |
| **C** | Push mirror to Gitea + force-push per ref | Herald at keyboard for local Gitea; **Alvin at keyboard for the public `github.com/GoodCISO/aware` push** | After Phase D |
| **D** | GitHub deprecation notice (README banner + pinned issue) + this document committed before Phase C | Herald | Before Phase C |
| **E** | Verification: raw GitHub fetch + Sentinel scan re-run + filter smoke-test | Herald | After Phase C |
| **Deferred** | GitHub-side filter: branch protection, GH Actions secret-scan, signed commits, CODEOWNERS | Sentinel + Herald spec separately | After Phase E |

---

## Verification commands (for future contributors)

```bash
# 1. Confirm users.json content was rewritten
curl -sS https://raw.githubusercontent.com/GoodCISO/aware/main/src/data/users.json
# Expected: {"users": [], "_note": "fixtures moved to scripts/seed-dev-users.js"}

# 2. Confirm agents.json content was rewritten
curl -sS https://raw.githubusercontent.com/GoodCISO/aware/main/src/data/agents.json
# Expected: {"agents": [], "_note": "fixtures moved to scripts/seed-dev-agents.js"}

# 3. Verify Finding 3 paths are redacted
curl -sS https://raw.githubusercontent.com/GoodCISO/aware/main/docs/audits/aware-2.0-trainer-env-audit-2026-06-13.md | head -20
# Expected: <repo-root>/, no <repo-root>/

# 4. Re-run Sentinel's scan
python3 /tmp/scan_aware.py
# Expected: 0 P1/P2 findings, only allowlisted P3 matches
```

---

## What this rewrite does NOT fix

- **Cached and archived copies.** Wayback Machine, Google cache, AI training crawlers, and any pre-rewrite GitHub clones retain the old history. The hashes were fixtures, so data risk is near-zero, but the pattern's existence on public web archives cannot be retroactively undone.
- **Anyone who cloned before the rewrite.** Local clones with the old SHAs can still `git checkout <old-sha> -- src/data/users.json` and see the fixture hashes. The fix is forward-going (the filter blocks new commits with the same pattern).
- **Forks.** Per Sentinel's audit, no known forks exist on `github.com/GoodCISO/aware`. If a fork surfaces post-rewrite, notify Herald/Sentinel for coordination.

---

## Forward-going protection

The 4-layer privacy filter (per Sentinel's spec, implemented in Phase A2) prevents the anti-pattern from regenerating:

1. **Pre-commit hook** (any clone): gitleaks + custom Python checker for the 3 P1/P2 patterns + LAN IPs + host paths. Hard-blocks commit.
2. **Pre-push hook** (before push to Gitea): full re-scan, hard-blocks push.
3. **Pre-receive hook on local Gitea** (server-side, can't be bypassed): same checks, no override. This is the load-bearing gate.
4. **CI guard on every push**: re-runs scan post-receive, posts findings to the pusher via Gitea API. Does not auto-revert (Herald/Sentinel decide).

Allowlist for known-good fixtures (test JWT mocks, mock LAN IPs in test files, genesis hash `0000…` for decision-chain traceability) is documented in `.gitleaks.toml`. False-positive additions require a written rationale.

---

## Lessons captured

1. **Patterns outlive values.** The hashes were fixtures (no data risk), but the file shape trained every future contributor that "this is how we ship seed data." A real-data leak using the same structure would have been GitHub-secret-scanning-invisible because it would look identical to the legitimate pattern.
2. **Source replacement must precede history rewrite.** Without moving the seed-data generation to `scripts/seed-dev-*.js`, the next `npm run seed:dev` would have re-committed the same pattern, defeating the cleanup.
3. **Document the discontinuity in-tree, not out-of-tree.** `docs/security/history-rewrites.md` lives in the repo so future contributors see it during onboarding, not in an external audit report that lives in `<canonical-credential-store>/`.
4. **Local Gitea force-push is also destructive.** Even though not internet-exposed, a 40-ref history rewrite affects anyone using the local mirror. Per Herald's standing delegation scope (msg 4529), destructive ops require explicit authorization — not just "Herald solo on a standing basis."

---

## Pointers

- **Audit report:** `<canonical-credential-store>/workspace-auditor/reports/audit-goodciso-aware-private-data-2026-06-23.md`
- **Sentinel's spec:** runId `3a1bc4dc` (Telegram, 2026-06-23 22:18 BST)
- **Herald's 2 amendments:** local Gitea force-push 1-key ack gate + Forge spawn question (Telegram, 2026-06-23 22:58 BST)
- **Alvin's authorization:** pending 06:30 BST pre-surface on 2026-06-24
- **APTS tracking:** SE-3, SC-7, HO-4 stay OPEN until Phase E verifies

— Herald 📢
