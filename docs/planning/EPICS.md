# Epics & Stories — AWARE-Evolution

**Phase:** P1 Planning (A1→P1 gate)
**Owner:** Archimedes (Architect)
**Date:** 2026-04-13
**Status:** Draft — for P1 gate review

---

## Epic 1: T0 Constraint Engine (C1)

**Problem:** Agents can exfiltrate data, run unapproved tools, or act beyond their authority without detection.

**Stories:**

| ID | Story | Estimate |
|----|-------|----------|
| E1-S1 | Constraint engine enforces whitelist of allowed URLs/domains per agent | 2 days |
| E1-S2 | Human authority gate requires explicit approval before sensitive tool execution | 2 days |
| E1-S3 | RSA-SHA256 request signing proves agent identity to backend | 1 day |
| E1-S4 | Append-only SHA-256 hash chain detects replay/tampering | 1 day |
| E1-S5 | T0 constraints are infrastructure-level, not bypassable by agent code | 1 day |

**Total estimate:** 7 days

---

## Epic 2: Circuit Breakers (C2)

**Problem:** Cascading failures in agent pipelines take down entire systems. No graceful degradation.

**Stories:**

| ID | Story | Estimate |
|----|-------|----------|
| E2-S1 | Per-agent circuit breaker trips after N consecutive failures | 2 days |
| E2-S2 | Circuit stays open for configurable cooldown period | 1 day |
| E2-S3 | Fallback behavior executes when circuit is open | 1 day |
| E2-S4 | Circuit state exposed via API for dashboard display | 1 day |
| E2-S5 | Manual reset via API or dashboard | 1 day |

**Total estimate:** 6 days

---

## Epic 3: Anomaly Detection (C3)

**Problem:** Behavioral anomalies (tool calling patterns, data access, timing) are invisible until damage is done.

**Stories:**

| ID | Story | Estimate |
|----|-------|----------|
| E3-S1 | Baseline model learns normal tool call frequency and sequence per agent | 3 days |
| E3-S2 | Anomaly score computed per action; threshold configurable | 2 days |
| E3-S3 | Alert triggered when anomaly score exceeds threshold | 1 day |
| E3-S4 | Alert dashboard shows anomaly history and severity | 1 day |
| E3-S5 | Alerts can trigger circuit breaker or human notification | 1 day |

**Total estimate:** 8 days

---

## Epic 4: ATD Integration (C4)

**Problem:** Agent activity not visible to operators; no unified tactical display.

**Stories:**

| ID | Story | Estimate |
|----|-------|----------|
| E4-S1 | Backend exposes agent activity events via WebSocket | 2 days |
| E4-S2 | ATD React dashboard connects to event stream | 2 days |
| E4-S3 | Dashboard shows constraint state, circuit breakers, anomaly alerts | 2 days |
| E4-S4 | Dashboard runs on port 3099, accessible alongside main AWARE UI | 1 day |

**Total estimate:** 7 days

---

## Cross-Cutting Stories

| ID | Story | Estimate |
|----|-------|----------|
| X1-S1 | All features have integration tests | 3 days |
| X1-S2 | All features have TypeScript type coverage | 1 day |
| X1-S3 | Docker Compose deployment works out of the box | 1 day |

**Total cross-cutting:** 5 days

---

## Total C1-C4 Estimate: 33 days

**Complexity note:** This assumes 1 Forge working full-time. With 2 Forges or reduced scope, could parallelize to 18-20 days.

---

## Dependencies

- E4 (ATD) requires E1 (constraints) to be partially complete — constraint state feeds dashboard
- E3 (anomaly) can run in parallel with E2 (circuit breakers)
- E1 (T0) is the highest risk — contains cryptographic components
