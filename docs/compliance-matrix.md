# AWARE Compliance Matrix

**Document:** AWARE Compliance Matrix  
**Project:** AWARE Evolution  
**Date:** 2026-03-28  
**Status:** Draft — Phase 1 evidence pending  
**Framework Versions:** CSA AI Control Matrix v1.0, NIST AI RMF (2023), ISO 27001:2022, DORA (EU) 2022/2554  

---

## Overview

This document maps every AWARE Evolution capability to its regulatory controls across four frameworks:

- **CSA AI Control Matrix** — Cloud Security Alliance AI Security controls
- **NIST AI RMF** — NIST AI Risk Management Framework (2023)
- **ISO 27001:2022** — Information security management systems
- **DORA** — Digital Operational Resilience Act (EU, 2022/2554)

Controls are marked:
- ✅ **Implemented** — evidence available in Phase 1 deliverable
- 🔄 **In Progress** — scoped in Phase 1 implementation
- 📋 **Planned** — scheduled for Phase 2–3

---

## Phase 1: Agent-Native Runtime

### 1.1 Agent Identity Layer (NHI Lifecycle)

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Identity & Access | AI-IAM-01 | Non-human identity lifecycle management |
| CSA AI CM | Identity & Access | AI-IAM-02 | Cryptographic credential issuance and rotation |
| NIST AI RMF | Govern (GOVERN) | GV.OC-01 | Organizational context is established |
| NIST AI RMF | Govern (GOVERN) | GV.RM-01 | AI system inventory is maintained |
| ISO 27001 | Access Control | A.9.2.1 | User registration and de-registration |
| ISO 27001 | Access Control | A.9.2.4 | Secret authentication information management |
| DORA | ICT Risk Management | Art. 5 | General ICT risk management requirements |
| DORA | ICT Third Party Risk | Art. 9 | ICT third-party risk management |

**Implementation Evidence (Phase 1 → Archimedes + Coder):**
- `src/agents/registry.js` — agent onboarding/deregistration endpoints
- `src/agents/identity-provider.js` — NHI JWT issuance and rotation
- Extended `src/discovery/` — agent-specific metadata fields
- ADR-001 (if applicable) — NHI identity architecture decision

**Test References:**
- Unit: `test/agents/registry.test.js`
- Integration: `test/agents/identity-provider.test.js`
- E2E: `test/e2e/nhi-lifecycle.test.js`

**Status:** 📋 Planned — pending Phase 1.1 implementation

---

### 1.2 Per-Agent Sandbox Policies

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Data Protection | AI-DP-01 | Data classification and handling |
| CSA AI CM | Data Protection | AI-DP-02 | Tool-call authorisation |
| CSA AI CM | Access Control | AI-AC-01 | Least-privilege access for AI systems |
| NIST AI RMF | Manage (MANAGE) | MA.DM-01 | Data processing is managed |
| NIST AI RMF | Manage (MANAGE) | MA.DM-02 | Data provenance is tracked |
| ISO 27001 | Access Control | A.9.4.1 | Information access restriction |
| ISO 27001 | Access Control | A.9.4.2 | Secure log-on procedures |
| ISO 27001 | Communications Security | A.13.1.1 | Network controls |
| DORA | ICT Risk Management | Art. 5 | Data security policies |
| DORA | ICT Risk Management | Art. 9 | ICT third-party risk |

**Implementation Evidence (Phase 1 → Archimedes + Coder):**
- `src/policies/engine.js` — policy evaluation (permit/deny)
- `src/policies/store.js` — declarative YAML/JSON policy persistence
- `src/policies/sandbox.js` — resource quotas per agent
- `src/policies/data-classification.js` — data tier access enforcement
- `docs/security-report.md` — updated threat model for per-agent sandbox

**Test References:**
- Unit: `test/policies/engine.test.js`
- Unit: `test/policies/sandbox.test.js`
- Integration: `test/policies/integration.test.js`

**Status:** 📋 Planned — pending Phase 1.2 implementation

---

### 1.3 Behavioural Baseline & Anomaly Detection

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Threat Detection | AI-TD-01 | Anomaly detection and alerting |
| CSA AI CM | Threat Detection | AI-TD-02 | Model behaviour monitoring |
| CSA AI CM | Logging & Monitoring | AI-LM-01 | Audit logging for AI decisions |
| NIST AI RMF | Measure (MEASURE) | ME.MI-01 | Model behaviour is measured |
| NIST AI RMF | Measure (MEASURE) | ME.MI-02 | AI system incidents are identified |
| ISO 27001 | Communications Security | A.12.6.1 | Information security incident management |
| ISO 27001 | Business Continuity | A.12.6.2 | Information security alerts and advisories |
| DORA | ICT Incident Management | Art. 10 | Detection and classification of ICT-related incidents |

**Implementation Evidence (Phase 1 → Archimedes + Coder):**
- `src/agents/behavioural-monitor.js` — per-agent metric baselines
- `src/agents/anomaly-detector.js` — statistical deviation detection
- `src/agents/decision-fingerprint.js` — output hash for drift/injection detection
- Existing alert system — extended with anomaly-triggered alert types

**Test References:**
- Unit: `test/agents/behavioural-monitor.test.js`
- Unit: `test/agents/anomaly-detector.test.js`
- Integration: `test/agents/decision-fingerprint.test.js`

**Status:** 📋 Planned — pending Phase 1.3 implementation

---

### 1.4 Kill Switch via Raft Consensus

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Incident Response | AI-IR-01 | Incident response procedures |
| CSA AI CM | Incident Response | AI-IR-02 | Kill-switch and emergency stop |
| CSA AI CM | Incident Response | AI-IR-03 | Graceful degradation after revocation |
| NIST AI RMF | Manage (MANAGE) | MA.RM-01 | AI risks are managed |
| NIST AI RMF | Govern (GOVERN) | GV.RM-02 | AI risk tolerance is defined |
| ISO 27001 | Incident Management | A.16.1.1 | Management of incidents and improvements |
| ISO 27001 | Business Continuity | A.16.1.5 | Response to incidents |
| DORA | ICT Incident Management | Art. 17 | Learning and evolving after incidents |
| DORA | ICT Risk Management | Art. 5 | Business continuity and disaster recovery |

**Implementation Evidence (Phase 1 → Archimedes + Coder):**
- Extended `src/election/heartbeat.js` — revocation broadcast payload
- `src/agents/revocation-service.js` — Raft-propagated kill-switch
- Audit log entries — timestamp, trigger reason, initiator for every revocation
- `docs/security-report.md` — kill-switch threat model

**Test References:**
- Unit: `test/agents/revocation-service.test.js`
- Integration: `test/election/kill-switch.test.js`
- E2E: `test/e2e/kill-switch.test.js`

**Status:** 📋 Planned — pending Phase 1.4 implementation

---

## Phase 2: Pheromone-Based Agent Routing

### 2.1–2.2 Pheromone Routing (Specialists + Security-Weighted Heuristic)

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Routing & Orchestration | AI-RO-01 | Task-specific routing segregation |
| CSA AI CM | Routing & Orchestration | AI-RO-02 | Routing decisions are logged and auditable |
| CSA AI CM | Model Governance | AI-GV-01 | Model selection is controlled |
| NIST AI RMF | Measure (MEASURE) | ME.MI-02 | AI system incidents are identified |
| NIST AI RMF | Govern (GOVERN) | GV.SE-01 | Security risk is managed |
| ISO 27001 | Change Management | A.12.1.2 | Security change management |
| ISO 27001 | Access Control | A.9.4.1 | Information access restriction |
| DORA | ICT Risk Management | Art. 5 | Risk assessment and mitigation |

**Implementation Evidence (Phase 2 → Archimedes + Coder):**
- `src/routing/pheromone-table.js` — pheromone persistence per task category
- `src/routing/pheromone-specialist.js` — task-category isolation
- `src/routing/heuristic-calculator.js` — security-weighted heuristic function
- `src/routing/trust-scorer.js` — behaviour-derived trust scores

**Test References:**
- Unit: `test/routing/pheromone-table.test.js`
- Unit: `test/routing/heuristic-calculator.test.js`
- Integration: `test/routing/security-heuristic.test.js`

**Status:** 📋 Planned — Phase 2 deliverable

---

### 2.3 Quality-Gated Reinforcement

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Model Governance | AI-GV-02 | Model output quality validation |
| CSA AI CM | Data Protection | AI-DP-03 | Data leakage prevention |
| NIST AI RMF | Measure (MEASURE) | ME.OU-01 | Outputs are monitored |
| NIST AI RMF | Govern (GOVERN) | GV.OV-01 | AI output quality is managed |
| ISO 27001 | Change Management | A.14.2.1 | Security in development and support processes |
| ISO 27001 | Software Development | A.14.2.5 | Security testing in development |
| DORA | ICT Risk Management | Art. 11 | Security of payment services |

**Implementation Evidence (Phase 2 → Archimedes + Coder):**
- `src/routing/quality-validator.js` — accuracy + security gate
- `src/routing/reinforcement.js` — positive reinforcement + negative penalty

**Test References:**
- Unit: `test/routing/quality-validator.test.js`
- Unit: `test/routing/reinforcement.test.js`

**Status:** 📋 Planned — Phase 2 deliverable

---

### 2.4 Interpretable Routing Audit

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Logging & Monitoring | AI-LM-01 | Audit logging for AI decisions |
| CSA AI CM | Logging & Monitoring | AI-LM-02 | Routing trail export |
| CSA AI CM | Audit & Accountability | AI-AU-01 | Audit record retention |
| NIST AI RMF | Map (MAP) | MAP.SE-01 | Security effects are characterised |
| NIST AI RMF | Govern (GOVERN) | GV.AC-01 | Accountability structures are defined |
| ISO 27001 | Communications Security | A.12.4.1 | Event logging |
| ISO 27001 | Communications Security | A.12.4.2 | Protection of information system audit logs |
| DORA | ICT Risk Management | Art. 12 | ICT processes and mechanisms |

**Implementation Evidence (Phase 2 → Archimedes + Coder):**
- `src/routing/audit-logger.js` — full pheromone trail logging
- Dashboard extension — pheromone heatmap visualisation
- SIEM-compatible JSON export

**Test References:**
- Unit: `test/routing/audit-logger.test.js`
- Integration: `test/routing/siem-export.test.js`

**Status:** 📋 Planned — Phase 2 deliverable

---

## Phase 3: Agentic Security Control Plane

### 3.1 Shadow Agent Discovery

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Asset Management | AI-AM-01 | AI asset inventory |
| CSA AI CM | Asset Management | AI-AM-02 | Shadow AI detection |
| NIST AI RMF | Map (MAP) | MAP.AM-01 | Asset inventory is maintained |
| NIST AI RMF | Govern (GOVERN) | GV.OV-02 | AI system purpose is documented |
| ISO 27001 | Asset Management | A.8.1.1 | Inventory of assets |
| ISO 27001 | Asset Management | A.8.1.2 | Ownership of assets |
| DORA | ICT Risk Management | Art. 5 | Asset management |

**Implementation Evidence (Phase 3 → Archimedes + Coder):**
- `src/security/agent-fingerprint.js` — model signatures, API call patterns
- `src/security/shadow-detector.js` — known vs unknown classification
- Extended alert system — `SHADOW_AGENT` alert type

**Test References:**
- Unit: `test/security/shadow-detector.test.js`
- Integration: `test/security/agent-fingerprint.test.js`

**Status:** 📋 Planned — Phase 3 deliverable

---

### 3.2 Context-Aware Tool-Call Enforcement

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Access Control | AI-AC-01 | Least-privilege access for AI systems |
| CSA AI CM | Access Control | AI-AC-02 | Context-aware authorisation |
| CSA AI CM | Data Protection | AI-DP-01 | Data classification and handling |
| NIST AI RMF | Manage (MANAGE) | MA.AC-01 | Access rights are managed |
| NIST AI RMF | Govern (GOVERN) | GV.SE-01 | Security risk is managed |
| ISO 27001 | Access Control | A.9.4.1 | Information access restriction |
| ISO 27001 | Access Control | A.9.4.3 | Password management system |
| DORA | ICT Risk Management | Art. 9 | ICT third-party risk |

**Implementation Evidence (Phase 3 → Archimedes + Coder):**
- `src/security/context-evaluator.js` — intent classification + data sensitivity
- Hot-reloadable policies — no agent restart required (Galileo pattern)
- Deny-by-default enforcement in `src/policies/engine.js`

**Test References:**
- Unit: `test/security/context-evaluator.test.js`
- Integration: `test/security/hot-reload-policies.test.js`

**Status:** 📋 Planned — Phase 3 deliverable

---

### 3.3 Decision-Chain Traceability

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Audit & Accountability | AI-AU-01 | Audit record retention |
| CSA AI CM | Audit & Accountability | AI-AU-02 | End-to-end decision chain |
| CSA AI CM | Logging & Monitoring | AI-LM-01 | Audit logging for AI decisions |
| NIST AI RMF | Govern (GOVERN) | GV.AC-01 | Accountability structures are defined |
| NIST AI RMF | Govern (GOVERN) | GV.OV-01 | AI system outputs are managed |
| ISO 27001 | Communications Security | A.12.4.1 | Event logging |
| ISO 27001 | Communications Security | A.12.4.2 | Protection of information system audit logs |
| DORA | ICT Risk Management | Art. 12 | Audit trail requirements |

**Implementation Evidence (Phase 3 → Archimedes + Coder):**
- `src/audit/decision-trace.js` — correlation ID linking all events
- `src/audit/chain-logger.js` — append-only hash-chained log
- JSON + SIEM export

**Test References:**
- Unit: `test/audit/chain-logger.test.js`
- Integration: `test/audit/decision-trace.test.js`
- E2E: `test/e2e/decision-chain.test.js`

**Status:** 📋 Planned — Phase 3 deliverable

---

### 3.4 GitOps Agent-as-Code

| Framework | Control Domain | Control ID | Control Description |
|-----------|---------------|-----------|-------------------|
| CSA AI CM | Change Management | AI-CM-01 | Change approval process |
| CSA AI CM | Change Management | AI-CM-02 | Configuration drift detection |
| NIST AI RMF | Manage (MANAGE) | MA.CM-01 | Configuration management |
| NIST AI RMF | Govern (GOVERN) | GV.PO-01 | AI policy is established |
| ISO 27001 | Change Management | A.12.1.2 | Security change management |
| ISO 27001 | Operations Security | A.12.1.1 | Documented operating procedures |
| DORA | ICT Risk Management | Art. 8 | Change management |

**Implementation Evidence (Phase 3 → Archimedes + Coder):**
- `src/gitops/agent-definitions.js` — Git-declared state enforcement
- `src/gitops/drift-detector.js` — runtime vs declared state divergence alert
- PR-based onboarding workflow

**Test References:**
- Unit: `test/gitops/drift-detector.test.js`
- Integration: `test/gitops/pr-workflow.test.js`

**Status:** 📋 Planned — Phase 3 deliverable

---

## Compliance Mapping Summary

| Phase | Capability | CSA AI CM | NIST AI RMF | ISO 27001 | DORA |
|-------|-----------|-----------|-------------|-----------|------|
| 1.1 | NHI lifecycle | AI-IAM-01, AI-IAM-02 | GV.OC-01, GV.RM-01 | A.9.2.1, A.9.2.4 | Art. 5, Art. 9 |
| 1.2 | Per-agent sandbox | AI-DP-01, AI-DP-02, AI-AC-01 | MA.DM-01, MA.DM-02 | A.9.4.1, A.9.4.2, A.13.1.1 | Art. 5, Art. 9 |
| 1.3 | Behavioural anomaly | AI-TD-01, AI-TD-02, AI-LM-01 | ME.MI-01, ME.MI-02 | A.12.6.1, A.12.6.2 | Art. 10 |
| 1.4 | Kill switch | AI-IR-01, AI-IR-02, AI-IR-03 | MA.RM-01, GV.RM-02 | A.16.1.1, A.16.1.5 | Art. 17, Art. 5 |
| 2.1–2.2 | Pheromone routing | AI-RO-01, AI-RO-02, AI-GV-01 | ME.MI-02, GV.SE-01 | A.12.1.2, A.9.4.1 | Art. 5 |
| 2.3 | Quality-gated routing | AI-GV-02, AI-DP-03 | ME.OU-01, GV.OV-01 | A.14.2.1, A.14.2.5 | Art. 11 |
| 2.4 | Routing audit | AI-LM-01, AI-LM-02, AI-AU-01 | MAP.SE-01, GV.AC-01 | A.12.4.1, A.12.4.2 | Art. 12 |
| 3.1 | Shadow agent discovery | AI-AM-01, AI-AM-02 | MAP.AM-01, GV.OV-02 | A.8.1.1, A.8.1.2 | Art. 5 |
| 3.2 | Tool-call enforcement | AI-AC-01, AI-AC-02, AI-DP-01 | MA.AC-01, GV.SE-01 | A.9.4.1, A.9.4.3 | Art. 9 |
| 3.3 | Decision traceability | AI-AU-01, AI-AU-02, AI-LM-01 | GV.AC-01, GV.OV-01 | A.12.4.1, A.12.4.2 | Art. 12 |
| 3.4 | GitOps agent-as-code | AI-CM-01, AI-CM-02 | MA.CM-01, GV.PO-01 | A.12.1.2, A.12.1.1 | Art. 8 |

---

## Framework Reference Notes

### CSA AI Control Matrix
Controls prefixed `AI-` are from the CSA AI Security Control Matrix v1.0 (draft). Where controls reference AI-specific concerns (NHI, pheromone routing, behavioural monitoring), these map directly to AWARE Evolution capabilities.

### NIST AI RMF
Govern (GV), Map (MAP), Measure (ME), and Manage (MA) functions are used per the NIST AI Risk Management Framework (2023). Control suffixes indicate the specific category and number within each function.

### ISO 27001:2022
Controls from Annex A of ISO 27001:2022. Primary sections relevant to AWARE Evolution:
- A.8 (Asset Management)
- A.9 (Access Control)
- A.12 (Operations Security)
- A.14 (Acquisition, Development and Maintenance)
- A.16 (Information Security Incident Management)

### DORA (EU 2022/2554)
Digital Operational Resilience Act, applicable to financial sector entities. AWARE Evolution addresses:
- Art. 5 — ICT risk management
- Art. 8 — ICT change management
- Art. 9 — ICT third-party risk
- Art. 10 — Detection and classification of ICT-related incidents
- Art. 11 — Security of payment services
- Art. 12 — Audit trail requirements
- Art. 17 — Learning and evolving after ICT-related incidents

---

## Maintenance

This document is a living document. Update with implementation evidence as each phase delivers:

1. **After Phase 1 implementation** — update Sections 1.1–1.4 with actual file paths and test references
2. **After Phase 2 implementation** — update Sections 2.1–2.4
3. **After Phase 3 implementation** — update Sections 3.1–3.4
4. **After Phase 4 (this document)** — formal review and sign-off

Each update must reference the corresponding ADR and sub-phase number.

---

*Document created by Chronicler (Scribe), 2026-03-28. Skeleton prepared ahead of Phase 1 implementation. Update with Phase 1 evidence once Architect and Coder deliver.*
