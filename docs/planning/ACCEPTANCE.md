# Acceptance Criteria — AWARE-Evolution C1-C4

**Phase:** P1 Planning (A1→P1 gate)
**Owner:** Archimedes + Pixel
**Date:** 2026-04-13
**Status:** Draft — for P1 gate review

---

## C1: T0 Constraint Engine — Acceptance Criteria

| # | Criterion | Testable Condition |
|---|-----------|-------------------|
| AC1 | URL whitelist enforcement | Agent request to non-whitelisted URL returns 403 with constraint violation logged |
| AC2 | Human authority gate | Sensitive tool call triggers approval request; request held until approved/rejected |
| AC3 | Token expiry | Approval tokens expire after 10 minutes; expired tokens rejected |
| AC4 | RSA-SHA256 signing | All agent→backend requests signed; signature verified at gateway |
| AC5 | Hash chain integrity | Hash chain cannot be modified without detection; verification returns error on tamper |
| AC6 | Non-bypassable | Compromised agent cannot disable constraints at agent level; only gateway-level override |

**Verification:** `npm test` constraint tests; manual signing verification

---

## C2: Circuit Breakers — Acceptance Criteria

| # | Criterion | Testable Condition |
|---|-----------|-------------------|
| AC7 | Circuit trips | After N consecutive failures, circuit opens; subsequent requests immediately return fallback |
| AC8 | Cooldown | Circuit stays open for configured cooldown period; after expiry, half-open allows test request |
| AC9 | Fallback executes | When circuit open, fallback behavior runs (log + return safe response) |
| AC10 | State API | GET /circuit-breakers/:agentId returns {state, failureCount, lastFailure} |
| AC11 | Manual reset | POST /circuit-breakers/:agentId/reset returns 200; circuit closes immediately |

**Verification:** `npm test` circuit breaker tests; curl commands against live system

---

## C3: Anomaly Detection — Acceptance Criteria

| # | Criterion | Testable Condition |
|---|-----------|-------------------|
| AC12 | Baseline model | System starts with no baseline; learns from first 1000 agent actions |
| AC13 | Anomaly scoring | Anomaly score 0-1 returned per action; score > threshold triggers alert |
| AC14 | Alert creation | Alert record created in DB with severity, agentId, timestamp, score |
| AC15 | Alert API | GET /alerts returns list; GET /alerts/:id returns detail |
| AC16 | Threshold config | Anomaly threshold configurable per agent via config |
| AC17 | Circuit integration | Alert with severity=critical automatically trips circuit breaker for that agent |

**Verification:** Synthetic anomaly injection; verify alert created in DB

---

## C4: ATD Dashboard — Acceptance Criteria

| # | Criterion | Testable Condition |
|---|-----------|-------------------|
| AC18 | Dashboard loads | http://localhost:3099 loads without console errors |
| AC19 | Agent list | All registered agents shown with name, status, constraint state |
| AC20 | Circuit display | Open circuits shown with red indicator; click shows details |
| AC21 | Anomaly display | Recent anomalies shown; severity badge (yellow/red) |
| AC22 | Real-time updates | New alerts appear within 5 seconds via WebSocket |
| AC23 | Responsive | Dashboard usable on 1024px+ viewport |

**Verification:** Playwright E2E test; manual browser test

---

## Non-Functional Criteria (All Phases)

| # | Criterion |
|---|-----------|
| NF1 | TypeScript: 0 errors (tsc --noEmit) |
| NF2 | Test coverage: >70% for core modules |
| NF3 | Docker Compose: `docker compose up` starts all services |
| NF4 | API latency: <100ms for non-training endpoints |

---

## Definition of Done (All Phases)

- All acceptance criteria pass (automated or manual verification documented)
- All critical/high bugs from review resolved or deferred with documented reason
- Architecture decision records updated if new decisions made
- No TypeScript errors
- Tests written and passing
