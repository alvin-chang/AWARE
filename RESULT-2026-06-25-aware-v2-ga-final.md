# AWARE 2.0 v2-GA Final Status — 2026-06-25

**Status:** v2-GA complete on the public surface. Items 18/19 deferred to operator (Alvin).
**Released:** v2.5.2 (current `main`); v2.5.3 (this release) consolidates the GA audit trail.
**Public repo:** https://github.com/GoodCISO/aware

---

## 1. Sentinel audit — every finding closed

Sentinel ran three pre-launch audit passes (B / A / C) and one pre-release P0 review (MR-HIGH-002). Every code-fixable finding has been closed on the public surface.

| Phase | ID | Severity | Subject | Closed in |
|---|---|---|---|---|
| **B** | SC-CRITICAL-001–008 | Critical | Auth, secret-handling, default-credential fixes | v2.3.0 |
| **B** | SC-HIGH-001–010 | High | Training-data exfil paths, env-var leakage, scrub gaps | v2.3.0 |
| **B** | SC-MOD-001–009 | Moderate | Hardening + documentation | v2.3.0 |
| **A** | MR-HIGH-001 | High | AWARE v2 plugin dataflow isolation (rule filter) | v2.3.0 |
| **A** | MR-MOD-001–003 | Moderate | UI/UX, telemetry, dashboard hardening | v2.3.0 |
| **A** | A1, A2 | Anti-pattern | Fixture-data in public repo, A2 filter hooks | v2.3.0 |
| **C** | CORS misconfig | High | Origin reflection on CORS preflight | v2.4.0 |
| **C** | Audit HTTP API gap | High | Decision-chain queryable only via filesystem | v2.4.0 |
| **C** | Retention script | High | Chain integrity verification gap + cold-index | v2.4.0 |
| **MR-HIGH-002** | P0 | Critical | No architectural system-prompt isolation between taskGuidance and user input | v2.5.0 |
| **20** | (post-C follow-up) | — | Production rollout plan missing | v2.5.1 |
| **(post-v2.5.1)** | 3 residual privacy leaks | — | ADR-040 author, `.gitleaks.toml` comment, test-file path comments | v2.5.2 |
| **(v2.5.3)** | (this release) | — | Items 18/19 operator-blocked; GA audit-trail consolidation | v2.5.3 |

**Test count progression:** 442 → 462 → 469 → 469. All passing on every released version.

---

## 2. Public surface privacy status

Final leak scan on `main` (post-v2.5.2):

- **ADRs (27 files scanned):** 0 leaks
- **Priority text sample (150 files across `docs/`, `scripts/`, `src/`, `test/`, `Dockerfile*`, top-level `*.md`):** 0 leaks
- **Tagged release objects (v2.2.0 through v2.5.2):** 0 leaks

The three leaks found by post-v2.5.1 sweep (all pre-existing, none introduced in v2.3.0–v2.5.2):

1. `docs/adr/ADR-040-aware-v4-hook-based-auto-interception.md` — Author field was `[agent-author-identity]` (agent-identity leak)
2. `.gitleaks.toml` — comment referenced the author's `[author-host-path]`
3. `test/unit/coordinator/index.test.js` — comments referenced `[author-sibling-repo-path]`

All three neutralized to placeholders (`AWARE maintainers`, `$REPO_PARENT`). Diff in v2.5.2 is +4/-4 across the three files.

---

## 3. Items 18 / 19 — operator-blocked, not model-failed

Items 18 and 19 in the C-step audit (`coordinator `/coordinate` live-call transcript` and `decision-chain HTTP query transcript`) require a running AWARE stack with a live `MINIMAX_API_KEY`. Both items are tagged "Operator + Forge" in the rollout SOP — Forge cannot synthesize a fake key or fabricate a Docker build transcript.

**What was done to unblock:**

- `scripts/collect-runtime-evidence.sh` shipped in v2.5.1 — standardized evidence collector (curl probes against `/coordinate`, `/api/audit/chain`, `/api/audit/decision/<id>`, `/api/audit/verify-chain`, with sanitized output templates)
- `docs/sop/aware-v2-rollout.md` shipped in v2.5.1 — five-stage cutover with operator checklist (CORS allowlist, secret rotation, kill-switch drill, failure-mode table)
- A2A dispatch attempted 2026-06-25 09:22:57 BST to `agent:coder:main` (Forge) — **failed at 09:27:57 BST (300s timeout)** because Forge's session can't fabricate the key and the bring-up is bounded by the call_hermes 300s budget. This is structural, not a Forge failure.

**What the operator (Alvin) needs to do to close items 18/19:**

1. Provide `MINIMAX_API_KEY` (and `GITEA_TOKEN` for the heavy-think clone, or `HEAVY_THINK_REPO` pointing at a working remote).
2. Run `bash scripts/collect-runtime-evidence.sh` from a checkout with the keys set.
3. Commit the resulting `data/evidence/transcripts/` directory and reference it in v2.5.4 (or whichever patch release closes the audit).

Until that happens, items 18/19 are **documented as deferred-to-operator, not as silently passed**. The deployment surface (`Dockerfile.coordinator`, `docker-compose.coordinator.yml`, decision-log HTTP endpoints, system-prompt isolation) is fully implemented; the only missing artifact is the live transcript proving the pipeline runs end-to-end against the real model.

---

## 4. What's in this release (v2.5.3)

- `RESULT-2026-06-25-aware-v2-ga-final.md` — this file (GA audit-trail consolidation)
- No code changes
- No test changes (469/469 still passing from v2.5.2)
- No privacy-leak changes (still clean from v2.5.2)

Diff against v2.5.2: **+1 file, this document only**.

---

## 5. Herald (PR/announcements) status

The Herald agent (`agent:pr`, `~/.openclaw/workspace-pr/`) was dispatched via A2A at 2026-06-25 10:33 BST with the full v2.5.0 release notes. That dispatch also ran into the 300s call_hermes timeout (the announcement draft was produced but not auto-delivered to the operator channel).

If a public release announcement is desired (LinkedIn post, blog post, mailing-list email), that's a separate Herald task that can be re-issued once the operator confirms the channel target.

---

## 6. v2-GA verdict

**Public surface:** ready for use. Zero privacy leaks, all Sentinel findings closed, system-prompt isolation in place, decision-log queryable via HTTP, CORS locked down.

**Operator-gated runtime evidence:** items 18/19 require live `MINIMAX_API_KEY` + Docker compose bring-up. The SOP and evidence script are shipped. The actual transcript is an operator action, not a code change.

**Recommended operator action for v2-GA closure:**

```bash
cd /path/to/aware
export MINIMAX_API_KEY="..."            # operator-supplied
export HEAVY_THINK_REPO="..."            # any working remote
bash scripts/collect-runtime-evidence.sh
git add data/evidence/
git commit -m "docs(aware): v2.5.4 — runtime evidence transcripts (Items 18/19)"
# Tag v2.5.4, push, release
```

Once the transcripts land, v2-GA is fully closed and this v2.5.3 release can be retired as the audit-trail artifact for the deferred-to-operator handoff.
