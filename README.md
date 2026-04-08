# AWARE — Agentic AI Security Control Plane

**Project Key:** `aware`  
**Root:** `/opt/aware`  
**GitHub:** https://github.com/alvin-chang/AWARE  
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
│                    ORCHESTRATOR                     │
│        (goal decomposition, task assignment)        │
├─────────────────────────────────────────────────────┤
│                     AGENT HOST                      │
│          (tool execution, context, memory)          │
├─────────────────────────────────────────────────────┤
│                   SECURITY LAYER                    │
│       (policy enforcement, anomaly detection)       │
├─────────────────────────────────────────────────────┤
│                     TOOL LAYER                      │
│          (I/O, external APIs, computation)          │
└─────────────────────────────────────────────────────┘
```

**Existing foundation (queen/worker hierarchy):** Maps cleanly to orchestrator/agent host roles. Extension is additive, not a rewrite.

---

## Quick Start

### Prerequisites

- Node.js ≥ 14.0.0
- npm ≥ 6.0.0
- Docker & Docker Compose (for containerized deployment)

### Local Development

```bash
# Clone the repository
git clone https://github.com/alvin-chang/AWARE.git
cd AWARE

# Install dependencies
npm install

# Start the backend server
npm start

# In a separate terminal, run tests
npm test

# Start the React UI (optional)
npm run ui-dev
```

### Docker Deployment

```bash
# Build and run all services (backend + UI)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The UI is served by **Nginx** on **port 3001** (configured in `docker-compose.yml`).
To build the UI Docker image separately:

```bash
docker build -f Dockerfile.ui -t aware-ui .
docker run -p 3001:80 aware-ui
```

### UI

The React UI runs on **port 3001** and connects to the API at port 3000.

```bash
# Install UI dependencies
npm run ui-install

# Start UI in development mode
npm run ui-dev

# Build UI for production
npm run ui-build
```

Configure UI via `src/ui/.env`:
- `PORT` — UI port (default: 3001)
- `REACT_APP_API_URL` — Backend API URL (default: /api)

### Deployment Scripts

```bash
# Deploy with Docker Compose (full stack)
./deploy.sh

# Deploy with custom environment file
./deploy.sh --env-file .env.production

# Deploy without rebuilding images
./deploy.sh --no-build

# Stop containers and redeploy
./deploy.sh --down
```

### Kubernetes Deployment

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s-deployment.yaml

# Check deployment status
kubectl get pods -l app=aware-backend
kubectl get pods -l app=aware-frontend
```

The k8s manifests create:
- Backend service (`aware-backend`) on port 3000
- Frontend service (`aware-frontend`) on port 80/3001
- Secret (`aware-secrets`) for JWT signing key

Replace the base64-encoded `SECRET_KEY` in the Secret before deploying.

### Configuration

Set these environment variables before starting:

| Variable | Description | Required |
|----------|-------------|----------|
| `SECRET_KEY` | JWT signing secret (min 32 chars) | Yes |
| `NODE_ID` | Unique node identifier | Auto-generated |
| `API_PORT` | API server port (default: 3000) | No |

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

**Phase 4 is complete** — compliance mapping documented.

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
- [OpenAPI Spec](docs/openapi.yaml) — API reference
- [Compliance Matrix](docs/compliance-matrix.md) — Security and compliance mapping
- [Changelog](CHANGELOG.md) — Version history

---

## Stack

Node.js · Express.js · React · Material-UI · Docker · Nginx · Raft Consensus · Ant Colony Optimization
