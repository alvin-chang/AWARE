# AWARE — Agentic AI Security Control Plane

**Project Key:** `aware`  
**Root:** `~/src/AWARE`  
**Gitea (primary):** http://openclaw.local:3000/alvin/AWARE  
**GitHub (read-only mirror):** https://github.com/alvin-chang/AWARE  
**License:** GPL-3.0

> **All agents push to Gitea only.** GitHub is a read-only public mirror. Never push directly to GitHub.

---

## What AWARE Is

AWARE is evolving into an **open-source agentic AI security control plane** — the open alternative to Microsoft Agent 365 and Okta Agent Gateway.

AWARE's core primitive is **bio-inspired coordination** (ant colony optimization). This isn't a bolt-on feature — it's the foundation for how autonomous agents route tasks, share learnings, and self-organize under security constraints.

**Core thesis:** Bio-inspired coordination algorithms are the right primitive for autonomous agent orchestration and security. Pheromone-based routing, distributed consensus, and self-healing topologies translate directly to agent governance.

---

## Key Differentiators (AWARE Evolution Research)

| Pattern | Description |
|---------|-------------|
| **Modularity with Explicit Interfaces** | Each layer (orchestrator, agent host, security, tools) evolves independently |
| **Identity-First Security** | Every agent has NHI (Non-Human Identity) with cryptographic credentials, capability claims, and trust scoring |
| **Explicit Tool Contracts** | Per-agent authorization specifying who can call what, under what conditions |
| **Observable Decision Trails** | Every routing decision logged with rationale — interpretable for debugging and compliance |
| **Quality-Gated Pheromone Evolution** | Only high-quality routing trajectories get reinforced (AMRO-S research, 4.7x speedup) |

---

## Architecture

AWARE implements a layered architecture:

```
┌─────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                      │
│         (goal decomposition, task assignment)       │
├─────────────────────────────────────────────────────┤
│                   AGENT HOST                         │
│          (tool execution, context, memory)          │
├─────────────────────────────────────────────────────┤
│              SECURITY LAYER                          │
│     (policy enforcement, anomaly detection)          │
├─────────────────────────────────────────────────────┤
│                   TOOL LAYER                        │
│            (I/O, external APIs, computation)         │
└─────────────────────────────────────────────────────┘
```

**Existing foundation (queen/worker hierarchy):** Maps cleanly to orchestrator/agent host roles. Extension is additive, not a rewrite.

---

## Implementation Phases

| Phase | Name | ADR | Status |
|-------|------|-----|--------|
| 1.1 | Agent Identity Layer | — | ✅ Complete |
| 1.2 | Per-Agent Sandbox Policies | — | ✅ Complete |
| 1.3 | Behavioural Baseline | — | ✅ Complete |
| 1.4 | Kill Switch (Raft Consensus) | — | ✅ Complete |
| 2.1 | Pheromone Specialists | ADR-009 | 🔄 In Progress (DRAFT) |
| 2.2 | Security-Weighted Heuristic | ADR-010 | ✅ Complete (9/9 tests PASS) |
| 3.1A | JWT Identity Provider | ADR-013 | ✅ Complete (27/27 tests PASS) |
| 3.1B | Behavioural Anomaly Detection | ADR-014 | ✅ Complete (14/14 tests PASS) |
| 3.1C | Tool Access Control | ADR-015 | ✅ Complete (40/40 tests PASS) |
| 3.1C | Compliance Mapping | ADR-016 | ✅ Complete (40/40 tests PASS) |
| 3.2/3.3 | Kill Switch Propagation | ADR-017 | ✅ Complete |

**Phase 1 is complete** — all sub-phases (1.1–1.4) delivered and tested.

**Phase 2.2 (ADR-010) is complete** — security-weighted heuristic implemented and tested.

**Phase 3 is complete** — all ADRs (013–017) approved, implemented, and tested.

**Phase 2.1 (ADR-009) is in progress** — pheromone specialists DRAFT.

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

| Vendor | Product | AWARE Advantage |
|--------|---------|-----------------|
| Microsoft Agent 365 | NHI management, shadow AI detection, universal agent logout | Bio-inspired coordination at core, not bolted on |
| Okta Agent Gateway | Agent-as-identity, tool-call authorisation, kill switch | Distributed kill-switch via Raft consensus (vs centralized) |
| Galileo Agent Control | Open-source runtime control plane, hot-reloadable policies | Pheromone routing + compliance mapping on top |

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
