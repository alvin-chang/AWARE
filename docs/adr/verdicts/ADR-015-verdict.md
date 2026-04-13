# ADR-015 Verdict — Phase 3.1 Tool Access Control

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)  
**Date:** 2026-04-14  
**ADR:** ADR-015-phase-3-1-tool-access-control.md  
**Phase:** 3.1 (P1)

---

## Verdict: REQUEST_CHANGES

The ADR defines a solid foundation for tool access control but has **three blocking issues** that must be resolved before implementation can proceed.

---

## Key Findings

### 1. RBAC Model — Partially Specified ⚠️

**What's defined:**
- Roles: `admin`, `coder`, `researcher`, `tester`
- Permission patterns with wildcard matching (`read:workspace/*`)
- Deny-first evaluation with pre-compiled regex (F-3 security fix)
- Parameter validation against schema (F-1 fix)

**What's missing:**
- **Role inheritance is declared but never implemented.** The `ROLES` constant has `inherits: []` for all roles, but there's no code showing how inheritance is resolved. Real-world RBAC typically has role hierarchies (e.g., `admin` inherits `coder`, `tester`).
- **Agent-to-role mapping is absent.** The ADR defines what roles exist but not how an agent gets assigned a role. Is it baked into identity (ADR-013)? A separate role assignment service? Config file?

**Impact:** Without role inheritance, you either duplicate permissions across roles or have a flat, rigid structure. Without agent-to-role mapping, the entire system has no way to authorize any agent.

---

### 2. Tool Permission Hierarchy — Implicit, Not Explicit ⚠️

**What's defined:**
- Risk levels: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- Pattern syntax: `category:name/*`

**What's missing:**
- No enforced hierarchy between risk levels. If something is `CRITICAL`, can it override `HIGH`? Can an admin grant `CRITICAL` permissions to a lower role?
- The pattern hierarchy (`credential:*` vs `credential:keychain/*`) is not specified — does a deny on `credential:*` block `credential:keychain:read`?
- No escalation path when a tool spans multiple categories.

**Impact:** Admins making permission changes won't have clear rules about what overrides what. Denials may not cascade correctly up the permission tree.

---

### 3. Emergency Override — Not Specified 🚨

**What's missing:**
- No "break-glass" mechanism for emergency access
- No time-limited emergency role elevation
- No audit trail specifically for emergency overrides
- No definition of who can authorize emergency access

**Impact:** In a real incident, operators may need to bypass tool restrictions (e.g., disable the exec tool to stop a runaway agent, or grant temporary credential access). Without an explicit override mechanism, either:
1. The system is too rigid to handle real emergencies, OR
2. Operators create ad-hoc bypasses that bypass the audit trail

This is a compliance gap for DORA Art. 26 and ISO 27001 A.9.4 — both require documented emergency access procedures.

---

## Non-Blocking Observations

| Issue | Severity | Notes |
|-------|----------|-------|
| Tool chaining (multiple tools per request) | Advisory | Listed as open question — needs decision before impl |
| Third-party tool handling | Advisory | Signing/sandboxing not specified — can be deferred |
| Permission delegation between agents | Advisory | Listed but flagged as dangerous — probably don't implement |

---

## Required Changes

Before APPROVED, the ADR must address:

1. **Implement role inheritance** — Either implement the `inherits` field in `ROLES` or remove it and document the flat structure rationale.

2. **Define agent-to-role binding** — Specify how agents receive roles (via ADR-013 identity, via config, via a role service). At minimum, show the data flow.

3. **Add emergency override mechanism** — Define a break-glass procedure with:
   - Time-limited elevated permissions
   - Explicit audit logging of override events
   - Defined authorized actors (who can invoke emergency mode)
   - Automatic expiry/revocation

4. **Clarify permission hierarchy resolution** — Document how denies at higher levels (`credential:*`) interact with more specific allows (`credential:keychain:read`).

---

## Summary

| Criterion | Status |
|-----------|--------|
| RBAC model properly specified? | ⚠️ Partial — roles defined, inheritance not implemented, agent binding missing |
| Tool permission hierarchy clear? | ⚠️ Implicit only — no explicit escalation or override rules |
| Emergency override mechanisms specified? | 🚨 Missing — compliance gap |
| Any blocking issues? | **YES** — three items above must be resolved |

---

**Recommendation:** Return to Archimedes for revisions. The core architecture is sound, but implementation without resolving role inheritance and emergency override will create gaps that are expensive to close later.

---
*Reviewer: Critic ⚖️ — AWARE-Evolution Project*