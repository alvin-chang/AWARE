# AWARE — Agentic AI Security Control Plane

**AWARE** secures autonomous AI agents before they become your biggest attack surface.

- **GitHub:** https://github.com/GoodCISO/aware
- **Product:** https://goodciso.org
- **License:** GPL-3.0

---

## The Problem

Your organisation is deploying AI agents — autonomous workflows, agentic AI, copilots with tool access. Each one is a non-human identity with credentials, permissions, and the ability to call external APIs.

**Who controls them?**

Traditional identity platforms weren't built for agents. They don't understand tool-call authorisation, behavioural drift, or the blast radius when an agent goes rogue.

## What AWARE Does

AWARE is an **open-source security control plane for autonomous AI agents**. It sits between your agents and their tools — enforcing identity, authorisation, behavioural constraints, and kill-switch capability across your entire agent fleet.

| Capability | What It Does |
|---|---|
| **Agent Identity** | Every agent gets cryptographic credentials, capability claims, and trust scoring (NHI for AI) |
| **Tool Contracts** | Per-agent authorisation — who can call what, under what conditions |
| **Constraint Enforcement** | T0–T4 security constraints: data exfiltration blocking, human-in-the-loop gates, cryptographic identity, append-only audit trails |
| **Behavioural Anomaly Detection** | Baselines normal agent behaviour and flags deviations |
| **Kill Switch** | Distributed emergency shutdown via Raft consensus — revoke all agent access instantly |
| **Observable Decision Trails** | Every routing decision logged with rationale — interpretable for debugging and compliance |

## How It Works

```
┌─────────────────────────────────────────────┐
│              YOUR AI AGENTS                 │
├─────────────────────────────────────────────┤
│              AWARE CONTROL PLANE            │
│  Identity → Authorisation → Constraints     │
│  Monitoring → Anomaly Detection → Kill      │
├─────────────────────────────────────────────┤
│              YOUR TOOLS & APIS              │
└─────────────────────────────────────────────┘
```

AWARE uses bio-inspired coordination algorithms (ant colony optimisation) to route agent tasks through the right security controls — self-organising under constraint, not bolted on as an afterthought.

## Who It's For

- **Security teams** deploying AI agents who need governance without slowing delivery
- **Compliance officers** requiring auditable decision trails for AI tool usage
- **Engineering leaders** running multi-agent systems who need kill-switch capability
- **Regulated industries** (finance, healthcare, legal) where AI agent activity must be traceable

## Get Started

### Quick Start (Docker)

```bash
git clone https://github.com/GoodCISO/aware.git
cd aware
docker compose up -d
```

The API runs on port 3000. The UI is on port 3001.

### Local Development

```bash
npm install
npm start
npm test
```

### Configuration

| Variable | Description |
|---|---|
| `SECRET_KEY` | JWT signing secret (min 32 chars) |
| `NODE_ID` | Unique node identifier (auto-generated) |
| `API_PORT` | API server port (default: 3000) |

## Enterprise

AWARE is open-source under GPL-3.0. For enterprise support, hosted deployment, and SLAs:

→ **[goodciso.org](https://goodciso.org)**

## Why Open Source?

Agent security shouldn't be a black box. Every security control, every policy decision, every kill-switch trigger — auditable, reviewable, and verifiable. Open-source is the only way to build trust in agent security.

## Status

All core phases complete. Active development continues.

| Component | Status |
|---|---|
| Agent Identity & Auth | ✅ Complete |
| Tool Access Control | ✅ Complete |
| Behavioural Anomaly Detection | ✅ Complete |
| Kill Switch (Raft Consensus) | ✅ Complete |
| Compliance Mapping | ✅ Complete |
| Constraint Enforcement (T0–T4) | ✅ Complete |

**Latest release:** See [CHANGELOG.md](CHANGELOG.md)

## Architecture Decisions

All architectural decisions are documented and publicly reviewable in `docs/adr/`. Each ADR has been formally reviewed and approved.

| ADR | Topic | Verdict |
|---|---|---|
| 009 | Pheromone Specialists | ✅ APPROVED |
| 010 | Security-Weighted Heuristic | ✅ APPROVED |
| 011 | Quality-Gated Reinforcement | ✅ APPROVED |
| 012 | Hot-Reload Policy Mechanism | ✅ APPROVED |
| 013 | Agent Identity Authentication | ✅ APPROVED |
| 014 | Behavioural Anomaly Detection | ✅ APPROVED |
| 015 | Tool Access Control | ✅ APPROVED |
| 016 | Compliance Mapping | ✅ APPROVED |
| 017 | Kill Switch Propagation | ✅ APPROVED |
| 018 | Decision-Chain Traceability | ✅ APPROVED |
| 019 | GitOps Agent-as-Code | ✅ APPROVED |

## Academic Backing

**AMRO-S** (arXiv:2603.12933) — Ant colony optimisation for multi-agent LLM routing. 4.7x speedup over existing approaches.

## Competitor Comparison

| Vendor | Product | AWARE Advantage |
|---|---|---|
| Microsoft Agent 365 | NHI management, shadow AI detection | Bio-inspired coordination at core, not bolted on |
| Okta Agent Gateway | Agent-as-identity, kill switch | Distributed kill-switch via Raft consensus |
| Galileo Agent Control | Open-source runtime control plane | Pheromone routing + compliance mapping |

## Quick Links

- [Product & Enterprise](https://goodciso.org)
- [Evolution Brief](docs/EVOLUTION-BRIEF.md)
- [OpenAPI Spec](docs/openapi.yaml)
- [Compliance Matrix](docs/compliance-matrix.md)
- [Changelog](CHANGELOG.md)

## Stack

Node.js · Express.js · React · Docker · Raft Consensus · Ant Colony Optimisation