# AWARE — Autonomous Compliance Infrastructure for AI Agents

**Project Key:** `aware`  
**Root:** `~/src/AWARE`  
**Gitea (primary):** http://openclaw.local:3000/alvin/AWARE  
**GitHub (public):** https://github.com/GoodCISO/aware  
**License:** Apache-2.0

> AWARE v1.0.0 — Autonomous compliance infrastructure shipped to GitHub (GoodCISO/aware). 214 clean files. Apache 2.0 license.

---

## What AWARE Is

AWARE is **open-source autonomous compliance infrastructure for AI agents**.

Autonomous AI agents operate across organisational boundaries, spawn child agents, and make independent decisions. Existing compliance frameworks — SOC 2 checklists, ISO 27001 templates, periodic audits — assume human oversight at every step. They don't apply to systems that act autonomously.

AWARE is different. It's infrastructure that makes compliance happen on its own:
- Every agent gets a **cryptographic identity** it can't fake
- Every action is **evaluated against policy before it executes**
- **Revocation cascades automatically** when an agent is compromised — kill the parent, the children go too
- **Full audit trails build themselves** — every decision, every context access, every escalation

AWARE implements **T0-T4 constraint levels** — from fully human-controlled (T0) to full autonomous operation with cryptographic identity (T4). Agents self-enforce the constraint level you define. You don't babysit them.

**Core thesis:** Bio-inspired coordination algorithms are the right primitive for autonomous agent orchestration and compliance. Pheromone-based routing, distributed consensus, and self-healing topologies translate directly to agent governance.

---

## Key Differentiators

| Pattern | What It Means for Autonomous Compliance |
|---------|-------------|
| **Cryptographic Agent Identity** | Every agent has NHI (Non-Human Identity) with cryptographic credentials — the foundation for autonomous self-governance |
| **Self-Enforcing Policies** | T0-T4 constraint levels evaluated before action executes — not checklists, infrastructure |
| **Automatic Revocation Cascade** | Kill the parent via Raft consensus, every child agent is revoked automatically |
| **Observable Decision Trails** | Every routing decision logged with rationale — self-documenting compliance |
| **Quality-Gated Pheromone Evolution** | Only high-quality, compliant routing trajectories get reinforced (AMRO-S research, 4.7x speedup) |
| **Modularity with Explicit Interfaces** | Each layer (orchestrator, agent host, compliance, tools) evolves independently — compliance is embedded, not bolted on |

---

## Architecture

AWARE's layered architecture makes compliance autonomous — not just visible:

```
┌─────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                      │
│         (goal decomposition, task assignment)       │
├─────────────────────────────────────────────────────┤
│                   AGENT HOST                         │
│          (tool execution, context, memory)          │
├─────────────────────────────────────────────────────┤
│              COMPLIANCE LAYER                        │
│     (policy enforcement, autonomous revocation)     │
├─────────────────────────────────────────────────────┤
│                   TOOL LAYER                        │
│            (I/O, external APIs, computation)         │
└─────────────────────────────────────────────────────┘
```

**Each layer makes compliance autonomous:**
- **Orchestrator:** Goal decomposition respects constraint boundaries — agents can't be assigned tasks outside their authority
- **Agent Host:** Tool execution is policy-gated — agents self-enforce before every action
- **Compliance Layer:** Pheromone routing with security-weighted heuristics — agents self-organize within policy bounds
- **Tool Layer:** External I/O is identity-verified — every call is attributed and logged

**Existing foundation (queen/worker hierarchy):** Maps cleanly to orchestrator/agent host roles. Extension is additive, not a rewrite.

---

## Implementation Phases

| Phase | Name | ADR | Status |
|-------|------|-----|--------|
| 1.1 | Agent Identity Layer | — | ✅ Complete |
| 1.2 | Per-Agent Sandbox Policies | — | ✅ Complete |
| 1.3 | Behavioural Baseline | — | ✅ Complete |
| 1.4 | Kill Switch (Raft Consensus) | — | ✅ Complete |
| 2.1 | Pheromone Specialists | ADR-009 | ✅ Complete (APPROVED + IMPLEMENTED) |
| 2.2 | Security-Weighted Heuristic | ADR-010 | ✅ Complete (9/9 tests PASS) |
| 2.3 | Quality-Gated Reinforcement | ADR-011 | ✅ Complete (APPROVED + IMPLEMENTED) |
| 2.4 | Hot-Reload Policy | ADR-012 | ✅ Complete (APPROVED + IMPLEMENTED) |
| 3.1A | JWT Identity Provider | ADR-013 | ✅ Complete (27/27 tests PASS) |
| 3.1B | Behavioural Anomaly Detection | ADR-014 | ✅ Complete (14/14 tests PASS) |
| 3.1C | Tool Access Control | ADR-015 | ✅ Complete (40/40 tests PASS) |
| 3.1C | Compliance Mapping | ADR-016 | ✅ Complete (40/40 tests PASS) |
| 3.2 | Kill Switch Propagation | ADR-017 | ✅ Complete (APPROVED) |
| 3.3 | Decision-Chain Traceability | ADR-018 | ✅ Complete (APPROVED + IMPLEMENTED) |
| 3.4 | GitOps Agent-as-Code | ADR-019 | ✅ Complete (APPROVED, alert-only) |

**Phase 1 is complete** — all sub-phases (1.1–1.4) delivered and tested.

**Phase 2 is complete** — all ADRs (009–012) approved, implemented, and tested.

**Phase 3 is complete** — all ADRs (013–019) approved, implemented, and tested.

**Phase 4 is complete** — compliance mapping documented and aligned with CSA AI Controls Matrix.

---

## Autonomous Compliance Mapping

AWARE's phases map directly to CSA AI Controls Matrix requirements for autonomous agent systems:

| Phase | Capability | Compliance Coverage |
|-------|-----------|--------------------|
| Phase 1 (1.1–1.4) | Identity + Sandbox + Kill Switch | Agent identity governance, revocation chain controls |
| Phase 2 (2.1–2.4) | Pheromone Routing + Quality Gating | Secure routing with compliance-weighted heuristics |
| Phase 3 (3.1–3.4) | JWT IdP + Anomaly Detection + Tool Access | Policy enforcement, anomaly detection, self-documenting audit trails |
| Phase 4 | Compliance Mapping | CSA AI Controls Matrix alignment and documentation |

---

## Academic Backing

**AMRO-S** (arXiv:2603.12933) — Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimisation:

- Pheromone-based path selection across layered AI agent graphs
- Task-specific pheromone specialists prevent cross-task interference
- Quality-gated evolution reinforces only high-quality routing trajectories
- **4.7x speedup** over existing multi-agent routing with better accuracy

What AMRO-S does NOT address (AWARE's differentiation): security heuristics, identity governance, kill switches, compliance mapping, blast radius containment.

---

## Enterprise Context

| Vendor | Product | AWARE's Differentiation |
|--------|---------|------------------------|
| Vanta / Drata | Compliance software | They automate checklists. AWARE automates agent governance. Different problem. |
| Microsoft Agent 365 | Agent identity | Bio-inspired coordination at core, not bolted on. Open source. |
| Okta Agent Gateway | Agent access | Distributed kill switch via Raft consensus — not centralised. |
| Galileo Agent Control | Open runtime | Pheromone routing + autonomous compliance mapping on top. |

---

## Status

- [x] Phase 1: Complete (1.1–1.4 all delivered and tested)
- [x] Phase 2.2: COMPLETE (ADR-010, 9/9 tests PASS)
- [x] Phase 3: COMPLETE ✅
  - ADR-013 (Phase 3.1A): COMPLETE (27/27 tests PASS)
  - ADR-014 (Phase 3.1B): COMPLETE (14/14 tests PASS)
  - ADR-015 (Phase 3.1C): COMPLETE (40/40 tests PASS)
  - ADR-016 (Phase 3.2): COMPLETE (40/40 tests PASS)
  - ADR-017 (Phase 3.2/3.3): COMPLETE (2026-04-01 22:38 BST)
- [x] Phase 4: COMPLETE ✅ — Compliance matrix documented

---

## Quick Links

- [Evolution Brief](docs/EVOLUTION-BRIEF.md) — Full project direction and research
- [Architecture](AWARE-architect.md) — Detailed technical architecture
- [OpenAPI Spec](docs/openapi.yaml) — API reference
- [Compliance Matrix](docs/compliance-matrix.md) — Security and compliance mapping
- [Changelog](CHANGELOG.md) — Version history

---

## Stack

Node.js · Express.js · React · Material-UI · Docker · Nginx · Raft Consensus · Ant Colony Optimization
