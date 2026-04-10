# AWARE Evolution Brief

## AWARE Heritage

AWARE was first conceived in 2013 as a logistics/Queen-Worker system (Autonomous Warehouse Automated Resource Engine). The current agent governance framework is a spiritual successor — same team, evolved mission.

## From Distributed Systems Platform to Agentic AI Security Control Plane

**Project Key:** aware
**Project Root:** /opt/aware
**GitHub:** https://github.com/alvin-chang/AWARE
**Licence:** GPL-3.0
**Stack:** Node.js, Express.js, React, Material-UI, Docker, Nginx

> **All agents push to Gitea only.** GitHub is a read-only public mirror. Never push directly to GitHub.

---

## What AWARE Is Today

AWARE (Autonomous Warehouse Automated Resource Engine) is a production-deployed autonomous distributed systems platform, in development since April 2013. Current capabilities:

- Ant colony-inspired algorithms for resource coordination
- Raft consensus for leader election with automatic failover
- Self-organising node discovery with role identification (leader/follower)
- Heartbeat mechanism for leader health checks
- JWT authentication with role-based access control
- React + Material-UI monitoring dashboard with real-time cluster health
- Alert system for cluster events, node status changes, and resource warnings
- RESTful API gateway for cluster management
- Docker Compose deployment with Nginx
- Full test suite: unit, integration, e2e (Playwright), load/performance
- OpenAPI specification (docs/openapi.yaml)
- Documentation: PRD, architecture, front-end spec, security report

## Where AWARE Is Going

AWARE is evolving into an open-source agentic AI security control plane — the open alternative to Microsoft Agent 365 and Okta Agent Gateway. The core thesis: AWARE's bio-inspired coordination algorithms are the right primitive for autonomous agent orchestration and security.

## Academic Validation

A March 2026 paper validates this direction:

**AMRO-S** (Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimisation)
- Source: Kyung Hee University, arXiv:2603.12933
- Key patterns to adopt:
  - Pheromone-based path selection across a layered graph of AI agents
  - Task-specific pheromone specialists to prevent cross-task interference
  - Quality-gated evolution that reinforces only high-quality routing trajectories
  - 4.7x speedup over existing multi-agent routing with better accuracy
- What AMRO-S does NOT address (our differentiation): security heuristics, identity governance, kill switches, compliance mapping, blast radius containment

## Enterprise Landscape (What We're Differentiating From)

| Vendor | Product | Announced | Key Capabilities | AWARE Advantage |
|--------|---------|-----------|------------------|-----------------|
| Microsoft | Agent 365 | RSAC 2026 | NHI management, shadow AI detection, universal agent logout | AWARE has bio-inspired coordination at the core, not bolted on |
| Okta | Agent Gateway | Mar 2026 | Agent-as-identity, tool-call authorisation, kill switch | AWARE's Raft consensus provides distributed kill-switch; Okta is centralised |
| Galileo | Agent Control | Mar 2026 | Open-source runtime control plane, hot-reloadable policies | AWARE adds pheromone routing + compliance mapping on top of runtime controls |

---

## PHASE 1: AGENT-NATIVE RUNTIME

**Goal:** Extend AWARE's existing node coordination to treat AI agents as first-class nodes.

### 1.1 Agent Identity Layer
- Non-human identity (NHI) lifecycle: onboarding → operation → credential rotation → decommissioning
- Each agent gets a unique identity with cryptographic credentials (extend existing JWT system)
- Agent registry service extending the existing node discovery service
- Identity metadata: agent type, model, version, capabilities, trust score
- Extension point: src/ node discovery module → add agent-specific fields and lifecycle endpoints

### 1.2 Per-Agent Sandbox Policies
- Policy-as-code: declarative YAML/JSON policy definitions per agent role
- Tool-call authorisation: whitelist of permitted tools per agent identity
- Resource quotas: token limits, API call budgets, compute caps per agent
- Data classification enforcement: which agents can access which data tiers
- New module: src/policies/ with a policy engine that evaluates before every tool call

### 1.3 Behavioural Baseline & Anomaly Detection
- Extend the existing monitoring dashboard to track agent decision patterns
- Baseline metrics: response latency, tool-call frequency, output token distribution, error rate
- Anomaly detection: statistical deviation from baseline triggers alerts via existing alert system
- Decision fingerprinting: hash agent outputs to detect prompt injection or model drift
- Extension point: existing alert system → add anomaly-triggered alert types

### 1.4 Kill Switch
- Leverage AWARE's existing Raft consensus to propagate agent revocation cluster-wide
- Leader can revoke any agent's credentials with immediate effect across all nodes
- Graceful degradation: revoked agent's in-flight tasks reassigned via ant colony rebalancing
- Audit log: every kill-switch event recorded with timestamp, trigger reason, and initiator
- Extension point: existing leader election → add revocation broadcast to heartbeat protocol

---

## PHASE 2: PHEROMONE-BASED AGENT ROUTING

**Goal:** Implement AMRO-S-style routing using AWARE's ant colony algorithms, extended with security-weighted heuristics.

### 2.1 Task-Specific Pheromone Specialists
- Separate pheromone tables per task category (code generation, research, security review, etc.)
- Prevent cross-task interference (AMRO-S Section 3.2 pattern)
- Pheromone decay rates tuned per task type
- Pheromone persistence backed by existing data store

### 2.2 Security-Weighted Heuristic Function
- Extend the standard ACO heuristic n with security signals:

  n_secure(agent, task) = w1 * capability_score + w2 * load_balance + w3 * trust_score + w4 * data_clearance + w5 * blast_radius_inverse

- trust_score: derived from behavioural baseline (Phase 1.3)
- data_clearance: from sandbox policies (Phase 1.2)
- blast_radius: estimated impact if the agent is compromised mid-task
- Weights configurable per deployment via policy-as-code

### 2.3 Quality-Gated Reinforcement
- Only reinforce routing paths that pass BOTH accuracy AND security validation
- Security validation: output passes content filter, no policy violations, no data leakage signals
- Pheromone reinforcement weighted by combined quality-security score
- Negative reinforcement (pheromone penalty) for policy violations
- Configurable quality/security weight balance per environment

### 2.4 Interpretable Routing Audit
- Full pheromone trail logging: which paths were considered, scores, selection rationale
- Map to CSA AI Control Matrix Logging & Monitoring controls
- Exportable audit trail for compliance reporting (JSON, SIEM-compatible)
- Dashboard visualisation: pheromone heatmaps showing routing patterns over time

---

## PHASE 3: AGENTIC SECURITY CONTROL PLANE

**Goal:** Position AWARE as a complete agent security runtime.

### 3.1 Shadow Agent Discovery
- Detect unregistered agents connecting to enterprise resources
- Network-level agent fingerprinting (model signatures, API call patterns)
- Alert + auto-quarantine for unknown agents via existing alert system
- Integration with agent registry (Phase 1.1) for known-vs-unknown classification

### 3.2 Tool-Call Policy Enforcement
- Context-aware tool authorisation: evaluate intent + data sensitivity before permitting tool execution
- Raft consensus ensures policy consistency across the cluster
- Hot-reloadable policies without agent restart (Galileo Agent Control pattern)
- Deny-by-default: agents can only call tools explicitly permitted by policy

### 3.3 Decision-Chain Traceability
- End-to-end audit trail: user request → orchestrator → agent routing → tool calls → output
- Pheromone-based routing decisions are inherently interpretable (AMRO-S validation)
- Compliance-ready export: JSON, SIEM-compatible formats
- Tamper-evident logging (append-only, hash-chained)

### 3.4 GitOps Agent-as-Code
- All agent definitions, policies, model versions, and routing configs stored in Git
- AWARE enforces the declared state at runtime
- Drift detection: alert when runtime state diverges from Git-declared state
- PR-based agent onboarding workflow: new agents require reviewed + merged PR before activation

---

## PHASE 4: COMPLIANCE MAPPING

**Goal:** Map every AWARE capability to established frameworks. Produce docs/compliance-matrix.md.

| AWARE Capability              | CSA AI Control Matrix | NIST AI RMF  | ISO 27001 | DORA       |
|-------------------------------|-----------------------|--------------|-----------|------------|
| NHI lifecycle (1.1)           | Identity & Access     | GOVERN 1.1   | A.9.2     | Art. 9     |
| Pheromone routing audit (2.4) | Logging & Monitoring  | MAP 3.1      | A.12.4    | Art. 12    |
| Per-agent sandbox (1.2)       | Data Protection       | MANAGE 2.3   | A.13.1    | Art. 9     |
| Kill switch (1.4)             | Incident Response     | MANAGE 4.1   | A.16.1    | Art. 17    |
| Shadow agent discovery (3.1)  | Asset Management      | MAP 1.1      | A.8.1     | Art. 5     |
| Quality-gated routing (2.3)   | Model Governance      | MEASURE 2.6  | A.14.2    | Art. 11    |
| Decision traceability (3.3)   | Audit & accountability| GOVERN 1.7   | A.12.4    | Art. 12    |
| GitOps agent-as-code (3.4)    | Change Management     | MANAGE 3.1   | A.12.1    | Art. 8     |
| Tool-call enforcement (3.2)   | Access Control        | MANAGE 2.1   | A.9.4     | Art. 9     |
| Behavioural anomaly (1.3)    | Threat Detection      | MEASURE 2.8  | A.12.6    | Art. 10    |

---

## CONSTRAINTS (ALL AGENTS MUST FOLLOW)

1. **All pushes go to Gitea** (https://gitea.example.com/aware/aware). Never push to GitHub directly.
2. Do NOT break existing AWARE functionality. All current tests must continue to pass.
3. Maintain backward compatibility: existing node management, leader election, and resource coordination must work unchanged.
4. All new code must have tests before review.
5. All new API endpoints must be added to docs/openapi.yaml.
6. Use existing technology stack (Node.js, Express.js, React, Docker) unless an ADR justifies a new dependency.
7. Keep GPL-3.0 licence.
8. British English in all documentation.
9. Every architectural decision gets an ADR in docs/adr/ with: context, decision, consequences, and how it extends existing AWARE code.
