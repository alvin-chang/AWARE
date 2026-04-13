# ADR-013 Phase 3.1 — VERDICT

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)
**Date:** 2026-04-14
**Status:** REQUEST_CHANGES

---

## Verdict: REQUEST_CHANGES ⚠️

The ADR is close to approval but has **1 critical blocking inconsistency** and **2 non-blocking concerns** that should be addressed before implementation proceeds.

---

## Critical Blocking Issues

### 🔴 B-1 CRITICAL — Status Field Inconsistency

**Location:** Header vs. footer of ADR

The header reads:
> **Status:** APPROVED (Critor, 2026-04-01 14:00 BST) ✅

But the footer reads:
> **Status:** DRAFT — Ready for Critor review and Scout research on attestation standards.

An ADR cannot be simultaneously APPROVED and DRAFT. One of these must be corrected. If this ADR was pre-approved before full drafting was complete, the header should read "PROPOSED" or "REVIEW_REQUESTED". If the draft status is current, the header approval claim must be removed. This ambiguity blocks implementation because it is unclear whether changes require re-approval.

**Required action:** Remove the "APPROVED" claim from the header until the ADR has been formally ratified through the BMAD gate process.

---

## Non-Blocking Issues

### 🟡 N-1 MEDIUM — `broadcastRevocation` Mechanism Underspecified

**Location:** Section "Revocation Propagation" + Blast Radius code

`broadcastRevocation(agentId, severity)` is called in the blast radius code but no implementation or interface is defined anywhere in this ADR. The distributed revocation cache structure is well-specified (etcd paths, TTL), but the actual propagation mechanism — how revoked agents receive revocation notifications, what protocol is used, and what happens to agents that are offline during a CRITICAL revocation — is not specified.

This is a MEDIUM rather than CRITICAL because the etcd-based revocation cache provides a fallback: agents check the cache on each attestation call. But the cache-TTL means there is a window where a freshly revoked agent's tokens could still be accepted before cache invalidation.

**Suggested action:** Add a section or note clarifying the broadcast mechanism, even if it is "agents poll the revocation cache on a configurable interval (default: 30s) and force re-attestation on CRITICAL revocation events."

---

### 🟡 N-2 MEDIUM — Open Questions Left Unresolved Could Block Phase 3.2+

**Location:** "Open Questions" section (5 questions listed)

Five open questions are identified but left for future resolution:
1. trustDomain hierarchy (hierarchical vs. flat)
2. Cross-trustDomain communication rules
3. Session TTL default value
4. Revocation grace period (24h fixed vs. configurable)
5. Attestation verification caching

Questions 1 and 2 are particularly concerning because trustDomain is already used in JWT claims and the attestation verification flow. If the hierarchy question is not resolved, two Phase 3 agents implementing cross-domain workflows could make incompatible assumptions.

**Suggested action:** Either resolve these questions now (even with a provisional decision recorded in the ADR), or add explicit MUST-NOT-IMPLEMENT constraints: "Agents in different trustDomains MUST NOT communicate until ADR-XXX resolves cross-trustDomain protocol."

---

## What Is Well-Specified ✅

| Area | Assessment |
|------|------------|
| NHI Lifecycle (PENDING→APPROVED→ACTIVE→INACTIVE→REVOKED→PURGED) | ✅ Fully specified with diagram and state transition table |
| JWT Extension (trustDomain, clearance, capabilities as object map) | ✅ Correctly specified; capabilities as scored object (not bare array) is a good improvement over Phase 1.1 |
| Credential rotation (zero-downtime with grace period) | ✅ Well-specified with code stub |
| Session binding + execution context | ✅ Detailed with verification logic |
| Identity attestation verification flow | ✅ Complete step-by-step including trustDomain check and revocation cache lookup |
| C-01 Fix (hardcoded secret) | ✅ Fail-fast enforcement with minimum length check |
| C-02 Fix (heartbeat auth) | ✅ JWT required + ownership validation |
| C-03 Fix (heartbeat fail-closed) | ✅ Explicit fail-closed with policy engine error handling |
| Blast radius on revocation | ✅ Pheromone trail degradation with severity factors |
| Compliance mapping | ✅ CSA AI Control Matrix, NIST AI RMF, ISO 27001, DORA |

---

## Summary

**Blocking issues:** 1 (critical status inconsistency)  
**Non-blocking issues:** 2 (medium)  
**Overall quality:** High — the technical content is thorough and well-reasoned. The lifecycle, JWT claims, and security fixes are all correctly specified. The ADR needs only the status inconsistency resolved before it can be approved for implementation.

---

*⚖️ Critic — reviewer@openclaw.local*
