# AWARE Phase 1 Audit — Architecture Map, Extension Points & Risk Register

**Project:** AWARE Evolution (Correct Location)
**Phase:** Step 2 — Architecture (Re-run)
**Author:** Archimedes (System Architect)
**Date:** 2026-03-31
**Status:** READY FOR IMPLEMENTATION
**Scope:** Phase 1 (1.1–1.4)

---

## 1. Executive Summary

This document maps AWARE's existing codebase (`~/src/AWARE/`) to the four Phase 1 evolution targets from `EVOLUTION-BRIEF.md`:
- 1.1 Agent Identity Layer — NHI lifecycle, cryptographic credentials, agent registry
- 1.2 Per-Agent Sandbox Policies — Policy-as-code, tool-call authorization
- 1.3 Behavioural Baseline & Anomaly Detection — monitoring, anomaly detection
- 1.4 Kill Switch — Raft consensus for agent revocation

**Conclusion:** AWARE's existing foundations (Raft consensus, node discovery, JWT/RBAC, alert system, etcd store) require extension rather than redesign. Phase 1 adds four new first-class modules on top of proven infrastructure.

**Critical path:** Phase 1.1 (Agent Identity Layer) is the root dependency. Phases 1.2–1.4 all depend on agents being identifiable principals.

---

## 2. Existing Codebase Map

### 2.1 Module Inventory

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **AWAREEngine** | `src/index.js` | 88 | Main entry point; initializes NodeDiscovery, ElectionManager, APIGateway |
| **NodeDiscovery** | `src/node-discovery/` | ~400 | UDP broadcast node discovery, heartbeat, discovered nodes map |
| **ElectionManager** | `src/election/` | ~350 | Raft consensus, leader election, term-based voting, heartbeat |
| **APIGateway** | `src/api/` | ~300 | Express REST API, JWT auth, routes (cluster, nodes, alerts, resources) |
| **UI** | `src/ui/` | ~2000 | React + Material-UI monitoring dashboard |

### 2.2 Architecture Diagram (Existing)

```
┌─────────────────────────────────────────────────────────────────┐
│                         AWAREEngine                              │
│  (src/index.js — orchestrates all services)                     │
└────────────────┬────────────────────────────┬───────────────────┘
                 │                            │
    ┌────────────▼────────────┐    ┌──────────▼────────────┐
    │     NodeDiscovery      │    │   ElectionManager     │
    │  (UDP broadcast/recv)  │    │  (Raft consensus)     │
    │  Port 41234/41235      │    │  Leader/Follower/Cand │
    └────────────┬────────────┘    └──────────┬────────────┘
                 │                            │
    ┌────────────▼────────────────────────────────────────────┐
    │                      APIGateway                          │
    │              (Express + JWT/RBAC)                         │
    │  /login /register /api/cluster /api/nodes               │
    │  /api/alerts /api/resources                              │
    └─────────────────────────────────────────────────────────┘
```

### 2.3 Technology Stack (Existing)

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node.js | Single-threaded event loop |
| Web framework | Express.js | REST API |
| Auth | JWT + RBAC | Human-auth framework, needs NHI extension |
| Consensus | Raft (custom) | Leader election, heartbeat, term-based voting |
| Discovery | UDP broadcast | Port 41234/41235, node announcements |
| State | etcd | Key-value store, existing schema for nodes/resources |
| Frontend | React + Material-UI | Monitoring dashboard |
| Security | helmet, cors, rate-limit | Basic HTTP security headers |

### 2.4 Existing API Routes

| Route | File | Auth | Purpose |
|-------|------|------|---------|
| POST /login | `src/api/index.js` | None | JWT issuance for human users |
| POST /register | `src/api/index.js` | None | User registration |
| GET /api/cluster/status | `src/api/routes/cluster.js` | JWT | Cluster health |
| GET /api/nodes | `src/api/routes/nodes.js` | JWT | List registered nodes |
| GET /api/alerts | `src/api/routes/alerts.js` | JWT | Alert history |
| GET /api/resources | `src/api/routes/resources.js` | JWT | Resource allocation |

---

## 3. Phase 1 Extension Map

### 3.1 Phase 1.1 — Agent Identity Layer

**Target:** NHI (Non-Human Identity) lifecycle management.

#### Extension Points

| Existing Component | Extension | New File(s) |
|-------------------|-----------|-------------|
| `src/node-discovery/` | Extend UDP broadcast protocol with `AGENT_ANNOUNCE` message type | `src/agents/protocol.js` |
| `src/api/` | Add `/api/agents/*` routes (CRUD for agent identities) | `src/api/routes/agents.js` |
| JWT/RBAC | Extend JWT claims for NHI: `agent_id`, `capabilities[]`, `clearance`, `trust_score`, `valid_until` | `src/agents/identity-provider.js` |
| etcd schema | Add `/aware/agents/{agent_id}` record type | — |
| `src/api/models/User.js` | Extend to `Agent` model (vs `User` model) | `src/api/models/Agent.js` |

#### New Components Required

| Component | File | Purpose |
|-----------|------|---------|
| **Agent Registry** | `src/agents/registry.js` | CRUD for agent identities; tracks lifecycle state |
| **Identity Provider** | `src/agents/identity-provider.js` | Issues and rotates short-lived agent JWTs |
| **Agent Model** | `src/api/models/Agent.js` | Agent identity schema (extends User model pattern) |
| **Agent Routes** | `src/api/routes/agents.js` | REST endpoints for agent lifecycle |
| **Discovery Protocol Extension** | `src/agents/protocol.js` | `AGENT_ANNOUNCE`, `AGENT_REVOKE` message types |

#### Dependency Analysis

```
Phase 1.1 (Agent Registry)
├── Extends: NodeDiscovery (adds agent broadcast)
├── Extends: APIGateway (adds /api/agents routes)
├── Extends: JWT system (adds NHI claim types)
├── Stores: etcd /aware/agents/{agent_id}
└── Required by: Phase 1.2, Phase 1.3, Phase 1.4
```

---

### 3.2 Phase 1.2 — Per-Agent Sandbox Policies

**Target:** Policy-as-code engine evaluating every tool call before execution.

#### Extension Points

| Existing Component | Extension | New File(s) |
|-------------------|-----------|-------------|
| `src/api/` | Add policy evaluation middleware | `src/policies/middleware.js` |
| `src/api/routes/resources.js` | Extend resource routes with tool-call authorization | — |
| etcd schema | Add `/aware/policies/{policy_id}` document type | — |
| Alert system | Add policy violation alert type | `src/api/routes/alerts.js` |

#### New Components Required

| Component | File | Purpose |
|-----------|------|---------|
| **Policy Engine** | `src/policies/engine.js` | Core: `(agent_id, tool, resource, context) → permit/deny` |
| **Policy Store** | `src/policies/store.js` | YAML/JSON policy persistence in etcd |
| **Sandbox Enforcer** | `src/policies/sandbox.js` | Resource quotas per agent (token limits, API budgets) |
| **Data Classification** | `src/policies/data-classification.js` | Data tier access rules per agent clearance |
| **Policy Middleware** | `src/policies/middleware.js` | Express middleware intercepting tool-call routes |

#### Dependency Analysis

```
Phase 1.2 (Policy Engine)
├── Depends on: Phase 1.1 (Agent Registry) — must know agent identity before evaluating policy
├── Extends: APIGateway (policy middleware on tool-call routes)
├── Stores: etcd /aware/policies/{policy_id}
├── Uses: Alert system (src/api/routes/alerts.js) for violations
└── Required by: Phase 3.2 (Context-Aware Tool Enforcement)
```

---

### 3.3 Phase 1.3 — Behavioural Baseline & Anomaly Detection

**Target:** Per-agent behavioural baselines with statistical anomaly alerting.

#### Extension Points

| Existing Component | Extension | New File(s) |
|-------------------|-----------|-------------|
| Alert system | Add anomaly-triggered alert types | `src/api/routes/alerts.js` |
| Monitoring dashboard | Extend with agent behavioural metrics | `src/ui/` components |
| NodeDiscovery | Extend to track per-agent behavioural metrics | — |

#### New Components Required

| Component | File | Purpose |
|-----------|------|---------|
| **Behavioural Monitor** | `src/agents/behavioural-monitor.js` | Collects per-agent metrics: latency, tool-call frequency, output size, error rate |
| **Anomaly Detector** | `src/agents/anomaly-detector.js` | Statistical deviation detection (Z-score or IQR) |
| **Decision Fingerprint** | `src/agents/decision-fingerprint.js` | Hash agent outputs to detect prompt injection/model drift |
| **Trust Scorer** | `src/agents/trust-scorer.js` | Derives trust score from behavioural baseline |

#### Dependency Analysis

```
Phase 1.3 (Anomaly Detection)
├── Depends on: Phase 1.1 (Agent Registry) — must track per-agent metrics
├── Extends: Alert system (new anomaly alert types)
├── Extends: UI dashboard (behavioural metrics display)
├── Feeds: Phase 1.4 (Kill Switch triggers on anomaly)
├── Feeds: Phase 2.2 (Trust score used in pheromone heuristic)
└── Stores: etcd /aware/trust/{agent_id}
```

---

### 3.4 Phase 1.4 — Kill Switch

**Target:** Distributed agent revocation via Raft consensus.

#### Extension Points

| Existing Component | Extension | New File(s) |
|-------------------|-----------|-------------|
| `src/election/ElectionManager.js` | Add revocation broadcast to heartbeat protocol | — |
| Heartbeat protocol | Add `REVOKE` message type to `sendHeartbeatToNode()` | — |
| Alert system | Add kill-switch event alert type | `src/api/routes/alerts.js` |

#### New Components Required

| Component | File | Purpose |
|-----------|------|---------|
| **Revocation Service** | `src/agents/revocation-service.js` | Accepts kill-switch trigger, propagates via Raft log |
| **Kill Switch API** | `src/api/routes/revocation.js` | REST endpoint: `POST /api/revoke/:agent_id` |

#### Dependency Analysis

```
Phase 1.4 (Kill Switch)
├── Depends on: Phase 1.1 (Agent Registry) — must revoke specific agent identity
├── Depends on: Phase 1.3 (Anomaly Detection) — anomaly triggers kill-switch
├── Uses: ElectionManager heartbeat protocol (existing Raft infrastructure)
├── Extends: Alert system (kill-switch event logging)
└── Stores: etcd /aware/audit/revocation/{event_id} (append-only log)
```

---

## 4. Consolidated Dependency Graph

```
Phase 1.1 (Agent Registry) ──────────────────────┐
    ├── Extends NodeDiscovery (UDP protocol)       │
    ├── Extends APIGateway (/api/agents)          │
    ├── Extends JWT (NHI claims)                  │
    └── Stores etcd /aware/agents/{id}            │
                                                   ▼
Phase 1.2 (Policy Engine) ───────────────────────┐
    ├── Depends on 1.1 (agent identity)           │
    ├── Extends APIGateway (middleware)           │
    └── Stores etcd /aware/policies/{id}          │
                                                   ▼
Phase 1.3 (Anomaly Detection) ──────────────────┐
    ├── Depends on 1.1 (per-agent metrics)       │
    ├── Feeds 1.4 (kill-switch triggers)         │
    ├── Feeds Phase 2.2 (trust score)             │
    └── Stores etcd /aware/trust/{id}            │
                                                   ▼
Phase 1.4 (Kill Switch) ────────────────────────┐
    ├── Depends on 1.1 (revoke identity)         │
    ├── Depends on 1.3 (anomaly triggers)        │
    ├── Uses ElectionManager (Raft heartbeat)     │
    └── Stores etcd /aware/audit/revocation/{id}│
```

**Critical path:** 1.1 → 1.2/1.3 → 1.4

---

## 5. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Agent credential compromise** | Critical | Medium | Short-lived JWTs (1-hour expiry) + Phase 1.4 kill-switch |
| **Policy engine bypass** | Critical | Low | Policy engine as independent service, queen cannot override |
| **etcd schema conflict** | High | Medium | Use namespaced keys `/aware/agents/`, `/aware/policies/` — no collision with existing |
| **Agent discovery broadcast storm** | Medium | Low | Rate-limit agent announcements; cap broadcast frequency |
| **Trust score manipulation** | Medium | Low | Multiple data sources for scoring; anomaly detection on score changes |
| **Sandbox escape** | Critical | Low | Process separation (not WASM) — operational simplicity |
| **Policy evaluation latency** | Low | Medium | Policy engine is async; agent tool-call adds ~5–20ms latency |
| **Existing tests break** | High | Low | All existing tests must pass unchanged |

---

## 5b. Scout's Security Findings (Prerequisites for Phase 1.2)

**Source:** Scout's Step 1 Audit (`docs/research/audit-findings.md`)
**Date:** 2026-03-31
**Status:** Must be addressed before Phase 1.2 begins

### CRITICAL Findings (Must Fix)

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| **C-01** | Hardcoded JWT secret fallback (`'default_secret_for_dev'`) | `src/api/middleware/auth.js:4` | **STILL VALID** — NOT FIXED |
| **C-02** | Plaintext credentials storage | `src/api/models/Agent.js` | ✅ FIXED — PBKDF2 (100k iterations) |
| **C-03** | Unauthenticated UDP discovery | `src/agents/protocol.js` | ✅ FIXED — HMAC-SHA256 signing |

### HIGH Findings (Must Fix)

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| **H-01** | Credential transmission over HTTP | `src/api/routes/agents.js` | NOT FIXED — needs HTTPS enforcement |
| **H-02** | Agent heartbeat endpoint not authenticated | `src/api/routes/agents.js` (POST /:id/heartbeat) | NOT FIXED — JWT doesn't include agent identity |

### MEDIUM Findings (Should Fix)

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| **M-01** | Credential pepper has fallback | `src/api/models/Agent.js:15` | NOT FIXED — fallback exists |
| **M-02** | No rate limiting on agent routes | `src/api/routes/agents.js` | NOT FIXED — global limiter only |
| **M-03** | No audit logging for agent lifecycle | `src/agents/registry.js`, `src/api/routes/agents.js` | NOT FIXED — integrate with alert system |

### Implementation Notes

| Finding | Architecture Fix Required |
|---------|------------------------|
| **C-01** | Remove fallback from `auth.js`; require `SECRET_KEY` env var at startup (fail-closed); minimum 32-char secret |
| **H-01** | Enforce HTTPS for all agent endpoints; add TLS certificate validation |
| **H-02** | Agents use own JWT from Identity Provider; heartbeat validates `req.agent.agentId === req.params.id` |
| **M-01** | Remove fallback from `Agent.js` pepper; require `AWARE_CREDENTIAL_PEPPER` env var |
| **M-02** | Add per-agent rate limiter to agent routes (e.g., 10 reg/min per source, 60 heartbeat/min per agent) |
| **M-03** | Add audit logging for all agent lifecycle events; integrate with existing AWARE alert system |

### Prerequisites Summary

**Before Phase 1.2 begins:**
1. ✅ C-02 (plaintext credentials) — FIXED
2. ✅ C-03 (UDP auth) — FIXED
3. ❌ **C-01** — MUST FIX before Phase 1.2
4. ❌ **H-02** — MUST FIX as part of Phase 1.1 closure
5. ❌ **M-03** — Integrate into Phase 1.2 architecture (audit logging for agent lifecycle)

---

## 6. Extension Point Detail

### 6.1 etcd Schema Extensions

```
Existing keys:
  /aware/nodes/{node_id}        → Node identity record
  /aware/resources/{resource_id} → Resource allocation

New keys (Phase 1):
  /aware/agents/{agent_id}      → Agent identity record (Phase 1.1)
  /aware/policies/{policy_id}   → Policy document (Phase 1.2)
  /aware/trust/{agent_id}       → Trust score (Phase 1.3)
  /aware/audit/revocation/{event_id} → Revocation event log (Phase 1.4)
```

### 6.2 Discovery Protocol Extensions

**New AGENT_ANNOUNCE message (Phase 1.1):**
```json
{
  "type": "AGENT_ANNOUNCE",
  "agentId": "agent:coder:instance-7f3a",
  "timestamp": 1743440000000,
  "capabilities": ["code_review", "test_write", "git_push"],
  "model": "MiniMax-M2.7",
  "version": "1.0.0",
  "clearance": "internal_only"
}
```

**New AGENT_REVOKE message (Phase 1.4):**
```json
{
  "type": "AGENT_REVOKE",
  "agentId": "agent:coder:instance-7f3a",
  "timestamp": 1743440000000,
  "reason": "anomaly_detected",
  "initiator": "agent:orchestrator:main",
  "blastRadius": "low"
}
```

### 6.3 JWT Extension for NHI

**New agent NHI JWT claims:**
```json
{
  "sub": "agent:coder:instance-7f3a",
  "iss": "aware-ca",
  "type": "agent",
  "capabilities": ["code_review", "test_write", "git_push"],
  "clearance": "internal_only",
  "trust_score": 0.87,
  "valid_until": "2026-03-31T17:00:00Z",
  "rotated_from": "agent:coder:instance-3b9c"
}
```

---

## 7. Implementation Order

**Prerequisites before Phase 1.2:**
- C-01 MUST be fixed (hardcoded secret in auth.js) — blocking
- H-02 MUST be fixed (heartbeat auth) — blocking
- M-03 (audit logging) should be integrated into Phase 1.2

1. **Phase 1.1 (Agent Registry)** — First; all other phases depend on agent identity
2. **Fix C-01 + H-02** — Must complete before Phase 1.2
3. **Phase 1.2 (Policy Engine)** and **Phase 1.3 (Anomaly Detection)** — Parallel after 1.1 + security fixes
4. **Phase 1.4 (Kill Switch)** — Last; depends on 1.1 and 1.3

---

## 8. Test Strategy

| Phase | Existing Tests | New Tests Required |
|-------|---------------|-------------------|
| Phase 1.1 | `src/node-discovery/__tests__/` | Agent registration, credential rotation, JWT NHI validation |
| Phase 1.2 | `src/api/__tests__/` | Policy evaluation, sandbox enforcement |
| Phase 1.3 | (existing monitoring tests) | Behavioural baseline, anomaly Z-score thresholds |
| Phase 1.4 | `src/election/__tests__/` | Revocation propagation, kill-switch latency |

**Constraint:** Existing tests must continue to pass.

---

## 9. Open Questions

1. **Sandboxing technology:** Process separation vs network isolation — need ADR
2. **etcd capacity planning:** Audit chains at scale — growth rate?
3. **NHI credential rotation frequency:** 1-hour default acceptable?
4. **Anomaly detection thresholds:** Z-score (3σ) vs IQR?

---

## 10. Sign-Off

**Architect:** Archimedes — ✅ READY FOR FORGE (Implementation)

**Next step:** Forge implements Phase 1.1 (Agent Registry) following this architecture map.
