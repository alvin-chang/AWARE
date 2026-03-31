# AWARE Step 1 Audit — Code & Architecture Assessment

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)
**Location:** `~/src/AWARE/` (Node.js/Express/React platform)
**Audit Date:** 2026-03-31
**Author:** Archimedes (System Architect)
**Status:** SUBMITTED FOR ALVIN APPROVAL
**Predecessor:** AWARE-Evolution audit was done in wrong location (`~/.openclaw/projects/AWARE-Evolution/`). This is the correct audit building on the existing `~/src/AWARE/` codebase.

---

## 1. Executive Summary

AWARE's existing Node.js/Express/React platform provides a solid foundation for the agentic AI security control plane evolution. The core modules — NodeDiscovery, ElectionManager, ClusterService — are well-structured with clear separation of concerns.

**Tech Stack Decision:** RECOMMEND KEEPING EXISTING STACK. No tech stack change warranted. Node.js/Express/React is appropriate for this evolution:
- Express.js handles the API gateway and routing extensions cleanly
- React dashboard extends naturally to agent metrics and pheromone heatmaps
- Node.js ecosystem has mature libraries for JWT, policy evaluation, and ACO algorithms
- Docker Compose deployment is production-ready

**Critical Path Root:** Agent Registry (Phase 1.1) — all subsequent phases depend on agents being identifiable principals.

**Key Finding:** No structural redesign needed. Evolution is component extension on proven foundations.

---

## 2. Existing Architecture Map

### 2.1 Module Inventory

```
~/src/AWARE/
├── src/
│   ├── index.js                    # AWAREEngine — bootstraps all services
│   ├── api/                        # Express API Gateway
│   │   ├── index.js                # APIGateway — routes, middleware, service wiring
│   │   ├── middleware/
│   │   │   ├── auth.js             # JWT authenticateToken + authorizeRoles + generateToken
│   │   │   └── validation.js       # Input validation middleware
│   │   ├── models/
│   │   │   └── User.js             # User model with JWT payload structure
│   │   ├── routes/
│   │   │   ├── alerts.js           # Alert CRUD + filtering
│   │   │   ├── cluster.js         # Cluster lifecycle + metrics
│   │   │   ├── nodes.js           # Node registration + status
│   │   │   └── resources.js       # Resource allocation
│   │   └── services/
│   │       ├── cluster-service.js  # Cluster state, scaling, metrics
│   │       └── resourceService.js  # Resource registry (mock data)
│   ├── election/                    # Raft Leader Election
│   │   ├── ElectionManager.js      # Raft state machine + vote handling
│   │   ├── index.js               # Election entry point
│   │   ├── network-partition-handler.js  # Partition detection + recovery
│   │   └── state-machine.js        # Raft state transitions
│   ├── node-discovery/             # UDP Node Discovery Protocol
│   │   ├── index.js               # NodeDiscovery class — UDP broadcast/listen
│   │   ├── protocol.js            # DiscoveryProtocol — message serialisation
│   │   ├── models/
│   │   │   └── Node.js            # Node metadata model
│   │   └── services/
│   │       ├── broadcast.js        # Presence broadcast service
│   │       └── listening.js        # Discovery listener service
│   ├── ui/                        # React Monitoring Dashboard
│   │   ├── package.json           # React + Material-UI
│   │   ├── public/
│   │   └── src/                   # React components
│   └── data/                       # Runtime data store (in-memory)
├── tests/
│   ├── unit/                      # Unit tests
│   ├── integration/               # Integration tests
│   └── performance/               # Load tests
├── docs/
│   ├── EVOLUTION-BRIEF.md        # 4-phase evolution plan
│   ├── architecture.md            # Existing architecture doc
│   ├── openapi.yaml              # API specification
│   ├── prd.md                    # Product requirements
│   ├── security-report.md         # Security analysis
│   ├── compliance-matrix.md      # Regulatory mapping
│   └── audit/
│       ├── architecture.md       # Previous audit (2026-03-28)
│       └── aware-gap-analysis.md # Previous gap analysis
├── docker-compose.yml            # Docker deployment
├── Dockerfile                    # Backend container
├── Dockerfile.ui                # UI container
├── nginx.conf                  # Reverse proxy config
└── package.json                # Dependencies: express, jsonwebtoken, helmet, cors, uuid, express-validator, express-rate-limit
```

### 2.2 Code Path Analysis — 6 Key Areas

#### A. Node Discovery
**File:** `src/node-discovery/index.js` + `protocol.js` + `services/`

**Current implementation:**
- UDP broadcast on port 41234 for node presence announcements
- UDP broadcast on port 41235 for presence broadcast
- `255.255.255.255` broadcast address for LAN discovery
- 30-second heartbeat interval
- 10-second presence broadcast interval
- In-memory `discoveredNodes` Map keyed by nodeId

**Key functions:**
```javascript
NodeDiscovery.start()                    // Binds UDP socket, starts broadcast loop
NodeDiscovery.handleNodeBroadcast()      // Updates discoveredNodes map
NodeDiscovery.broadcastPresence()         // Sends JSON nodeInfo broadcast
NodeDiscovery.sendHeartbeat()             // 30s interval heartbeat
NodeDiscovery.getDiscoveredNodes()        // Returns Array of discovered nodes
```

**Extension point for Phase 1.1:** Add agent-specific metadata to `nodeInfo` broadcast payload:
```javascript
// Extension: add agent fields
{
  nodeId, type: 'agent'|'node', model, version, capabilities, trust_score, clearance
}
```

#### B. Leader Election (Raft)
**File:** `src/election/ElectionManager.js` + `state-machine.js`

**Current implementation:**
- Raft consensus with election timeout 300–600ms random range
- Heartbeat interval 100ms (AppendEntries RPC)
- State machine: follower → candidate → leader
- Vote granting based on log up-to-date check
- EventEmitter for leader election events

**Key functions:**
```javascript
ElectionManager.startElectionTimer()     // Random timeout before election
ElectionManager.startElection()         // Become candidate, request votes
ElectionManager.requestVote(nodeId)     // Simulated RPC vote request
ElectionManager.becomeLeader()          // Transition to leader, start heartbeats
ElectionManager.sendHeartbeats()         // AppendEntries RPC to all nodes
ElectionManager.handleRequestVote()      // Vote grant/deny logic
ElectionManager.handleAppendEntries()    // Follower log replication
ElectionManager.handleLeaderFailure()    // Detect leader loss, restart election
```

**Extension point for Phase 1.4 (Kill Switch):** Extend heartbeat payload with revocation list:
```javascript
// Extension: add revocation broadcast
{ term, leaderId, prevLogIndex, prevLogTerm, entries: [], leaderCommit, revokedAgents: [] }
```

#### C. Resource Management
**File:** `src/api/services/resourceService.js` + `src/api/routes/resources.js`

**Current implementation:**
- Mock resource registry: 5 pre-defined resources (Compute, Storage, Load Balancer, Database, Cache)
- Resource model: id, name, location, status, type, utilisation, capacity
- CRUD operations: getResources, getResourceById, updateResourceStatus, getActiveResources

**Extension point for Phase 1.2:** Extend to per-agent resource quotas:
```javascript
// Extension: per-agent quota tracking
{ agentId, resourceType, quotaLimit, currentUsage, resetInterval }
```

#### D. Alert System
**File:** `src/api/routes/alerts.js`

**Current implementation:**
- In-memory alert store (array, max 1000 alerts)
- Alert model: id, timestamp, level (INFO/WARNING/ERROR), source, message, resolved
- CRUD: GET /, GET /:id, PUT /:id, POST /
- Filtering: level, source, resolved, pagination

**Extension point for Phase 1.3 (Anomaly Detection):** Add alert types:
```javascript
// Extension: new alert types
{ ...alert, type: 'node'|'agent'|'policy'|'anomaly', agentId, deviation, baseline, current }
```

#### E. JWT Authentication
**File:** `src/api/middleware/auth.js` + `src/api/models/User.js`

**Current implementation:**
- `jsonwebtoken` with HS256
- Token payload: username, role, iat, jti, exp
- Rate limiting: 5 attempts per 15 minutes on auth endpoints
- 24-hour token expiry (configurable via TOKEN_EXPIRY env var)
- Role-based authorisation via `authorizeRoles(...roles)`

**Key functions:**
```javascript
authenticateToken(req, res, next)       // Verifies Bearer token
authorizeRoles(...roles)                // Returns middleware for role check
generateToken(payload)                  // Creates JWT with jti, iat, exp
```

**Extension point for Phase 1.1 (NHI):** Extend JWT payload:
```javascript
// Extension: NHI claims
{
  sub: 'agent:coder:instance-7f3a',
  type: 'agent'|'human',
  capabilities: ['code_review', 'test_write'],
  clearance: 'internal_only',
  trust_score: 0.87,
  rotated_from: 'agent:coder:instance-3b9c'
}
```

#### F. Monitoring Dashboard
**File:** `src/ui/` (React + Material-UI)

**Current implementation:**
- React SPA with Material-UI components
- Dashboard: cluster health, node status, resource utilisation, alerts
- Real-time updates via polling (assumed, UI source not fully reviewed)

**Extension point for Phase 2.4/3.3:** Add dashboard panels:
- Pheromone heatmap visualisation
- Agent trust score display
- Routing decision audit trail viewer
- Compliance status panel

---

## 3. Extension Points Per Phase

### Phase 1: Agent-Native Runtime

| Sub-phase | Extension Point | File(s) to Add/Modify | Effort |
|-----------|----------------|----------------------|--------|
| **1.1 Agent Identity Layer** | Add NHI fields to nodeInfo broadcast; add agent registry endpoints | `src/api/routes/agents.js` (NEW); modify `src/node-discovery/index.js` | ~400 lines |
| **1.2 Per-Agent Sandbox Policies** | Policy engine + tool-call authorisation middleware | `src/api/middleware/policyEngine.js` (NEW); modify `src/api/middleware/auth.js` | ~600 lines |
| **1.3 Behavioural Baseline & Anomaly** | Extend alert types; add behavioural monitor service | Modify `src/api/routes/alerts.js`; `src/agents/behavioural-monitor.js` (NEW) | ~500 lines |
| **1.4 Kill Switch** | Extend Raft heartbeat payload with revocation list | Modify `src/election/ElectionManager.js` | ~150 lines |

**Phase 1 dependency order:** 1.1 → 1.2/1.3 → 1.4

### Phase 2: Pheromone-Based Agent Routing

| Sub-phase | Extension Point | File(s) to Add/Modify | Effort |
|-----------|----------------|----------------------|--------|
| **2.1 Task-Specific Pheromone Specialists** | Pheromone table manager in etcd | `src/routing/pheromone-table.js` (NEW) | ~300 lines |
| **2.2 Security-Weighted Heuristic** | Extend ACO heuristic with security signals | `src/routing/heuristic-calculator.js` (NEW); modify existing ACO | ~250 lines |
| **2.3 Quality-Gated Reinforcement** | Validation-gated pheromone update | `src/routing/quality-validator.js` (NEW); modify pheromone update | ~200 lines |
| **2.4 Interpretable Routing Audit** | Full decision trail logging + dashboard | `src/routing/audit-logger.js` (NEW); UI extension | ~300 lines |

**Phase 2 depends on:** Phase 1.1 (Agent Registry must exist before routing)

### Phase 3: Agentic Security Control Plane

| Sub-phase | Extension Point | File(s) to Add/Modify | Effort |
|-----------|----------------|----------------------|--------|
| **3.1 Shadow Agent Discovery** | Network fingerprint + registry check | `src/security/shadow-detector.js` (NEW) | ~400 lines |
| **3.2 Context-Aware Tool Enforcement** | Intent classifier + data sensitivity labels | `src/security/context-evaluator.js` (NEW); modify policy engine | ~500 lines |
| **3.3 Decision-Chain Traceability** | Hash-chained append-only audit log | `src/audit/decision-trace.js` (NEW); SIEM exporter | ~350 lines |
| **3.4 GitOps Agent-as-Code** | Git-backed agent definitions + drift detection | `src/gitops/agent-definitions.js` (NEW); drift detector | ~400 lines |

**Phase 3 depends on:** Phase 1 + Phase 2

### Phase 4: Compliance Mapping

| Deliverable | File | Effort |
|-------------|------|--------|
| CSA AI Control Matrix mapping | `docs/compliance-matrix.md` (update) | ~100 lines |
| NIST AI RMF mapping | `docs/compliance-matrix.md` (update) | ~100 lines |
| DORA mapping | `docs/compliance-matrix.md` (update) | ~100 lines |
| ISO 27001 mapping | `docs/compliance-matrix.md` (update) | ~100 lines |

**Phase 4 depends on:** All prior phases (documentary only)

---

## 4. Dependency Analysis

### 4.1 Internal Module Dependencies

```
NodeDiscovery ──────────────────────────────┐
    │ (provides discovered nodes)           │
    ▼                                       │
ElectionManager ───────────────────────────┐ │
    │ (provides leadership)                  │ (both used by)
    ▼                                       ▼
ClusterService ──────────────────────────► APIGateway
    │                                        │
    ├──► ResourceService                     │
    └──► AlertService (via alerts route)     │
```

### 4.2 Phase Dependency Graph

```
[Phase 1.1 Agent Registry] ─────────────────────────────────────────┐
         │                                                           │
         ├────────► [Phase 1.2 Policy Engine] ─────────────────────┐  │
         │                      │                                  │  │
         ├────────► [Phase 1.3 Anomaly Detection] ───────────────┤  │
         │                      │                                  │  │
         └────────► [Phase 1.4 Kill Switch] ──────────────────────┤  │
                                                              ▼      │
[Phase 2.1-2.4 Pheromone Routing] ◄─────────────────────── (needs 1.1+1.3)
         │
         ▼
[Phase 3.1-3.4 Security Control Plane] ◄──── (needs all Phase 1 + 2)
         │
         ▼
[Phase 4 Compliance Mapping] ◄──── (documentary, needs all prior)
```

### 4.3 No External Database Dependency for Phase 1

**Important:** Phase 1 does NOT require a new database. The existing in-memory store + JSON file persistence is sufficient for:
- Agent registry (small dataset, ~50 agents)
- Policy store (YAML/JSON files, ~20 policies)
- Behavioural baselines (rolling statistics in-memory)
- Revocation list (append-only, small)

**Recommendation:** Add `etcd` in Phase 2 when pheromone tables require high-availability persistence. Phase 1 works with filesystem persistence.

---

## 5. Risk Register

| ID | Risk | Severity | Likelihood | Impact | Mitigation |
|----|------|----------|------------|--------|------------|
| R-01 | Agent registry delay blocks all subsequent phases | Critical | Medium | Full project delay | Parallelise 1.2/1.3 development while 1.1 is finalised |
| R-02 | Policy engine performance bottleneck at high agent count | High | Medium | Latency spikes | Benchmark before Phase 2; consider async evaluation |
| R-03 | Kill switch propagation latency during network partition | Critical | Low | Compromised agent continues operating | Local kill takes precedence; health check retry loop |
| R-04 | JWT NHI rotation introduces routing latency | Medium | Medium | Token refresh delays task execution | Pre-rotate tokens before expiry; cache valid credentials |
| R-05 | Behavioural anomaly false positives cause alert fatigue | Medium | Medium | Operators ignore real alerts | Start with conservative thresholds; tune based on data |
| R-06 | Pheromone table storage grows unbounded | High | Medium | etcd/storage exhaustion | TTL-based eviction; archival to cold storage |
| R-07 | Shadow agent detection has blind spots | High | Medium | Unregistered agents operate undetected | Layer network fingerprinting + API call pattern analysis |
| R-08 | Breaking existing node management functionality | Critical | Low | Cluster instability during evolution | Full test suite must pass before each phase deployment |
| R-09 | Phase 2 pheromone convergence to insecure optima | High | Low | Routing selects compromised agents | Negative reinforcement for policy violations |
| R-10 | GitOps workflow too slow for development iteration | Low | Medium | Developer productivity loss | Development-mode bypass flag; production enforces GitOps |

---

## 6. Technology Stack Assessment

| Component | Current | Assessment | Recommendation |
|-----------|---------|------------|----------------|
| **Backend runtime** | Node.js ≥14 | Mature, production-ready | KEEP — no change needed |
| **API framework** | Express.js 4.18 | Standard, well-understood | KEEP |
| **Auth** | jsonwebtoken + express-rate-limit | Industry standard | KEEP — extend JWT claims for NHI |
| **UI framework** | React + Material-UI | Strong for dashboards | KEEP — extend for agent metrics |
| **Deployment** | Docker Compose + Nginx | Production-ready | KEEP |
| **State store** | In-memory + JSON files | Sufficient for Phase 1 | KEEP until Phase 2 |
| **Consensus** | Custom Raft implementation | Functional but simulated RPC | KEEP — extend for kill switch |

**No ADR required.** Existing stack is appropriate for all 4 phases.

---

## 7. Test Coverage Assessment

| Module | Unit Tests | Integration Tests | Coverage |
|--------|------------|-------------------|----------|
| `src/election/` | ✅ Present | ✅ Present | Partial — vote simulation is mocked |
| `src/node-discovery/` | ✅ Present | ✅ Present | Partial |
| `src/api/` | ✅ Present | ✅ Present | Partial — mock data in resourceService |
| `src/api/middleware/auth.js` | ⚠️ Not clear | Not clear | Needs test coverage for NHI token validation |
| `src/api/routes/` | ✅ Present | ✅ Present | Moderate |

**Gap:** No load/performance tests for agent-scale scenarios (100+ agents). Recommend adding in Phase 1.3 when anomaly detection is operational.

---

## 8. Recommendations

### 8.1 Immediate (Before Phase 1 Implementation)

1. **Write ADR-001:** Confirm Node.js/Express/React stack for all 4 phases (this document serves as the analysis)
2. **Stand up `~/src/AWARE/docs/adr/` directory** for architectural decision records
3. **Add NHI token validation tests** to `src/api/middleware/__tests__/`
4. **Review AWARE-Evolution gap analysis** (`docs/audit/aware-gap-analysis.md`) — much of the Phase 1-3 component inventory is already designed there; reuse applicable designs

### 8.2 Phase 1 Sequencing

1. **Start with Phase 1.1 (Agent Registry)** — this is the critical path root
2. **Parallelise Phase 1.2 (Policy Engine) and Phase 1.3 (Anomaly Detection)** — both depend only on 1.1's identity framework
3. **Complete Phase 1.4 (Kill Switch)** last — depends on 1.2's revocation logic

### 8.3 Key Design Decisions Needed (ADRs)

| ADR | Decision | Recommendation |
|-----|----------|----------------|
| ADR-001 | Stack confirmation | Keep Node.js/Express/React |
| ADR-002 | Etcd introduction point | Phase 2 (pheromone tables need HA persistence) |
| ADR-003 | Sandbox isolation technology | Process separation with IPC (not WASM/eBPF) |
| ADR-004 | NHI credential rotation interval | 1-hour expiry with 15-minute pre-rotation |

---

## 9. Relationship to AWARE-Evolution Work

**Important context:** The AWARE Evolution work was previously done in `~/.openclaw/projects/AWARE-Evolution/` (TypeScript/SQLite). That work is **superseded by this audit**. The correct foundation is the existing `~/src/AWARE/` Node.js/Express/React platform documented here.

Previous deliverables from `~/.openclaw/projects/AWARE-Evolution/`:
- `docs/research/audit-findings.md` — 15 audit findings (3 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW, 3 Performance)
- `docs/research/architecture-findings.md` — solutions for all 15 findings
- `AWARE-architect.md` — 1,191-line architecture document

**Those findings and solutions apply here**, but the implementation must be on the Node.js/Express/React stack, not TypeScript/SQLite.

---

## 10. Open Questions

1. **Etcd vs filesystem for Phase 1:** Is filesystem persistence acceptable for agent registry and policy store, or does Alvin want etcd from day one?
2. **Existing test suite status:** Do the current tests pass? What is the baseline test health before we begin Phase 1?
3. **Development environment:** Is there a local Docker Compose setup developers can use, or is it production-only?
4. **Existing `docs/audit/` contents:** Should the previous `architecture.md` and `aware-gap-analysis.md` be archived or updated in place?

---

## 11. Next Steps

1. **Alvin approves AUDIT.md** → Architect proceeds to Step 2 (Architecture) for Phase 1
2. **Scout completes market/vendor research** in parallel (already underway)
3. **Forge stands by** for Phase 1 implementation assignment after Architecture is approved

---

**Submitted by:** Archimedes (System Architect)
**Timestamp:** 2026-03-31T15:30 UTC
**Status:** AWAITING ALVIN APPROVAL
