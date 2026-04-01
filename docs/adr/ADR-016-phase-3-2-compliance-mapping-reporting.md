# ADR-016: Phase 3.2 — Compliance Mapping & Reporting

**Status:** APPROVED (Critor, 2026-04-01 22:05 BST) ✅  
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

**F-2 FIX: Control Weight Determination Methodology**

Control weights are determined by a **risk-based scoring matrix** combining:
1. **Regulatory impact** — penalty severity under each framework
2. **Business criticality** — impact on AWARE operations
3. **Implementation complexity** — effort to implement control

```javascript
// Control weight determination matrix
const WEIGHT_FACTORS = {
  regulatoryImpact: {
    CRITICAL_FRAMEWORK: 4,  // DORA Art. 26 (ICT incidents)
    HIGH_FRAMEWORK: 3,       // CSA AI Control Matrix (AI.OPS*)
    MEDIUM_FRAMEWORK: 2,     // ISO 27001 Annex A
    LOW_FRAMEWORK: 1         // Informational controls
  },
  businessCriticality: {
    CRITICAL: 4,   // Direct revenue/operations impact
    HIGH: 3,       // Security team productivity
    MEDIUM: 2,     // Administrative overhead
    LOW: 1         // Nice-to-have
  },
  implementationComplexity: {
    LOW: 1.0,      // Already implemented, just need evidence
    MEDIUM: 0.8,   // Minor configuration changes
    HIGH: 0.6,     // New component implementation
    VERY_HIGH: 0.4 // Major architectural changes
  }
};

// Compute control weight
function determineControlWeight(control, framework) {
  const regulatoryWeight = WEIGHT_FACTORS.regulatoryImpact[framework] || 1;
  const criticalityWeight = WEIGHT_FACTORS.businessCriticality[control.criticality] || 1;
  const complexityWeight = WEIGHT_FACTORS.implementationComplexity[control.complexity] || 0.5;
  
  // Normalize to 1-10 scale
  const rawScore = regulatoryWeight * criticalityWeight * complexityWeight;
  const normalizedWeight = Math.min(10, Math.max(1, rawScore / 2));
  
  return Math.round(normalizedWeight * 10) / 10; // Round to 1 decimal
}

// Framework-specific base weights
const FRAMEWORK_BASE_WEIGHTS = {
  CSA_AI_CM: {
    'AI.OPS-04': { criticality: 'HIGH', complexity: 'MEDIUM' },  // Tool control
    'AI.OPS-05': { criticality: 'HIGH', complexity: 'LOW' },     // Audit logging
    'AI.ID-01': { criticality: 'CRITICAL', complexity: 'MEDIUM' }, // Identity
    'AI.MT-01': { criticality: 'HIGH', complexity: 'MEDIUM' }    // Monitoring
  },
  NIST_AI_RMF: {
    'PR.AC': { criticality: 'CRITICAL', complexity: 'MEDIUM' },    // Access control
    'AU.02': { criticality: 'HIGH', complexity: 'LOW' },          // Audit events
    'DE.AE': { criticality: 'HIGH', complexity: 'MEDIUM' }        // Anomaly detection
  },
  ISO_27001: {
    'A.9.2': { criticality: 'CRITICAL', complexity: 'MEDIUM' },  // Access management
    'A.9.4': { criticality: 'HIGH', complexity: 'HIGH' },        // Access control
    'A.12.4': { criticality: 'HIGH', complexity: 'LOW' }         // Logging
  },
  DORA: {
    'Art.26': { criticality: 'CRITICAL', complexity: 'HIGH' },     // ICT incidents
    'Art.27': { criticality: 'HIGH', complexity: 'MEDIUM' },      // Threat intel
    'Art.28': { criticality: 'CRITICAL', complexity: 'HIGH' }     // Resilience
  }
};

function computeCompliancePosture(framework) {
  const controls = getFrameworkControls(framework);
  const baseWeights = FRAMEWORK_BASE_WEIGHTS[framework] || {};
  
  let totalScore = 0;
  let maxScore = 0;
  
  for (const control of controls) {
    // Determine weight for this control
    const baseConfig = baseWeights[control.controlId] || { criticality: 'MEDIUM', complexity: 'LOW' };
    const controlWeight = determineControlWeight(
      { ...control, ...baseConfig },
      framework.includes('CSA') ? 'HIGH_FRAMEWORK' : 
      framework.includes('DORA') ? 'CRITICAL_FRAMEWORK' :
      framework.includes('ISO') ? 'MEDIUM_FRAMEWORK' : 'LOW_FRAMEWORK'
    );
    
    const evidence = getEvidence(control.controlId);
    
    if (evidence.compliant) {
      totalScore += controlWeight;
    }
    
    maxScore += controlWeight;
  }
  
  return {
    score: maxScore > 0 ? totalScore / maxScore : 0,
    compliant: totalScore === maxScore,
    gaps: getNonCompliantControls(framework),
    breakdown: {
      totalScore,
      maxScore,
      weights: controls.map(c => ({
        controlId: c.controlId,
        weight: determineControlWeight({ ...c, ...(baseWeights[framework]?.[c.controlId] || {}) }, framework)
      }))
    }
  };
}
```

**Weight determination summary:**
- Regulatory impact (1-4): How critical this control is to passing audits
- Business criticality (1-4): How much a failure impacts AWARE operations
- Implementation complexity (0.4-1.0): How hard it is to implement (more complex = lower effective weight)

Final weights range from 1-10, normalized by framework importance.

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

**F-1 FIX: Access Control for /api/compliance/* endpoints**

All compliance endpoints require authentication and role-based authorization:

| Endpoint | Method | Purpose | Access Control |
|----------|--------|---------|----------------|
| `/api/compliance/posture` | GET | Get overall compliance posture | `compliance:read` role |
| `/api/compliance/posture/:framework` | GET | Get posture for specific framework | `compliance:read` role |
| `/api/compliance/controls` | GET | List all controls and status | `compliance:read` role |
| `/api/compliance/controls/:controlId` | GET | Get control details and evidence | `compliance:read` role |
| `/api/compliance/evidence` | POST | Submit evidence | `compliance:write` role |
| `/api/compliance/gaps` | GET | List all compliance gaps | `compliance:read` role |
| `/api/compliance/gaps/:gapId` | PUT | Update gap status | `compliance:admin` role |
| `/api/compliance/reports` | GET | List compliance reports | `compliance:read` role |
| `/api/compliance/reports/:reportId` | GET | Generate/download report | `compliance:read` role |

### Compliance API Middleware

```javascript
const COMPLIANCE_ROLES = {
  'compliance:read': {
    allows: [
      'GET:/api/compliance/*'
    ],
    requires: ['agent', 'session']
  },
  'compliance:write': {
    allows: [
      'GET:/api/compliance/*',
      'POST:/api/compliance/evidence'
    ],
    requires: ['agent', 'session']
  },
  'compliance:admin': {
    allows: ['*:/api/compliance/*'],
    requires: ['agent', 'session', 'mfa']
  },
  'executive': {
    allows: [
      'GET:/api/compliance/posture*',
      'GET:/api/compliance/reports'
    ],
    requires: ['agent', 'session']
  },
  'auditor': {
    allows: [
      'GET:/api/compliance/*',
      'POST:/api/compliance/evidence'
    ],
    requires: ['agent', 'session', 'time-limited'],
    expiresIn: '8h' // Auditors get time-limited access
  }
};

async function complianceAccessControl(req, res, next) {
  const { agentId, sessionId } = req.body;
  const requestedEndpoint = `${req.method}:/api/compliance${req.path}`;
  
  try {
    // Verify session and get agent role
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'INVALID_SESSION' });
    }
    
    const agent = await agentRegistry.getAgent(session.agentId);
    const roles = session.roles || [];
    
    // Check if any role grants access
    let allowed = false;
    let grantedBy = null;
    
    for (const role of roles) {
      const roleConfig = COMPLIANCE_ROLES[role];
      if (!roleConfig) continue;
      
      // Check time-limited access
      if (roleConfig.expiresIn && session.roleGrantedAt) {
        const elapsed = Date.now() - new Date(session.roleGrantedAt).getTime();
        const expiresIn = parseDuration(roleConfig.expiresIn);
        if (elapsed > expiresIn) continue; // Role expired
      }
      
      // Check pattern match
      for (const pattern of roleConfig.allows) {
        if (matchEndpoint(requestedEndpoint, pattern)) {
          allowed = true;
          grantedBy = role;
          break;
        }
      }
      
      if (allowed) break;
    }
    
    if (!allowed) {
      await auditLogger.log({
        event: 'COMPLIANCE_ACCESS_DENIED',
        agentId: session.agentId,
        endpoint: requestedEndpoint,
        roles
      });
      return res.status(403).json({ 
        error: 'INSUFFICIENT_COMPLIANCE_ACCESS',
        required: 'compliance:read or higher',
        granted: roles
      });
    }
    
    // Attach authorization context
    req.complianceAuth = {
      agentId: session.agentId,
      roles,
      grantedBy,
      canWrite: roles.some(r => ['compliance:write', 'compliance:admin'].includes(r)),
      canAdmin: roles.includes('compliance:admin')
    };
    
    next();
  } catch (error) {
    logger.error({ event: 'COMPLIANCE_AUTH_ERROR', error: error.message });
    return res.status(500).json({ error: 'AUTHORIZATION_ERROR' });
  }
}
```

### Endpoint-Specific Access Examples

```javascript
// GET /api/compliance/posture — requires compliance:read
app.get('/api/compliance/posture', complianceAccessControl, async (req, res) => {
  // Any authenticated agent with compliance:read can view posture
  const posture = await postureCalculator.getOverallPosture();
  res.json(posture);
});

// PUT /api/compliance/gaps/:gapId — requires compliance:admin
app.put('/api/compliance/gaps/:gapId', complianceAccessControl, async (req, res) => {
  if (!req.complianceAuth.canAdmin) {
    return res.status(403).json({ error: 'ADMIN_REQUIRED' });
  }
  // Only compliance:admin can update gap status
  const { status, notes } = req.body;
  await gapTracker.updateStatus(req.params.gapId, { status, notes, updatedBy: req.complianceAuth.agentId });
  res.json({ success: true });
});

// GET /api/compliance/reports — requires compliance:read, executives can also access
app.get('/api/compliance/reports', complianceAccessControl, async (req, res) => {
  // Executives and compliance roles can view reports
  const reports = await reportGenerator.listReports(req.complianceAuth);
  res.json(reports);
});
```

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
