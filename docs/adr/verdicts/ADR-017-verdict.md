# ADR-017 Verdict — Phase 3.2 Kill Switch Propagation & Emergency Shutdown

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)
**Date:** 2026-04-14
**Commit reviewed:** f4481d0
**Previous review:** 2026-04-01 (REQUEST_CHANGES — missing propagation SLA bounds and cancel-during-shutdown procedure)
**ADR Status:** DRAFT → APPROVED

---

## Verdict: ✅ APPROVED

All previously identified blocking gaps have been addressed. ADR-017 is ready for implementation.

---

## Verification Against Prior Findings

### ✅ Finding F-1: Propagation SLA Bounds — RESOLVED

**What was missing:** Expected propagation latency through Raft consensus not specified.

**What was added:** "Propagation SLA Bounds" table (Section: Propagation Mechanism) with explicit latency numbers:

| Propagation Phase | Expected Latency | Maximum Latency |
|-----------------|-----------------|-----------------|
| Raft log commit (LOCAL) | < 50ms | 500ms |
| Raft broadcast (DOMAIN) | < 200ms per hop | 2s total |
| Raft broadcast (GLOBAL) | < 500ms total | 5s total |
| Agent shutdown execution | < 1s | 5s |
| Acknowledgment write | < 100ms | 1s |

Additionally, Raft consensus assumptions are documented (3-node cluster, majority=2, network partition handling for >10s unreachable agents).

### ✅ Finding F-2: Cancel-During-Shutdown Procedure — RESOLVED

**What was missing:** No defined handling when cancel is issued mid-propagation or mid-shutdown.

**What was added:** "Cancel-During-Shutdown Procedure" section with:

- **Cancel Decision Tree** — branching logic for LOCAL/DOMAIN/GLOBAL severity with explicit outcomes
- **Cancel States and Effects table** — maps kill signal state to cancel effectiveness (CANCEL_SUCCESS / PARTIAL_CANCEL / CANCEL_INEFFECTIVE)
- **Cancel API response structure** — includes `killedAgents`, `rescuedAgents`, `propagationStopped`, and status
- **Post-Cancel Actions:**
  1. 1 hour elevated monitoring (ADR-014 anomaly detection at 2x sensitivity)
  2. Automatic incident report generated within 24h
  3. False positive root cause documentation required before kill signal type re-enabled

---

## Additional Review Notes

### Unreachable Agent Handling — Clear ✅

Section clearly specifies:
- 15-minute reconnect window for offline agents
- `delayed: true` flag for late acknowledgments
- Agents marked `AGENT_NEVER_RECONNECTED` if they fail to return within 15 minutes
- Cold-standby agents check etcd for active kill signals on restart before accepting requests

### Acknowledgment Write Verification — Present ✅

The `acknowledgeKillSignal` function retries once on failure and throws an error if the write cannot be verified. Critical failures are logged to audit with severity `CRITICAL`.

### GLOBAL Kill Cancel Authority Matrix — Present ✅

Three-approver requirement, board quorum rules, 5-minute cooldown between cancel attempts, written justification required.

---

## Remaining Open Questions (Non-Blocking)

The ADR lists 4 open questions. These are design decisions for implementation, not blocking issues:

1. Automatic LOCAL→DOMAIN escalation on repeated kills
2. Mandatory waiting period before re-onboarding
3. Gradual permission restoration for partially-recovered agents
4. One-message-before-shutdown allowance for killed agents

These do not block implementation — they can be resolved during the implementation phase or deferred to operational policy.

---

## Summary

| Criterion | Status |
|-----------|--------|
| Propagation SLA bounds specified with latency numbers | ✅ RESOLVED |
| Unreachable agent handling clear | ✅ VERIFIED |
| Cancel-during-shutdown procedure defined | ✅ RESOLVED |
| Remaining blocking issues | **NONE** |

**ADR-017 is approved for implementation.**

---