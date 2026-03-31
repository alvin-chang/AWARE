# AWARE Evolution — Audit-Architecture Report
## Architecture for High-Performance Autonomous Agent Control Plane

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)
**Phase:** Audit-Architecture (Sprint 2)
**Author:** Archimedes (System Architect)
**Date:** 2026-03-28
**Status:** READY FOR IMPLEMENTATION
**Deadline:** 2026-03-31 17:00 GMT

---

## Executive Summary

AWARE's evolution from distributed systems platform to agentic AI security control plane is architecturally sound. The existing queen-worker hierarchy maps cleanly to orchestrator-agent host roles. The key challenge is not structural redesign but component addition on top of proven foundations.

**Critical path:** Agent Registry (NHI lifecycle) → everything else depends on agents being identifiable principals.

**Recommended implementation order:**
1. Phase 1a: Agent Registry + NHI identity (critical path root)
2. Phase 1b: Policy Engine + Per-Agent Sandboxes
3. Phase 2: Pheromone-based routing (extends existing ACO primitives)
4. Phase 3: Shadow agent discovery + Tool-call enforcement
5. Phase 4: Compliance mapping (documentary, low engineering cost)

---

## Research Question 1: What Architectural Patterns Do High-Performing AI Agents Share?

### Pattern 1: Modularity with Explicit Interfaces

High-performing agents separate concerns into distinct layers with clear interface contracts:

```
┌─────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                      │
│  (goal decomposition, task assignment, retry logic)    │
├─────────────────────────────────────────────────────┤
│                   AGENT HOST                         │
│  (tool execution, context management, memory)        │
├─────────────────────────────────────────────────────┤
│              SECURITY LAYER                          │
│  (policy enforcement, anomaly detection, kill-switch) │
├─────────────────────────────────────────────────────┤
│                   TOOL LAYER                        │
│  (I/O, external APIs, computation)                   │
└─────────────────────────────────────────────────────┘
```

**Why it matters:** Each layer can evolve independently. Policy changes don't require rewriting the orchestrator. Tool additions don't break security enforcement.

**AWARE fit:** AWARE's existing queen/worker separation is this pattern — queen handles coordination, workers handle execution. Extending to agent hosts follows the same principle.

### Pattern 2: Identity-First Security

Every agent has a non-human identity (NHI) with cryptographic credentials:

- **Unique identifier** (UUID or DID)
- **Capability claims** (what the agent can do)
- **Trust score** (behavioral history)
- **Credential lifecycle** (rotation, revocation)

**Why it matters:** Without identity, you can't have policies, anomaly detection, or accountability. Identity is the prerequisite for every other security control.

**AWARE fit:** Existing JWT/RBAC system provides the foundation. Key extension: machine-driven short-lived credential rotation (vs human refresh cycles), plus new claims for `capabilities`, `clearance`, and `trust_score`.

### Pattern 3: Explicit Tool Contracts

High-performing agents define what tools they expose and under what conditions:

```typescript
interface ToolContract {
  tool: string;
  permittedAgents: string[];    // which agents can call
  requiresContext: string[];   // what context needed
  rateLimitPerAgent: number;   // calls per minute
  escalationRequired: boolean;  // does this need human approval
}
```

**Why it matters:** Without explicit contracts, tool access is binary (all or nothing). Contracts enable fine-grained authorization.

**AWARE fit:** Per-agent sandbox policies (Phase 1.2) implement this pattern via YAML/JSON policy definitions.

### Pattern 4: Observable Decision Trails

Every routing decision is logged with rationale:

```typescript
interface RoutingDecision {
  task: Task;
  candidates: Agent[];
  scores: Map<Agent, number>;
  selected: Agent;
  reasoning: string;  // "highest pheromone + trust_score"
  timestamp: Date;
}
```

**Why it matters:** Autonomous systems fail in opaque ways. Interpretable decision trails enable debugging, compliance, and iterative improvement.

**AWARE fit:** Pheromone routing inherently provides this (AMRO-S validation). Full trail logging completes it.

### Pattern 5: Graceful Degradation

When components fail, the system degrades predictably:

| Component | Failure Mode | Graceful Degradation |
|-----------|-------------|---------------------|
| Agent | Unresponsive | Task reassigned via colony rebalancing |
| Policy Engine | Overloaded | Deny-by-default fallback |
| Pheromone Table | Stale | Fall back to capability-based routing |
| Kill Switch | Network partition | Local kill takes precedence, cluster sync later |

**Why it matters:** Autonomous systems must handle partial failures. Perfect consistency is less important than continued operation.

---

## Research Question 2: What Role Does Modularity and Separation of Concerns Play?

### Modularity Enables Independent Evolution

Each capability phase can be developed and deployed independently:

| Phase | Components | Independence |
|-------|-----------|--------------|
| Phase 1a | Agent Registry | No dependencies |
| Phase 1b | Policy Engine | Depends on Registry |
| Phase 2 | Pheromone Routing | Depends on Registry |
| Phase 3 | Shadow Discovery | Depends on Registry |
| Phase 4 | Compliance Mapping | Depends on all |

**Key insight:** Agent Registry is the root. Everything else depends on it. Build it first.

### Separation of Concerns Prevents Security Bugs

Security enforcement must be independent of the systems it governs:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Orchestrator │ ──▶ │ Agent Host   │ ──▶ │ Tool Layer   │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │Policy Engine │  ← Independent of orchestration
                    │(SECURITY)    │
                    └──────────────┘
```

**Anti-pattern to avoid:** Policy enforcement embedded in the orchestrator. If the orchestrator is compromised, policies go with it.

**AWARE correct approach:** Policy engine is a separate service that intercepts tool calls before they execute. Queen cannot override policy — it can only change policy definitions via GitOps.

### The Modularity Paradox: When Over-Modularization Hurts

**Risk:** Too many small services create coordination overhead.

**AWARE context:** At 6-agent scale, over-modularizing (8+ services) adds more latency than it saves in isolation. The right granularity is:
- Orchestrator (queen)
- Agent hosts (workers)  
- Policy engine (security layer)
- Registry (identity)
- Pheromone store (etcd)

5 services, not 15.

---

## Research Question 3: How Should AWARE's Existing Architecture Evolve?

### Current State Assessment

| AWARE Component | Fits Agentic AI | Gap |
|----------------|----------------|-----|
| Queen/Worker hierarchy | ✅ Clean mapping to orchestrator/agent | None |
| Raft consensus | ✅ Distributed kill-switch | None |
| etcd state store | ✅ Extensible schema | Needs new record types |
| Node discovery | ✅ Maps to agent registry | Must extend protocol |
| JWT/RBAC | ✅ Foundation for NHI | Must extend claims |
| Alert system | ✅ Anomaly alerting | Must add agent-specific alerts |
| API Gateway | ✅ Route to agent hosts | Must add agent endpoints |

**Conclusion:** No structural redesign needed. Evolution is component extension, not architectural rewrite.

### Component Evolution Map

#### Queen → Orchestrator + Policy Authority
- **Adds:** Agent lifecycle management, policy definitions, pheromone initialization
- **Changes:** Queen election includes policy capability
- **Why:** Queen already handles cluster coordination; policy authority is a natural extension

#### Worker → Agent Host + Sandbox
- **Adds:** Tool execution sandbox, per-agent pheromone signaling, trust score updates
- **Changes:** Workers gain agent-specific state (trust_score, clearance, capabilities)
- **Why:** Workers already execute tasks; sandboxing is a natural extension

#### etcd Schema Extensions
```
/aware/agents/{agent_id}       → Agent identity record
/aware/policies/{policy_id}    → Policy definitions
/aware/pheromones/{task_type}  → Pheromone tables (per AMRO-S)
/aware/trust/{agent_id}        → Trust scores
/aware/audit/{event_id}        → Audit chain
```

#### Discovery Protocol Extension
Existing broadcast protocol extended with:
- `AGENT_ANNOUNCE` — new agent registers
- `AGENT_REVOKE` — credential revocation
- `POLICY_UPDATE` — policy definition change
- `PHEROMONE_SYNC` — routing table update

### JWT Extension for NHI

```json
{
  "sub": "agent:coder:instance-7f3a",
  "iss": "aware-ca",
  "type": "agent",
  "capabilities": ["code_review", "test_write", "git_push"],
  "clearance": "internal_only",
  "trust_score": 0.87,
  "valid_until": "2026-03-28T15:00:00Z",
  "rotated_from": "agent:coder:instance-3b9c"
}
```

**Key difference from human JWT:** Short validity (hours, not days), automated rotation, no refresh UI needed.

---

## Research Question 4: Critical Infrastructure Requirements

### Memory: Short-Term + Long-Term Separation

| Memory Type | Purpose | Storage | Retention |
|------------|---------|---------|-----------|
| Context window | Current task state | In-process | Per-task |
| Agent memory | Learned patterns | etcd or dedicated store | Persistent |
| Pheromone trails | Routing optimization | etcd | Decay over time |
| Audit chain | Accountability | Append-only log | Long-term |

**AWARE note:** Existing etcd cluster can handle agent memory + pheromone storage. Audit chain needs append-only store (Freshchain or equivalent).

### Communication: Typed Channels

```
ORCHESTRATOR → AGENT: Task assignment (Task message)
AGENT → ORCHESTRATOR: Task completion (Result message)
AGENT → POLICY_ENGINE: Authorization request (AuthZ message)
POLICY_ENGINE → AGENT: Authorization decision (AuthZ response)
QUEEN → ALL: Kill switch / revocation (Revoke message)
ANY → REGISTRY: Identity lookup (Resolve message)
```

**Channel properties:**
- Task messages: at-least-once delivery
- AuthZ messages: exactly-once (critical for security)
- Revoke messages: at-most-once (if missed, health check catches it)

### Tool Use: Sandboxing Strategy

| Approach | Isolation | Latency | Complexity |
|---------|-----------|---------|------------|
| Process separate | High | Medium | Medium |
| WASM | High | Low | High |
| eBPF sandbox | Highest | Lowest | Highest |
| Network isolation | Medium | Low | Low |

**Recommendation for AWARE:** Process separation with IPC. Not WASM (too complex to maintain). Network isolation for untrusted tools. This balances safety and operational simplicity.

### Minimum Viable Infrastructure Additions

For Phase 1 to function:

1. **Agent Registry service** — new Go/Node.js service, ~500 lines
2. **Policy Engine** — extends existing alert system patterns, ~800 lines
3. **etcd schema** — new record types, no schema migration needed
4. **JWT extension** — claim types + short-lived rotation logic
5. **Discovery extension** — 3 new message types

Total new code estimate: ~2,000-3,000 lines across 5 components.

---

## Research Question 5: Failure Modes and Mitigation Strategies

### Critical Failure Mode Analysis

| Failure Mode | Severity | Likelihood | Mitigation |
|-------------|----------|------------|------------|
| **Agent credential compromise** | Critical | Medium | Short-lived creds + kill-switch + behavioral anomaly detection |
| **Policy engine bypass** | Critical | Low | Policy as independent service, queen cannot override |
| **Pheromone table corruption** | High | Low | Fallback to capability routing + periodic reconciliation |
| **Kill-switch propagation failure** | Critical | Low | Local kill takes precedence + health check retry |
| **Shadow agent undetected** | High | Medium | Network fingerprinting + registry lookup |
| **Tool-call authorization drift** | High | Medium | Policy versioned in Git + drift detection |
| **Agent trust score manipulation** | Medium | Low | Multiple data sources for scoring + anomaly detection |

### Top 5 Mitigation Strategies

#### 1. Defense in Depth for Credentials

```
Layer 1: Short-lived JWT (1-hour expiry)
Layer 2: Behavioral anomaly detection (unusual tool-call patterns trigger revocation)
Layer 3: Raft-consensus kill-switch (revoked → all nodes within seconds)
Layer 4: Physical isolation (critical agents on separate network segment)
```

#### 2. Policy Engine Independence

- Policy engine is a separate service, not embedded in orchestrator
- Queen can change policy definitions (via GitOps) but cannot bypass enforcement
- Policy changes require PR review (two-person rule for security-critical policies)
- Policy version stored in etcd with hash chain

#### 3. Interpretable Anomaly Detection

Not "flag this" but "flag this because":

```typescript
interface AnomalyAlert {
  agent: string;
  deviation: string;       // "tool-call frequency 3σ above baseline"
  baseline: number;       // 12 calls/hour
  current: number;         // 47 calls/hour
  timestamp: Date;
  action: "alert" | "revoke" | "throttle";
}
```

**Why:** Black-box anomaly detection creates false positives and erodes trust. Interpretable alerts let operators validate before acting.

#### 4. Graceful Degradation Hierarchy

When components fail, fall back predictably:

```
Pheromone routing unavailable → Capability-based routing
Capability data unavailable → Round-robin (degraded but functional)
Registry unavailable → Agents continue with cached credentials until expiry
```

#### 5. Kill-Switch with Blast Radius Containment

When an agent is revoked:
1. Immediate: In-flight tool calls aborted
2. Short-term: Tasks reassigned via colony rebalancing
3. Medium-term: Trust score for that agent's type reviewed
4. Long-term: Root cause analysis, policy update if needed

**Audit log:** Every kill-switch event is recorded with trigger reason, initiator, and blast radius estimate.

### Safe Failure Design Principles

1. **Fail to deny:** Policy uncertainty → deny. Capability uncertainty → reduce permissions.
2. **Fail to observable:** Every failure produces an audit event. Silent failures are worse than loud ones.
3. **Fail to isolated:** Component failure doesn't cascade. Agent host crash → task reassignment, not cluster failure.
4. **Fail to recoverable:** Automatic recovery paths for common failures. Manual intervention only for novel failures.

---

## Implementation Roadmap

### Phase 1a: Agent Registry (Critical Path Root)
**Weeks 1-2**

- Agent identity record schema in etcd
- Agent discovery protocol extension
- NHI credential issuance (extend JWT system)
- Agent registry service (CRUD for agent identities)
- Credential rotation mechanism

**Deliverable:** `agents/registry/` — new service, ~800 lines

### Phase 1b: Policy Engine + Sandboxes
**Weeks 3-4**

- Policy definition schema (YAML/JSON)
- Policy engine service
- Per-agent sandbox (process isolation)
- Tool-call authorization before execution
- Policy change GitOps workflow

**Deliverable:** `agents/policy/` — new service, ~1000 lines

### Phase 2: Pheromone Routing
**Weeks 5-7**

- Pheromone table schema in etcd
- Security-weighted heuristic function
- Quality-gated reinforcement
- Routing audit trail
- Dashboard visualization

**Deliverable:** `agents/routing/` — extends existing ACO primitives, ~600 lines

### Phase 3: Shadow Discovery + Enforcement
**Weeks 8-9**

- Network-level agent fingerprinting
- Shadow agent detection + quarantine
- Context-aware tool authorization
- Hot-reloadable policies

**Deliverable:** `agents/security/` — new capabilities, ~500 lines

### Phase 4: Compliance Mapping
**Weeks 10-11**

- CSA AI Control Matrix mapping
- NIST AI RMF mapping
- DORA mapping
- Audit trail export (JSON, SIEM formats)

**Deliverable:** `docs/compliance-matrix.md` — documentation only, low engineering cost

---

## Open Questions (Flagged for Team)

1. **Etcd capacity planning:** Pheromone tables + audit chains at scale — what's the growth rate? When does storage become a concern?
2. **Sandboxing technology decision:** Process separation vs eBPF vs WASM — need ADR
3. **NHI credential rotation latency:** How fast must rotation be to maintain availability vs limit blast radius?
4. **GitOps development-mode bypass:** Provisioning speed during development vs production enforcement — what's the right balance?
5. **AMRO-S 4.7x speedup claim:** Need to review source paper before fully adopting pheromone routing numbers

---

## Conclusion

AWARE's evolution to an agentic AI security control plane is architecturally achievable with component extensions, not structural redesigns. The existing queen-worker hierarchy, Raft consensus, and etcd store provide the right primitives.

**Critical path:** Agent Registry (Phase 1a) — everything else depends on agents being identifiable principals.

**Biggest risk:** Over-engineering. At 6-agent scale, 5 services is right granularity. 15 would be over-modularized.

**Biggest security gap:** Policy engine embedded in orchestrator would defeat the purpose. Must remain independent.

**Biggest operational gap:** Interpretable anomaly detection — black-box ML is tempting but erodes trust. Start with statistical thresholds, add ML if false positive rate becomes a problem.

---

**Next Steps:**
1. Phase 1a implementation begins immediately (Agent Registry)
2. ADR needed: sandboxing technology decision
3. Scout to review AMRO-S paper for pheromone routing numbers
4. Architect to design policy engine authorization flow

**Architect sign-off:** ✅ Ready for Coder handoff