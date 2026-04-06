# AWARE Architecture

**Version:** 1.0
**Last Updated:** 2026-04-06
**Project Key:** aware

---

## Overview

AWARE (Autonomous Warehouse Automated Resource Engine) is a production-deployed autonomous distributed systems platform using bio-inspired coordination algorithms. The system implements Raft consensus for leader election, ant colony optimization for resource routing, and provides a React-based monitoring dashboard.

---

## System Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    AWARE Platform                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Frontend   │  │   Backend   │  │  Node Agents     │ │
│  │  (React +   │  │  (Express   │  │  (Coordination   │ │
│  │  Material-  │  │  + Node.js) │  │   + Discovery)  │ │
│  │  UI)        │  │             │  │                 │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
│         │                │                    │         │
│         └────────────────┼────────────────────┘         │
│                          │                               │
│              ┌───────────▼───────────┐                  │
│              │    Raft Consensus      │                  │
│              │    (Leader Election)    │                  │
│              └───────────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Material-UI, React Router |
| Backend | Node.js, Express.js |
| Database | SQLite (embedded), file-based persistence |
| Consensus | Raft (leader election, log replication) |
| Coordination | Ant Colony Optimization (pheromone-based routing) |
| Container | Docker, Docker Compose |
| Reverse Proxy | Nginx |
| API | REST, OpenAPI 3.0 |

---

## Backend Architecture

### API Layer (`/api`)

- **Authentication:** JWT-based with role-based access control (RBAC)
- **Endpoints:**
  - `/api/auth/*` — Authentication (login, register, refresh)
  - `/api/nodes/*` — Node management and status
  - `/api/cluster/*` — Cluster operations and health
  - `/api/jwt/*` — JWT token management

### Node Coordination

- **Discovery Protocol:** UDP-based node discovery on configurable ports
- **Heartbeat:** Periodic health checks from leader to followers
- **Leader Election:** Raft consensus for automatic failover
- **State Replication:** Log-based state machine replication

### Security Model

- JWT tokens with configurable expiry
- Role-based permissions: `admin`, `operator`, `viewer`
- Pheromone-based routing with quality-gated evolution

---

## Frontend Architecture

### Dashboard Features

- **Cluster Overview:** Real-time node status and cluster health
- **Node Manager:** Add, remove, and configure nodes
- **Alert Viewer:** System alerts and notifications
- **Metrics Display:** Resource utilization and performance metrics

### State Management

- React Context for global state
- React Query for server state synchronization
- Local storage for user preferences

---

## Data Flow

```
Client Request
      │
      ▼
┌─────────────┐
│    Nginx    │ ─── Static assets (frontend)
│   (Port     │
│   3001)     │
└─────────────┘
      │
      ▼ (proxy to backend)
┌─────────────┐     ┌──────────────┐
│  Express    │────▶│  Raft Node    │
│  API Server │     │  (Leader)     │
└─────────────┘     └──────────────┘
                           │
                           ▼ (replicate)
                    ┌──────────────┐
                    │ Follower     │
                    │ Nodes        │
                    └──────────────┘
```

---

## Deployment

### Docker Compose

```yaml
services:
  aware-backend:
    build: .
    ports:
      - "${API_PORT:-3000}:${API_PORT:-3000}"
    environment:
      - NODE_ID=${NODE_ID:-node-1}
      - DISCOVERY_PORT=${DISCOVERY_PORT:-41234}
      - SECRET_KEY=${SECRET_KEY}
    volumes:
      - ./data:/app/data

  aware-frontend:
    build:
      context: .
      dockerfile: Dockerfile.ui
    ports:
      - "3001:80"
    environment:
      - REACT_APP_API_URL=${REACT_APP_API_URL}
```

### Environment Variables

See `.env.production` for full configuration:

- `NODE_ID` — Unique node identifier
- `API_PORT` — Backend API port (default: 3000)
- `DISCOVERY_PORT` — UDP discovery port (default: 41234)
- `BROADCAST_PORT` — UDP broadcast port (default: 41235)
- `SECRET_KEY` — JWT signing secret
- `REACT_APP_API_URL` — Frontend API endpoint

---

## Security Considerations

1. **Authentication:** JWT with short-lived access tokens
2. **Authorization:** Role-based access control
3. **Network:** Nodes communicate on internal network only
4. **Secrets:** Never commit `.env.production` to version control
5. **Pheromone Validation:** Quality-gated evolution prevents routing drift

---

## API Reference

Full OpenAPI specification: [`docs/openapi.yaml`](docs/openapi.yaml)

---

## Related Documentation

- [Evolution Brief](docs/EVOLUTION-BRIEF.md) — Project direction and research
- [OpenAPI Spec](docs/openapi.yaml) — API reference
- [Compliance Matrix](docs/compliance-matrix.md) — Security and compliance mapping
