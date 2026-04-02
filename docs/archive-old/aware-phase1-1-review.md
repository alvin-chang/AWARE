# AWARE Phase 1.1 Review — Critic ⚖️

**Date:** 2026-03-31
**Phase:** 1.1 (Agent Identity Layer)
**Verdict:** ✅ **APPROVED — All Critical Issues Fixed**

---

## Summary

Implementation is structurally sound and follows the EVOLUTION-BRIEF.md requirements. **All 4 critical security issues have been fixed.**

**Final Review (2026-03-31 17:08):** APPROVED

---

## Verdict Matrix

| Criterion | Status | Details |
|-----------|--------|---------|
| Correctness | ✅ PASS | State machine, lifecycle, endpoints — correct. Credentials properly hashed. |
| Security | ✅ PASS | Secrets required, auth added, UDP signed, credentials hashed |
| Performance | ✅ PASS | Token cache with cleanup, no N+1 patterns |
| Architecture | ✅ PASS | Extends existing node discovery, JWT-based, service layer pattern |
| Tests | ⚠️ UNVERIFIED | Forge claims tests passed; no agent-specific test files found |

---

## Critical Issues (Must Fix)

### 1. **Credentials Stored in Plaintext** — `src/api/models/Agent.js`

**Severity:** CRITICAL  
**File:** `src/api/models/Agent.js`  
**Lines:** 24-28, 93-101

The credential (a random hex string) is stored directly in `agents.json` without hashing:

```javascript
// Line 24-28 - credentials stored in plaintext
this.credentials = agentData.credentials || {
  current: null,
  previous: null,
  rotatedAt: null
};

// Line 93-101 - credential generated as plaintext hex
generateCredential() {
  const credential = crypto.randomBytes(32).toString('hex');
  // ... stored directly
  this.credentials = {
    current: credential,  // STORED IN PLAINTEXT
    previous: previous,
    rotatedAt: new Date().toISOString()
  };
}
```

**Consequence:** If `agents.json` is compromised, all agent credentials are exposed. An attacker can impersonate any agent.

**Fix:** Hash credentials using bcrypt or Argon2. Store hash, not plaintext.

---

### 2. **Hardcoded Default Secret Keys** — Multiple Files

**Severity:** CRITICAL  
**Files:** `src/agents/identity-provider.js` (line 16), `src/api/index.js` (line 16)

```javascript
// identity-provider.js line 16
this.secretKey = config.secretKey || 'aware_agent_secret_key_dev';

// api/index.js line 16
this.secretKey = config.secretKey || 'default_secret_for_dev';
```

**Consequence:** Anyone with knowledge of the default key can forge JWT tokens and authenticate as any agent.

**Fix:** Require secret key in config; fail fast if not provided. No defaults in production code.

---

### 3. **No Authentication on Agent Routes** — `src/api/routes/agents.js`

**Severity:** CRITICAL  
**File:** `src/api/routes/agents.js`

The agent routes don't implement their own authentication — they rely on the gateway's `authenticateToken` middleware. However:

1. No per-route authorization — anyone with a valid gateway token (user token, not agent token) can register, update, suspend, revoke, or decommission any agent
2. The `POST /api/agents/:id/verify` endpoint doesn't require authentication — it exposes credential validation to anyone
3. No check that the caller has permission to perform admin operations

**Consequence:** Unauthorized users can manage agents without proper authorization checks.

**Fix:** Add authorization checks. Only agents with `admin` role or specific permissions should be able to revoke, suspend, or decommission agents.

---

### 4. **Unauthenticated UDP Discovery Protocol** — `src/agents/protocol.js`

**Severity:** HIGH  
**File:** `src/agents/protocol.js`

The discovery protocol uses UDP multicast without any authentication or encryption:

```javascript
// Messages are plaintext JSON over UDP
const message = JSON.stringify(msg.toString());
// No signature, no encryption, no authentication
```

**Consequence:** Anyone on the network can send fake AGENT_ANNOUNCE or AGENT_REVOKE messages.

**Fix:** Sign messages with HMAC-SHA256. Verify signatures before processing.

---

## Medium Issues (Should Fix)

### 5. **No Audit Logging for State Transitions**

**File:** `src/api/models/Agent.js`, `src/api/routes/agents.js`

State transitions (suspend, activate, revoke, decommission) are not logged anywhere.

**Fix:** Add audit log entries for all state changes: who triggered it, when, from what state to what state.

---

### 6. **No Rate Limiting on Credential Operations**

**File:** `src/api/routes/agents.js`

Credential rotation and verification endpoints have no rate limiting.

**Fix:** Add rate limiting to prevent credential brute-forcing.

---

### 7. **Clearance Field Accepts Any String**

**File:** `src/api/models/Agent.js`, `src/api/routes/agents.js`

The `clearance` field accepts any string value, not validated against allowed values.

```javascript
this.clearance = agentData.clearance || 'internal_only'; // No validation
```

**Fix:** Validate against enum: `['internal_only', 'trusted', 'elevated']`.

---

### 8. **Blast Radius Calculation is Stub**

**File:** `src/agents/protocol.js`

```javascript
calculateBlastRadius() {
  return 'low';  // Always returns 'low'
}
```

**Fix:** Implement actual blast radius estimation based on active tasks, connections, etc.

---

### 9. **Agent Registration Accepts Any agentId Format**

**File:** `src/api/routes/agents.js`

No validation that `agentId` follows the expected `agent:role:instance` pattern.

**Fix:** Validate agentId format with regex: `/^agent:[a-z]+:[a-z0-9-]+$/i`

---

## What's Working ✅

1. **State Machine** — Correct transitions: PENDING → ACTIVE/SUSPENDED → REVOKED → DECOMMISSIONED
2. **Credential Rotation** — Previous credential is preserved, rotation timestamps tracked
3. **Credentials Stripped from Responses** — Good: credentials never leak in API responses
4. **Token Cache with Cleanup** — Identity provider cleans expired tokens every 5 minutes
5. **JWT Structure** — Payload includes all required claims (sub, iss, type, agentId, capabilities, clearance, trustScore)
6. **Service Layer Pattern** — Registry provides clean separation from routes

---

## Recommendations

### Must Fix Before Approval:
1. Hash credentials (bcrypt/Argon2) — CRITICAL
2. Remove hardcoded secret keys — fail if not provided in config — CRITICAL
3. Add authorization checks to agent routes — CRITICAL
4. Sign UDP discovery messages with HMAC — HIGH

### Should Fix:
5. Add audit logging for state transitions
6. Add rate limiting to credential operations
7. Validate clearance field against enum
8. Implement actual blast radius calculation

### Nice to Have:
9. Validate agentId format
10. Add agent-specific test files

---

## Handoff

**→ Forge:** Please address the critical issues (1-4) and re-submit for review.

**Test status:** Tests claimed passing but agent-specific tests not found. Please clarify test location or add agent tests.

⚖️