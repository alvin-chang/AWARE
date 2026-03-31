# AWARE Security & Architecture Audit — Step 1 Findings

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)  
**Canonical Path:** `~/src/AWARE/`  
**Phase:** Step 1 — Audit (Researcher: Scout)  
**Date:** 2026-03-31  
**Status:** COMPLETE — Ready for Archimedes Step 2 (Architecture)  
**Gitea:** http://192.168.1.204:3000/alvin/AWARE

---

## Executive Summary

AWARE is a production-deployed distributed systems platform (v1.0.0, deployed 2025-09-29) built on Node.js/Express/React. The codebase is well-structured with solid foundations: Raft-inspired consensus, JWT authentication, Express security middleware (helmet, rate-limiting, CORS), and a React dashboard.

**The core finding:** AWARE is evolving into an **agentic AI security control plane** (per EVOLUTION-BRIEF.md). This is the correct direction. However, Phase 1.1 (Agent Identity Layer) implementation revealed 1 remaining CRITICAL issue and several MEDIUM/HIGH concerns that must be addressed before Phase 1.2 begins.

**Phase 1.1 Security Review Summary:**
- C-01 (Hardcoded secret): **STILL VALID** — `auth.js` has fallback, `api/index.js` is fixed
- C-02 (Unauthenticated UDP): **FIXED** — HMAC-SHA256 signing required
- C-03 (Plaintext credentials): **FIXED** — PBKDF2 with 100k iterations
- Route auth: **FIXED** — `authenticateToken` middleware protects `/api/agents`
- Hardcoded secrets: **PARTIALLY FIXED** — `api/index.js` throws FATAL, `auth.js` still has fallback

**Scoring Protocol (weighted_v1):** Impact×0.35 + Feasibility×0.30 + Alignment×0.20 + Novelty×0.15

| Severity | Count | Top Priority |
|----------|-------|-------------|
| CRITICAL | 1 | Hardcoded secret in auth.js |
| HIGH | 2 | Credential transmission, agent heartbeat auth |
| MEDIUM | 3 | Credential pepper fallback, missing rate limiting on agent routes, audit logging |
| LOW | 2 | Test coverage gaps, WebSocket security |

---

## PHASE 1.1 IMPLEMENTATION REVIEW

### What Was Implemented

The Phase 1.1 implementation (Agent Identity Layer) added:

| Component | File | Purpose |
|-----------|------|---------|
| Agent model | `src/api/models/Agent.js` | NHI model with PBKDF2 credential hashing |
| Agent routes | `src/api/routes/agents.js` | RESTful lifecycle management |
| Agent registry | `src/agents/registry.js` | Central NHI registry |
| Identity provider | `src/agents/identity-provider.js` | JWT issuance for agents |
| Agent protocol | `src/agents/protocol.js` | UDP discovery with HMAC signing |
| API gateway extension | `src/api/index.js` | Agent routes mounted with JWT auth |

### Security Fixes Verified

| Issue | Status | Evidence |
|-------|--------|----------|
| Plaintext credentials | ✅ FIXED | `Agent.js` uses PBKDF2 (100k iterations) with salt |
| Unauthenticated UDP | ✅ FIXED | `protocol.js` requires HMAC-SHA256 signature |
| Hardcoded secrets (api/index.js) | ✅ FIXED | Throws FATAL if `config.secretKey` not set |
| Route authentication | ✅ FIXED | `authenticateToken` middleware applied to `/api/agents` |

### Remaining Security Issues

---

## CRITICAL Findings

### C-01: Hardcoded JWT Secret Fallback (auth.js)

**Severity:** CRITICAL  
**Location:** `src/api/middleware/auth.js:4`

**Finding:**
```javascript
const SECRET_KEY = process.env.SECRET_KEY || 'default_secret_for_dev';
```

**Status:** STILL VALID — The `api/index.js` APIGateway class was fixed to throw FATAL, but the `auth.js` middleware module still contains the hardcoded fallback.

**Impact:**
- If `SECRET_KEY` env var is not set, `auth.js` uses `default_secret_for_dev`
- All JWT tokens (both human users and agents) signed with predictable secret
- Attacker can forge any JWT token

**Fix Required:**
1. Remove the fallback from `auth.js`
2. Require `SECRET_KEY` to be set at startup (fail-closed)
3. Add validation: secret must be at least 32 characters

---

## HIGH Findings

### H-01: Credential Transmission Over HTTP

**Severity:** HIGH  
**Location:** `src/api/routes/agents.js` (POST /api/agents)

**Finding:**
The agent registration endpoint (`POST /api/agents`) accepts agent credentials and the `Agent.create()` method generates and returns the raw credential. If this endpoint is accessed over HTTP (not HTTPS), credentials traverse the network in plaintext.

**Evidence:**
```javascript
// agents.js - registration returns raw credential
const newAgent = Agent.create({ agentId, name, type, ... });
// Agent.create() returns raw credential via generateCredential()
```

**Impact:**
- Network eavesdropping can capture agent credentials
- Combined with C-01, an attacker can forge agent identities

**Fix Required:**
1. Enforce HTTPS for all agent registration endpoints
2. Add TLS certificate validation
3. Consider initial credential out-of-band delivery (e.g., file-based provisioning)

---

### H-02: Agent Heartbeat Endpoint Not Authenticated

**Severity:** HIGH  
**Location:** `src/api/routes/agents.js` (POST /api/agents/:id/heartbeat)

**Finding:**
The heartbeat endpoint (`POST /api/agents/:id/heartbeat`) is protected by the global `authenticateToken` middleware (JWT), but the JWT payload does not include the agent's own identity. A compromised human user token could record heartbeats for any agent.

**Evidence:**
```javascript
// agents.js - heartbeat uses req.user from human JWT
router.post('/:id/heartbeat', ..., (req, res) => {
  // req.user is human user, not the agent being heartbeaten
  agent.touch(); // Updates lastSeenAt for any agent
});
```

**Impact:**
- Human user with valid JWT can impersonate any agent via heartbeat
- Enables equivocation attacks against agent trust scores

**Fix Required:**
1. Agents should authenticate using their own JWT (via Identity Provider)
2. Heartbeat should validate that `req.agent.agentId === req.params.id`
3. Or: Require agent's own JWT with matching agentId claim

---

## MEDIUM Findings

### M-01: Credential Pepper Has Fallback

**Severity:** MEDIUM  
**Location:** `src/api/models/Agent.js:15`

**Finding:**
```javascript
const CREDENTIALPepper = process.env.AWARE_CREDENTIAL_PEPPER || 'aware-agent-credential-secret';
```

If `AWARE_CREDENTIAL_PEPPER` is not set, a known fallback is used. An attacker with read access to `agents.json` could crack credentials if they guess the fallback pepper.

**Impact:**
- Credential cracking becomes feasible if agents.json is exposed
- Reduces effectiveness of PBKDF2

**Fix Required:**
1. Remove fallback — require `AWARE_CREDENTIAL_PEPPER` to be set
2. Or: Generate pepper deterministically from `SECRET_KEY` + salt

---

### M-02: No Rate Limiting on Agent Routes

**Severity:** MEDIUM  
**Location:** `src/api/routes/agents.js`

**Finding:**
Agent routes (especially registration and heartbeat) lack per-agent rate limiting. The global rate limiter applies to all routes, but a specific limit for agent operations is not enforced.

**Impact:**
- Brute force attacks on credential verification endpoint
- Heartbeat flooding to inflate trust scores
- Registration flooding

**Fix Required:**
1. Add rate limiter specific to agent routes (e.g., 10 registrations per minute per source)
2. Add per-agent heartbeat rate limiting

---

### M-03: No Audit Logging for Agent Lifecycle Events

**Severity:** MEDIUM  
**Location:** `src/agents/registry.js`, `src/api/routes/agents.js`

**Finding:**
Agent lifecycle events (registration, credential rotation, suspension, revocation, decommissioning) are not explicitly logged to an audit trail. The existing AWARE alert system exists but agent events are not integrated.

**Impact:**
- No compliance-ready audit trail for agent activities
- Difficult to investigate security incidents involving agents
- Cannot meet CSA AI Control Matrix Logging & Monitoring controls

**Fix Required:**
1. Add audit logging for all agent lifecycle events
2. Integrate with existing AWARE alert system
3. Log: timestamp, initiator (who/what), action, target agent, result, metadata

---

## LOW Findings

### L-01: Test Coverage Gaps for Agent Lifecycle

**Severity:** LOW  
**Location:** `src/api/__tests__/`, `src/agents/`

**Finding:**
No dedicated test file for agent routes (`agents.js`). Agent model and registry lack unit tests.

**Fix Required:**
1. Add `src/api/__tests__/agents.test.js`
2. Add `src/agents/__tests__/registry.test.js`
3. Add `src/agents/__tests__/identity-provider.test.js`

---

### L-02: WebSocket Security Not Addressed

**Severity:** LOW  
**Location:** `src/ui/src/services/WebSocketService.js`

**Finding:**
The existing WebSocket service (`WebSocketService.js`) connects to the AWARE cluster for real-time updates. Agent-specific WebSocket authentication is not addressed.

**Impact:**
- If agents use WebSockets, authentication mechanism is unclear
- WebSocket connections could be hijacked

**Fix Required:**
1. Define agent WebSocket authentication protocol
2. Add agent-specific WebSocket authentication middleware

---

## PHASE 1.2+ RECOMMENDATIONS

Based on the audit of existing codebase and Phase 1.1 implementation:

### For Phase 1.2 (Per-Agent Sandbox Policies)

1. **Policy engine must integrate with agent authentication** — Policies should be evaluated after agent identity is verified, not before
2. **Policy storage** — Consider extending `agents.json` or using separate `policies.json` with RBAC
3. **Tool-call authorization** — Should use agent's `capabilities` and `clearance` from verified JWT claims

### For Phase 1.3 (Behavioural Baseline & Anomaly Detection)

1. **Trust score integration** — The `trustScore` field in Agent model should be populated from Phase 1.3 anomaly detection, not manually set
2. **Agent activity logging** — All agent decisions should be logged to enable anomaly detection
3. **Baseline metrics collection** — Agent model needs fields for baseline metrics (avg response time, typical tool calls, etc.)

### For Phase 1.4 (Kill Switch)

1. **Raft integration** — Revocation broadcast should use existing election heartbeat protocol
2. **Agent protocol integration** — `AGENT_REVOKE` message type already exists in `protocol.js`, needs integration with Raft consensus

---

## EXISTING CODEBASE ANALYSIS

### Module Inventory

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **AWAREEngine** | `src/index.js` | 88 | Main entry point; initializes NodeDiscovery, ElectionManager, APIGateway |
| **NodeDiscovery** | `src/node-discovery/` | ~400 | UDP broadcast node discovery, heartbeat, discovered nodes map |
| **ElectionManager** | `src/election/` | ~350 | Raft consensus, leader election, term-based voting, heartbeat |
| **APIGateway** | `src/api/` | ~300 | Express REST API, JWT auth, routes (cluster, nodes, alerts, resources, agents) |
| **AgentIdentity** | `src/agents/` | ~300 | Agent registry, identity provider, agent protocol (NEW) |
| **UI** | `src/ui/` | ~2000 | React + Material-UI monitoring dashboard |

### Architecture Diagram (After Phase 1.1)

```
┌─────────────────────────────────────────────────────────────────┐
│                         AWAREEngine                              │
│  (src/index.js — orchestrates all services)                     │
└────────────────┬────────────────────────────┬───────────────────┘
                 │                            │
    ┌────────────▼────────────┐    ┌──────────▼────────────┐
    │     NodeDiscovery      │    │   ElectionManager     │
    │  (UDP broadcast/recv)   │    │  (Raft consensus)     │
    │  Port 41234/41235     │    │  Leader/Follower/Cand │
    └────────────┬────────────┘    └──────────┬────────────┘
                 │                            │
    ┌────────────▼────────────┐    ┌──────────▼────────────┐
    │     AgentProtocol      │    │   APIGateway          │
    │  (UDP agent discovery) │    │  (Express + JWT/RBAC) │
    │  Port 41236 + HMAC    │    │  /api/agents/*       │
    └────────────────────────┘    └──────────┬────────────┘
                                            │
                         ┌──────────────────┼──────────────────┐
                         │                  │                  │
              ┌──────────▼──────┐  ┌───────▼──────┐  ┌──────▼──────┐
              │ IdentityProvider│  │ AgentRegistry │  │ AlertSystem │
              │  (JWT for NHIs) │  │ (agents.json)│  │ (existing)  │
              └─────────────────┘  └──────────────┘  └─────────────┘
```

### Extension Points for Phase 1

| Phase | Extension | Existing Base | New Module |
|-------|-----------|---------------|------------|
| 1.1 | Agent Identity Layer | NodeDiscovery, JWT/RBAC | `src/agents/*` |
| 1.2 | Per-Agent Sandbox | Agent registry | `src/policies/*` |
| 1.3 | Behavioural Anomaly | Monitoring dashboard | `src/agents/metrics.js` |
| 1.4 | Kill Switch | ElectionManager, heartbeat | `src/agents/revocation.js` |

---

## ENTERPRISE LANDSCAPE ANALYSIS

### Microsoft Agent 365 (RSAC 2026)
- **NHI management** — AWARE Phase 1.1 provides this
- **Shadow AI detection** — AWARE Phase 3.1 (Shadow Agent Discovery)
- **Universal agent logout** — AWARE Phase 1.4 (Kill Switch) with Raft consensus
- **AWARE differentiation:** Bio-inspired coordination at core, not bolted on

### Okta Agent Gateway (March 2026)
- **Agent-as-identity** — AWARE Phase 1.1
- **Tool-call authorisation** — AWARE Phase 1.2 (Per-Agent Sandbox Policies)
- **Kill switch** — AWARE Phase 1.4 (Raft consensus — distributed, not centralised)
- **AWARE differentiation:** Distributed kill-switch via Raft vs Okta's centralised approach

### Galileo Agent Control (March 2026)
- **Runtime control plane** — AWARE has this via APIGateway
- **Hot-reloadable policies** — AWARE Phase 1.2
- **AWARE differentiation:** Pheromone routing + compliance mapping on top of runtime controls

---

## AMRO-S PAPER ANALYSIS (arXiv:2603.12933)

### Key Patterns to Adopt

1. **Pheromone-based routing** — AWARE's ant colony algorithms provide foundation
2. **Task-specific pheromone specialists** — Separate pheromone tables per task category
3. **Quality-gated evolution** — Only reinforce routing paths that pass accuracy AND security validation

### What AMRO-S Does NOT Cover (AWARE Differentiation)

1. **Security heuristics** — AMRO-S optimises for task completion; AWARE must add security signals
2. **Identity governance** — NHI lifecycle, credential rotation, revocation
3. **Kill switches** — AMRO-S has no concept of agent revocation
4. **Compliance mapping** — CSA AI Control Matrix, NIST AI RMF, DORA

---

## RECOMMENDATIONS

### Immediate (Before Phase 1.2)

1. **Fix C-01** — Remove hardcoded secret fallback from `auth.js`
2. **Fix H-02** — Add agent-specific JWT validation for heartbeat endpoint
3. **Add M-03** — Implement audit logging for agent lifecycle events

### Short-term (Phase 1.2-1.4)

1. Policy engine integration with agent authentication
2. Anomaly detection that updates trust scores
3. Kill switch via Raft consensus broadcast

### Long-term (Phase 2-4)

1. Pheromone-based agent routing with security-weighted heuristics
2. Shadow agent discovery
3. Compliance mapping to CSA AI Control Matrix

---

## FILES REVIEWED

- `src/api/middleware/auth.js` — JWT authentication middleware
- `src/api/index.js` — Express API gateway
- `src/api/routes/agents.js` — Agent lifecycle REST routes
- `src/api/models/Agent.js` — Agent NHI model
- `src/api/models/User.js` — User model (for comparison)
- `src/agents/registry.js` — Agent registry service
- `src/agents/identity-provider.js` — Agent JWT issuer
- `src/agents/protocol.js` — Agent UDP discovery protocol
- `src/node-discovery/index.js` — Node discovery (existing)
- `src/election/ElectionManager.js` — Raft consensus (existing)
- `docs/EVOLUTION-BRIEF.md` — Project direction

---

**Audit Complete. Ready for Step 2 (Architecture) by Archimedes.**
