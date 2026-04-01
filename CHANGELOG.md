# Changelog

All notable changes to AWARE Evolution are documented here.

## [Unreleased] — All Phase 3 ADRs Approved ✅

## [1.2.0] — 2026-04-01 — ADR Approvals

### ADR-014: Phase 3.1B — Behavioural Anomaly Detection ✅

**Status:** APPROVED (Critic, 2026-04-01 21:10 BST)
**Commit:** `06c983e`

**Findings resolved:**
- F-1: Penalty formula now INCREASES with anomaly (was decreasing/inverted)
- F-2: stddev=0 guard prevents NaN in computeZScore()
- F-3: classifySeverity() uses BOTH anomaly AND trust score

### ADR-013: Phase 3.1A — Agent Identity & Authentication Framework ✅

**Status:** APPROVED (Critic, 2026-04-01 14:00 BST)
**Commit:** `b61fda3`
**Testing:** 27/27 tests passing (identity-v2.test.js)

**Content:**
- NHI lifecycle state machine (PENDING→APPROVED→ACTIVE→INACTIVE/REVOKED)
- Extended JWT claims: trustDomain, sessionId, executionContext, trustScore
- Zero-downtime credential rotation
- Session binding to execution context
- Identity attestation for cross-agent communication
- Distributed revocation cache with blast radius
- Fixes C-01 (hardcoded secret), C-02 (heartbeat auth), C-03 (fail-closed)

---

### ADR-010: Phase 2.2 — Security-Weighted Heuristic Function ✅

**Status:** APPROVED (Critic, 2026-04-01 20:39 BST)
**Commit:** `39bc2be`

**Findings resolved:**
- F-2: validateWeights() function added to prevent NaN/Infinity
- F-5: ALPHA/BETA explicitly defined (1.0 default)
- F-6: heuristicSum=0 guard prevents division by zero

---

## [1.1.4] — 2026-04-01 — Phase 1.4 Complete

### Phase 1.4 — Kill Switch with Raft Consensus ✅

**Status:** Complete (2026-04-01)

**Components:**
- **RevocationEntry** (C-01): Proper revocation type for emergency shutdown
- **Raft Consensus** (C-02): Majority quorum for kill-switch decisions
- **Vote Granting** (C-03): Proper Raft vote granting via node registry
- **Kill Switch Routes** (C-04): Emergency shutdown endpoints mounted in src/api/index.js

**Testing:** 10/10 kill-switch tests passing (Quinn verified)
**Commits:** `d4f44d7`, `aa278ab`, `f711c3d`, `2846e2e`

---

## [1.1.3] — 2026-04-01 — Phase 1.3 Complete

### Phase 1.3 — Behavioural Baseline & Anomaly Detection

**Added:**
- **Metrics Collector** — `src/monitoring/metrics-collector.js` — Singleton service aggregating agent metrics
- **Baseline Service** — `src/monitoring/baseline-service.js` — Rolling 7-day window, z-score computation, statistics (mean, stddev, p50-p99)
- **Anomaly Detector** — `src/monitoring/anomaly-detector.js` — Z-score thresholds (CRITICAL >4σ, HIGH >3σ, MEDIUM >2.5σ, LOW >2σ)
- **Fingerprint Service** — `src/monitoring/fingerprint-service.js` — Prompt injection detection (beyond Phase 1.3 spec)
- **Metrics Store** — `src/monitoring/store.js` — JSON persistence with atomic writes, 30-day retention
- **Metrics Router** — `src/api/routes/metrics.js` — 11 REST API endpoints

**Metric Types:**
- `TOOL_CALL_FREQUENCY` — Tool usage tracking per agent
- `RESPONSE_LATENCY` — Response time distribution
- `ERROR_RATE` — Error frequency per agent
- `DECISION_FINGERPRINT` — Prompt injection detection (beyond spec)

**Review:** ✅ Critic APPROVED (2026-04-01)
**Testing:** 47/52 passing | 6 pre-existing auth failures (api.test.js)
**Commits:** `d679ec6`, `e0c0fd2`, `a3ceaec`, `f7e7427`, `653ba7a`, `8159cf7`, `1bc02ce`

---

### Phase 1.2 — Per-Agent Sandbox Policies ✅

**Status:** Complete (2026-03-31)

**Added:**
- **Policy Engine core** — Model, Tool Catalog, Policy Store, Policy Engine, Policy Routes
- **Per-Agent Sandboxes** — sandbox policy schema (tools, network, trust level)
- **Tool Contract Registry**
- **Runtime policy reload without restart**

**Security Fixes (Phase 1b):**
- Heartbeat spoofing prevention — Policy Engine verifies caller owns slot before heartbeat accepted

**Commits:** `92a9443`

---

## [1.1.1] — 2026-03-29 — Phase 1.1 Complete

### Added
- **Agent Registry** — NHI (Non-Human Identity) lifecycle management
  - `POST /registry/agent` — Register new agent with identity
  - `GET /registry/agent/:agentId` — Retrieve agent details
  - `PUT /registry/agent/:agentId/heartbeat` — Heartbeat with ownership verification
  - `DELETE /registry/agent/:agentId` — Deregister agent
  - `GET /registry/agents` — List all registered agents
  - `GET /registry/agent/:agentId/telemetry` — Decision event telemetry
- **Decision Event Telemetry** — Observable routing decision trails
- **SQLite storage backend** — `src/store/etc7-store.ts` interface
- **etcd storage backend** — `src/store/etcd-store.ts` (production)

### Security Fixes (Phase 1.1)
- `trustDomain` — Server-assigned, not client-supplied (commit 44974f6)
- `webhookUrl` — SSRF protection via blocklist validation (commit 44974f6)

### Testing
- 17/17 unit tests pass
- Integration tests require etcd on port 18900

### Dependencies
- etcd (port 18900) for integration tests

---

## [Prior] — Original AWARE (Distributed Systems Platform)

Original AWARE was a distributed systems platform using ant colony-inspired algorithms for cluster coordination and resource optimization. This is now archived at `docs/legacy/README-v1.md`.

---

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1.1 | Agent Identity Layer | ✅ Complete |
| 1.2 | Per-Agent Sandbox Policies | ✅ Complete |
| 1.3 | Behavioural Baseline | ✅ Complete |
| 1.4 | Kill Switch | ✅ Complete |
| 2.1 | Pheromone Specialists | 🔄 In Progress |
| 2.2 | Security-Weighted Heuristic | ✅ APPROVED (ADR-010) |
| 3.1 | Agent Identity & Authentication | ✅ APPROVED (ADR-013) |
| 3.1B | Behavioural Anomaly Detection | ✅ APPROVED (ADR-014) |
| 3.1C | Tool Access Control | ⏳ Pending (ADR-015) |
| 3.2 | Compliance Mapping | ⏳ Pending (ADR-016) |
| 3.2 | Kill Switch Propagation | ⏳ Pending (ADR-017) |

---

*Generated by Chronicler (Scribe) — 2026-04-01*
