# AWARE Security & Architecture Audit — Step 1 Findings

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)  
**Canonical Path:** `~/src/AWARE/`  
**Phase:** Step 1 — Audit (Researcher: Scout)  
**Date:** 2026-03-31  
**Status:** COMPLETE — Ready for Archimedes Step 2 (Architecture)  
**Commit:** This audit  
**Gitea:** http://192.168.1.204:3000/alvin/AWARE

---

## Executive Summary

AWARE is a production-deployed distributed systems platform (v1.0.0, deployed 2025-09-29) built on Node.js/Express/React. The codebase is well-structured with solid foundations: Raft-inspired consensus, JWT authentication, Express security middleware (helmet, rate-limiting, CORS), and a React dashboard.

**The core finding:** AWARE is evolving into an **agentic AI security control plane** (per EVOLUTION-BRIEF.md). This is the correct direction. However, as a distributed cluster platform, it has **zero agent-native capabilities** today. Three CRITICAL security issues exist in the current implementation that must be fixed before any agent work begins.

**Scoring Protocol (weighted_v1):** Impact×0.35 + Feasibility×0.30 + Alignment×0.20 + Novelty×0.15

| Severity | Count | Top Priority |
|----------|-------|-------------|
| CRITICAL | 3 | Hardcoded secret, unauthenticated discovery, broken election |
| HIGH | 3 | No rate limiting, in-memory alerts, no input sanitization |
| MEDIUM | 4 | Missing agent identity, policy engine, pheromone routing, audit layer |
| LOW | 3 | Test gaps, CORS validation, election instability |
| Performance | 3 | UDP broadcast frequency, no pagination, in-memory user store |

---

## CRITICAL Findings

### C-01: Hardcoded JWT Secret Fallback

**Severity:** CRITICAL  
**Location:** `src/api/middleware/auth.js:6`, `src/index.js:15`

**Finding:**
```javascript
// src/api/middleware/auth.js
const SECRET_KEY = process.env.SECRET_KEY || 'default_secret_for_dev';
```

If `SECRET_KEY` environment variable is not set, the system uses `default_secret_for_dev`. This secret is:
1. Present in the public source code repository
2. Used for all JWT signing and verification
3. Used for agent credential issuance (once NHI is implemented)

An attacker who knows the default secret can:
- Forge any JWT token
- Impersonate any user or (future) agent
- Bypass all authentication

**Evidence:** The same fallback pattern exists in `src/index.js` line 15:
```javascript
secretKey: config.secretKey || process.env.SECRET_KEY || 'default_secret',
```

**Fix Required:**
1. Refuse to start if `SECRET_KEY` is not set (fail-closed)
2. Add startup validation: secret must be at least 32 characters
3. Rotate any tokens issued with the default secret immediately after fix
4. Add health-check validation that fails if secret is default

---

### C-02: Unauthenticated UDP Node Discovery

**Severity:** CRITICAL  
**Location:** `src/node-discovery/index.js`, `src/node-discovery/services/broadcast.js`

**Finding:**
The UDP broadcast protocol (`src/node-discovery/services/broadcast.js`) sends and receives node presence announcements with **no authentication**:

```javascript
// broadcast.js - outgoing broadcast
const message = JSON.stringify({
  nodeId: this.nodeId,
  timestamp: Date.now(),
  capabilities: this.capabilities,
  status: this.status
});
// ... sends to 255.255.255.255 with no signature
```

```javascript
// index.js - incoming handling
handleNodeBroadcast(nodeInfo, remote) {
  // nodeInfo.nodeId accepted verbatim from network
  this.discoveredNodes.set(nodeInfo.nodeId, { ...nodeInfo, ... });
}
```

Any attacker on the same network can:
1. Broadcast as a fake node with arbitrary capabilities
2. Trigger false partition alerts via heartbeat manipulation
3. Disrupt queen election by impersonating high-priority nodes

**Impact:** Network-level authentication bypass. An attacker with local network access (or any node in the cluster) can manipulate cluster topology.

**Fix Required:**
1. Add HMAC signature to all broadcast messages using a shared cluster secret
2. Verify signature before accepting broadcasts
3. Reject broadcasts with invalid or missing signatures
4. Extend to discovery protocol (`protocol.js`)

---

### C-03: Election Manager Grants Votes Randomly

**Severity:** CRITICAL  
**Location:** `src/election/index.js:65-67`

**Finding:**
```javascript
// election/index.js - requestVote method
setTimeout(() => {
  const granted = Math.random() > 0.3; // 70% chance of getting vote
  callback(granted);
}, Math.random() * 100);
```

The election manager **simulates** vote granting rather than actually requesting votes from other nodes. Votes are granted randomly (70% probability), not based on log completeness or term validity as Raft requires.

Additionally, `requestVote` is a local simulation — it never makes actual RPC calls to other nodes:
```javascript
// "Simulate network request to other node" - comment in code
// In a real implementation, this would be an RPC call
setTimeout(() => { ... }, Math.random() * 100);
```

This means:
1. Elections can produce incorrect leaders
2. The "consensus" is fictional
3. Any code depending on `electionManager.isLeader()` may have wrong state

**Note:** The state machine (`src/election/state-machine.js`) correctly implements Raft log replication. The ElectionManager is a simulation stub that doesn't match.

**Fix Required:**
1. Implement actual inter-node RPC for vote requests
2. Replace random vote granting with log-completeness check (`isLogUpToDate`)
3. Verify majority consensus before becoming leader
4. Add persistent vote records

---

## HIGH Findings

### H-01: No Rate Limiting on Most API Endpoints

**Severity:** HIGH  
**Location:** `src/api/index.js`

**Finding:**
Rate limiting only applies to authentication endpoints:
```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,  // Only 5 attempts per 15 minutes for /login, /register
  // ...
});
this.app.post('/login', authLimiter, ...);
this.app.post('/register', authLimiter, ...);
```

Protected endpoints (`/api/cluster`, `/api/nodes`, `/api/alerts`, `/api/resources`) have **no rate limiting**. An authenticated attacker can:
- Flood the cluster with API requests
- Use enumeration attacks on `/api/nodes/:nodeId`
- Trigger expensive cluster operations repeatedly

**Fix Required:**
1. Add per-IP rate limiting to all API endpoints (e.g., 100 req/15min)
2. Add per-user rate limiting for expensive operations (`/api/cluster/scale-up`, `/api/cluster/scale-down`)
3. Consider endpoint-specific limits for cluster management operations

---

### H-02: In-Memory Alerts with No Persistence

**Severity:** HIGH  
**Location:** `src/api/routes/alerts.js:5-28`

**Finding:**
```javascript
// alerts.js - in-memory only
let alerts = [
  { id: 1, timestamp: ..., level: 'INFO', source: 'Node-001', ... },
  // ...
];
```

Alerts are stored in a JavaScript array. On restart:
- All historical alerts are lost
- Alert correlation across restarts is impossible
- Audit trail requirements (DORA Art. 12, ISO 27001 A.12.4) are unmet

For an agentic AI security control plane, alert persistence is mandatory for:
- Post-incident investigation
- Compliance audit trails
- Behavioral anomaly detection history

**Fix Required:**
1. Persist alerts to a database (SQLite, PostgreSQL, or etcd)
2. Add TTL-based eviction for old alerts
3. Support alert export in SIEM-compatible JSON format

---

### H-03: No Input Sanitisation on Dynamic Route Parameters

**Severity:** HIGH  
**Location:** `src/api/routes/nodes.js`, `src/api/routes/alerts.js`

**Finding:**
Route handlers accept dynamic parameters without sanitisation:

```javascript
// nodes.js - nodeId from URL accepted verbatim
router.get('/:nodeId', (req, res) => {
  const { nodeId } = req.params;  // No validation
  // Used in: res.json({ nodeId, ... })
});
```

```javascript
// alerts.js - query parameters not sanitised
router.get('/', (req, res) => {
  const { level, source, resolved, limit = 50, offset = 0 } = req.query;
  // level, source used directly in filter without sanitisation
  filteredAlerts = filteredAlerts.filter(alert => 
    alert.level.toLowerCase() === level.toLowerCase()
  );
});
```

While `express-validator` is available and used for body validation in `validation.js`, it is **not used** for:
- URL parameters (`req.params`)
- Query string parameters (`req.query`)
- Headers

**Fix Required:**
1. Apply `validateNodeIdParam` from `validation.js` to all node ID parameters
2. Add query parameter validation (type, length, allowed values)
3. Sanitise all dynamic values before use in responses

---

## MEDIUM Findings

### M-01: Missing Agent Identity Layer (NHI)

**Severity:** MEDIUM (blocks agentic AI evolution)  
**Location:** No existing implementation

**Finding:**
AWARE has **zero** Non-Human Identity (NHI) capabilities. Nodes are infrastructure entities, not agents. No concept of:
- Agent principals
- Agent credential lifecycle
- Agent capability declarations
- Agent trust scores

Per the EVOLUTION-BRIEF.md, AWARE is evolving to an agentic AI security control plane. Phase 1.1 (Agent Registry) is the critical path root — everything depends on it.

**Impact:** Without NHI, Phases 1.2-4 are all blocked. No agent governance is possible.

**Recommendation:**
Implement as Phase 1.1 per the architecture specification in `docs/audit/architecture.md`.

---

### M-02: Missing Policy Enforcement Engine

**Severity:** MEDIUM (blocks agentic AI security)  
**Location:** No existing implementation

**Finding:**
There is **no policy engine**. Per-agent sandbox, tool-call authorisation, and resource quotas are absent.

Current access control is:
- User-level JWT/RBAC only
- No concept of agent-scoped permissions
- No tool-call interception

For an agentic AI security control plane, deny-by-default tool-call authorisation is the primary blast-radius containment mechanism.

**Recommendation:**
Implement as Phase 1.2 per `docs/audit/aware-gap-analysis.md`.

---

### M-03: Missing Pheromone Routing Layer (AMRO-S)

**Severity:** MEDIUM (core differentiation gap)  
**Location:** Existing ACO algorithms in `src/election/` coordinate compute resources, not agent routing

**Finding:**
AWARE's ant colony optimization (ACO) coordinates **compute resource allocation**, not **AI agent routing decisions**. These are orthogonal domains.

AMRO-S (arXiv:2603.12933) patterns not implemented:
1. **Task-specific pheromone specialists** — Separate pheromone tables per task category to prevent cross-task interference
2. **Quality-gated reinforcement** — Only reinforce routing paths that pass both accuracy AND security validation
3. **Interpretable routing audit** — Full pheromone trail logging with selection rationale

**AMRO-S claims:** 4.7x speedup, 1.90 points improvement over routing baselines.

**What AMRO-S does NOT address (AWARE's differentiation):**
- Security-weighted heuristic function (trust_score, data_clearance, blast_radius_inverse)
- Identity governance
- Kill switches
- Compliance mapping

**Recommendation:**
Implement as Phase 2 per `docs/audit/architecture.md`. Extend existing ACO primitives to agent routing domain.

---

### M-04: Missing Interpretability / Audit Layer

**Severity:** MEDIUM (compliance gap)  
**Location:** No existing implementation

**Finding:**
No end-to-end decision chain traceability. Existing audit capabilities:
- In-memory alert store (`alerts.js`)
- Basic cluster event logging

Missing:
- Decision chain tracer (user → orchestrator → agent routing → tool calls → output)
- Tamper-evident append-only audit log
- Hash-chained audit entries
- SIEM-compatible export

**Compliance impact:**
| Framework | Requirement | AWARE Status |
|----------|-------------|--------------|
| CSA AI Control Matrix | Logging & Monitoring | Incomplete |
| DORA Art. 12 | Audit trails for AI systems | Missing |
| ISO 27001 A.12.4 | Security event logging | Incomplete |

**Recommendation:**
Implement as Phase 3.3 per `docs/audit/aware-gap-analysis.md`. Decision traceability is prerequisite for compliance mapping (Phase 4).

---

## LOW Findings

### L-01: Incomplete Test Coverage

**Severity:** LOW  
**Location:** `tests/` directory

**Finding:**
Existing tests cover basic API, discovery, and election logic. Missing:
- UDP broadcast authentication tests
- Election consensus correctness tests (vote granting, leader election)
- Partition handling tests
- Integration tests for the full discovery → election → cluster formation flow

Current test files:
```
tests/unit/api.test.js
tests/unit/discovery.test.js
tests/unit/election.test.js
tests/unit/node-discovery.test.js
tests/integration/basic-integration.test.js
tests/integration/multi-node.test.js
tests/performance/load.test.js
```

**Recommendation:**
Add:
- Mock UDP socket tests for broadcast authentication
- Raft consensus correctness tests (using a proper Raft testing framework)
- Network partition simulation tests

---

### L-02: CORS Origin Validation Limited

**Severity:** LOW  
**Location:** `src/api/index.js:54-59`

**Finding:**
```javascript
this.app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [process.env.FRONTEND_URL || 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200
}));
```

If `ALLOWED_ORIGINS` is not set, CORS accepts `localhost:3001` in production. This is acceptable for development but could be tightened in production.

**Fix (low priority):**
1. Reject undefined origins in production (`NODE_ENV=production`)
2. Validate origin against a whitelist, not just env config

---

### L-03: Election Random Timeout Could Cause Instability

**Severity:** LOW  
**Location:** `src/election/index.js:36-42`

**Finding:**
```javascript
const timeout = Math.floor(Math.random() * 300) + 300; // 300-600ms
```

Randomised timeouts prevent split votes but the range (300-600ms) is narrow. Under high load, multiple nodes may timeout simultaneously and trigger simultaneous elections.

**Recommendation:**
Widen the range (e.g., 150-300ms like production Raft) and add exponential backoff on repeated election failures.

---

## Performance Findings

### P-01: UDP Broadcast Frequency

**Severity:** Performance  
**Location:** `src/node-discovery/services/broadcast.js:28`

**Finding:**
Presence broadcasts every 10 seconds:
```javascript
setInterval(() => {
  this.broadcastPresence();
}, 10000);
```

At scale (100+ nodes), this creates broadcast storms. 100 nodes × 100 bytes × 0.1 Hz = 1 KB/s broadcast traffic.

**Recommendation:**
1. Implement exponential backoff for broadcasts
2. Add jitter to prevent synchronised broadcasts
3. Consider unicast for established topologies

---

### P-02: No Pagination on Discovery Nodes Endpoint

**Severity:** Performance  
**Location:** `src/api/routes/nodes.js:8-25`

**Finding:**
```javascript
router.get('/', (req, res) => {
  const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
  // Returns all nodes with no pagination
  res.json({ self: thisNode, discovered: discoveredNodes, total: ... });
});
```

Returns all discovered nodes in one response. No limit/offset. Large clusters return large payloads.

**Recommendation:**
Add `?limit=50&offset=0` pagination to `/api/nodes`.

---

### P-03: In-Memory User Store with No Caching

**Severity:** Performance  
**Location:** `src/api/models/User.js`, `src/api/middleware/auth.js`

**Finding:**
Users are loaded from JSON file on every authentication:
```javascript
const users = require('../data/users.json');
User.validateCredentials = (username, password) => {
  return users.find(u => u.username === username && u.password === password);
};
```

For a production system with frequent authentication, this is inefficient.

**Recommendation:**
1. Add in-memory cache with TTL for user lookups
2. Support user store in database for production
3. Add refresh token mechanism

---

## Enterprise Landscape (Adopt vs Differentiate)

### Microsoft Agent 365 (RSAC 2026)

| Capability | Microsoft | AWARE Status |
|------------|-----------|--------------|
| NHI management | ✅ Announced | ❌ Missing |
| Shadow AI detection | ✅ Announced | ❌ Missing |
| Universal agent logout | ✅ Announced | ❌ Missing |
| Bio-inspired coordination | ❌ Not core | ✅ AWARE differentiator |

**AWARE differentiation:** Bio-inspired coordination at the core (pheromone routing), not bolted on.

---

### Okta Agent Gateway (March 2026)

| Capability | Okta | AWARE Status |
|------------|------|--------------|
| Agent-as-identity | ✅ | ❌ Missing |
| Tool-call authorisation | ✅ | ❌ Missing |
| Kill switch | ✅ (centralised) | ❌ Missing |
| Distributed consensus | ❌ | ✅ AWARE differentiator |

**AWARE differentiation:** Distributed kill-switch via Raft consensus. Okta is centralised — single point of failure.

---

### Galileo Agent Control (March 2026)

| Capability | Galileo | AWARE Status |
|------------|---------|--------------|
| Open-source runtime control | ✅ | ✅ (GPL-3.0) |
| Hot-reloadable policies | ✅ | ❌ Missing |
| Pheromone routing | ❌ | ✅ AMRO-S pattern |
| Compliance mapping | ❌ | ❌ Missing |

**AWARE differentiation:** Pheromone routing (AMRO-S) + compliance mapping on top of runtime controls.

---

## AMRO-S Paper Patterns (arXiv:2603.12933)

### Patterns AWARE Should Adopt

| Pattern | AMRO-S Description | AWARE Implementation |
|--------|-------------------|---------------------|
| Task-specific pheromone specialists | Separate pheromone tables per task category to reduce cross-task interference | ❌ Not implemented — ACO only handles compute resources |
| Quality-gated reinforcement | Reinforce only high-quality routing trajectories; penalise policy violations | ❌ Not implemented — no quality validation |
| Intent inference via SFT SLM | Low-overhead semantic interface for task classification | ❌ Not implemented — no intent classification |
| Semantic-conditioned path selection | Route based on query semantics, not just capability matching | ❌ Not implemented |

### AWARE Differentiation (What AMRO-S Does NOT Address)

AMRO-S focuses on routing efficiency. It does NOT address:
- Security heuristics in pheromone selection
- Identity governance (NHI lifecycle)
- Kill switches (agent revocation)
- Compliance mapping (CSA AI Control Matrix, NIST AI RMF, DORA)
- Blast radius containment

---

## Prioritised Fix Order

| Priority | Finding | Reason |
|----------|---------|--------|
| P0 | C-01: Hardcoded secret | Authentication bypass |
| P0 | C-02: Unauthenticated discovery | Network-level impersonation |
| P0 | C-03: Broken election | Wrong leader = wrong decisions |
| P1 | H-01: No rate limiting | DoS vector |
| P1 | H-02: In-memory alerts | Audit gap |
| P1 | H-03: No input sanitisation | Injection risk |
| P2 | M-01: Missing NHI | Critical path root |
| P2 | M-02: Missing policy engine | Agent security core |
| P2 | M-03: Missing pheromone routing | Core differentiation |
| P2 | M-04: Missing audit layer | Compliance blocker |
| P3 | L-01: Test gaps | Quality |
| P3 | L-02: CORS validation | Defence in depth |
| P3 | L-03: Election instability | Reliability |
| P4 | P-01: Broadcast frequency | Scale |
| P4 | P-02: No pagination | Scale |
| P4 | P-03: In-memory user store | Performance |

---

## Files Reviewed

### Source Code
```
src/index.js                    — AWAREEngine class, service initialisation
src/api/index.js                — Express gateway, middleware, routing
src/api/middleware/auth.js      — JWT authentication, rate limiting
src/api/middleware/validation.js — Input validation rules
src/api/routes/cluster.js       — Cluster management endpoints
src/api/routes/nodes.js         — Node discovery endpoints
src/api/routes/alerts.js        — Alert management (in-memory)
src/election/index.js           — Raft-inspired election (simulation)
src/election/state-machine.js    — Raft log replication
src/election/network-partition-handler.js — Partition detection
src/node-discovery/index.js      — UDP node discovery
src/node-discovery/protocol.js  — Discovery message types
src/node-discovery/services/broadcast.js — Presence broadcast
```

### Documentation
```
README.md                        — Project overview, evolution direction
docs/EVOLUTION-BRIEF.md          — Full project brief, phase plan
docs/audit/architecture.md       — Archimedes architecture report
docs/audit/aware-gap-analysis.md — Gap analysis (22 component additions)
docs/compliance-matrix.md       — Compliance mapping
```

### External References
```
AMRO-S (arXiv:2603.12933)       — Pheromone routing research
Microsoft Agent 365              — RSAC 2026 announcement
Okta Agent Gateway               — March 2026 announcement
Galileo Agent Control            — March 2026 announcement
```

---

## Next Steps

**Immediate (P0-P1):**
1. Forge to fix C-01 (hardcoded secret) — fail-closed startup validation
2. Forge to fix C-02 (UDP authentication) — HMAC-signed broadcasts
3. Forge to fix C-03 (broken election) — implement real RPC vote requests
4. Forge to add rate limiting to all API endpoints (H-01)

**Phase 1a (Agent Registry):**
5. Implement NHI identity layer per `docs/audit/architecture.md`
6. Add persistent alert store

**Phase 1b (Policy Engine):**
7. Implement per-agent sandbox and policy engine

**Phase 2 (Pheromone Routing):**
8. Extend ACO to agent routing domain per AMRO-S patterns

---

**Audit complete.** Awaiting Alvin's approval to hand off to Archimedes for Step 2 (Architecture).

---

*Scout 🔍 — Researcher, AWARE-Evolution Step 1 Audit*  
*2026-03-31*
