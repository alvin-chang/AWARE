# ADR-016: Phase 3.2 — Compliance Mapping & Reporting

**Status:** DRAFT  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** Scout Audit findings; ADR-009 through ADR-015; CSA AI Control Matrix; NIST AI RMF; ISO 27001; DORA  
**Depends on:** ADR-009, ADR-010, ADR-011, ADR-012, ADR-013, ADR-014, ADR-015  
**Phase:** 3.2 (P1)  

---

## Context

AWARE is deployed in a regulated environment (UK, EU) and is a member of Cloud Security Alliance (CSA) UK Chapter. Multiple compliance frameworks apply:

- **CSA AI Control Matrix** — AI-specific controls for autonomous systems
- **NIST AI RMF** — NIST framework for AI risk management
- **ISO 27001** — Information security management
- **DORA** — EU Digital Operational Resilience Act

ADR-016 establishes the **Compliance Mapping & Reporting** system that:
1. Maps AWARE components to compliance framework controls
2. Collects evidence automatically
3. Generates compliance reports
4. Tracks remediation of control gaps

---

## Compliance Frameworks

### CSA AI Control Matrix

The CSA AI Control Matrix defines AI-specific controls across categories:

| Category | Controls |
|----------|----------|
| AI.ID (AI Identity) | ID-01: Identity management, ID-02: Authentication |
| AI.OT (AI Operations) | OT-01: Model inventory, OT-02: Data governance |
| AI.OPS (AI Operations) | OPS-01: Model monitoring, OPS-02: Incident response |
| AI.MT (AI Maintenance) | MT-01: Update management, MT-02: Configuration control |

### NIST AI RMF

The NIST AI RMF (AI Risk Management Framework) organizes into sections:

| Section | Functions |
|---------|-----------|
| Govern | OV (Governance), RS (Risk Response) |
| Map | RA (Risk Assessment) |
| Measure | MA (Measurement) |
| Manage | IM (Risk Management) |

### ISO 27001

Annex A controls relevant to AWARE:

| Control | Description |
|---------|-------------|
| A.9.2 | User access management |
| A.9.4 | System and network access |
| A.12.1 | Operational procedures |
| A.12.4 | Logging and monitoring |
| A.16.1 | Incident management |

### DORA (Digital Operational Resilience Act)

EU regulation for financial entities' ICT risk:

| Article | Requirement |
|---------|-------------|
| Art. 12 | Internal control frameworks |
| Art. 26 | ICT incidents and operational resilience |
| Art. 27 | Threat intelligence |
| Art. 28 | Business continuity |

---

## AWARE Control Mapping

### CSA AI Control Matrix Mapping

| AWARE Component | CSA Control | Implementation |
|-----------------|-------------|----------------|
| Agent Identity (ADR-013) | AI.ID-01, AI.ID-02 | NHI lifecycle, JWT auth, credential rotation |
| Session Binding (ADR-013) | AI.ID-02 | Session management, execution context |
| Behavioural Monitoring (ADR-014) | AI.MT-01 | Baseline establishment, anomaly detection |
| Trust Score (ADR-014) | AI.MT-01 | Trust score computation, decay |
| Tool Control (ADR-015) | AI.OPS-04, AI.OPS-05 | RBAC permissions, pre-invocation auth |
| Pheromone Routing (ADR-009-012) | AI.OT-02 | Secure routing with quality/security gates |
| Hot-Reload Policies (ADR-012) | AI.MT-02 | Policy versioning, atomic updates |
| Quality Gate (ADR-011) | AI.OPS-01 | Task outcome validation |
| Kill Switch (Phase 1.4) | AI.OPS-02 | Emergency shutdown, consensus |

### NIST AI RMF Mapping

| AWARE Component | NIST Function | Implementation |
|-----------------|---------------|----------------|
| Agent Registry | OV-1, OV-3 | Organizational context, risk tolerance |
| Identity Provider | OV-4 | Governance structures for AI |
| Attestation Service | PR.AC | Access control enforcement |
| Behavioural Monitor | DE.AE | Anomaly detection |
| Alert Dispatcher | RS.AN | Analysis of detected anomalies |
| Compliance Reporter | IM-1, IM-2 | Continuous monitoring, reporting |

### ISO 27001 Mapping

| AWARE Component | ISO Control | Implementation |
|-----------------|-------------|----------------|
| Identity Provider | A.9.2.1-6 | User registration, authentication, access rights |
| Tool Control | A.9.4.1-6 | Information access restriction, security domains |
| Audit Logger | A.12.4.1-3 | Event logging, clock synchronization |
| Incident Handler | A.16.1.1-7 | Incident management procedures |
| Policy Engine | A.12.1.2 | Change management |

### DORA Mapping

| AWARE Component | DORA Article | Implementation |
|-----------------|---------------|----------------|
| Monitoring (ADR-014) | Art. 26 | ICT incident detection |
| Kill Switch | Art. 26 | Business continuity |
| Alert Dispatcher | Art. 27 | Threat intelligence sharing |
| Pheromone Routing | Art. 28 | Operational resilience |

---

## Evidence Collection

### Automated Evidence Sources

| Evidence Type | Source | Collection Method |
|--------------|--------|-------------------|
| Agent registrations | Agent Registry | Periodic snapshot |
| Authentication events | Identity Provider | Real-time log stream |
| Tool invocations | Tool Auditor | Real-time log stream |
| Anomaly alerts | Alert Dispatcher | Real-time log stream |
| Policy changes | Policy Store | Version history |
| Pheromone updates | Reinforcement Controller | Audit trail |
| Credential rotations | Credential Rotator | Audit trail |

### Evidence Schema

```javascript
{
  evidenceId: 'ev-uuid',
  framework: 'CSA_AI_CM',
  controlId: 'AI.ID-01',
  collectedAt: '2026-04-01T10:00:00Z',
  source: {
    component: 'identity-provider',
    event: 'AGENT_REGISTERED',
    agentId: 'agent-001'
  },
  artifact: {
    type: 'json',
    content: { /* registration record */ }
  },
  compliant: true,
  notes: 'Agent registration completed with proper credential hashing'
}
```

---

## Compliance Dashboard

### Report Types

| Report | Frequency | Audience | Contents |
|--------|-----------|----------|----------|
| Executive Summary | Monthly | Board/C-level | High-level risk posture, key metrics |
| Detailed Compliance | Quarterly | Compliance team | Control-by-control status, gaps |
| Incident Report | On-demand | Security team | Specific incident details |
| Audit Evidence | Pre-audit | Auditors | Full evidence package |
| Remediation Tracker | Weekly | Risk owners | Open gaps, remediation status |

### Compliance Posture Score

```javascript
function computeCompliancePosture(framework) {
  const controls = getFrameworkControls(framework);
  
  let totalScore = 0;
  let maxScore = 0;
  
  for (const control of controls) {
    const evidence = getEvidence(control.controlId);
    
    if (evidence.compliant) {
      totalScore += control.weight;
    }
    
    maxScore += control.weight;
  }
  
  return {
    score: totalScore / maxScore,
    compliant: totalScore === maxScore,
    gaps: getNonCompliantControls(framework)
  };
}
```

### Dashboard Widgets

```
┌─────────────────────────────────────────────────────────────┐
│  COMPLIANCE POSTURE                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CSA AI Control Matrix    ████████████████████░░░  92%     │
│  NIST AI RMF              █████████████████░░░░░  85%     │
│  ISO 27001                ████████████████████░░  94%     │
│  DORA                      ██████████████████░░░░  88%     │
│                                                             │
│  Overall: ███████████████████░░░░  90%                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Gap Remediation Tracking

### Gap Lifecycle

```
IDENTIFIED → ASSESSED → REMEDIATION_PLAN → IN_PROGRESS → VERIFIED → CLOSED
    │           │             │                 │            │          │
    │           │             │                 │            │          │
    └───────────┴─────────────┴─────────────────┴────────────┴──────────┘
         Auto          Risk owner       DRI assigned    Test        Evidence
         scan          prioritizes       implements      passes      collected
```

### Gap Definition

```javascript
{
  gapId: 'gap-uuid',
  framework: 'CSA_AI_CM',
  controlId: 'AI.OPS-03',
  title: 'Tool invocation audit retention insufficient',
  description: 'Current tool audit logs retained for 90 days, but control requires 1 year',
  severity: 'MEDIUM',
  riskOwner: 'security-team@goodciso.org',
  identifiedAt: '2026-04-01T10:00:00Z',
  identifiedBy: 'automated-scan',
  status: 'ASSESSED',
  remediation: {
    required: 'Extend audit log retention to 365 days',
    estimatedEffort: '2 days',
    targetDate: '2026-04-15'
  },
  evidence: {
    required: ['audit-log-retention-policy', 'storage-configuration'],
    provided: ['audit-log-retention-policy']
  },
  verifiedAt: null,
  closedAt: null
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/compliance/posture` | GET | Get overall compliance posture |
| `/api/compliance/posture/:framework` | GET | Get posture for specific framework |
| `/api/compliance/controls` | GET | List all controls and status |
| `/api/compliance/controls/:controlId` | GET | Get control details and evidence |
| `/api/compliance/evidence` | POST | Submit evidence |
| `/api/compliance/gaps` | GET | List all compliance gaps |
| `/api/compliance/gaps/:gapId` | PUT | Update gap status |
| `/api/compliance/reports` | GET | List compliance reports |
| `/api/compliance/reports/:reportId` | GET | Generate/download report |

---

## Report Generation

### Automated Report Schedule

```javascript
const REPORT_SCHEDULE = {
  'executive-summary': {
    frequency: 'monthly',
    dayOfMonth: 1,
    recipients: ['board@goodciso.org', 'ciso@goodciso.org']
  },
  'detailed-compliance': {
    frequency: 'quarterly',
    quarterEnd: true,
    recipients: ['compliance@goodciso.org', 'legal@goodciso.org']
  },
  'incident': {
    frequency: 'on-demand',
    trigger: 'security-incident',
    recipients: ['security-team@goodciso.org']
  }
};
```

### Report Format

```javascript
{
  reportId: 'rpt-uuid',
  type: 'executive-summary',
  generatedAt: '2026-04-01T00:00:00Z',
  period: {
    from: '2026-03-01T00:00:00Z',
    to: '2026-03-31T23:59:59Z'
  },
  summary: {
    overallPosture: 0.90,
    trends: {
      CSA_AI_CM: { previous: 0.88, current: 0.92, direction: 'improving' },
      NIST_AI_RMF: { previous: 0.84, current: 0.85, direction: 'stable' }
    },
    openGaps: 3,
    criticalIncidents: 0,
    pendingRemediations: 5
  },
  keyMetrics: [
    { name: 'Agents Registered', value: 6, change: '+1' },
    { name: 'Anomalies Detected', value: 12, change: '-3' },
    { name: 'Tool Invocations', value: 45231, change: '+8%' }
  ],
  generatedBy: 'compliance-reporter',
  approvedBy: null
}
```

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| FrameworkMapper | `src/compliance/framework-mapper.js` | Map components to controls |
| EvidenceCollector | `src/compliance/evidence-collector.js` | Automate evidence collection |
| PostureCalculator | `src/compliance/posture-calculator.js` | Compute compliance scores |
| GapTracker | `src/compliance/gap-tracker.js` | Manage remediation lifecycle |
| ReportGenerator | `src/compliance/report-generator.js` | Generate scheduled reports |
| ComplianceAPI | `src/api/routes/compliance.js` | REST API endpoints |
| ComplianceDashboard | `dashboard/compliance.js` | React dashboard widget |

---

## Open Questions

1. **Framework priority:** Which framework should be considered "primary" for AWARE? (CSA AI CM given CSA UK membership?)

2. **Evidence automation level:** Should all evidence be auto-collected, or allow manual evidence uploads? (Auto more reliable, manual more flexible)

3. **Third-party audits:** How do we handle evidence from third-party systems? (SOC 2 Type II reports, penetration tests?)

4. **Remediation SLAs:** Should we define mandatory remediation timeframes per severity? (e.g., CRITICAL gaps must be remediated within 7 days)

5. **Certification requirements:** Does AWARE need formal certification against any framework, or is self-assessment sufficient?

---

## Status

**DRAFT** — Ready for Critor review and alignment on compliance priorities.

---

*Next: ADR-017 (Kill Switch Propagation & Emergency Shutdown)*
