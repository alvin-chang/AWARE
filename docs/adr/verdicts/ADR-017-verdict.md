# ADR-017 Verdict — Phase 3.2 Kill Switch Propagation & Emergency Shutdown

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)
**Date:** 2026-04-14
**Verdict:** REQUEST_CHANGES

---

## Summary

ADR-017 is structurally solid and covers the full kill signal lifecycle. The severity model (LOCAL / DOMAIN / GLOBAL), Raft-based propagation, shutdown procedures, acknowledgment protocol, and recovery flow are all well-specified. However, there are **two blocking gaps** that must be resolved before this ADR can be approved.

---

## Assessment

### 1. Kill Switch Mechanism (Local vs Global) — ✅ SPECIFIED

The three-tier severity model is clear and well-differentiated:

| Level | Scope | Propagation |
|-------|-------|-------------|
| LOCAL | Single agent | None — agent self-revokes |
| DOMAIN | Trust domain | Broadcast to domain via Raft |
| GLOBAL | All agents | Full cluster Raft broadcast |

Trigger conditions are enumerated per level (auto and manual). The `KillSignalEntry` Raft log type is defined. The blast radius estimation function is present.

**Verdict: Adequately specified.**

---

### 2. Propagation Speed/Time — ❌ NOT SPECIFIED

**This is a blocking gap.**

The ADR defines the *mechanism* of propagation (Raft broadcast via `KillSignalEntry`) and the *acknowledgment deadline* (5 minutes), but it does **not** specify the expected propagation latency — i.e., how long it takes for a kill signal to travel from the issuer to all targeted agents through Raft consensus.

Missing:
- Expected Raft log commit latency for a `KillSignalEntry`
- Whether propagation is synchronous (all agents receive before shutdown begins) or asynchronous
- What happens if an agent is unreachable at the time of broadcast (cold-standby, network partition)
- Whether the 5-minute acknowledgment deadline is a SLA or just a monitoring threshold

The `checkKillSignalProgress` function checks for missing acknowledgments, but there's no defined handling path for agents that are permanently unreachable during a broadcast.

**Required fix: Specify expected propagation latency bounds and handling for unreachable agents.**

---

### 3. Rollback/Safety Mechanisms — ⚠️ PARTIALLY SPECIFIED

The **authority matrix** for kill signal cancellation is detailed (LOCAL → DOMAIN admin, DOMAIN → domain admin + CISO, GLOBAL → 3 C-level approvals with board quorum). The API endpoint `POST /api/kill-switch/:killSignalId/cancel` exists in the endpoint table.

However, the **cancel execution procedure** is not defined:
- What does cancellation actually do to agents that have already started shutting down?
- If graceful shutdown has already begun, does cancel halt it?
- Is there a window in which cancel is effective vs. too late?
- What is the state of a partially-killed domain if a cancel is issued mid-propagation?

The `GLOBAL_KILL_CANCEL_AUTHORITY` config object is defined, but no corresponding `executeKillSignalCancel()` function exists in the ADR.

**Required fix: Define the cancel execution procedure, including handling of in-flight shutdowns and partial propagation states.**

---

### 4. Open Issues

| # | Question | Risk if Unresolved |
|---|----------|-------------------|
| OQ-1 | Automatic LOCAL → DOMAIN escalation? | Unresolved, could allow cascading failures |
| OQ-2 | Mandatory recovery waiting period? | Rapid re-compromise risk |
| OQ-3 | Partial recovery with reduced permissions? | Either accept full reset or define tiered restore |
| OQ-4 | One-way agent message before shutdown? | Could leak critical info or could be vital for alerting |

These are listed as open questions but have no proposed resolution or recommendation. At minimum, the ADR should state which decisions are deferred to Phase 3.3 or operational runbook.

---

## Blocking Issues (must fix before approval)

1. **Propagation latency is unspecified** — no expected time bounds for Raft broadcast delivery, no handling for unreachable agents, no distinction between acknowledgment deadline and propagation SLA.

2. **Kill signal cancel procedure is not defined** — authority matrix exists but no execution flow; partial propagation state is unhandled.

---

## Non-Blocking Observations

- The acknowledgment write verification (F-1) is adequately handled with retry + throw semantics.
- The GLOBAL cancel authority matrix (F-2) is well-specified with 3-approver requirement, board quorum, and written justification.
- The cleanup procedure correctly integrates credential revocation (ADR-013), pheromone erosion (ADR-011), and session invalidation.
- The blast radius estimator is a valuable safety net before issuing.
- The compliance mapping to CSA AI Control Matrix, NIST AI RMF, ISO 27001, and DORA is thorough.

---

## Verdict

**REQUEST_CHANGES**

Fix the two blocking issues before re-submission:
1. Add propagation latency specification (expected bounds, unreachable agent handling)
2. Define kill signal cancel execution procedure (in-flight shutdown handling, partial propagation state)

---

*Critic ⚖️ (reviewer@openclaw.local) — 2026-04-14*
