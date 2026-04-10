# AWARE User Guide

**AWARE** — Agentic AI Security Control Plane

This guide covers the web interface for managing AWARE clusters, nodes, and monitoring.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [User Account Management](#user-account-management)
3. [Dashboard](#dashboard)
4. [Clusters](#clusters)
5. [Nodes](#nodes)
6. [Monitoring](#monitoring)
7. [Alerts](#alerts)
8. [Configuration](#configuration)
9. [API Reference](#api-reference)

---

## Getting Started

### Accessing the UI

After deployment, the AWARE UI is available at:

- **URL:** `http://localhost:3001` (local Docker deployment)
- **API:** `http://localhost:3000` (backend directly)

### First-Time Setup

1. Navigate to the AWARE UI
2. Click **Register** to create your first account
3. After registration, you are automatically logged in

---

## User Account Management

### Registration

Create a new account at `/register`:

| Field | Requirements |
|-------|-------------|
| Username | Required, unique |
| Email | Required, valid email format |
| Password | Min 8 characters, must include uppercase, lowercase, number, and special character |
| Confirm Password | Must match password |

After successful registration, you are redirected to the Dashboard.

### Login

Sign in at `/login` with your credentials:

- Username or email
- Password

On successful login, you are redirected to the Dashboard.

### Logout

Click your user menu and select **Logout** to end your session.

---

## Dashboard

The Dashboard provides a real-time overview of your AWARE cluster:

### Summary Cards

| Metric | Description |
|--------|-------------|
| Active Clusters | Number of clusters with active status |
| Total Nodes | Connected node count |
| Avg Response Time | Average API response time (ms) |
| System Status | Overall health indicator |

### Components

- **Cluster Health Overview** — Health status of all clusters
- **Node Connectivity Status** — Connection status of all discovered nodes
- **Resource Selection** — Filter and select specific resources for detailed status

The Dashboard auto-refreshes every 30 seconds.

---

## Clusters

Manage your AWARE clusters at `/clusters`.

### View Clusters

The Clusters page lists all clusters with:

- **Name** — Cluster identifier
- **Status** — `active` (healthy), `warning`, or `error`
- **Node Count** — Number of nodes in the cluster
- **Leader** — Whether this node is the Raft leader

### Create a Cluster

Click **Create Cluster** to open the cluster creation wizard:

1. Enter cluster name
2. Configure cluster parameters
3. Submit

The new cluster appears in the list immediately.

### Cluster States

| State | Meaning |
|-------|---------|
| `active` | Cluster is healthy and operational |
| `warning` | Cluster has degraded performance or partial connectivity |
| `error` | Cluster is unavailable or unreachable |

---

## Nodes

View and manage nodes at `/nodes`.

### Node Types

| Role | Description |
|------|-------------|
| **Queen** | Leader node that coordinates the cluster via Raft consensus |
| **Worker** | Standard node that executes tasks and communicates with the queen |

### Self Node

The **Self Node** is the local AWARE instance you are connected to. It displays:

- Node ID
- Role (Queen or Worker)
- Connection status
- Last seen timestamp

### Discovered Nodes

Other AWARE nodes discovered on the network are listed under **Discovered Nodes**. Each shows:

- Node ID
- Role
- Status (`connected` or `disconnected`)
- IP address
- Last seen timestamp

### Refresh Nodes

Click **Refresh** to manually poll for the latest node status.

---

## Monitoring

View system metrics at `/monitoring`.

### Available Metrics

- **CPU Usage** — Per-node CPU utilization
- **Memory Usage** — Per-node memory consumption
- **Network Traffic** — Inter-node communication volume
- **Response Times** — API response latency histograms

Metrics are fetched from the backend and cached for 5 seconds to reduce load.

### Filtering

Use the time-range selector to view metrics over different periods:

- Last 5 minutes
- Last 15 minutes
- Last hour
- Last 24 hours

---

## Alerts

Manage system alerts at `/alerts`.

### Alert Levels

| Level | Description |
|-------|-------------|
| **Critical** | Immediate attention required |
| **Warning** | Degraded performance or pending issue |
| **Info** | Informational events |

### Filtering Alerts

Use the filter panel to narrow alerts by:

- Severity level
- Time range
- Node or cluster

### Alert Actions

- **View Details** — Click an alert to see full details
- **Acknowledge** — Mark an alert as seen
- **Resolve** — Clear a resolved alert

---

## Configuration

Manage system settings at `/configuration`.

### Cluster Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| Cluster Name | Human-readable cluster identifier | `AWARE Cluster` |
| Leader Election Timeout | Raft election timeout (ms) | `5000` |
| Heartbeat Interval | Node heartbeat interval (ms) | `1000` |

### Security Settings

| Parameter | Description |
|-----------|-------------|
| JWT Expiry | Token expiration time |
| Session Timeout | Inactive session timeout |

Changes to configuration take effect immediately without restart.

---

## API Reference

AWARE provides a REST API at `/api`. All endpoints (except `/login` and `/register`) require JWT authentication.

### Authentication

Include the JWT token in the `Authorization` header:

```
Authorization: Bearer <your_token>
```

### Endpoints

#### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/login` | Authenticate and receive JWT token |
| `POST` | `/register` | Create new user account |
| `GET` | `/api/current-user` | Get current user info |

#### Clusters

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cluster/status` | Get cluster status |
| `GET` | `/api/cluster/config` | Get cluster configuration |
| `PUT` | `/api/cluster/config` | Update cluster configuration |
| `POST` | `/api/cluster` | Create a new cluster |
| `GET` | `/api/cluster/metrics` | Get cluster metrics |
| `GET` | `/api/cluster/events` | Get cluster events |

#### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/nodes` | List all nodes |
| `GET` | `/api/nodes/:id` | Get specific node |
| `PUT` | `/api/nodes/:id` | Update node configuration |
| `POST` | `/api/nodes/:id/health-check` | Trigger node health check |

#### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/alerts` | List alerts (supports `?level=`, `?nodeId=`) |
| `GET` | `/api/alerts/:id` | Get specific alert |
| `POST` | `/api/alerts` | Create a new alert |
| `PUT` | `/api/alerts/:id` | Update an alert |

#### Resources

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/resources` | List all resources |
| `GET` | `/api/resources/:id` | Get specific resource |
| `PUT` | `/api/resources/:id` | Update resource configuration |

### Response Format

Successful responses:

```json
{
  "data": { ... }
}
```

Error responses:

```json
{
  "error": "Error message description"
}
```

---

## Troubleshooting

### Registration Fails

- Ensure all fields meet the requirements
- Check that the backend is running (`docker compose logs aware-backend`)
- Verify the `/register` nginx proxy is configured

### Dashboard Shows No Data

- Confirm the backend is healthy and reachable
- Check browser console for API errors
- Verify JWT token is valid (try logging out and back in)

### Nodes Not Discovered

- Ensure other AWARE instances are running
- Check network connectivity between nodes
- Verify firewall allows inter-node communication

### API Returns 401 Unauthorized

- Your session has expired — log out and log back in
- The JWT token may be malformed — clear local storage and re-authenticate

---

## Architecture Overview

AWARE uses a layered architecture:

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

### Raft Consensus

AWARE uses Raft consensus for leader election in multi-node clusters:

- One **Queen** (leader) node coordinates operations
- **Workers** replicate state from the Queen
- Automatic failover if the Queen becomes unavailable

In single-node mode, the node becomes leader immediately without election.

---

For more details, see the [README](../README.md) and [OpenAPI specification](openapi.yaml).
