# AWARE Gap Analysis: Current State to Agentic AI Security Control Plane

**Document:** AWARE Gap Analysis  
**Date:** 2026-03-28  
**Status:** Draft  
**Classification:** Internal Architecture Review  

---

## 1. Executive Summary

AWARE's existing architecture provides a strong foundation for agentic AI orchestration — particularly its Raft-based consensus, self-organising node discovery, and event-driven communication model. However, four significant capability gaps must be addressed before AWARE can function as an agentic AI security control plane:

1. **No agent identity lifecycle** — nodes are infrastructure, not agent principals
2. **No policy enforcement engine** — no per-agent sandbox or tool-call authorisation
3. **No pheromone routing layer** — existing ACO algorithms coordinate compute resources, not AI agent routing decisions
4. **No interpretability/audit layer** — no decision-chain traceability or compliance mapping

These are not incremental extensions. Each requires a new first-class module.

---

## 2. Current AWARE Capabilities Relevant to Agentic AI

| Capability | Applicable to Agents? | How |
|---|---|---|
| Ant colony resource coordination | Partial | ACO primitives exist; routing domain is different (agent selection vs compute allocation) |
| Raft consensus + queen election | Yes | Foundation for distributed kill-switch, policy consensus, revocation propagation |
| Self-organising node discovery | Partial | Node discovery works for infrastructure nodes; needs agent registry extension |
| Heartbeat + health checks | Yes | Can be extended to agent liveness, behavioural anomaly detection |
| JWT + RBAC | Partial | Human-auth framework; needs NHI (non-human identity) extension |
| Alert system | Yes | Reuse for anomaly alerts, kill-switch events, policy violations |
| etcd key-value store | Yes | Back pheromone tables, agent registry, policy store |
| Event-driven architecture | Yes | Agent events, routing decisions, policy evaluations as first-class events |
| React monitoring dashboard | Yes | Extend to agent metrics, pheromone heatmaps, compliance dashboards |

---

## 3. Gap Analysis by Phase

### 3.1 Phase 1: Agent-Native Runtime

#### Gap 1.1: No Agent Identity Layer (NHI)

**Current state:** Nodes have infrastructure identities (certificates, IP addresses). Agents are not tracked entities.

**Required:** Agent registry service — a first-class directory of agent principals with cryptographic credentials, lifecycle state, capability declarations, and trust scores.

**Component additions:**
- `src/agents/registry.js` — agent onboarding, deregistration, credential issuance
- `src/agents/identity-provider.js` — issues and rotates agent JWTs; supports short-lived tokens with NHI claims
- Extend `src/discovery/` with agent-specific metadata fields (agent type, model, version, capabilities)
- Extend etcd schema to include agent identity records alongside node records

**Rationale:** Agents must be identifiable principals before any policy, routing, or audit decision can be made about them. Without this, Phases 1.2–4.0 are all blocked.

---

#### Gap 1.2: No Per-Agent Sandbox / Policy Engine

**Current state:** AWARE controls node-level access. There is no per-agent tool-call authorisation.

**Required:** Policy-as-code engine evaluating every tool call before execution.

**Component additions:**
- `src/policies/engine.js` — policy evaluation; receives (agent_id, tool, resource, context) → permit/deny
- `src/policies/store.js` — persists declarative YAML/JSON policies in etcd
- `src/policies/sandbox.js` — enforces resource quotas (token limits, API budgets, compute caps) per agent
- `src/policies/data-classification.js` — enforces data tier access rules per agent clearance level

**Rationale:** Deny-by-default tool-call authorisation is the primary mechanism for blast-radius containment when an agent is compromised or misbehaving. This is the core security primitive of Phase 1.

---

#### Gap 1.3: No Behavioural Baseline / Anomaly Detection

**Current state:** AWARE monitors node-level metrics (CPU, memory, network). Agent decision patterns are invisible.

**Required:** Per-agent behavioural baselines (latency, tool-call frequency, output size distribution, error rate) with statistical anomaly alerting.

**Component additions:**
- `src/agents/behavioural-monitor.js` — collects per-agent metrics, computes rolling baselines
- `src/agents/anomaly-detector.js` — statistical deviation detection; triggers alerts via existing alert system
- `src/agents/decision-fingerprint.js` — hashes agent outputs; detects prompt injection or model drift

**Rationale:** Without behavioural baselines, kill-switches and policy violations are reactive rather than proactive. Anomaly detection enables the system to act on early warning signals before policy violations occur.

---

#### Gap 1.4: Kill Switch via Raft Consensus

**Current state:** Queen election handles infrastructure failover. Agent credential revocation is not propagated cluster-wide.

**Required:** Extend heartbeat protocol to broadcast agent revocation events; revoked agent loses credentials immediately across all nodes.

**Component additions:**
- Extend `src/election/heartbeat.js` with revocation broadcast payload
- `src/agents/revocation-service.js` — accepts kill-switch trigger, propagates via Raft log
- Audit log entry for every revocation event (initiator, reason, timestamp)

**Rationale:** AWARE's existing Raft consensus gives a critical advantage over centralised competitors (Okta Agent Gateway): a distributed kill-switch with no single point of failure. This is a genuine differentiator.

---

### 3.2 Phase 2: Pheromone-Based Agent Routing

#### Gap 2.1: No Pheromone Routing Layer

**Current state:** AWARE's ACO algorithms coordinate compute resource allocation across nodes. This is orthogonal to AI agent routing.

**Required:** Task-category-specific pheromone tables evaluated at routing decision time.

**Component additions:**
- `src/routing/pheromone-table.js` — pheromone persistence per task category, stored in etcd
- `src/routing/pheromone-specialist.js` — isolates pheromone decay/reinforcement per task type (code generation, research, security review, etc.)
- Extend existing `src/aco/` coordinator to support agent-scope pheromone operations

**Rationale:** AMRO-S (arXiv:2603.12933) demonstrates 4.7x speedup with task-specific pheromone isolation. AWARE's ACO primitives are applicable here but must be extended to the agent routing domain.

---

#### Gap 2.2: No Security-Weighted Heuristic Function

**Current state:** ACO heuristic function (if present) optimises for load or proximity. Security signals are absent.

**Required:** Multi-signal heuristic: `n = w1·capability + w2·load + w3·trust_score + w4·data_clearance + w5·blast_radius_inverse`

**Component additions:**
- `src/routing/heuristic-calculator.js` — computes weighted heuristic per (agent, task) pair
- `src/routing/trust-scorer.js` — derives trust score from Phase 1.3 behavioural baseline
- Configurable weight vector via policy-as-code

**Rationale:** Production agent routing must balance capability with security posture. Trust score and blast-radius inverse prevent routing to compromised or over-privileged agents for sensitive tasks.

---

#### Gap 2.3: No Quality-Gated Reinforcement

**Current state:** No mechanism to reinforce or penalise routing decisions based on outcome quality.

**Required:** Pheromone reinforcement gated on both accuracy and security validation.

**Component additions:**
- `src/routing/quality-validator.js` — evaluates output: content filter, policy violations, data leakage signals
- `src/routing/reinforcement.js` — positive reinforcement for passing paths; negative penalty for policy violations
- Extend pheromone update algorithm to include security dimension

**Rationale:** Routing paths that bypass security controls must be negatively reinforced, not just ignored. Without this, the pheromone system will converge on insecure optima.

---

#### Gap 2.4: No Interpretable Routing Audit

**Current state:** Event log exists; pheromone routing decisions are not logged with rationale.

**Required:** Full pheromone trail logging: paths considered, scores, selection rationale.

**Component additions:**
- `src/routing/audit-logger.js` — logs every routing decision with full score breakdown
- Dashboard extension: pheromone heatmap visualisation
- SIEM-compatible JSON export

**Rationale:** Phase 4 compliance mapping requires audit evidence for every routing decision. AMRO-S routing is interpretable by design; AWARE must surface this for enterprise audit requirements.

---

### 3.3 Phase 3: Agentic Security Control Plane

#### Gap 3.1: No Shadow Agent Discovery

**Current state:** AWARE only knows about registered nodes.

**Required:** Detect and flag/register/quarantine agents connecting to enterprise resources without going through the agent registry.

**Component additions:**
- `src/security/agent-fingerprint.js` — network-level fingerprinting: model signatures, API call patterns
- `src/security/shadow-detector.js` — classifies known vs unknown agents; triggers alert + auto-quarantine
- Extend existing alert system with shadow-agent alert type

**Rationale:** Shadow AI is a primary enterprise risk. AWARE must actively discover unregistered agents, not just enforce policy on known ones.

---

#### Gap 3.2: No Context-Aware Tool-Call Enforcement

**Current state:** Policy engine (Gap 1.2) evaluates static rules. Intent and data sensitivity are not considered.

**Required:** Context-enriched authorisation: evaluate (intent + data sensitivity + agent trust) before permitting tool execution.

**Component additions:**
- `src/security/context-evaluator.js` — enriches tool-call authorisation with intent classification and data sensitivity labels
- Hot-reloadable policies without agent restart (Galileo Agent Control pattern)
- Deny-by-default: agents can only call explicitly permitted tools

**Rationale:** Static allowlists are insufficient; the same tool call may be legitimate or malicious depending on context. This is the primary differentiator from standard RBAC.

---

#### Gap 3.3: No End-to-End Decision Chain Traceability

**Current state:** Audit log exists; end-to-end request traces are not linked.

**Required:** Tamper-evident, append-only hash-chained audit trail: user → orchestrator → agent routing → tool calls → output.

**Component additions:**
- `src/audit/decision-trace.js` — links all events in a single decision chain via correlation ID
- `src/audit/chain-logger.js` — append-only hash-chained log; tampering invalidates chain
- JSON + SIEM export for compliance reporting

**Rationale:** Without end-to-end traceability, post-incident investigation cannot reconstruct the full chain of decisions. Hash-chaining provides tamper evidence for regulatory audit.

---

#### Gap 3.4: No GitOps Agent-as-Code Workflow

**Current state:** Agent configuration managed via API; no version-controlled declarative state.

**Required:** All agent definitions, policies, model versions, and routing configs stored in Git; AWARE enforces declared state at runtime.

**Component additions:**
- `src/gitops/agent-definitions.js` — reads agent configs from Git repo; validates on PR merge
- `src/gitops/drift-detector.js` — compares runtime state to Git-declared state; alerts on divergence
- PR-based onboarding workflow: new agents require reviewed + merged PR before activation

**Rationale:** Enterprise security requires change management and audit trails for agent configurations. GitOps provides both. This maps directly to CSA AI Control Matrix Change Management controls.

---

### 3.4 Phase 4: Compliance Mapping

#### Gap 4.1: No Compliance Documentation

**Current state:** No formal mapping of AWARE capabilities to CSA AI Control Matrix, NIST AI RMF, ISO 27001, or DORA.

**Required:** `docs/compliance-matrix.md` mapping every AWARE capability to its regulatory controls.

**Deliverable:** `docs/compliance-matrix.md` — see EVOLUTION-BRIEF.md Table 2 for the baseline mapping framework.

**Rationale:** Enterprise procurement requires compliance evidence. The mapping table in the EVOLUTION-BRIEF is the starting point; each cell must be substantiated with implementation evidence (audit logs, policy configs, ADR references).

---

## 4. Research Question Responses

### Q1: How should AWARE's existing queen/worker architecture map to agent roles?

| AWARE Role | Agentic Extension |
|---|---|
| **Queen Node** | **Orchestrator** — registers agents, issues NHI credentials, propagates kill-switches via Raft, computes pheromone routing decisions, enforces policies cluster-wide |
| **Worker Node** | **Agent Host** — runs sandboxed agent workloads, reports behavioural metrics, executes pheromone-guided routing instructions from queen |

The queen/worker hierarchy maps directly. No structural change required. The queen gains new responsibilities (agent lifecycle, policy enforcement, routing computation); workers gain new capabilities (agent sandboxing, pheromone signalling).

**Key insight:** AWARE's existing separation of cluster coordination (queen) from workload execution (workers) is architecturally correct for agent orchestration. This is a strength, not a gap.

---

### Q2: What new components are needed beyond the current node discovery + Raft model?

| Category | Components Required |
|---|---|
| **Identity** | Agent registry, NHI identity provider, credential rotation service |
| **Policy** | Policy engine, policy store, data classification service, sandbox enforcer |
| **Routing** | Pheromone table manager, heuristic calculator, trust scorer, quality validator, reinforcement loop |
| **Observability** | Behavioural monitor, anomaly detector, decision fingerprint, routing audit logger |
| **Security** | Shadow agent detector, context evaluator, revocation service |
| **GitOps** | Agent definitions loader, drift detector |
| **Compliance** | Compliance matrix, decision chain tracer, SIEM exporter |

**Etcd schema extensions required for:** agent identity records, pheromone tables, policy documents, trust scores, audit chains.

**API extensions required:** NHI lifecycle endpoints, policy CRUD, pheromone status, audit export.

---

### Q3: How does existing JWT/identity system extend to agent NHI?

AWARE's existing JWT/RBAC system provides a foundation. Extension required:

| Current (Human Auth) | Extension for NHI |
|---|---|
| User identity in JWT `sub` claim | Agent identity in JWT `sub` claim with `agent_id` type discriminator |
| Role-based access (`roles` claim) | Capability declarations (`capabilities` claim) + clearance level (`clearance` claim) |
| Session tokens (relatively long-lived) | Short-lived tokens (minutes) with automatic rotation via identity provider |
| Static role assignments | Dynamic trust score derived from Phase 1.3 behavioural baseline, embedded in token or consulted at validation time |
| API key + certificate auth for nodes | Extend to include agent attestation (workload identity bound to host node identity) |

**Critical缺口:** Current JWT validation assumes human-operated refresh cycles. Agent NHI requires machine-driven credential rotation — the identity provider must proactively rotate agent credentials before expiry, not on user action.

**Differentiation from Okta Agent Gateway:** AWARE's Raft consensus means kill-switch revocation propagates via distributed log, not via a centralised token validation endpoint. This is architecturally more resilient.

---

## 5. Critical Path

The phases have hard dependencies. The following order is non-negotiable:

```
Phase 1.1 (Agent Registry) → Phase 1.2 (Policy Engine) → Phase 1.3 (Anomaly Detection)
                             ↓
Phase 1.4 (Kill Switch) ← Phase 1.2 (Policy Engine)
                             ↓
Phase 2.1–2.4 (Pheromone Routing) ← Phase 1.1 + 1.3
                             ↓
Phase 3.1–3.4 (Security Control Plane) ← Phase 1 + Phase 2
                             ↓
Phase 4 (Compliance Mapping) ← All prior phases
```

Phase 1.1 (Agent Registry) is the critical path root. Everything depends on agents being identifiable principals.

---

## 6. Risks and Open Questions

1. **Etcd capacity:** Pheromone tables and audit chains could reach significant volume. Needs capacity planning and TTL-based eviction policy.
2. **Agent sandboxing technology:** Gap 1.2's sandbox requirement needs a concrete isolation technology decision (containers, WebAssembly, separate processes). This is an ADR.
3. **AMRO-S implementation fidelity:** The AMRO-S paper's exact algorithm must be reviewed before full adoption; some patterns may not transfer directly to the security domain.
4. **NHI credential rotation latency:** Short-lived agent tokens with automated rotation must not introduce routing latency. Needs performance modelling.
5. **GitOps agent activation delay:** PR-based onboarding adds latency to agent provisioning. Acceptable for production, potentially problematic for development. Needs development-mode bypass.

---

## 7. Summary: Specific Component Additions

| # | Component | File(s) | Rationale |
|---|---|---|---|
| 1 | Agent Registry | `src/agents/registry.js` | NHI lifecycle management — Phase 1.1 critical path |
| 2 | NHI Identity Provider | `src/agents/identity-provider.js` | Agent JWT issuance and rotation — Phase 1.1 |
| 3 | Policy Engine | `src/policies/engine.js` | Deny-by-default tool-call authorisation — Phase 1.2 |
| 4 | Policy Store | `src/policies/store.js` | Declarative YAML/JSON policy persistence — Phase 1.2 |
| 5 | Agent Sandbox | `src/policies/sandbox.js` | Resource quotas per agent — Phase 1.2 |
| 6 | Data Classification | `src/policies/data-classification.js` | Data tier access control — Phase 1.2 |
| 7 | Behavioural Monitor | `src/agents/behavioural-monitor.js` | Per-agent metric baselines — Phase 1.3 |
| 8 | Anomaly Detector | `src/agents/anomaly-detector.js` | Statistical deviation alerts — Phase 1.3 |
| 9 | Decision Fingerprint | `src/agents/decision-fingerprint.js` | Prompt injection / drift detection — Phase 1.3 |
| 10 | Revocation Service | `src/agents/revocation-service.js` | Distributed kill-switch via Raft — Phase 1.4 |
| 11 | Pheromone Table Manager | `src/routing/pheromone-table.js` | Per-task pheromone persistence — Phase 2.1 |
| 12 | Pheromone Specialist | `src/routing/pheromone-specialist.js` | Task-category pheromone isolation — Phase 2.1 |
| 13 | Heuristic Calculator | `src/routing/heuristic-calculator.js` | Security-weighted routing heuristic — Phase 2.2 |
| 14 | Trust Scorer | `src/routing/trust-scorer.js` | Behaviour-derived trust scores — Phase 2.2 |
| 15 | Quality Validator | `src/routing/quality-validator.js` | Security-gated reinforcement — Phase 2.3 |
| 16 | Routing Audit Logger | `src/routing/audit-logger.js` | Interpretable routing audit trail — Phase 2.4 |
| 17 | Shadow Agent Detector | `src/security/shadow-detector.js` | Unregistered agent discovery — Phase 3.1 |
| 18 | Context Evaluator | `src/security/context-evaluator.js` | Intent-aware tool authorisation — Phase 3.2 |
| 19 | Decision Chain Tracer | `src/audit/decision-trace.js` | End-to-end tamper-evident audit — Phase 3.3 |
| 20 | Agent Definitions Loader | `src/gitops/agent-definitions.js` | GitOps declarative state enforcement — Phase 3.4 |
| 21 | Drift Detector | `src/gitops/drift-detector.js` | Runtime vs declared state divergence — Phase 3.4 |
| 22 | Compliance Matrix | `docs/compliance-matrix.md` | Regulatory control mapping — Phase 4 |

---

*Document produced by Architect subagent, 2026-03-28. Pending review by AWARE architecture owner.*
