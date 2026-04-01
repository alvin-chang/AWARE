# ADR-017: Phase 3.2 — Kill Switch Propagation & Emergency Shutdown

**Status:** APPROVED (Critic, 2026-04-01 22:38 BST)
**Critic review:** APPROVED — F-1 (ack write verification) and F-2 (override authority matrix) resolved  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** Phase 1.4 (Kill Switch); Scout Audit findings (C-01, C-02, C-03); ADR-013 (Identity); ADR-014 (Behavioural); ADR-015 (Tool Control)  
**Depends on:** Phase 1.4 (Kill Switch architecture), ADR-013, ADR-014, ADR-015  
**Phase:** 3.2 (P1)  

---

## Context

Phase 1.4 delivered the **Kill Switch architecture** with:
- Raft-based consensus for leader election
- RevocationEntry type for Raft log
- Majority quorum consensus before revocation execution
- Production Raft RPC for vote granting and stale leader detection

ADR-017 addresses the **operational question**: once a kill switch is triggered, how does it propagate to all agents and what is the shutdown/recovery procedure?

Phase 1.4 established the mechanism; ADR-017 establishes the **protocol for using it**.

---

## Decision

Implement a **Kill Switch Propagation & Emergency Shutdown system** that:

1. **Defines kill switch trigger types** and severity levels
2. **Establishes propagation mechanism** (how kill signals reach all agents)
3. **Defines shutdown procedure** (graceful vs forced)
4. **Handles post-emergency recovery** and re-onboarding
5. **Maintains audit trail** for all emergency actions

---

## Kill Switch Trigger Types

### Severity Levels

| Level | Trigger | Scope | Propagation |
|-------|---------|-------|-------------|
| **LOCAL** | Single agent misbehaviour | Single agent | None — agent self-revokes |
| **DOMAIN** | Trust domain compromised | All agents in domain | Broadcast to domain |
| **GLOBAL** | System-wide emergency | All agents everywhere | Full cluster broadcast |

### Trigger Conditions

```javascript
const KILL_SWITCH_TRIGGERS = {
  LOCAL: [
    { condition: 'trust_score < 0.2', duration: '5min', type: 'auto' },
    { condition: 'anomaly_score > 0.95', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' }
  ],
  DOMAIN: [
    { condition: 'domain_breach_detected', type: 'auto' },
    { condition: 'multiple_local_kills_in_domain', threshold: 3, window: '1h', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' }
  ],
  GLOBAL: [
    { condition: 'leader_compromised', type: 'auto' },
    { condition: 'consensus_failure', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' },
    { condition: 'regulatory_emergency', type: 'manual' }
  ]
};
```

---

## Propagation Mechanism

### Kill Signal Structure

```javascript
{
  killSignalId: 'ks-uuid',
  issuedAt: '2026-04-01T10:30:00Z',
  issuedBy: 'admin@goodciso.org',
  severity: 'DOMAIN',
  target: {
    scope: 'trustDomain:aware-prod',
    agentIds: null  // null = all agents in scope
  },
  reason: {
    code: 'DOMAIN_BREACH',
    description: 'Compromised agent detected attempting credential exfiltration',
    evidence: ['audit-log-ref', 'agent-behavior-ref']
  },
  requiresAcknowledgment: true,
  acknowledgmentDeadline: '2026-04-01T10:35:00Z',  // 5 min
  shutdownProcedure: 'GRACEFUL'  // or 'FORCED'
}
```

### Propagation Flow (DOMAIN Severity)

```
Admin issues DOMAIN kill
         │
         ▼
┌─────────────────────────┐
│ 1. Verify authority    │───❌ Invalid ──▶ Reject
└────────────┬────────────┘
             │ Valid
             ▼
┌─────────────────────────┐
│ 2. Create KillSignal    │
│    in etcd              │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 3. Raft broadcast       │──────┐
│    (majority quorum)    │      │
└────────────┬────────────┘      │
             │                   │
    ┌────────┴────────┐          │
    │                 │          │
    ▼                 ▼          │
┌─────────┐     ┌───────────┐    │
│ Follower│     │ All Agents│◀───┘
│ Agents │◀────│ (via Raft)│
└─────────┘     └───────────┘
    │                 │
    ▼                 ▼
┌─────────────────────────┐
│ 4. Agent receives kill  │
│    signal               │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 5. Execute shutdown     │
│    procedure            │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 6. Acknowledge to       │
│    kill signal issuer   │
└─────────────────────────┘
```

### Raft-Based Broadcast

Kill signals are written to the Raft log as `KillSignalEntry`:

```javascript
class KillSignalEntry {
  constructor(killSignal) {
    this.type = 'KILL_SIGNAL';
    this.killSignalId = killSignal.killSignalId;
    this.severity = killSignal.severity;
    this.target = killSignal.target;
    this.issuedAt = killSignal.issuedAt;
    this.issuedBy = killSignal.issuedBy;
    this.shutdownProcedure = killSignal.shutdownProcedure;
  }
  
  // Applied to state machine on commit
  apply(state) {
    // Mark all targeted agents as 'killed'
    for (const agentId of this.getTargetAgents()) {
      state.agents.get(agentId).state = 'KILLED';
      state.agents.get(agentId).killSignalId = this.killSignalId;
    }
  }
}
```

---

## Shutdown Procedures

### GRACEFUL Shutdown

Agents complete current work and stop accepting new work:

```
Kill signal received (GRACEFUL)
         │
         ▼
┌─────────────────────────┐
│ Stop accepting new work │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Finish current tasks    │
│ (max 5 min)             │
└────────────┬────────────┘
             │
    ┌────────┴────────┐
    │ All tasks done? │
    └────────┬────────┘
       No   │    Yes
        │   │     │
        ▼   │     ▼
    ┌─────┐ │  ┌──────────┐
    │Force│ │  │Shutdown  │
    │stop │ │  │complete  │
    └──┬──┘ │  └──────────┘
       │    │
       └────┘
```

```javascript
async function executeGracefulShutdown(agentId, killSignal) {
  const MAX_GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes
  
  // Stop accepting new work
  await agentRegistry.updateState(agentId, 'SHUTTING_DOWN');
  
  // Set deadline
  const deadline = Date.now() + MAX_GRACE_PERIOD;
  
  // Wait for current tasks to complete
  const tasks = await taskQueue.getActiveTasks(agentId);
  
  await Promise.all(
    tasks.map(async (task) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        await taskQueue.cancel(task.taskId);
        return;
      }
      
      try {
        await task.complete({ timeout: remaining });
      } catch (error) {
        await taskQueue.cancel(task.taskId);
      }
    })
  );
  
  // Final cleanup
  await performCleanup(agentId);
  await agentRegistry.updateState(agentId, 'KILLED');
  await acknowledgeKillSignal(killSignal.killSignalId, agentId);
}
```

### FORCED Shutdown

Agents stop immediately without completing work:

```javascript
async function executeForcedShutdown(agentId, killSignal) {
  // Cancel all active tasks
  const tasks = await taskQueue.getActiveTasks(agentId);
  for (const task of tasks) {
    await taskQueue.cancel(task.taskId, { reason: 'EMERGENCY_SHUTDOWN' });
  }
  
  // Force stop execution
  await executionContext.terminate(agentId, { force: true });
  
  // Cleanup
  await performCleanup(agentId);
  await agentRegistry.updateState(agentId, 'KILLED');
  await acknowledgeKillSignal(killSignal.killSignalId, agentId);
}
```

### Cleanup Procedure

Both graceful and forced shutdown perform cleanup:

```javascript
async function performCleanup(agentId) {
  // 1. Revoke credentials (ADR-013)
  await credentialRotator.revokeAll(agentId);
  
  // 2. Invalidate sessions
  await sessionManager.invalidateAll(agentId);
  
  // 3. Erode pheromone trails (ADR-011)
  await reinforcementController.applyKillPenalty(agentId, {
    factor: 0,  // Complete reset
    reason: 'EMERGENCY_SHUTDOWN'
  });
  
  // 4. Close connections
  await connectionPool.close(agentId);
  
  // 5. Release resources
  await resourceManager.release(agentId);
  
  // 6. Log audit event
  await auditLogger.log({
    event: 'AGENT_SHUTDOWN',
    agentId,
    timestamp: Date.now(),
    type: 'GRACEFUL' // or 'FORCED'
  });
}
```

---

## Acknowledgment Protocol

### Why Acknowledgment?

The kill signal issuer needs to know if ALL targeted agents received and acted on the kill signal. Missing acknowledgments indicate:
1. Network partition preventing delivery
2. Agent crash before processing
3. Malicious agent ignoring kill

### Acknowledgment Flow

```javascript
// Agent side
async function acknowledgeKillSignal(killSignalId, agentId) {
  const ackData = {
    agentId,
    acknowledgedAt: Date.now(),
    status: 'KILLED'
  };
  
  // Write to etcd with verification
  const putResult = await etcd.put(
    `/aware/kill-signals/${killSignalId}/acks/${agentId}`,
    ackData
  );
  
  // Verify write succeeded before considering ack complete
  if (!putResult || !putResult.succeeded) {
    // Retry once with backoff
    await sleep(100);
    const retryResult = await etcd.put(
      `/aware/kill-signals/${killSignalId}/acks/${agentId}`,
      ackData
    );
    
    if (!retryResult || !retryResult.succeeded) {
      // Log critical failure — this agent may be falsely "missing"
      await auditLogger.log({
        event: 'ACK_WRITE_FAILURE',
        agentId,
        killSignalId,
        timestamp: Date.now(),
        severity: 'CRITICAL'
      });
      
      // Still throw — issuer must know about this
      throw new Error(`ACK_WRITE_FAILED: Agent ${agentId} failed to persist acknowledgment for ${killSignalId}`);
    }
  }
  
  return { success: true, killSignalId, agentId };
}

// Issuer side
async function checkKillSignalProgress(killSignalId) {
  const killSignal = await etcd.get(`/aware/kill-signals/${killSignalId}`);
  const acks = await etcd.get(`/aware/kill-signals/${killSignalId}/acks`);
  
  const totalAgents = countTargetAgents(killSignal.target);
  const acknowledged = Object.keys(acks).length;
  const missing = totalAgents - acknowledged;
  
  if (missing > 0) {
    const deadline = new Date(killSignal.acknowledgmentDeadline);
    if (Date.now() > deadline) {
      // Deadline passed - escalate
      await alertDispatcher.send({
        severity: 'CRITICAL',
        title: 'Kill Signal Acknowledgment Missing',
        killSignalId,
        missingAgents: missing,
        action: 'MANUAL_INTERVENTION_REQUIRED'
      });
    }
  }
  
  return {
    totalAgents,
    acknowledged,
    missing,
    isComplete: missing === 0
  };
}
```

---

## Post-Emergency Recovery

### Recovery States

```
KILLED ──────────────────┐
   │                     │
   │ admin approves      │ admin denies
   │ re-onboarding       │
   ▼                     ▼
ONBOARDING ────────── REJECTED
   │
   │ credentials issued
   │ baseline established
   │ permissions configured
   │
   ▼
ACTIVE
```

### Re-Onboarding Procedure

```javascript
async function reOnboardAgent(agentId, approvedBy) {
  // 1. Admin approval
  const approval = await adminReview(agentId, approvedBy);
  if (!approval.approved) {
    await agentRegistry.updateState(agentId, 'REJECTED');
    return { success: false, reason: approval.reason };
  }
  
  // 2. Generate new credentials
  const newCredentials = await credentialRotator.rotateAll(agentId);
  
  // 3. Create new session
  const newSession = await sessionManager.createSession(agentId, {
    forceNew: true
  });
  
  // 4. Reset behavioural baseline
  await baselineStore.resetBaseline(agentId);
  
  // 5. Re-establish pheromone trails (start from 0)
  await pheromoneStore.resetAgentTrails(agentId);
  
  // 6. Set initial permissions
  await permissionStore.resetPermissions(agentId);
  
  // 7. Activate
  await agentRegistry.updateState(agentId, 'ACTIVE');
  
  // 8. Audit log
  await auditLogger.log({
    event: 'AGENT_REONBOARDED',
    agentId,
    approvedBy,
    previousKillSignalId: previousKillSignalId,
    timestamp: Date.now()
  });
  
  return { success: true, newSession };
}
```

---

## Blast Radius Management

### When to Use DOMAIN vs GLOBAL

| Scenario | Recommended Scope |
|----------|-------------------|
| Single agent misbehaving | LOCAL |
| Multiple agents in same domain | DOMAIN |
| Leader or quorum compromised | GLOBAL |
| Unknown spread of compromise | DOMAIN (can escalate to GLOBAL) |

### Blast Radius Estimation

Before issuing a kill signal, estimate the impact:

```javascript
async function estimateBlastRadius(target) {
  if (target.scope === 'GLOBAL') {
    const allAgents = await agentRegistry.getAllAgents();
    return {
      agentsAffected: allAgents.length,
      tasksAffected: await taskQueue.countActiveTasks(),
      estimatedDowntime: 'UNKNOWN',
      businessImpact: 'CRITICAL'
    };
  }
  
  const agentsInScope = await agentRegistry.getAgentsByScope(target.scope);
  const tasksInScope = await taskQueue.countTasksForAgents(agentsInScope);
  
  return {
    agentsAffected: agentsInScope.length,
    tasksAffected: tasksInScope,
    estimatedDowntime: estimateRestartTime(agentsInScope),
    businessImpact: tasksInScope > 10 ? 'HIGH' : 'MEDIUM'
  };
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/kill-switch/issue` | POST | Issue kill signal (admin only) |
| `/api/kill-switch/:killSignalId` | GET | Get kill signal status |
| `/api/kill-switch/:killSignalId/acks` | GET | Get acknowledgments |
| `/api/kill-switch/:killSignalId/progress` | GET | Get propagation progress |
| `/api/kill-switch/:killSignalId/cancel` | POST | Cancel kill signal (see authority matrix) |
| `/api/recovery/:agentId/onboard` | POST | Re-onboard killed agent (admin only) |
| `/api/recovery/:agentId/estimate-blast-radius` | POST | Estimate blast radius before issuing |

### Override/Cancel Authority Matrix

| Severity | Cancel Authority | Override Requirements |
|----------|-----------------|---------------------|
| **LOCAL** | Domain admin | Single approval |
| **DOMAIN** | Domain admin + CISO | Two approvals required |
| **GLOBAL** | Board/C-level only (CEO, CTO, CISO) | Three approvals required, majority of board quorum |

**GLOBAL Kill Signal Cancel Requirements:**
- Minimum 3 C-level approvers required
- Majority of available board quorum (e.g., 3 of 5, 4 of 7)
- All approvers must be独立 (independent, not same team)
- Cancel request must include written justification
- Cancel is logged and auditable

```javascript
const GLOBAL_KILL_CANCEL_AUTHORITY = {
  requiredApprovers: 3,
  eligibleRoles: ['CEO', 'CTO', 'CISO', 'BOARD_MEMBER'],
  minBoardQuorum: 0.6,  // 60% of board must be represented
  requireIndependentApproval: true,  // approvers from different departments
  cancelCooldown: 5 * 60 * 1000,  // 5 min between cancel attempts
  requiresWrittenJustification: true
};

// Cancel request structure
{
  killSignalId: 'ks-uuid',
  requestedBy: 'ceo@goodciso.org',
  justification: 'False positive confirmed — no actual compromise',
  approvers: [
    { role: 'CEO', approvedAt: Date.now() },
    { role: 'CTO', approvedAt: Date.now() },
    { role: 'CISO', approvedAt: Date.now() }
  ],
  boardQuorumMet: true
}
```

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| KillSwitchIssuer | `src/emergency/kill-switch-issuer.js` | Create and issue kill signals |
| KillSwitchPropagator | `src/emergency/kill-switch-propagator.js` | Raft broadcast and fan-out |
| ShutdownController | `src/emergency/shutdown-controller.js` | Execute shutdown procedures |
| AcknowledgmentTracker | `src/emergency/ack-tracker.js` | Track agent acknowledgments |
| RecoveryManager | `src/emergency/recovery-manager.js` | Handle re-onboarding |
| BlastRadiusEstimator | `src/emergency/blast-radius-estimator.js` | Estimate impact before kill |

---

## Open Questions

1. **Automatic escalation:** Should LOCAL kills automatically escalate to DOMAIN if multiple occur in short window? (Risk vs disruption trade-off)

2. **Recovery waiting period:** Should there be a mandatory waiting period before re-onboarding after a kill? (Prevent rapid re-compromise)

3. **Partial recovery:** Should agents be able to re-onboard with reduced permissions first? (Gradual trust restoration)

4. **Communication during shutdown:** Should killed agents be allowed to send ONE message before shutting down? (e.g., to alert humans)

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.OPS-02 (Incident response) | Kill switch protocol, acknowledgment |
| CSA AI Control Matrix | AI.OPS-03 (Change management) | Kill signal audit trail |
| NIST AI RMF | RS.AN (Incident analysis) | Blast radius estimation |
| NIST AI RMF | RS.MI (Incident mitigation) | Shutdown procedures |
| ISO 27001 | A.16.1 (Incident management) | Full lifecycle management |
| DORA | Art. 26 (Business continuity) | Emergency shutdown, recovery |

---

## Status

**REVISIONS NEEDED** — F-1 (acknowledgment write verification) and F-2 (GLOBAL kill cancel authority matrix) fixed. Ready for Critic re-review.

---

*Phase 3 ADRs complete. All 5 ADRs drafted (ADR-013 through ADR-017).*
