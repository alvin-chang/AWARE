# ADR-012: Phase 2.4 — Hot-Reload Policy Mechanism

**Status:** APPROVED (2026-04-02 10:21 UTC)
**Fixes applied:**
- F-1: Specified explicit double-buffer GC timing with reference counting and maxInFlightAge
- F-2: Added blast-radius-matrix JSON Schema to POLICY_SCHEMAS  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** EVOLUTION-BRIEF.md Section 2.4; Scout's routing research (AMRO-S paper); ADR-009 Phase 2.1 (Pheromone Specialists); ADR-010 Phase 2.2 (Security-Weighted Heuristic); ADR-011 Phase 2.3 (Quality-Gated Reinforcement)  
**Depends on:** ADR-009, ADR-010, ADR-011  
**Note:** "Hot-reload policies is table stakes (Galileo has it)" — required for production readiness  

---

## Context

AWARE's routing intelligence depends on configurable policies:
- Pheromone decay rates (ρ)
- Security heuristic weights (w1–w5)
- Quality gate thresholds
- Blast radius parameters

In production, policies must be updated **without restarting the service**. This is standard functionality ("table stakes") — competitors like Galileo already support it.

The hot-reload mechanism must:
1. Load policies from persistent storage (etcd)
2. Validate policy schemas before applying
3. Apply changes atomically without disrupting in-flight routing decisions
4. Trigger pheromone re-initialisation when relevant parameters change
5. Log all policy changes for audit

---

## Decision

Implement a **Hot-Reload Policy Controller** that watches etcd for policy changes and applies them atomically to the routing engine. Policies are stored in etcd with version vectors for atomic compare-and-swap updates.

---

## Policy Storage Schema

Policies are stored in etcd under `/aware/policies/`:

```
/aware/policies/
├── routing/
│   ├── pheromone.json        # Decay rates, learning rates
│   ├── heuristic.json       # Security heuristic weights
│   ├── quality-gate.json     # Quality thresholds
│   └── blast-radius.json    # Blast radius parameters
├── security/
│   ├── allowed-tools.json   # Tool access control
│   ├── data-classification.json
│   └── blast-radius-matrix.json
└── meta/
    └── policy-version.json  # Version vector for CAS
```

### Policy Version Vector

Each policy file includes a version vector for conflict detection:

```json
{
  "version": 42,
  "lastModified": "2026-04-01T10:30:00Z",
  "modifiedBy": "admin",
  "changeReason": "Adjust decay rate for production load"
}
```

---

## Hot-Reload Watcher

### Watch Mechanism

The **PolicyWatcher** subscribes to etcd change events using watch streams:

```
PolicyWatcher
  ├── etcd.WatchPrefix('/aware/policies/')
  ├── DebounceQueue (100ms window for burst changes)
  ├── SchemaValidator (validate before apply)
  └── PolicyApplicator (atomic update to routing engine)
```

### Debouncing

Rapid successive changes (e.g., during bulk edits) are debounced over a 100ms window to avoid redundant reloads. Only the final state after the window closes is applied.

### Change Detection Flow

```
etcd change event
      │
      ▼
┌─────────────────┐
│ Debounce (100ms) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ❌ Invalid
│ Schema Validate │──────────────────→ Log error, skip, alert
└────────┬────────┘
         │ ✅ Valid
         ▼
┌─────────────────┐
│ Compare Version │
└────────┬────────┘
         │
    ┌────┴────┐
    │ version │
    │  same?  │
    └────┬────┘
     No  │  Yes
         ▼         ▼
┌─────────────────┐
│ CAS Update      │  (compare-and-swap)
│ (atomic in etcd)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PolicyApplicator│
│ (apply to routing│
│  engine)         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Audit Log       │
│ (who/what/when) │
└─────────────────┘
```

---

## Policy Applicator

### Routing Engine Integration

When a policy changes, the applicator updates the in-memory routing engine:

| Policy File | Affected Components | Reload Behaviour |
|------------|-------------------|------------------|
| `pheromone.json` | Pheromone matrices (τ^t) | Recalculate τ values with new decay |
| `heuristic.json` | Security heuristic η | Recompute η with new weights |
| `quality-gate.json` | Quality thresholds | Update gate thresholds (no re-eval) |
| `blast-radius.json` | Blast radius estimates | Recompute all blast radius values |
| `allowed-tools.json` | Tool whitelist | Immediate enforcement on next call |
| `data-classification.json` | Clearance levels | Immediate enforcement |

### In-Flight Request Handling

**Critical:** Policy changes must NOT affect requests already being processed.

**Strategy:** Double-buffer the policy state with explicit GC timing (F-1 fix).

1. Keep reference to "old" policy state for in-flight requests
2. Apply new policy to "new" state
3. New requests use "new" state immediately
4. In-flight requests complete with "old" state
5. **Garbage-collect "old" state** using reference counting:
   - Each in-flight request increments a `pendingCount` counter when starting
   - Each completed request decrements `pendingCount`
   - When `pendingCount === 0` AND `maxInFlightAge` (default: 5 minutes) has elapsed → safe to GC old state
   - If `pendingCount > 0` after `maxInFlightAge` (hung requests), log WARNING and retain old state until resolved

**Double-Buffer State Machine:**

```
IDLE (no pending requests)
      │
      ▼
┌─────────────────┐
│ Policy Change    │
│ Received        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Swap: old ← new │
│ Reset counters  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ NEW state       │ ← New requests use new state
│ OLD state       │ ← In-flight requests complete with old state
│ pendingCount=0  │
└────────┬────────┘
         │
         │ In-flight request starts
         ▼
┌─────────────────┐
│ pendingCount++  │
└────────┬────────┘
         │
         │ In-flight request completes
         ▼
┌─────────────────┐
│ pendingCount--  │
└────────┬────────┘
         │
    ┌────┴────┐
    │pending=0│     ┌────────────────────┐
    │AND age>5m│───→│ GC old state       │
    └────┬────┘     │ Return to IDLE     │
         │         └────────────────────┘
         │
         │ pending>0 OR age≤5m
         ▼
┌─────────────────┐
│ Retain old state│ ← Wait for completion
└─────────────────┘
```

**Hung Request Protection:** If `pendingCount > 0` after `maxInFlightAge` (5 minutes), the oldest policy state is retained indefinitely until all requests complete or timeout. This prevents memory leaks from hung requests while maintaining correctness.

```
Request A (in-flight) ──────→ Uses old policy state
Request B (new) ─────────────→ Uses new policy state
Request C (new) ─────────────→ Uses new policy state
```

### Transactional Policy Updates

For changes affecting multiple policy files (e.g., weights + thresholds together):

```javascript
async function applyPolicyTransaction(changes) {
  const version = await etcd.get('/aware/policies/meta/policy-version');
  
  // Start transaction
  await etcd.transaction(async (tx) => {
    for (const {path, content} of changes) {
      tx.put(path, JSON.stringify(content));
    }
    tx.put('/aware/policies/meta/policy-version', {
      version: version + 1,
      lastModified: new Date().toISOString(),
      modifiedBy: currentUser,
      changeReason: 'Bulk policy update'
    });
  });
  
  // After successful commit, trigger reload
  await triggerReload();
}
```

---

## Schema Validation

### Policy Schema Registry

Each policy type has a JSON Schema:

```javascript
const POLICY_SCHEMAS = {
  'routing/pheromone': {
    type: 'object',
    required: ['learningRate', 'pheromoneMin', 'pheromoneMax', 'decayRate'],
    properties: {
      learningRate: { type: 'number', minimum: 0, maximum: 1 },
      pheromoneMin: { type: 'number', minimum: 0, maximum: 1 },
      pheromoneMax: { type: 'number', minimum: 0, maximum: 1 },
      decayRate: { type: 'number', minimum: 0, maximum: 1 }
    }
  },
  'routing/heuristic': {
    type: 'object',
    required: ['weights'],
    properties: {
      weights: {
        type: 'object',
        required: ['w1', 'w2', 'w3', 'w4', 'w5'],
        properties: {
          w1: { type: 'number', minimum: 0, maximum: 1 }, // capability
          w2: { type: 'number', minimum: 0, maximum: 1 }, // load_balance
          w3: { type: 'number', minimum: 0, maximum: 1 }, // trust_score
          w4: { type: 'number', minimum: 0, maximum: 1 }, // data_clearance
          w5: { type: 'number', minimum: 0, maximum: 1 }  // blast_radius_inverse
        }
      }
    }
  },
  'quality-gate': {
    type: 'object',
    required: ['thresholds'],
    properties: {
      thresholds: {
        type: 'object',
        required: ['excellent', 'acceptable', 'marginal'],
        properties: {
          excellent: { type: 'number', minimum: 0, maximum: 1 },
          acceptable: { type: 'number', minimum: 0, maximum: 1 },
          marginal: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  },
  // F-2 fix: Added blast-radius-matrix schema (was referenced but not defined)
  'security/blast-radius-matrix': {
    type: 'object',
    required: ['version', 'matrix'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      lastModified: { type: 'string', format: 'date-time' },
      modifiedBy: { type: 'string' },
      matrix: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0, maximum: 1 }
        }
        // Agent-to-agent blast radius matrix
        // matrix[agentA][agentB] = blast radius if agentA compromises agentB
      },
      defaults: {
        type: 'object',
        properties: {
          readOnlyAgent: { type: 'number', minimum: 0, maximum: 1 },
          networkAgent: { type: 'number', minimum: 0, maximum: 1 },
          credentialedAgent: { type: 'number', minimum: 0, maximum: 1 },
          adminAgent: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  }
};
```

### Validation Before Apply

```javascript
async function validateAndApply(policyPath, newContent) {
  const schemaKey = policyPath.replace('/aware/policies/', '').replace('.json', '');
  const schema = POLICY_SCHEMAS[schemaKey];
  
  if (!schema) {
    throw new Error(`No schema defined for ${policyPath}`);
  }
  
  const { valid, errors } = validateJSONSchema(newContent, schema);
  
  if (!valid) {
    // Log validation errors
    logger.error({
      event: 'POLICY_VALIDATION_FAILED',
      policy: policyPath,
      errors
    });
    
    // Alert on-call
    await alertOnCall({
      severity: 'HIGH',
      message: `Policy validation failed for ${policyPath}`,
      errors
    });
    
    return { success: false, errors };
  }
  
  return { success: true };
}
```

---

## Pheromone Re-Initialisation

When certain policies change, pheromone matrices must be re-computed:

| Change | Re-initialisation Required? |
|--------|----------------------------|
| Decay rate (ρ) | No — applies to future updates |
| Learning rate | No — applies to future updates |
| Pheromone min/max | No — clamp applied to existing |
| New task category | **Yes** — initialize τ^t for new category |
| Weight changes (heuristic) | No — recompute η at next decision |
| Quality thresholds | No — applies to next evaluation |
| Blast radius matrix | **Yes** — recalculate blast radius for all agents |

### New Task Category Initialisation

When a new task type is added to the taxonomy, initialise τ values based on:

```
τ(agent, new_task) = τ_avg × capability_score(agent, new_task)
```

Where τ_avg is the average pheromone level across all known task categories for that agent.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/policies` | GET | List all policies and their current versions |
| `/api/policies/:category/:name` | GET | Get specific policy |
| `/api/policies/:category/:name` | PUT | Update policy (triggers hot-reload) |
| `/api/policies/validate` | POST | Validate policy without applying |
| `/api/policies/reload` | POST | Force manual reload (admin only) |
| `/api/policies/history` | GET | Get policy change audit log |

### Update Request Format

```json
PUT /api/policies/routing/heuristic
{
  "weights": {
    "w1": 0.35,
    "w2": 0.15,
    "w3": 0.30,
    "w4": 0.10,
    "w5": 0.10
  },
  "changeReason": "Increase trust_score weight to prioritise verified agents"
}
```

### Response Format

```json
{
  "success": true,
  "policy": {
    "path": "/aware/policies/routing/heuristic.json",
    "version": 43,
    "lastModified": "2026-04-01T11:30:00Z",
    "modifiedBy": "admin"
  },
  "affectedComponents": ["heuristic-evaluator"]
}
```

---

## Audit Trail

Every policy change is logged to the audit log:

```javascript
{
  event: 'POLICY_CHANGED',
  timestamp: '2026-04-01T11:30:00Z',
  actor: 'admin',
  path: '/aware/policies/routing/heuristic.json',
  oldVersion: 42,
  newVersion: 43,
  changeReason: 'Increase trust_score weight...',
  affectedComponents: ['heuristic-evaluator'],
  validationResult: 'passed'
}
```

Audit logs are stored in etcd under `/aware/audit/policy-changes/` with 90-day retention.

---

## Admin Interface

For operational convenience, provide a CLI tool for policy management:

```bash
# List policies
aware-cli policy list

# Show specific policy
aware-cli policy get routing/heuristic

# Update policy (triggers hot-reload)
aware-cli policy set routing/heuristic --file ./new-heuristic.json --reason "Weight adjustment"

# Validate without applying
aware-cli policy validate routing/heuristic --file ./new-heuristic.json

# Force reload
aware-cli policy reload --component heuristic-evaluator

# Show audit history
aware-cli policy history --limit 20
```

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| PolicyWatcher | `src/routing/policy-watcher.js` | etcd watch subscription, debouncing |
| SchemaValidator | `src/routing/schema-validator.js` | JSON Schema validation |
| PolicyApplicator | `src/routing/policy-applicator.js` | Atomic policy application |
| PolicyStore | `src/routing/policy-store.js` | etcd read/write operations |
| AuditLogger | `src/routing/audit-logger.js` | Audit trail persistence |
| PolicyCLI | `cli/policy-cli.js` | Admin CLI tool |

---

## Open Questions

1. **Watch resumption**: If the PolicyWatcher crashes and restarts, how do we detect missed changes? (Need watch revision tracking or periodic full reconciliation)

2. **Validation in CI/CD**: Should policy changes be validated in a CI pipeline before being committed to etcd?

3. **Rollback mechanism**: Should we support rollback to previous policy version? (Would require storing N previous versions in etcd)

4. **Policy diff**: Should the API expose a `/diff` endpoint showing what would change before applying?

5. **Notification on failure**: If validation fails, who gets alerted? What's the escalation path?

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.OPS-03 (Change management) | All policy changes audited, validated before apply |
| NIST AI RMF | DE.CM-3 (External connectivity) | Blast radius changes require re-computation |
| ISO 27001 | A.12.1.2 (Change control) | Policy changes follow change management process |
| DORA | Art. 25 (Change management) | Policy version tracking for all routing decisions |

---

## Status

**DRAFT** — Ready for Critor review and Quinn integration testing.

---

*Phase 2 ADRs complete. Awaiting directive for Phase 3 (Security Control Plane).*
