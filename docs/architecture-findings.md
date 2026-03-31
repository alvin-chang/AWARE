# AWARE Step 2 — Architecture Findings

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)  
**Canonical Path:** `~/src/AWARE/`  
**Phase:** Step 2 — Architecture (Architect: Archimedes)  
**Date:** 2026-03-31  
**Status:** COMPLETE — Ready for Forge Step 3 (Implementation)  
**Based on:** Scout's Step 1 Audit (`docs/research/audit-findings.md`)

---

## Executive Summary

AWARE Phase 1 (Agent-Native Runtime) architecture is sound with one remaining CRITICAL finding and several MEDIUM/HIGH issues to address before Phase 1.2 begins.

**Key decisions:**
1. **C-01 fix is prerequisite** — must be fixed before any agent deployment
2. **Phase 1.1 implementation is solid** — Agent model, registry, identity provider, HMAC-signed protocol all verified
3. **Phase 1.2-1.4 build on Phase 1.1** — Agent Registry is the foundation

---

## CRITICAL Finding Fix — C-01

### Hardcoded JWT Secret Fallback

**Severity:** CRITICAL  
**Location:** `src/api/middleware/auth.js:4`

**Current code:**
```javascript
const SECRET_KEY = process.env.SECRET_KEY || 'default_secret_for_dev';
```

**Architecture decision:** Remove the fallback entirely. Authentication middleware must fail-closed if `SECRET_KEY` is not set.

**Required fix:**
```javascript
// auth.js — REQUIRED at startup
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
  console.error('FATAL: SECRET_KEY environment variable is required');
  process.exit(1);
}
if (SECRET_KEY.length < 32) {
  console.error('FATAL: SECRET_KEY must be at least 32 characters');
  process.exit(1);
}
```

**Implementation notes:**
- Add validation as early as possible in module load (before any routes are registered)
- Consider adding startup banner: "AWARE requires SECRET_KEY ≥ 32 chars"
- This pattern matches how `api/index.js` handles the fatal check — extend to `auth.js`

**Files affected:**
- `src/api/middleware/auth.js` — add validation at module load

**Verification:**
```javascript
// Test: verify process.exit(1) when SECRET_KEY is missing or < 32 chars
// Test: verify JWT validation fails closed when SECRET_KEY is invalid
```

---

## HIGH Finding Fixes

### H-01: Credential Transmission Over HTTP

**Severity:** HIGH  
**Location:** `src/api/routes/agents.js` (POST /api/agents)

**Problem:** Agent registration endpoint accepts credentials over HTTP. If accessed over HTTP (not HTTPS), credentials traverse in plaintext.

**Architecture decision:** Enforce HTTPS at the API gateway layer, not at the application layer.

**Required fix:**
1. **API Gateway (express):** Add TLS enforcement middleware for production
2. **Deployment:** Document that `POST /api/agents` MUST be served over HTTPS
3. **Initial credential delivery:** Consider file-based or environment-based provisioning for initial agent registration

**Implementation:**
```javascript
// In API gateway — enforce HTTPS in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.status(403).json({ error: 'HTTPS required for agent operations' });
  }
  next();
});
```

**Alternative (long-term):** Agent credentials should be provisioned out-of-band (e.g., injected via environment or mounted secret) rather than transmitted over the network at registration time.

**Files affected:**
- `src/api/index.js` — add HTTPS enforcement middleware

---

### H-02: Agent Heartbeat Endpoint Not Authenticated

**Severity:** HIGH  
**Location:** `src/api/routes/agents.js` (POST /api/agents/:id/heartbeat)

**Problem:** Heartbeat endpoint uses human user's JWT. A compromised human token can record heartbeats for any agent, enabling equivocation attacks.

**Architecture decision:** Heartbeat must validate agent's own JWT. The JWT's `agentId` claim must match `req.params.id`.

**Required fix:**
```javascript
// agents.js — heartbeat route
router.post('/:id/heartbeat', authenticateToken, (req, res) => {
  // req.user is the authenticated user/agent from JWT
  // For agents, the JWT payload includes { type: 'agent', agentId: '...', ... }
  if (req.user.type !== 'agent') {
    return res.status(403).json({ error: 'Agents only' });
  }
  if (req.user.agentId !== req.params.id) {
    return res.status(403).json({ error: 'Cannot heartbeat for another agent' });
  }
  const agent = registry.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  agent.touch();
  res.json({ status: 'ok', lastSeenAt: agent.lastSeenAt });
});
```

**Key insight:** Agents authenticate with their own JWT (issued by Identity Provider). The JWT contains `type: 'agent'` and `agentId`. The heartbeat must verify `req.user.agentId === req.params.id`.

**Files affected:**
- `src/api/routes/agents.js` — add agent JWT validation to heartbeat

---

## MEDIUM Finding Fixes

### M-01: Credential Pepper Has Fallback

**Severity:** MEDIUM  
**Location:** `src/api/models/Agent.js:15`

**Current code:**
```javascript
const CREDENTIALPepper = process.env.AWARE_CREDENTIAL_PEPPER || 'aware-agent-credential-secret';
```

**Architecture decision:** Remove fallback. Generate pepper deterministically from `SECRET_KEY` + salt if not provided.

**Required fix:**
```javascript
// Agent.js
const CREDENTIALPepper = process.env.AWARE_CREDENTIAL_PEPPER 
  || crypto.createHash('sha256').update(process.env.SECRET_KEY || '').digest('hex');
```

**Files affected:**
- `src/api/models/Agent.js` — remove static fallback

---

### M-02: No Rate Limiting on Agent Routes

**Severity:** MEDIUM  
**Location:** `src/api/routes/agents.js`

**Architecture decision:** Add per-agent rate limiting for registration and heartbeat endpoints.

**Required fix:**
```javascript
// agents.js — add rate limiter
const agentRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per source
  message: { error: 'Too many requests' }
});

router.post('/', agentRateLimit, Agent.createAgent); // registration
router.post('/:id/heartbeat', agentRateLimit, heartbeatHandler); // heartbeat
```

**Files affected:**
- `src/api/routes/agents.js` — add rate limiter middleware

---

### M-03: No Audit Logging for Agent Lifecycle Events

**Severity:** MEDIUM  
**Location:** `src/agents/registry.js`, `src/api/routes/agents.js`

**Architecture decision:** Add audit logging for all agent lifecycle events, integrated with existing AWARE alert system.

**Required events to log:**
- Agent registered
- Credential rotated
- Agent suspended
- Agent revoked
- Agent decommissioned
- Heartbeat anomaly detected

**Required fields:**
```javascript
{
  timestamp: new Date().toISOString(),
  event: 'AGENT_REGISTERED',
  initiator: req.user.agentId || req.user.userId,
  target: agentId,
  result: 'SUCCESS' | 'FAILURE',
  metadata: { reason: '...', duration: '...' }
}
```

**Implementation:**
```javascript
// In registry.js — add audit hook
const auditLog = [];
function audit(event, initiator, target, result, metadata = {}) {
  auditLog.push({ timestamp: new Date().toISOString(), event, initiator, target, result, metadata });
  // Integrate with existing AWARE alert system
  alertSystem.log(event, { initiator, target, result, metadata });
}
```

**Files affected:**
- `src/agents/registry.js` — add audit function and hooks
- `src/api/routes/agents.js` — call audit on lifecycle events

---

## Phase 1 Architecture

### Phase 1.1: Agent Identity Layer — COMPLETE ✅

Scout's audit verified:
- ✅ Agent model with PBKDF2 credential hashing
- ✅ Agent registry (`agents.json`)
- ✅ Identity Provider (JWT issuance for agents)
- ✅ Agent protocol with HMAC-SHA256 signed UDP discovery
- ✅ Route authentication (`authenticateToken` middleware)

**What remains:** C-01 fix (hardcoded secret fallback in auth.js)

---

### Phase 1.2: Per-Agent Sandbox Policies

**Goal:** Define and enforce per-agent tool-call policies

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                      Policy Engine                                │
│  (src/policies/)                                                │
└─────────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐
│ Agent Registry │ │ Policy Store  │ │  Tool Catalog │
│ (agents.json)  │ │ (policies.json)│ │  (tools.json)  │
└───────────────┘ └───────────────┘ └───────────────┘
```

**Components:**

| Component | Path | Purpose |
|-----------|------|---------|
| PolicyEngine | `src/policies/engine.js` | Evaluates tool-call requests against policies |
| PolicyStore | `src/policies/store.js` | CRUD for policies, loaded from `policies.json` |
| PolicyModel | `src/policies/model.js` | Policy schema: `agentId`, `tool`, `action`, `conditions` |
| ToolCatalog | `src/policies/tool-catalog.js` | Registry of available tools and their risk levels |

**Policy schema:**
```javascript
{
  policyId: 'pol_001',
  agentId: 'agent_001',
  tool: 'http_request',
  action: 'ALLOW' | 'DENY' | 'AUDIT',
  conditions: {
    maxFrequency: '10/minute',
    requireApproval: false,
    allowedTargets: ['https://api.trusted.com/*']
  },
  createdAt: '2026-03-31T00:00:00Z',
  createdBy: 'admin'
}
```

**Tool-call flow:**
1. Agent calls tool via API
2. PolicyEngine intercepts
3. Fetch agent's policies from PolicyStore
4. Evaluate conditions against request
5. Allow/Deny/Audit based on policy
6. Log decision to audit trail

**Files to create:**
- `src/policies/engine.js` — Policy engine
- `src/policies/store.js` — Policy store (extend agents.json or separate policies.json)
- `src/policies/model.js` — Policy schema
- `src/policies/tool-catalog.js` — Tool registry

---

### Phase 1.3: Behavioural Baseline & Anomaly Detection

**Goal:** Detect anomalous agent behaviour based on learned baselines

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                   Anomaly Detector                               │
│  (src/agents/metrics.js)                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐
│ Agent Metrics │ │ Baseline Store│ │ Alert System  │
│  Collector    │ │ (baselines.json)│ │ (existing)    │
└───────────────┘ └───────────────┘ └───────────────┘
```

**Metrics to track per agent:**
- Tool calls per minute/hour/day
- Response time distribution (mean, stddev)
- Error rate
- Network requests (destination, frequency)
- Credential usage frequency

**Baseline learning:**
```javascript
// Collect metrics over time window (e.g., 7 days)
// Compute statistical baseline: mean, stddev, percentiles
// Flag anomalies when current behaviour exceeds baseline by N stddev
```

**Anomaly types:**
- Spike in tool call frequency
- New destination for HTTP requests
- Response time degradation
- Unusual error rate
- Credential used from new location

**Trust score integration:**
```javascript
// Anomaly detected → reduce trust score
// Consistent normal behaviour → increase trust score
// Trust score affects policy evaluation
```

**Files to create:**
- `src/agents/metrics.js` — Metrics collector
- `src/agents/baselines.js` — Baseline learning and anomaly detection

---

### Phase 1.4: Distributed Kill Switch

**Goal:** Revoke agent credentials/access across the entire cluster via Raft consensus

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kill Switch                                   │
│  (src/agents/revocation.js)                                     │
└─────────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
┌───────▼───────┐                   ┌───────▼───────┐
│ ElectionMgr   │                   │ Agent Registry │
│ (existing)    │                   │ (agents.json)  │
└───────────────┘                   └───────────────┘
```

**Key insight:** AWARE already has Raft consensus via ElectionManager. Kill switch uses existing heartbeat protocol to broadcast revocation decisions.

**Revocation flow:**
1. Admin issues revoke command: `DELETE /api/agents/:id`
2. APIGateway validates admin JWT
3. RevocationRequest sent to ElectionManager
4. Leader node proposes revocation via Raft log
5. Once consensus reached, revocation broadcast to all nodes
6. Each node updates local agent registry (mark revoked)
7. All agent protocol connections closed
8. Audit log updated

**AGENT_REVOKE message type (exists in protocol.js):**
```javascript
// protocol.js — add revocation handling
const AGENT_REVOKE = 'AGENT_REVOKE';
// Handler: close connections, mark agent as revoked in registry
```

**Files to create:**
- `src/agents/revocation.js` — Revocation logic with Raft integration

**Dependency:** Requires C-03 fix (production Raft consensus) — see below.

---

## Known Issues Not in Scout's Audit

### C-03: Election Math.random() (NOT IN SCOUT'S AUDIT)

**Severity:** CRITICAL (for Phase 1.4)  
**Location:** `src/election/ElectionManager.js` — requestVote() method

**Finding:** Vote granting uses `Math.random()` simulation, not deterministic Raft RPC.

```javascript
// ElectionManager.js — current (BROKEN)
async requestVote(nodeId) {
  const granted = Math.random() > 0.3;  // ← NOT production Raft
  resolve(granted);
}
```

**Impact:** Phase 1.4 (Kill Switch) requires distributed consensus via Raft. This broken election makes distributed kill switch unreliable.

**Fix required:** Replace with actual Raft RPC vote granting based on log up-to-date check.

**Recommendation:** This is a separate issue from Scout's audit. Flag to Scout for inclusion in next audit or create separate issue for Forge to fix in parallel with Phase 1.2.

---

## Implementation Order

| Phase | Tasks | Dependencies |
|-------|-------|--------------|
| **Phase 1.1** | C-01 fix, H-01 fix, H-02 fix | None |
| **Phase 1.2** | Policy engine, policy store, tool catalog | Phase 1.1 |
| **Phase 1.3** | Metrics collector, baseline store, anomaly detection | Phase 1.1 |
| **Phase 1.4** | Revocation logic, Raft integration | Phase 1.1 + C-03 fix |
| **C-03 fix** | Production Raft RPC | Separate track (affects Phase 1.4) |

**Recommended order:**
1. Fix C-01 immediately (CRITICAL — blocks all agent deployment)
2. Fix H-02 immediately (HIGH — security regression without it)
3. Fix H-01 (HTTPS enforcement — deployment concern)
4. Phase 1.2 (policy engine) — can start after C-01/H-02
5. Phase 1.3 (anomaly detection) — can start after Phase 1.2
6. Phase 1.4 (kill switch) — requires Phase 1.1 + C-03 fix
7. C-03 fix — parallel with Phase 1.2-1.3

---

## Files Summary

### Existing Files Modified
| File | Change |
|------|--------|
| `src/api/middleware/auth.js` | Add SECRET_KEY validation (fail-closed) |
| `src/api/index.js` | Add HTTPS enforcement middleware |
| `src/api/routes/agents.js` | H-02: agent JWT validation for heartbeat; M-02: rate limiting |
| `src/api/models/Agent.js` | M-01: remove static pepper fallback |
| `src/agents/registry.js` | M-03: add audit logging |

### New Files Created
| File | Purpose |
|------|---------|
| `src/policies/engine.js` | Phase 1.2: Policy engine |
| `src/policies/store.js` | Phase 1.2: Policy store |
| `src/policies/model.js` | Phase 1.2: Policy schema |
| `src/policies/tool-catalog.js` | Phase 1.2: Tool registry |
| `src/agents/metrics.js` | Phase 1.3: Metrics collector |
| `src/agents/baselines.js` | Phase 1.3: Baseline learning |
| `src/agents/revocation.js` | Phase 1.4: Kill switch logic |

---

## Verification

### C-01 Verification
```bash
# Missing SECRET_KEY → process.exit(1)
$ SECRET_KEY='' node src/api/middleware/auth.js
FATAL: SECRET_KEY environment variable is required

# SECRET_KEY < 32 chars → process.exit(1)
$ SECRET_KEY='short' node src/api/middleware/auth.js
FATAL: SECRET_KEY must be at least 32 characters

# Valid SECRET_KEY → starts without error
$ SECRET_KEY='this_is_a_very_long_secret_key_32chars' node src/api/middleware/auth.js
[no output, process stays running]
```

### H-02 Verification
```bash
# Agent heartbeat with mismatched agentId → 403
$ curl -X POST https://aware.example.com/api/agents/agent_002/heartbeat \
  -H "Authorization: Bearer <agent_001_JWT>" \
  # Returns 403: Cannot heartbeat for another agent

# Agent heartbeat with matching agentId → 200
$ curl -X POST https://aware.example.com/api/agents/agent_001/heartbeat \
  -H "Authorization: Bearer <agent_001_JWT>" \
  # Returns 200: { status: 'ok', lastSeenAt: '...' }
```

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| C-03 election bug breaks Phase 1.4 | CRITICAL | Fix C-03 in parallel; test Raft extensively |
| C-01 exploit before fix deployed | CRITICAL | Deploy C-01 fix before any agent deployment |
| H-02 exploit enables agent impersonation | HIGH | Fix H-02 before production agent deployment |
| Policy engine creates performance bottleneck | MEDIUM | Benchmark policy evaluation; cache policies |
| Audit logging creates storage pressure | MEDIUM | Rotate/compact audit logs; archive to object storage |

---

## Decisions Made

| Decision | Rationale |
|----------|----------|
| Fail-closed on missing SECRET_KEY | C-01 exploit is catastrophic (attacker forges any JWT) |
| Agent JWT for heartbeat, not human JWT | H-02 requires agent-specific authentication |
| HTTPS enforcement at gateway, not app | Simpler, covers all agent routes |
| Policy store in JSON file, not database | Avoid adding database dependency for Phase 1 |
| Revocation via Raft, not centralized | Distributed kill switch is AWARE's differentiator |
| C-03 fix is separate from Phase 1.2-1.4 | Different concern; needs dedicated Raft expertise |

---

## Questions for Next Steps

1. **C-03:** Who owns the Raft fix? Forge or separate specialist?
2. **Policy store:** JSON file (`policies.json`) or extend `agents.json`?
3. **Tool catalog:** Predefined list or dynamically discovered?
4. **Baseline window:** 7 days default, configurable?

---

**Status:** ✅ Architecture Complete  
**Next:** Step 3 (Implementation) by Forge  
**Depends on:** C-01 fix before agent deployment
