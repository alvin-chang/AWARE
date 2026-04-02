# ADR-018: Phase 3.3 — Decision-Chain Traceability

**Status:** DRAFT (needs Critic review)  
**Author:** Archimedes  
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

**Current gap:** Decisions are logged individually but not linked into a tamper-evident chain. Investigators cannot trace: user request → orchestrator → agent routing → tool calls → output.

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

Each record's `hash` field is computed as:
```
hash = SHA256(decisionId + parentDecisionId + timestamp + actor + action + context + outcome + prevHash)
```

This creates an immutable chain — modifying any record invalidates all subsequent hashes.

---

## Implementation

### New Modules

**`src/audit/decision-logger.js`**
- `logDecision(decision)` — writes decision to append-only log
- `getChain(decisionId)` — retrieves full chain from root to decision
- `verifyChain()` — verifies hash integrity of entire log
- `exportChain(format)` — exports in JSON/SIEM-compatible format

**`src/audit/audit-store.js`**
- Append-only file-based storage (JSONL format)
- Optional etcd backend for distributed deployments
- Automatic hash verification on read

**`src/api/routes/audit.js`**
- `GET /api/audit/chain/:decisionId` — retrieve decision chain
- `GET /api/audit/verify` — verify chain integrity
- `GET /api/audit/export?from=&to=&format=` — export for compliance

### Integration Points

| Module | Integration |
|--------|-------------|
| Pheromone Router (`src/routing/`) | Log routing decisions with pheromone scores |
| Policy Engine (`src/policies/`) | Log allow/deny decisions with policy ID |
| Agent Registry (`src/agents/`) | Log agent onboarding/revocation |
| Tool Call Handler | Log tool access requests and outcomes |

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

**Critic review:** PENDING

**Implementation:** NOT STARTED

**Testing:** NOT STARTED
