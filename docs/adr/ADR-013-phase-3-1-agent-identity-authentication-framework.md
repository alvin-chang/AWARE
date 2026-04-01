# ADR-013: Phase 3.1 — Agent Identity & Authentication Framework

**Status:** APPROVED (Critor, 2026-04-01 14:00 BST) ✅  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** Phase 1.1 (Agent Identity Layer); Scout Audit (C-01, C-02, C-03); ADR-010 (Trust Score); EVOLUTION-BRIEF.md Section on NHI  
**Depends on:** Phase 1.1 (Agent Identity Layer)  
**Phase:** 3.1 (P0 — blocking)  

---

## Context

Phase 1.1 established the Agent Identity Layer with:
- `Agent` model (NHI with PBKDF2 credential hashing)
- `AgentRegistry` (central NHI registry)
- `IdentityProvider` (JWT issuance for agents)
- `AgentProtocol` (UDP discovery with HMAC signing)

Scout's audit revealed critical gaps:
- **C-01:** Hardcoded JWT secret fallback in `auth.js` (still valid)
- **C-02:** Agent heartbeat auth missing
- **C-03:** Heartbeat fails open without policy engine

ADR-013 addresses the identity and authentication framework that all other Phase 3 components depend on. Without strong identity, behavioural monitoring (ADR-014) and tool enforcement (ADR-015) cannot function reliably.

---

## Decision

Implement a comprehensive **Agent Identity & Authentication Framework** that provides:

1. **Strong credential management** — No hardcoded fallbacks, rotation without downtime
2. **Rich JWT claims** — trustDomain, clearance, capabilities, agentType
3. **Session binding** — Agent ↔ execution context binding
4. **Identity attestation** — Cross-agent communication verification
5. **Revocation propagation** — Fast revocation with distributed cache invalidation

---

## NHI Lifecycle Management

### Agent States

```
┌──────────┐    register    ┌──────────┐    activate    ┌──────────┐
│ PENDING  │──────────────▶│ APPROVED │───────────────▶│  ACTIVE  │
└──────────┘               └──────────┘               └──────────┘
     │                          │                          │
     │ reject                   │ deactivate                │ revoke
     ▼                         ▼                          ▼
┌──────────┐               ┌──────────┐            ┌──────────────┐
│ REJECTED │               │ INACTIVE  │            │   REVOKED    │
└──────────┘               └──────────┘            └──────────────┘
                                                              │
                                                    ┌───────────┘
                                                    │ purged (after grace period)
                                                    ▼
                                              ┌──────────┐
                                              │ PURGED   │
                                              └──────────┘
```

### State Transitions

| From | To | Trigger | Action |
|------|----|---------|--------|
| — | PENDING | Agent requests registration | Credential stored (hashed) |
| PENDING | APPROVED | Admin approves | Credential activated |
| PENDING | REJECTED | Admin rejects | Credential deleted |
| APPROVED | ACTIVE | First successful auth | JWT issued |
| ACTIVE | INACTIVE | Admin/system deactivates | JWTs revoked, agent stops accepting work |
| ACTIVE | REVOKED | Security incident | All tokens invalidated, blast radius applied |
| INACTIVE | ACTIVE | Admin reactivates | New credential rotation triggered |
| REVOKED | PURGED | Grace period expired (24h) | All data deleted |

---

## JWT Claims Extension

### Standard JWT Claims (Phase 1.1)

```json
{
  "sub": "agent-001",
  "iss": "aware-ca",
  "type": "agent",
  "agentId": "agent-001",
  "name": "Forge",
  "agentType": "coder",
  "capabilities": ["coding", "review"],
  "clearance": "L2",
  "iat": 1743570000,
  "exp": 1743573600
}
```

### Extended Claims (ADR-013)

```json
{
  "sub": "agent-001",
  "iss": "aware-ca",
  "type": "agent",
  "agentId": "agent-001",
  "name": "Forge",
  "agentType": "coder",
  "agentVersion": "1.4.2",
  "trustDomain": "aware-prod",
  "clearance": "L2",
  "capabilities": {
    "coding": 0.95,
    "review": 0.85,
    "testing": 0.70
  },
  "trustScore": 0.87,
  "blastRadius": 0.15,
  "sessionId": "sess-abc123",
  "executionContext": {
    "workspace": "/workspace/forge",
    "browserProfile": "coder"
  },
  "issuedAt": "2026-04-01T10:00:00Z",
  "expiresAt": "2026-04-01T11:00:00Z",
  "notBefore": "2026-04-01T10:00:00Z"
}
```

### Claims Definitions

| Claim | Type | Description |
|-------|------|-------------|
| `trustDomain` | string | Security domain (e.g., "aware-prod", "aware-dev") |
| `agentVersion` | string | Semantic version of agent software |
| `trustScore` | float | Behavioural trust score (from ADR-010) |
| `blastRadius` | float | Estimated blast radius if compromised (0-1) |
| `sessionId` | string | Current execution session ID |
| `executionContext` | object | Current execution environment details |
| `capabilities` | object | Map of capability → score (not just array) |

---

## Credential Management

### Credential Types

| Type | Use Case | Rotation Frequency |
|------|----------|-------------------|
| `password` | Initial registration, fallback | On demand |
| `hmac-key` | UDP protocol signing | Every 24h |
| `x509-cert` | TLS client cert (future) | Every 90 days |
| `oauth-token` | External service auth | Per provider TTL |

### Credential Rotation (Zero-Downtime)

```
Agent has: credential_v1 (current)

1. Identity Provider issues credential_v2
2. Agent receives v2, stores both v1 and v2
3. Agent authenticates with v2, sends v1 hash to confirm
4. Identity Provider marks v1 as "superseded" (grace period: 1h)
5. After grace period, v1 is invalidated
6. Agent deletes v1
```

**Implementation:**
```javascript
async function rotateCredential(agentId) {
  const agent = registry.lookup(agentId);
  
  // Issue new credential
  const newCredential = await generateCredential('hmac-key');
  
  // Store new credential alongside old
  await registry.addCredential(agentId, {
    type: 'hmac-key',
    hash: await hashCredential(newCredential),
    version: agent.credentials.length + 1,
    issuedAt: Date.now(),
    supersededAfter: Date.now() + GRACE_PERIOD_MS
  });
  
  // Notify agent
  await notifyAgent(agentId, { action: 'credential_rotated', newCredential });
  
  // Schedule old credential invalidation
  scheduleInvalidation(agentId, oldCredentialId, GRACE_PERIOD_MS);
  
  return { success: true, newCredential };
}
```

---

## Session Binding

### Session Lifecycle

```
Agent requests work
      │
      ▼
┌─────────────────┐
│ Identity Verify │───❌ Invalid ──▶ Reject
└────────┬────────┘
         │ Valid
         ▼
┌─────────────────┐
│ Create Session  │───▶ JWT with sessionId
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Bind to Exec    │───▶ ExecutionContext record
│ Context         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Issue Work      │
│ Token           │
└────────┬────────┘
         │
         ▼
    [Work executes]
         │
         ▼
┌─────────────────┐
│ Session End     │───▶ Token invalidated
└─────────────────┘
```

### Execution Context Binding

Each agent JWT must be bound to a specific execution context:

```javascript
{
  "sessionId": "sess-abc123",
  "executionContext": {
    "workspace": "/workspace/forge",
    "browserProfile": "coder",
    "maxConcurrentTasks": 3,
    "allowedTools": ["read", "write", "exec", "git"],
    "deniedTools": ["rm", "sudo", "curl"]
  }
}
```

**Verification at tool invocation:**
```javascript
function verifyToolAccess(sessionId, toolName) {
  const session = sessionStore.get(sessionId);
  
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }
  
  const { allowedTools, deniedTools } = session.executionContext;
  
  if (deniedTools.includes(toolName)) {
    throw new Error('TOOL_DENIED');
  }
  
  if (!allowedTools.includes('*') && !allowedTools.includes(toolName)) {
    throw new Error('TOOL_NOT_ALLOWED');
  }
  
  return true;
}
```

---

## Identity Attestation

### Cross-Agent Communication

When Agent A communicates with Agent B, Agent B must verify Agent A's identity:

```
Agent A                           Agent B
   │                                  │
   │  1. Send message + JWT           │
   │─────────────────────────────────▶│
   │                                  │
   │  2. Verify JWT signature         │
   │  3. Check notBefore/expiresAt    │
   │  4. Verify trustDomain match     │
   │  5. Check revocation list        │
   │                                  │
   │  6. Allow/Deny                   │
   │◀─────────────────────────────────│
```

### Attestation Verification Flow

```javascript
async function verifyAttestation(token, targetTrustDomain) {
  // 1. Verify JWT signature
  const payload = jwt.verify(token, identityProvider.secretKey);
  
  // 2. Check temporal validity
  const now = Date.now();
  if (payload.notBefore && now < payload.notBefore) {
    throw new Error('TOKEN_NOT_YET_VALID');
  }
  if (payload.expiresAt && now > payload.expiresAt) {
    throw new Error('TOKEN_EXPIRED');
  }
  
  // 3. Verify trustDomain
  if (payload.trustDomain !== targetTrustDomain) {
    throw new Error('TRUST_DOMAIN_MISMATCH');
  }
  
  // 4. Check revocation list (distributed cache)
  const isRevoked = await revocationCache.isRevoked(payload.agentId);
  if (isRevoked) {
    throw new Error('AGENT_REVOKED');
  }
  
  // 5. Verify agent is still active
  const agent = registry.lookup(payload.agentId);
  if (agent.state !== 'active') {
    throw new Error('AGENT_NOT_ACTIVE');
  }
  
  return {
    verified: true,
    agentId: payload.agentId,
    trustScore: payload.trustScore,
    clearance: payload.clearance
  };
}
```

---

## Revocation Propagation

### Revocation Events

| Event | Severity | Action |
|-------|----------|--------|
| Agent compromise detected | CRITICAL | Immediate revocation + blast radius |
| Agent misbehaviour | HIGH | Gradual revocation + investigation |
| Admin request | MEDIUM | Immediate revocation |
| Agent self-revocation | LOW | Graceful shutdown |

### Blast Radius on Revocation

When an agent is revoked, pheromone trails for that agent are degraded:

```javascript
async function applyRevocationBlastRadius(agentId, severity) {
  const agent = registry.lookup(agentId);
  
  const penaltyFactors = {
    CRITICAL: 0.0,   // Complete reset
    HIGH: 0.1,       // Near-complete erosion
    MEDIUM: 0.3,     // Significant erosion
    LOW: 0.5         // Moderate erosion
  };
  
  const factor = penaltyFactors[severity];
  
  // Apply penalty to all pheromone trails for this agent
  const pheromoneMatrix = await pheromoneStore.getMatrix();
  
  for (const taskType of pheromoneMatrix.keys()) {
    const current = pheromoneMatrix.get(taskType, agentId);
    pheromoneMatrix.set(taskType, agentId, current * factor);
  }
  
  await pheromoneStore.saveMatrix(pheromoneMatrix);
  
  // Propagate revocation to all agents
  await broadcastRevocation(agentId, severity);
}
```

### Distributed Revocation Cache

Revocation status is cached in etcd with TTL for fast lookups:

```
/aware/revocation/
├── <agentId>/
│   ├── status: "revoked"
│   ├── severity: "CRITICAL"
│   ├── revokedAt: "2026-04-01T10:30:00Z"
│   ├── reason: "Compromise detected"
│   └── expiresAt: "2026-04-02T10:30:00Z"
```

---

## C-01 Fix: Hardcoded Secret

**Problem (from Scout's audit):** `auth.js` has hardcoded fallback `'default_secret_for_dev'`

**Fix:**
```javascript
// src/api/middleware/auth.js

// CRITICAL SECURITY: No default secret allowed
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
  // Fail-fast: do not allow server to start without proper secret
  throw new Error('FATAL: SECRET_KEY environment variable is required. No default value allowed.');
}

// Validate minimum secret length (32 chars for HS256)
if (SECRET_KEY.length < 32) {
  throw new Error('FATAL: SECRET_KEY must be at least 32 characters for HS256.');
}
```

---

## C-02 Fix: Agent Heartbeat Authentication

**Problem:** Agent heartbeat lacks authentication

**Fix:** Require JWT for heartbeat endpoint:

```javascript
// src/api/routes/agents.js

router.post('/:agentId/heartbeat', 
  authenticateToken,  // Require JWT
  validateAgentOwnership, // Agent can only heartbeat for itself
  async (req, res) => {
    const { agentId } = req.params;
    
    // Verify JWT agentId matches request
    if (req.user.agentId !== agentId) {
      return res.status(403).json({ error: 'Heartbeat must be for own agent' });
    }
    
    // Update heartbeat timestamp
    await registry.updateHeartbeat(agentId);
    
    res.json({ status: 'ok', timestamp: Date.now() });
  }
);
```

---

## C-03 Fix: Heartbeat Fail-Closed

**Problem:** Heartbeat fails open without policy engine

**Fix:** Convert to fail-closed:

```javascript
async function getHeartbeatStatus(agentId) {
  try {
    const policy = await policyEngine.getPolicy('heartbeat');
    
    if (!policy.enabled) {
      return { 
        status: 'disabled', 
        reason: 'Heartbeat disabled by policy',
        timestamp: Date.now()
      };
    }
    
    const agent = await registry.getAgent(agentId);
    return {
      status: 'ok',
      lastHeartbeat: agent.lastHeartbeat,
      timestamp: Date.now()
    };
    
  } catch (error) {
    // FAIL CLOSED: Treat policy engine errors as heartbeat failure
    logger.error({
      event: 'HEARTBEAT_POLICY_ERROR',
      agentId,
      error: error.message
    });
    
    return {
      status: 'error',
      reason: 'Policy engine unavailable',
      timestamp: Date.now()
      // Agent will be marked inactive after missed heartbeats
    };
  }
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents` | POST | Register new agent |
| `/api/agents/:agentId` | GET | Get agent details |
| `/api/agents/:agentId/credentials` | POST | Rotate credential |
| `/api/agents/:agentId/revoke` | POST | Revoke agent |
| `/api/agents/:agentId/session` | POST | Create session |
| `/api/agents/:agentId/session/:sessionId/heartbeat` | POST | Session heartbeat |
| `/api/identity/verify` | POST | Verify attestation token |
| `/api/identity/revocation-list` | GET | Get revocation list |

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| NHI Registry | `src/agents/nhi-registry.js` | Agent state machine, credential storage |
| Identity Provider v2 | `src/agents/identity-provider-v2.js` | Extended JWT, session binding |
| Credential Rotator | `src/agents/credential-rotator.js` | Zero-downtime rotation |
| Session Manager | `src/agents/session-manager.js` | Session lifecycle, heartbeat |
| Attestation Service | `src/agents/attestation-service.js` | Cross-agent verification |
| Revocation Cache | `src/agents/revocation-cache.js` | Distributed revocation state |
| Auth Middleware Fix | `src/api/middleware/auth.js` | Remove hardcoded fallback |

---

## Open Questions

1. **trustDomain hierarchy:** Should trustDomains be hierarchical (e.g., "aware-prod" trusts "aware-prod-eu") or flat?

2. **Cross-trustDomain communication:** How should agents communicate across trust domains? (Require explicit trust relationships?)

3. **Session timeout:** What should be the default session TTL? (Current: 1h JWT, but session binding may need shorter TTL)

4. **Revocation grace period:** Is 24h grace period appropriate for PURGE, or should it be configurable per severity?

5. **Attestation performance:** Verifying attestation on every cross-agent call adds latency. Should we cache verification results? (With TTL)

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.ID-01 (Identity management) | NHI lifecycle, credential rotation |
| CSA AI Control Matrix | AI.ID-02 (Authentication) | JWT with rich claims, session binding |
| NIST AI RMF | ID.AM (Asset management) | Agent registry, state machine |
| NIST AI RMF | PR.AC (Access control) | Session binding, execution context |
| ISO 27001 | A.9.2 (User access management) | Agent identity, credential management |
| DORA | Art. 12 (Ordnance) | Credential rotation, revocation |

---

## Status

**DRAFT** — Ready for Critor review and Scout research on attestation standards.

---

*Next: ADR-014 (Behavioural Anomaly Detection)*
