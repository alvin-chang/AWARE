# AWARE Evolution — Project State

**Project Key:** aware
**Project Root:** ~/src/AWARE
**Last Updated:** 2026-03-31 16:39 GMT+1
**Status:** Phase 1 RE-RUN in progress

---

## ⚠️ IMPORTANT: Phase 1 Re-Run (2026-03-31)

The previous AWARE Evolution work was done at the **wrong location** (`~/.openclaw/projects/AWARE-Evolution/` — a TypeScript/SQLite rewrite). Phase 1 is being re-run correctly against the original `~/src/AWARE/` platform (Node.js/Express/React).

**Correct location:** `~/src/AWARE/` (http://openclaw.local:3000/alvin/AWARE)

---

## Phase 1 Scope (Agent-Native Runtime)

| Sub-phase | Name | Status |
|-----------|------|--------|
| 1.1 | Agent Identity Layer — NHI lifecycle, cryptographic credentials, agent registry | Pending |
| 1.2 | Per-Agent Sandbox Policies — Policy-as-code, tool-call authorization | Pending |
| 1.3 | Behavioural Baseline & Anomaly Detection — monitoring, anomaly detection | Pending |
| 1.4 | Kill Switch — Raft consensus for agent revocation | Pending |

---

## Governance Pipeline (6-Step)

| Step | Agent | Responsibility | Status |
|------|-------|---------------|--------|
| 1 | Scout | Audit — read codebase, AMRO-S paper, enterprise landscape | 🔄 IN PROGRESS |
| 2 | Archimedes | Architecture — map modules to phases, dependency analysis | Pending |
| 3 | Forge | Implementation — implement audit findings | Pending |
| 4 | Critic | Review — approve implementation | Pending |
| 5 | Quinn | Test — verify implementation | Pending |
| 6 | Chronicler | Document — update docs, openapi.yaml, ADRs | Pending |

---

## Phase 1 Audit Findings

**Status:** Pending Scout's audit (Step 1)

Scout is researching:
1. Full existing `~/src/AWARE/` codebase
2. AMRO-S paper (arXiv:2603.12933)
3. Enterprise landscape: Microsoft Agent 365, Okta Agent Gateway, Galileo Agent Control

Output: `~/src/AWARE/docs/research/audit-findings.md`

---

## Architecture Map

**Status:** Pending Archimedes' architecture (Step 2)

Archimedes will produce: `~/src/AWARE/docs/AUDIT.md`

---

## Key Constraints

1. All pushes go to Gitea: `http://openclaw.local:3000/alvin/AWARE` (NOT GitHub)
2. Do NOT break existing AWARE functionality — all current tests must pass
3. Maintain backward compatibility
4. All new code must have tests
5. All new API endpoints must be added to `docs/openapi.yaml`
6. Use existing stack (Node.js, Express.js, React) unless ADR justifies otherwise
7. GPL-3.0 license
8. British English in all documentation
9. Every architectural decision gets an ADR in `docs/adr/`

---

## Previous Work (WRONG LOCATION)

The work previously done at `~/.openclaw/projects/AWARE-Evolution/` was in the wrong repository and is NOT valid for this evolution. It will not be carried forward.

---

## Next Steps

1. Scout completes Step 1 (audit findings)
2. Archimedes completes Step 2 (architecture map)
3. Forge begins Step 3 (implementation)
4. Critic completes Step 4 (review)
5. Quinn completes Step 5 (test)
6. Chronicler completes Step 6 (document)

---
