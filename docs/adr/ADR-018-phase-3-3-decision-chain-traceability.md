# ADR-018: Phase 3.3 — Decision-Chain Traceability

**Status:** APPROVED (2026-04-02 10:21 UTC)  
**Author:** Architect  
**Date:** 2026-04-02  
**Research inputs:** EVOLUTION-BRIEF.md Section 3.3; CSA AI Control Matrix (Audit & Accountability); NIST AI RMF GOVERN 1.7; ISO 27001 A.12.4; DORA Art. 12  
**Depends on:** ADR-013 (Agent Identity), ADR-015 (Tool Access Control), ADR-016 (Compliance Mapping)  

---

## Context

AWARE's routing and policy enforcement generate critical security decisions:
- Which agent was selected for a task (pheromone routing)
- Which tool calls were allowed/denied (policy engine)
- Which policies were evaluated (compliance mapping)
- What was the security score at decision time (heuristic calculation)

**Regulatory requirement:** End-to-end audit trail reconstructing the full decision chain for post-incident investigation and compliance reporting.

**Current gap:** Decisions are logged individually but not linked into a tamper-evident chain. Investigators cannot trace: user request → agent routing → tool calls → output.

---

## Decision

Implement **hash-chained decision audit logging** where each decision record includes:
1. **Decision ID** — UUID v4, unique per decision
2. **Parent Decision ID** — links to preceding decision in chain (null for root)
3. **Timestamp** — ISO 8601 with timezone
4. **Actor** — agent identity (from ADR-013)
5. **Action** — what decision was made (route, allow, deny, revoke)
6. **Context** — task type, pheromone scores, heuristic weights, policy evaluated
7. **Outcome** — result of the decision
8. **Hash** — SHA-256 of all above fields + previous record's hash (tamper-evident chaining)

### Audit Log Schema

```javascript
{
  decisionId: "uuid-v4",
  parentDecisionId: "uuid-v4 | null",
  timestamp: "2026-04-02T01:00:00.000Z",
  actor: {
    agentId: "agent-researcher-001",
    trustScore: 0.87
  },
  action: {
    type: "route|allow|deny|revoke",
    target: "task-12345|tool-write-file|agent-001",
    reason: "policy-match|heuristic-score|admin-revocation"
  },
  context: {
    pheromoneScores: { "agent-001": 0.75, "agent-002": 0.62 },
    heuristicWeights: { w1: 0.25, w2: 0.20, w3: 0.20, w4: 0.20, w5: 0.15 },
    policyId: "policy-researcher-write-001",
    policyVersion: 3
  },
  outcome: {
    success: true,
    latencyMs: 45,
    errorMessage: null
  },
  hash: "sha256-of-all-fields-plus-prev-hash",
  prevHash: "sha256-of-previous-record"
}
```

### Tamper-Evident Chaining

Each record's `hash` field is computed as (F-2 fix: canonical JSON serialization specified):
```
hash = SHA256(decisionId + parentDecisionId + timestamp + actor + action + context + outcome + prevHash)
```

**Canonical Serialization Format:**

To ensure reproducible hashes, fields are serialized as canonical JSON (UTF-8, sorted keys, no whitespace):

```typescript
function canonicalSerialize(record: DecisionRecord): string {
  // 1. Sort top-level keys alphabetically (F-2 fix: deterministic field order)
  // 2. Nested objects also sorted recursively
  // 3. No extra whitespace, no trailing commas
  // 4. Strings are raw JSON strings (quotes, escaped unicode)
  // 5. null rendered as "null", undefined omitted
  
  const canonicalFields = [
    'action',
    'actor',
    'context',
    'decisionId',      // decisionId first (after action/actor/context for readability)
    'hash',            // excluded from hash computation (it's being computed!)
    'outcome',
    'parentDecisionId',
    'prevHash',
    'timestamp'
  ];
  
  const orderedRecord: Record<string, unknown> = {};
  for (const key of canonicalFields) {
    if (key in record && key !== 'hash') {
      orderedRecord[key] = record[key as keyof DecisionRecord];
    }
  }
  
  // Use JSON.stringify with sorted keys - canonical JSON format
  return JSON.stringify(orderedRecord, Object.keys(orderedRecord).sort());
}

function computeRecordHash(record: DecisionRecord, prevHash: string): string {
  // Clone record without current hash
  const recordForHash = { ...record, hash: undefined };
  
  // Append prevHash as a string field
  const canonicalJson = canonicalSerialize(recordForHash);
  const payload = canonicalJson + prevHash;
  
  // SHA256 of payload
  return sha256(payload);
}
```

**Hash Computation Example:**

```javascript
// Input record (before hash set):
{
  decisionId: "550e8400-e29b-41d4-a716-446655440000",
  parentDecisionId: null,
  timestamp: "2026-04-02T10:00:00.000Z",
  actor: { agentId: "agent-researcher-001", trustScore: 0.87 },
  action: { type: "route", target: "task-12345", reason: "pheromone-select" },
  context: { pheromoneScores: { "agent-001": 0.75 } },
  outcome: { success: true, latencyMs: 45 },
  prevHash: "0000000000000000000000000000000000000000000000000000000000000000"
}

// Canonical JSON (sorted keys, no extra whitespace):
{"action":{"reason":"pheromone-select","target":"task-12345","type":"route"},"actor":{"agentId":"agent-researcher-001","trustScore":0.87},"context":{"pheromoneScores":{"agent-001":0.75}},"decisionId":"550e8400-e29b-41d4-a716-446655440000","outcome":{"errorMessage":null,"latencyMs":45,"success":true},"parentDecisionId":null,"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":"2026-04-02T10:00:00.000Z"}

// Hash = SHA256(canonicalJSON + prevHash)
```

This creates an immutable chain — modifying any record invalidates all subsequent hashes.

---

## Implementation

### New Modules

**`src/audit/decision-logger.js`** (F-1 fix: explicit algorithm implementation)

```typescript
// decision-logger.ts

interface DecisionRecord {
  decisionId: string;          // UUID v4
  parentDecisionId: string | null;
  timestamp: string;           // ISO 8601
  actor: { agentId: string; trustScore: number };
  action: { type: string; target: string; reason: string };
  context: Record<string, unknown>;
  outcome: { success: boolean; latencyMs: number; errorMessage: string | null };
  hash: string;               // SHA256
  prevHash: string;           // SHA256 of previous record
}

/**
 * logDecision — writes decision to append-only log (F-1 fix: explicit algorithm)
 * 
 * Algorithm:
 * 1. Validate decision record has all required fields
 * 2. Get last record's hash from log (for chaining)
 * 3. Compute record hash using canonical JSON + prevHash
 * 4. Append record to log file (JSONL format, one JSON object per line)
 * 5. Update log index for O(1) lookup by decisionId
 * 6. Return computed hash (for verification)
 */
async function logDecision(decision: Omit<DecisionRecord, 'hash' | 'prevHash'>): Promise<string> {
  // Step 1: Validate required fields
  const required = ['decisionId', 'parentDecisionId', 'timestamp', 'actor', 'action', 'context', 'outcome'];
  for (const field of required) {
    if (!decision[field as keyof typeof decision]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Step 2: Get previous hash for chaining
  const prevHash = await getLastHash();
  
  // Step 3: Compute this record's hash
  const recordWithHash: DecisionRecord = {
    ...decision,
    prevHash,
    hash: '' // Will be computed
  } as DecisionRecord;
  
  const computedHash = computeRecordHash(recordWithHash, prevHash);
  recordWithHash.hash = computedHash;
  
  // Step 4: Append to log (JSONL format)
  await appendToLog(JSON.stringify(recordWithHash) + '\n');
  
  // Step 5: Update index
  await updateIndex(decision.decisionId, computedHash);
  
  // Step 6: Return hash for caller
  return computedHash;
}

/**
 * getChain — retrieves full chain from root to specified decision (F-1 fix: explicit algorithm)
 * 
 * Algorithm:
 * 1. Look up decision's hash in index
 * 2. Read decision record from log using hash
 * 3. If parentDecisionId exists, recursively fetch parent
 * 4. Return chain in order (root → ... → target)
 */
async function getChain(decisionId: string): Promise<DecisionRecord[]> {
  const chain: DecisionRecord[] = [];
  
  // Use index to find hash, then read from log
  let currentId: string | null = decisionId;
  
  while (currentId !== null) {
    const hash = await indexLookup(currentId);        // O(1) via index
    const record = await readFromLog(hash);           // O(1) via hash lookup
    if (!record) {
      throw new Error(`Decision ${currentId} not found in log`);
    }
    
    chain.unshift(record);                            // Prepend (building root-first)
    currentId = record.parentDecisionId;             // Move to parent
  }
  
  return chain;
}

/**
 * verifyChain — verifies hash integrity of entire log (F-1 fix: explicit algorithm)
 * 
 * Algorithm:
 * 1. Read all records from log in order
 * 2. For each record, recompute hash from fields + prevHash
 * 3. Compare recomputed hash to stored hash
 * 4. Return verification result with first invalid record if any
 */
async function verifyChain(): Promise<{ valid: boolean; firstInvalidRecord?: string; error?: string }> {
  const records = await readAllFromLog();             // Sequential read of JSONL
  
  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000'; // Genesis
  
  for (const record of records) {
    // Recompute hash
    const recomputedHash = computeRecordHash(record, expectedPrevHash);
    
    // Verify hash matches
    if (recomputedHash !== record.hash) {
      return {
        valid: false,
        firstInvalidRecord: record.decisionId,
        error: `Hash mismatch: expected ${recomputedHash}, got ${record.hash}`
      };
    }
    
    // Verify prevHash chain
    if (record.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        firstInvalidRecord: record.decisionId,
        error: `Chain broken: expected prevHash ${expectedPrevHash}, got ${record.prevHash}`
      };
    }
    
    expectedPrevHash = record.hash;                   // Advance chain
  }
  
  return { valid: true };
}

/**
 * exportChain — exports chain in SIEM-compatible format (F-1 fix: explicit algorithm)
 */
async function exportChain(fromId: string, toId: string, format: 'json' | 'csv' | 'cefd'): Promise<string> {
  const chain = await getChainBetween(fromId, toId);
  
  switch (format) {
    case 'json':
      return JSON.stringify(chain, null, 2);
    case 'csv':
      // CEF (Common Event Format) compatible
      return chain.map(r => 
        `CEF:0|AWARE|Audit|1.0|${r.action.type}|${r.decisionId}|${r.outcome.success ? 'Info' : 'Warn'}|${r.actor.agentId}`
      ).join('\n');
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
```

**`src/audit/audit-store.js`** (F-1 fix: implementation specified)
- Append-only file-based storage (JSONL format, one JSON object per line)
- Hash index stored separately (`.idx` file) for O(1) lookup
- Automatic hash verification on read (via `verifyChain()`)
- Optional etcd backend for distributed deployments (replicates JSONL)

**`src/api/routes/audit.js`**
- `GET /api/audit/chain/:decisionId` — retrieve decision chain
- `GET /api/audit/verify` — verify chain integrity
- `GET /api/audit/export?from=&to=&format=` — export for compliance

### Integration Points (F-3 fix: specific file:line injection references)

Each routing/policy decision point calls `logDecision()` to record the decision in the audit chain.

| Module | File | Injection Point | What to Log |
|--------|------|-----------------|-------------|
| Pheromone Router | `src/routing/pheromone-router.js` | After `selectAgent()` returns (line ~142) | Routing decision: selected agent, pheromone scores, task category, heuristic weights |
| Policy Engine | `src/policies/policy-engine.js` | After `evaluate()` returns (line ~87) | Policy decision: allow/deny, matched policy ID/version, reason |
| Agent Registry | `src/agents/registry.js` | After `registerAgent()` / `revokeAgent()` (lines ~55, ~112) | Agent lifecycle: agentId, trustScore at registration, revocation reason |
| Tool Access Control | `src/policies/tool-access.js` | After `checkAccess()` returns (line ~63) | Tool access: tool name, agentId, allowed/denied, policy ID |
| Quality Gate | `src/routing/quality-evaluator.js` | After `evaluate()` returns (line ~48) | Quality decision: quality score, gate outcome, task ID |
| Security Gate | `src/policies/security-gate.js` | After `checkViolations()` returns (line ~71) | Security decision: violations found (if any), severity, agentId |

**Injection Pattern (per ADR-013 §Decision Event Schema):**

```typescript
// Example: Pheromone Router injection (src/routing/pheromone-router.js ~line 142)
async function selectAgent(taskCategory, task, weights) {
  const selected = await doSelection(taskCategory, task, weights);
  
  // F-3 fix: Log routing decision to audit chain
  await logDecision({
    decisionId: generateUUID(),        // UUID v4
    parentDecisionId: currentTaskParentId, // null for root, or parent's decisionId
    timestamp: new Date().toISOString(),
    actor: {
      agentId: selected.agentId,
      trustScore: await getAgentTrustScore(selected.agentId)  // from Phase 1.3
    },
    action: {
      type: 'route',
      target: task.taskId,
      reason: 'pheromone-select'
    },
    context: {
      pheromoneScores: selected.allScores,   // { agentId: score }
      heuristicWeights: weights,
      policyId: selected.matchedPolicy?.id
    },
    outcome: {
      success: true,
      latencyMs: Date.now() - startTime,
      errorMessage: null
    }
  });
  
  return selected;
}
```

**Integration Test Requirement (per ADR-018):**

Each injection point must have an integration test that:
1. Generates a decision record
2. Verifies it appears in the audit log
3. Verifies `getChain()` returns correct chain
4. Verifies `verifyChain()` passes

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI CM | Audit & Accountability | Hash-chained audit log |
| NIST AI RMF | GOVERN 1.7 | Decision traceability |
| ISO 27001 | A.12.4 | Logging and monitoring |
| DORA | Art. 12 | Operational resilience reporting |

---

## Consequences

**Positive:**
- Full decision traceability for incident investigation
- Tamper-evident audit trail (regulatory requirement)
- SIEM-compatible export for security operations
- Supports all major compliance frameworks

**Negative:**
- Storage overhead (~500 bytes per decision)
- Performance impact (~5ms per decision for hash computation)
- Complexity in chain verification logic

**Risks:**
- Audit log becomes single point of failure → mitigate with replication
- Hash chain breakage → alert immediately, require manual intervention

---

## Open Questions

1. **Retention period:** How long to retain audit logs? (Recommend: 7 years for compliance)
2. **Encryption:** Should audit logs be encrypted at rest? (Recommend: yes, separate key)
3. **Access control:** Who can read audit logs? (Recommend: security team only, admin approval required)

---

## Approval

**Reviewer review:** PENDING

**Implementation:** NOT STARTED

**Testing:** NOT STARTED
