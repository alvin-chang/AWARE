# AWARE Architecture — v2.0

> **Version:** 2.0
> **Date:** 2026-04-12
> **Status:** Architecture updated per Alvin directive — ant routing removed, ATD merged as frontend

---

## Overview

**AWARE (Autonomous Warehouse Automated Resource Engine)** is now a **security-first agentic AI platform** — a control plane for governing autonomous AI agents in production.

**Positioning:** "AWARE — the security-first agentic AI platform"
**Target buyer:** CISO, AI safety leads, compliance teams

---

## What Was Removed (v1 → v2)

| Removed | Reason |
|---------|--------|
| Ant colony optimization (AMRO-S pheromone routing) | Academic exploration, not customer-validated |
| Raft consensus for resource routing | Over-engineered for current scope |
| General-purpose distributed coordination | Not part of security control plane focus |

---

## What Stays (v2 Core)

| Component | Purpose |
|-----------|---------|
| Security constraint engine | T0-T4 constraint definitions and enforcement |
| Circuit breakers | Fail-fast on policy violations |
| Anomaly detection | Detect deviation from expected agent behavior |
| Kill switches | Emergency stop for agent operations |
| ATD React dashboard | Visualization layer (merged from agent-tactical-display) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AWARE Platform                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ATD Frontend (React)                    │   │
│  │  ~/src/AWARE/frontend/                              │   │
│  │  Security dashboard, agent map, constraint editor   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            │ REST / WebSocket              │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              AWARE Backend (Node.js)                 │   │
│  │  ~/src/AWARE/backend/                               │   │
│  │                                                       │   │
│  │  • Constraint engine (T0-T4 definitions)             │   │
│  │  • Circuit breaker logic                            │   │
│  │  • Anomaly detection                                │   │
│  │  • Kill switch manager                              │   │
│  │  • Event ingestion from OpenClaw gateways          │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            │ Policy enforcement             │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           OpenClaw Agent Layer                       │   │
│  │  Agents operate within AWARE security constraints    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ATD Merge

**Source:** `~/.openclaw/projects/agent-tactical-display/` (standalone ATD project)
**Destination:** `~/src/AWARE/frontend/`

ATD was the React dashboard for agent tactical display. Per Alvin directive 2026-04-12, ATD becomes AWARE's visualization layer:
- ATD's React frontend moves to `~/src/AWARE/frontend/`
- ATD's backend (PostgreSQL + Redis + Stripe billing) is deprioritized — AWARE backend takes priority
- Positioning shifts from "standalone SaaS" to "AWARE's frontend"

---

## Security Control Plane Features

### T0-T4 Constraint Framework

| Tier | Constraint Type | Example |
|------|----------------|---------|
| T0 | Hard block | Never execute shell commands |
| T1 | Require approval | External network calls need confirmation |
| T2 | Log and alert | File system writes trigger notification |
| T3 | Monitor only | Read operations are logged |
| T4 | Audit trail | Full context capture for compliance |

### Circuit Breakers

- **Constraint violation** → agent operation halted
- **Anomaly detected** → agent paused, alert sent
- **Kill switch triggered** → all agent operations stop immediately

### Anomaly Detection

- Monitor agent behavior against baseline
- Detect: excessive retries, unexpected tool calls, deviation from task scope
- Alert via dashboard + webhook

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Flow |
| Backend | Node.js, Express.js |
| Database | SQLite (embedded) or PostgreSQL |
| Event ingestion | WebSocket/SSE from OpenClaw gateways |
| Auth | JWT-based (integrates with OpenClaw auth) |

---

## Project Structure

```
~/src/AWARE/
├── AWARE-architect.md      ← This file (architecture spec)
├── frontend/                 ← ATD React dashboard (merged)
│   ├── src/
│   ├── package.json
│   └── ...
├── backend/                  ← Security control plane backend
│   ├── src/
│   │   ├── constraints/     ← T0-T4 constraint engine
│   │   ├── circuit-breakers/← Circuit breaker logic
│   │   ├── anomaly/         ← Anomaly detection
│   │   └── killswitch/      ← Kill switch manager
│   └── ...
└── docs/
```

---

## Out of Scope (v2)

- General-purpose task orchestration
- Multi-agent coordination algorithms
- Distributed consensus (Raft/etc.)
- Non-security resource routing

---

*Archimedes — 2026-04-12*
