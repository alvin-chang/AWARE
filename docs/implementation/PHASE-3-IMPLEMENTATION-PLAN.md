# AWARE Phase 3 Implementation Plan

**Author:** Archimedes  
**Date:** 2026-04-01  
**Status:** DRAFT  
**For:** Forge (implementation), Critor (review), Quinn (testing)  

---

## Overview

Phase 3 implements the **Security Control Plane** for AWARE. All 5 ADRs (013-017) are complete. This document maps the implementation sequence, dependencies, and technical requirements.

---

## Dependency Graph

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    PHASE 1 (COMPLETE)                  │
                    │   Phase 1.1 Identity   Phase 1.3 Baseline   Phase 1.4    │
                    │   (JWT, sessions)     (trust_score)         (Kill Switch)│
                    └──────────────────────────────────────────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                              ▼
    ┌───────────────────────────┐              ┌─────────────────────────────┐
    │   ADR-013 (Identity)      │              │   ADR-011 (Gated Update)   │
    │   JWT Claims, Credentials │              │   (Quality Gate)           │
    │   Session Binding         │              │   NOT REQ'D FOR P3         │
    │   Attestation            │              └─────────────────────────────┘
    └───────────┬───────────────┘
                │
    ┌───────────┴───────────────┐
    ▼                           ▼
┌───────────────┐     ┌───────────────────────┐
│ ADR-014      │     │ ADR-015               │
│ (Behavioural)│     │ (Tool Access)         │
│ Baseline,    │◀────│ Depends: ADR-013      │
│ Z-score,     │     │ Parallel with 014     │
│ trust_score  │     └───────────┬───────────┘
└───────┬───────┘                 │
        │                         │
        └────────────┬────────────┘
                     ▼
         ┌───────────────────────────┐
         │ ADR-017 (Kill Switch)     │
         │ Propagation, Shutdown     │
         │ Depends: 013, 014, 015     │
         └───────────┬───────────────┘
                     │
         ┌───────────┴───────────────┐
         ▼                           ▼
   ┌───────────────┐     ┌───────────────────────┐
   │ ADR-016       │     │ FUTURE:               │
   │ (Compliance)  │     │ ADR-009/010/011/012   │
   │ Depends: ALL  │     │ (Phase 2 routing)     │
   └───────────────┘     └───────────────────────┘
```

---

## Implementation Sequence

### Phase 3.1A: ADR-013 — Agent Identity & Authentication Framework
**Priority:** P0 (BLOCKING)  
**Dependencies:** Phase 1.1 (existing)  
**Estimated Effort:** Medium  

**What to build:**

| Component | File | Purpose |
|-----------|------|---------|
| NHI Lifecycle Manager | `src/identity/nhi-lifecycle.js` | Agent state machine (PENDING→ACTIVE→SUSPENDED→REVOKED) |
| JWT Claims Extension | `src/auth/extended-claims.js` | Add SPIFFE ID, role, permissions, trust_level to JWT |
| Credential Rotator | `src/identity/credential-rotator.js` | Zero-downtime credential rotation |
| Session Binder | `src/identity/session-binder.js` | Bind sessions to execution context |
| Attestation Service | `src/identity/attestation-service.js` | Cross-agent verification |
| Revocation Cache | `src/identity/revocation-cache.js` | Distributed revocation with blast radius |

**API Endpoints:**
- `POST /api/identity/agents/:agentId/attest` — Request attestation
- `POST /api/identity/agents/:agentId/rotate-credentials` — Rotate credentials
- `GET /api/identity/agents/:agentId/status` — Get agent identity status

**Database Schema:**

```sql
-- Agent identity state
CREATE TABLE agent_identities (
  agent_id VARCHAR(255) PRIMARY KEY,
  spiffe_id VARCHAR(255) NOT NULL UNIQUE,
  state ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED') DEFAULT 'PENDING',
  trust_level DECIMAL(3,2) DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Credential rotation state
CREATE TABLE agent_credentials (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255) REFERENCES agent_identities(agent_id),
  credential_type VARCHAR(50),
  current_credential TEXT,
  previous_credential TEXT,
  rotated_at TIMESTAMP,
  expires_at TIMESTAMP
);

-- Attestation records
CREATE TABLE attestations (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255),
  attested_by VARCHAR(255),
  attested_at TIMESTAMP DEFAULT NOW(),
  result JSONB,
  UNIQUE(agent_id, attested_by)
);

-- Revocation cache
CREATE TABLE revocation_cache (
  agent_id VARCHAR(255) PRIMARY KEY,
  revoked_at TIMESTAMP DEFAULT NOW(),
  revoked_by VARCHAR(255),
  reason TEXT,
  blast_radius INTEGER DEFAULT 0
);
```

**Why first:** All other Phase 3 components depend on knowing WHO an agent is before they can monitor behaviour (014), enforce tools (015), or propagate kill signals (017).

---

### Phase 3.1B: ADR-014 — Behavioural Anomaly Detection & Baseline
**Priority:** P0  
**Dependencies:** ADR-013 (Identity), ADR-010 (Trust Score)  
**Estimated Effort:** Medium  

**What to build:**

| Component | File | Purpose |
|-----------|------|---------|
| Behavioural Monitor | `src/monitoring/behavioural-monitor.js` | Collect metrics across 5 dimensions |
| Baseline Store | `src/monitoring/baseline-store.js` | Per-agent baseline profiles |
| Z-Score Calculator | `src/monitoring/zscore-calculator.js` | Anomaly scoring per dimension |
| Anomaly Alert Service | `src/monitoring/anomaly-alert.js` | Alert generation and escalation |
| Trust Score Deriver | `src/monitoring/trust-deriver.js` | Derive trust_score from anomaly data |

**5 Behavioural Dimensions:**
1. **Tool Usage** — Which tools called, frequency, sequence patterns
2. **API Calls** — Request rate, endpoints hit, error rates
3. **Data Access** — Files accessed, data volume, patterns
4. **Timing** — Session duration, activity patterns, latency
5. **Capabilities** — Endpoint access, permission usage, escalation attempts

**API Endpoints:**
- `GET /api/monitoring/agents/:agentId/baseline` — Get baseline profile
- `GET /api/monitoring/agents/:agentId/anomaly-score` — Get current Z-scores
- `POST /api/monitoring/agents/:agentId/alert` — Trigger alert
- `GET /api/monitoring/alerts?severity=HIGH` — Query alerts

**Database Schema:**

```sql
-- Behavioural baselines
CREATE TABLE behavioural_baselines (
  agent_id VARCHAR(255) PRIMARY KEY,
  dimension VARCHAR(50),  -- 'tool_usage', 'api_calls', 'data_access', 'timing', 'capabilities'
  mean DECIMAL(10,4),
  stddev DECIMAL(10,4),
  last_updated TIMESTAMP DEFAULT NOW(),
  sample_size INTEGER DEFAULT 0,
  UNIQUE(agent_id, dimension)
);

-- Anomaly events
CREATE TABLE anomaly_events (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255),
  dimension VARCHAR(50),
  z_score DECIMAL(6,3),
  raw_value DECIMAL(10,4),
  detected_at TIMESTAMP DEFAULT NOW(),
  severity ENUM('INFO', 'WARNING', 'HIGH', 'CRITICAL')
);

-- Trust score history
CREATE TABLE trust_scores (
  agent_id VARCHAR(255),
  score DECIMAL(3,2),
  trend ENUM('IMPROVING', 'STABLE', 'DEGRADING'),
  calculated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (agent_id, calculated_at)
);
```

**Why parallel with 015:** ADR-015 (Tool Access) needs behavioural context to make intelligent allow/deny decisions. They can be built in parallel once ADR-013 is complete.

---

### Phase 3.1C: ADR-015 — Tool Access Control & Enforcement
**Priority:** P0  
**Dependencies:** ADR-013 (Identity), ADR-014 (Behavioural)  
**Estimated Effort:** Medium  

**What to build:**

| Component | File | Purpose |
|-----------|------|---------|
| Tool Registry | `src/tools/registry.js` | Tool definitions with categories, risk levels |
| Permission Evaluator | `src/tools/permission-evaluator.js` | RBAC permission checks |
| Pre-Invocation Hook | `src/tools/pre-invoke-hook.js` | 6-step authorization flow |
| Shadow Tool Detector | `src/tools/shadow-detector.js` | Detect unknown/anomalous tool usage |
| Tool Audit Logger | `src/tools/audit-logger.js` | Log all tool invocations |

**6-Step Pre-Invocation Flow:**
1. Authenticate caller (JWT verification)
2. Authorize role (RBAC check)
3. Validate tool is registered (whitelist)
4. Check behavioural context (ADR-014 integration)
5. Enforce parameter constraints (schema validation)
6. Log invocation (audit trail)

**API Endpoints:**
- `GET /api/tools/registry` — List all registered tools
- `POST /api/tools/registry` — Register new tool
- `POST /api/tools/invoke/:toolId` — Invoke tool (with auth)
- `GET /api/tools/audit?agentId=x&toolId=y` — Query tool audit log

**Database Schema:**

```sql
-- Tool registry
CREATE TABLE tool_registry (
  tool_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  risk_level ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
  parameters JSONB,  -- Parameter schema
  allowed_roles TEXT[],  -- RBAC: which roles can invoke
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tool permissions (RBAC)
CREATE TABLE tool_permissions (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255),
  tool_id VARCHAR(255),
  permission ENUM('ALLOW', 'DENY'),
  granted_by VARCHAR(255),
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  UNIQUE(agent_id, tool_id)
);

-- Tool invocation audit
CREATE TABLE tool_audit (
  id SERIAL PRIMARY KEY,
  tool_id VARCHAR(255),
  agent_id VARCHAR(255),
  invoked_at TIMESTAMP DEFAULT NOW(),
  parameters JSONB,
  result JSONB,
  decision ENUM('ALLOWED', 'DENIED', 'SHADOW_DETECTED')
);
```

**Parallel with 014:** ADR-014 provides behavioural context for ADR-015's decision-making. They can be implemented simultaneously by the same coder.

---

### Phase 3.2A: ADR-017 — Kill Switch Propagation & Emergency Shutdown
**Priority:** P1  
**Dependencies:** Phase 1.4 (Kill Switch), ADR-013, ADR-014, ADR-015  
**Estimated Effort:** Medium  

**What to build:**

| Component | File | Purpose |
|-----------|------|---------|
| Kill Switch Issuer | `src/emergency/kill-switch-issuer.js` | Create kill signals |
| Kill Switch Propagator | `src/emergency/kill-switch-propagator.js` | Raft broadcast |
| Shutdown Controller | `src/emergency/shutdown-controller.js` | Graceful/forced shutdown |
| Acknowledgment Tracker | `src/emergency/ack-tracker.js` | Track agent acks |
| Recovery Manager | `src/emergency/recovery-manager.js` | Re-onboarding after kill |

**API Endpoints:**
- `POST /api/kill-switch/issue` — Issue kill signal
- `GET /api/kill-switch/:killSignalId` — Get kill signal status
- `GET /api/kill-switch/:killSignalId/acks` — Get acknowledgments
- `POST /api/kill-switch/:killSignalId/cancel` — Cancel kill signal
- `POST /api/recovery/:agentId/onboard` — Re-onboard agent

**Database Schema:**

```sql
-- Kill signals
CREATE TABLE kill_signals (
  kill_signal_id VARCHAR(255) PRIMARY KEY,
  severity ENUM('LOCAL', 'DOMAIN', 'GLOBAL'),
  issued_by VARCHAR(255),
  issued_at TIMESTAMP DEFAULT NOW(),
  target_scope VARCHAR(255),  -- 'agent:x' or 'domain:y' or 'GLOBAL'
  reason_code VARCHAR(50),
  reason_description TEXT,
  shutdown_procedure ENUM('GRACEFUL', 'FORCED'),
  acknowledgment_deadline TIMESTAMP,
  status ENUM('ACTIVE', 'ACKNOWLEDGED', 'CANCELLED', 'EXPIRED')
);

-- Kill signal acknowledgments
CREATE TABLE kill_signal_acks (
  id SERIAL PRIMARY KEY,
  kill_signal_id VARCHAR(255),
  agent_id VARCHAR(255),
  acknowledged_at TIMESTAMP DEFAULT NOW(),
  status ENUM('PENDING', 'KILLED', 'FAILED'),
  FOREIGN KEY (kill_signal_id) REFERENCES kill_signals(kill_signal_id)
);
```

**Why after 013/014/015:** Kill switch propagation needs to know agent identities (013), detect anomalous behaviour triggering the kill (014), and enforce tool access restrictions during shutdown (015).

---

### Phase 3.2B: ADR-016 — Compliance Mapping & Reporting
**Priority:** P1 (can be built last, provides reporting)  
**Dependencies:** ALL ADRs (009-015, 017)  
**Estimated Effort:** Low-Medium  

**What to build:**

| Component | File | Purpose |
|-----------|------|---------|
| Compliance Mapper | `src/compliance/mapper.js` | Map components to framework controls |
| Evidence Collector | `src/compliance/evidence-collector.js` | Automated evidence gathering |
| Posture Calculator | `src/compliance/posture-calculator.js` | Calculate compliance scores |
| Report Generator | `src/compliance/report-generator.js` | Generate compliance reports |

**API Endpoints:**
- `GET /api/compliance/posture` — Get overall posture scores
- `GET /api/compliance/posture/:framework` — Get specific framework score
- `GET /api/compliance/gaps` — List compliance gaps
- `GET /api/compliance/reports/:type` — Generate report (executive/detailed/incident)

**Database Schema:**

```sql
-- Compliance controls mapping
CREATE TABLE compliance_controls (
  control_id VARCHAR(100) PRIMARY KEY,
  framework VARCHAR(50),  -- 'CSA_AI_CM', 'NIST_AI_RMF', 'ISO27001', 'DORA'
  component_id VARCHAR(255),  -- Maps to AWARE component
  status ENUM('COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE'),
  evidence_refs TEXT[],
  last_assessed TIMESTAMP
);

-- Evidence collected
CREATE TABLE compliance_evidence (
  id SERIAL PRIMARY KEY,
  control_id VARCHAR(100),
  collected_at TIMESTAMP DEFAULT NOW(),
  source VARCHAR(100),  -- Which AWARE module generated this
  evidence JSONB
);

-- Compliance posture history
CREATE TABLE compliance_posture (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50),
  score DECIMAL(5,2),  -- 0-100
  calculated_at TIMESTAMP DEFAULT NOW()
);
```

**Why last:** Compliance reporting aggregates data from all other components. Build identity (013), behavioural (014), tool access (015), and kill switch (017) first, then wire up the reporting layer.

---

## Infrastructure Requirements Summary

### New Files to Create

```
src/
├── identity/
│   ├── nhi-lifecycle.js
│   ├── extended-claims.js
│   ├── credential-rotator.js
│   ├── session-binder.js
│   ├── attestation-service.js
│   └── revocation-cache.js
├── monitoring/
│   ├── behavioural-monitor.js
│   ├── baseline-store.js
│   ├── zscore-calculator.js
│   ├── anomaly-alert.js
│   └── trust-deriver.js
├── tools/
│   ├── registry.js
│   ├── permission-evaluator.js
│   ├── pre-invoke-hook.js
│   ├── shadow-detector.js
│   └── audit-logger.js
├── emergency/
│   ├── kill-switch-issuer.js
│   ├── kill-switch-propagator.js
│   ├── shutdown-controller.js
│   ├── ack-tracker.js
│   └── recovery-manager.js
└── compliance/
    ├── mapper.js
    ├── evidence-collector.js
    ├── posture-calculator.js
    └── report-generator.js
```

### Existing Files to Modify

```
src/
├── auth/middleware.js         — Add JWT claims validation, session binding check
├── agents/registry.js         — Add state machine transitions, trust_level field
├── api/routes/               — Add Phase 3 endpoints
└── election/state-machine.js  — May need KillSignalEntry handling (Phase 1.4)
```

### Database Migrations Required

1. `agent_identities` table
2. `agent_credentials` table
3. `attestations` table
4. `revocation_cache` table
5. `behavioural_baselines` table
6. `anomaly_events` table
7. `trust_scores` table
8. `tool_registry` table
9. `tool_permissions` table
10. `tool_audit` table
11. `kill_signals` table
12. `kill_signal_acks` table
13. `compliance_controls` table
14. `compliance_evidence` table
15. `compliance_posture` table

---

## Test Coverage Requirements

| ADR | Unit Tests | Integration Tests | E2E Scenarios |
|-----|------------|-------------------|---------------|
| ADR-013 | JWT claims, credential rotation, state transitions | Attestation flow, revocation propagation | Full identity lifecycle |
| ADR-014 | Z-score calculation, baseline refresh | Alert escalation, trust derivation | Behavioural anomaly detection |
| ADR-015 | Permission checks, shadow detection | Pre-invoke hook flow | Tool access scenarios |
| ADR-017 | Graceful vs forced shutdown, ack tracking | Kill signal propagation | Full kill/recovery cycle |
| ADR-016 | Posture calculation, gap detection | Evidence collection | Compliance report generation |

**Total new test files:** ~15-20

---

## Open Questions (for Architect/Team)

1. **Database:** Are we using etcd for all Phase 3 state, or PostgreSQL? (ADR-013 suggests etcd for identity state)
2. **ML Models:** ADR-014 mentions ML-based anomaly detection as future. Should we stub the interface now?
3. **SPIFFE Integration:** ADR-013 research recommends SPIFFE format. Should we implement SPIFFE ID generation?
4. **Existing JWT:** Phase 1.1 has JWT auth. How do we extend it vs replace it?

---

## Parallelization Opportunities

**Option A: Sequential (1 coder)**
```
013 → 014 → 015 → 017 → 016
```
**Estimated:** 4 implementation cycles

**Option B: Parallel (2 coders)**
```
Coder 1: 013 → 017
Coder 2: 014 → 015 (parallel with 014) → 016
```
**Estimated:** 2-3 implementation cycles

**Option C: Full Parallel (3 coders)**
```
Coder 1: 013 + 014
Coder 2: 015 (after 013)
Coder 3: 017 (after 014+015) + 016 (last)
```
**Estimated:** 2 implementation cycles

---

## Next Steps

1. **Forge:** Review this plan, flag any technical blockers
2. **Critor:** Review ADRs 013-017 for any design issues before implementation
3. **Quinn:** Plan test strategy in parallel with Forge's implementation
4. **Archimedes:** Available for clarification as implementation proceeds

---

*Plan prepared by Archimedes for AWARE Phase 3 implementation. ADRs 013-017 committed to docs/adr/.*
