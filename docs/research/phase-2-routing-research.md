# Phase 2 Routing Research: AMRO-S Patterns & Enterprise Landscape

**Author:** Scout (Researcher)  
**Date:** 2026-03-31  
**Task:** Phase 2: Pheromone-Based Agent Routing — Research Input for Archimedes' ADR  
**Sources:** arXiv:2603.12933 (AMRO-S paper), web search on Microsoft Agent 365 / Okta Agent Gateway / Galileo Agent Control

---

## 1. AMRO-S Paper: Key Patterns to Adopt

**Paper:** Wang et al., "Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimization," arXiv:2603.12933, March 2026.

### 1.1 Task-Specific Pheromone Specialists

AMRO-S does NOT maintain a single global pheromone matrix. Instead, for each task category, it maintains an independent pheromone specialist matrix τ^t, where τ^t_ij accumulates the historical utility of choosing transition (i→j) under task t.

**Key equation — Query-conditioned pheromone fusion:**
```
τ^(q)_ij = Σ_t∈T  w_t(q) · τ^t_ij
```
where w_t(q) is the semantic attribution weight for task t given query q.

This factorize–fuse design:
- Isolates task memories within specialist matrices to prevent contamination
- Enables smooth interpolation for mixed-intent queries

**AWARE Phase 2 relevance:** EVOLUTION-BRIEF.md Section 2.1 calls for "separate pheromone tables per task category." AMRO-S provides the exact mathematical framework for this.

### 1.2 Security-Weighted Heuristic Function

Standard ACO heuristic η_j(t) combines three signals:

```
η_j(t) = λ_A · Ability~[j][t] 
        + λ_L · (1 / Load[j] + ε)~
        + λ_R · (1 / RT[j] + ε)~
```

Where:
- `Ability[j][t]` = task-specific capability prior
- `Load[j]` = real-time load
- `RT[j]` = response time

**AWARE extension (EVOLUTION-BRIEF.md Section 2.2):**
```
n_secure(agent, task) = w1·capability_score + w2·load_balance + w3·trust_score + w4·data_clearance + w5·blast_radius_inverse
```

This adds two security dimensions not in AMRO-S:
- `trust_score` — derived from Phase 1.3 behavioural baseline
- `blast_radius` — estimated impact if agent is compromised mid-task

### 1.3 Quality-Gated Reinforcement

AMRO-S employs a two-stage scheme:

**Offline warm-up:** Pheromone specialist τ^t optimised using labelled data with ground-truth fitness signals.

**Online bypass evolution:** 
- Inference and learning are decoupled — serving path does NOT update pheromones
- A fraction of requests sampled to FIFO buffer B
- LLM-Judge outputs binary gate g ∈ {0,1}: g=1 means acceptable quality
- Only gated samples reinforce pheromones:

```
τ^t_ij ← (1-ρ)·τ^t_ij + w_t(q)·Q / (f_sys(P) + ε)
```

**AWARE Phase 2 relevance (Section 2.3):** AWARE's security validation must pass BEFORE pheromone reinforcement. Negative reinforcement (pheromone penalty) for policy violations. This goes beyond AMRO-S's quality gate by adding a security gate.

### 1.4 Interpretable Routing Audit

AMRO-S provides traceable routing evidence through structured pheromone patterns. Pheromone heatmaps show which paths were considered, scores, and selection rationale.

**AWARE Phase 2 relevance (Section 2.4):**
- Full pheromone trail logging
- Map to CSA AI Control Matrix Logging & Monitoring controls
- Exportable audit trail (JSON, SIEM-compatible)
- Dashboard visualisation: pheromone heatmaps

### 1.5 Key AMRO-S Performance Claims

- **4.7× speedup** under 1000 concurrent processes vs baseline
- Average score 87.83 vs strongest routing baseline 85.93 (+1.90 points)
- Stable accuracy under high concurrency (96.10%–96.40% across 20–1000 processes)
- Baseline WRR accuracy degrades from 96.00% → 88.20% under same load

### 1.6 What AMRO-S Does NOT Address (AWARE Differentiation)

AMRO-S optimises for quality–cost trade-offs. It does NOT consider:
- Security heuristics (trust scores, blast radius)
- Identity governance (who is allowed to route to whom)
- Kill switches (immediate credential revocation)
- Compliance mapping (CSA AI Control Matrix, NIST AI RMF, DORA)
- Context-aware tool-call authorisation

These are AWARE's differentiation.

---

## 2. Enterprise Landscape: Competitive Context

### 2.1 Microsoft Agent 365

**Announced:** RSAC 2026  
**Key Capabilities:**
- NHI (Non-Human Identity) lifecycle management
- Shadow AI detection — discover unregistered agents
- Universal agent logout — revoke all agent sessions immediately
- Microsoft Agent Framework (open-source, successor to existing frameworks) with .NET and Python support
- "Handoff" orchestration — agents transfer control to one another based on context or user request

**Routing approach:** Handoff-based. No pheromone or ACO-based routing described.

**Source:** Microsoft Security Blog (2026-03-20), Microsoft DevBlogs (2026-02-19), Microsoft Learn (Agent Framework documentation)

### 2.2 Okta Agent Gateway

**Announced:** March 16, 2026 (General availability: April 30, 2026)  
**Product:** Okta for AI Agents  
**Key Capabilities:**
- Agent Gateway — centralised control plane to secure AI agent access to resources
- Virtual MCP server capability — allows agents to access tools from Okta's MCP registry
- Agent-as-identity — treats agents as "machine-first identity"
- Tool-call authorisation — whitelist of permitted tools per agent identity
- Gateway detection — identify and govern unregistered AI agents and OAuth clients interacting with API/MCP/gateway endpoints
- Application programming interface (API) access management

**Routing approach:** Centralised hub-and-spoke. No pheromone routing. Central policy enforcement point.

**Source:** Okta press release (2026-03-16), Okta datasheet "The blueprint for the Secure Agentic Enterprise" (2026-03), SiliconANGLE (2026-03-16)

### 2.3 Galileo Agent Control

**Announced:** March 11, 2026  
**Type:** Open-source runtime control plane  
**Key Capabilities:**
- Hot-reloadable policies — update policies without agent restart
- Governs AI agents across multiple frameworks (AWS, CrewAI, Glean among first integrations)
- Runtime guardrails — centralised enforcement of agent behaviour
- Open-source control plane for enterprise-scale agent governance

**Routing approach:** Policy-based guardrails. No pheromone or ACO routing. Static policy enforcement with hot-reload.

**Source:** Yahoo Finance (2026-03-11), LinkedIn/The New Stack (2026-03), AI Agent Engineering site (2026-03-18)

### 2.4 Comparative Summary

| Vendor | Product | Routing Strategy | Pheromone/ACO | Hot-Reload Policies | Security Governance | AWARE Advantage |
|--------|---------|-----------------|---------------|--------------------|--------------------|-----------|
| Microsoft | Agent 365 | Handoff orchestration | ❌ No | ❌ No | NHI mgmt, shadow AI detection, kill switch | AWARE has bio-inspired routing at core |
| Okta | Agent Gateway | Centralised hub-and-spoke | ❌ No | ❌ No | Tool-call auth, kill switch, MCP registry | AWARE's Raft consensus provides distributed kill-switch; Okta is centralised |
| Galileo | Agent Control | Policy-based guardrails | ❌ No | ✅ Yes | Runtime enforcement, cross-framework | AWARE adds pheromone routing + compliance mapping |
| AWARE | (this project) | **Pheromone-based ACO** | ✅ Yes | Planned (Phase 3.2) | Full identity, behavioural, kill-switch, compliance | Differentiation: bio-inspired + security-weighted |

---

## 3. Key Findings for Archimedes' ADR

### 3.1 No Competitor Uses Pheromone Routing

All three enterprise products use centralised or policy-based routing. None implement ACO-inspired pheromone routing. This confirms AWARE's direction is genuinely differentiated, not just a feature arms race.

### 3.2 Hot-Reload Policies Is Table Stakes for Enterprise

Galileo Agent Control (open-source, March 2026) has hot-reloadable policies. This is now an enterprise expectation, not a differentiator. AWARE should implement this in Phase 3.2 per EVOLUTION-BRIEF.md.

### 3.3 Trust Scores + Blast Radius Are Novel

None of the three vendors have explicit "trust score" or "blast radius" constructs in their routing/selection logic. AWARE's security-weighted heuristic function (Section 2.2 of EVOLUTION-BRIEF.md) is genuinely novel.

### 3.4 AMRO-S Quality Gate Maps to AWARE Security Gate

AMRO-S's LLM-Judge binary quality gate (g=0/1) is the analogue for AWARE's security validation gate. AWARE's gate should evaluate:
- Output passes content filter
- No policy violations
- No data leakage signals
- Tool calls are authorised per Phase 1.2 sandbox policies

### 3.5 Pheromone Specialist Task Categories

AMRO-S separates pheromone tables by task type. For AWARE, suggested initial task categories (aligned with EVOLUTION-BRIEF.md):
- `code_generation` — coding tasks
- `research` — information gathering and synthesis
- `security_review` — vulnerability assessment, audit
- `coordination` — cross-agent task routing
- `monitoring` — health checks, status reporting

---

## 4. Recommended Next Steps for Archimedes

1. **ADR-0X:** Formalise pheromone specialist data model — schema for τ^t matrices, query-conditioned fusion algorithm
2. **ADR-0X:** Design security-weighted heuristic function — define exact weight parameters w1–w5, how trust_score is computed from Phase 1.3 behavioural baseline
3. **ADR-0X:** Quality + security gated update mechanism — define binary security gate criteria, negative reinforcement for policy violations
4. **ADR-0X:** Pheromone storage — extend AWARE's existing data store vs new store for pheromone matrices
5. **ADR-0X:** Integration with existing Raft consensus — pheromone updates must be cluster-wide consistent

---

## 5. Open Questions (For Archimedes)

1. Does AWARE's existing UDP discovery / Raft consensus provide a natural foundation for distributed pheromone synchronisation?
2. What is the SLA for pheromone propagation across the cluster? Is eventual consistency acceptable or must it be strong?
3. How does Phase 1.3 behavioural baseline feed into trust_score computation? Is there an existing metric?
4. Should pheromone specialists be warm-started from historical agent performance data (offline AMRO-S warm-up), or start empty?
5. What is the minimum viable pheromone update — can we defer quality-gated online evolution to Phase 2.2?

---

## Sources

- Wang et al., "Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimization," arXiv:2603.12933, March 2026. https://arxiv.org/abs/2603.12933
- Microsoft Security Blog, "Secure agentic AI end-to-end," March 20, 2026. https://www.microsoft.com/en-us/security/blog/2026/03/20/secure-agentic-ai-end-to-end/
- Microsoft DevBlogs, "Microsoft Agent Framework Reaches Release Candidate," February 19, 2026. https://devblogs.microsoft.com/foundry/microsoft-agent-framework-reaches-release-candidate/
- Microsoft Learn, "Microsoft Agent Framework Workflows Orchestrations." https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff
- Okta, "The blueprint for the Secure Agentic Enterprise," March 2026. https://www.okta.com/sites/default/files/2026-03/datasheet-secure-agentic-enterprise-blueprint.pdf
- Okta, "Okta for AI Agents | Govern Agentic Identity." https://www.okta.com/products/govern-ai-agent-identity/
- SiliconANGLE, "Okta unveils new framework to manage AI agents and upcoming Okta AI Agents platform," March 16, 2026. https://siliconangle.com/2026/03/16/okta-unveils-new-framework-manage-ai-agents-upcoming-okta-ai-agents-platform/
- Galileo AI, "Galileo Releases Open Source AI Agent Control Plane," March 11, 2026. https://finance.yahoo.com/news/galileo-releases-open-source-ai-150100502.html
- AI Agent Engineering, "Galileo Agent Control: The Open-Source Control Plane That Governs AI Agents Across Every Framework," March 18, 2026. https://ai-agent-engineering.org/news/galileo-agent-control-the-open-source-control-plane-that-governs-ai-agents-across-every-framework
