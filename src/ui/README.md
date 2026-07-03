# AWARE — Security Control Plane UI

The web-based user interface for AWARE (**Adaptive Workflow Agent with Recursive Evolution**) — operating across compliance, customer support, and software engineering domains.

## Overview

This React-based application provides a security operations dashboard for managing AI agent trust, constraint enforcement, kill switch controls, anomaly detection, compliance mapping, and audit trail traceability.

## Features

- **Agent Identity Dashboard** — Trust scores, cryptographic credentials, capability claims
- **Constraint Enforcement** — T0–T4 constraint tier visibility and status
- **Kill Switch Controls** — Emergency shutdown and agent revocation
- **Anomaly Detection Alerts** — Behavioral deviation monitoring with baseline comparison
- **Compliance Mapping** — ISO 27001, SOC 2, GDPR, AI Act framework coverage
- **Audit Trail Viewer** — Decision chain traceability and routing decision history

## Tech Stack

- React 18 + React Router v6
- Material UI (MUI) — dark theme
- Redux Toolkit — agents, alerts, compliance, audit slices
- Recharts — metrics visualisation
- WebSocket — real-time event streaming

## Prerequisites

Before running this application, ensure you have:

- Node.js (version 16 or higher)
- npm or yarn package manager
- Access to the AWARE API backend
- AWARE backend WebSocket endpoint (for real-time events)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Install dependencies:
   ```bash
   cd src/ui && npm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your API and WebSocket URLs
   ```

4. Start the development server:
   ```bash
   npm start
   ```

## Production

Build and deploy with Docker:
```bash
docker build -f Dockerfile.ui -t aware-ui .
docker run -p 80:80 aware-ui
```

nginx is configured for SPA routing.
