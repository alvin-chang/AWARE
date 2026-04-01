# AWARE Phase 1.4 — Kill Switch (Raft Consensus) Audit
## Step 1 Findings — Researcher: Scout

**Project:** AWARE (Autonomous Warehouse Automated Resource Engine)  
**Canonical Path:** `~/src/AWARE/`  
**Phase:** Phase 1.4 — Kill Switch / Step 1 (Audit)  
**Date:** 2026-04-01  
**Status:** COMPLETE — Ready for Archimedes Step 2 (Architecture)  
**Gitea:** http://openclaw.local:3000/alvin/AWARE

---

## Executive Summary

AWARE has a Raft-inspired leader election system (`src/election/`) that handles queen-worker failover. The agent identity layer (`src/agents/`) has a local `revoke()` function that transitions agents to `REVOKED` state. **However, there is no mechanism to propagate revocations across the cluster via Raft consensus.**

The EVOLUTION-BRIEF.md specifies: *"Leverage AWARE's existing Raft consensus to propagate agent revocation cluster-wide"* and *"Extension point: existing leader election → add revocation broadcast to heartbeat protocol."* This audit identifies what exists, what's missing, and what must be built.

**Core finding:** Phase 1.4 requires new Raft log entry types, heartbeat protocol extensions, distributed revocation state, and task reassignment coordination. The foundation (election, state machine, agent registry) exists but is not integrated.

---

## Document Structure

1. [Existing Implementation Analysis](#existing-implementation-analysis)
2. [CRITICAL Findings](#critical-findings)
3. [HIGH Findings](#high-findings)
4. [MEDIUM Findings](#medium-findings)
5. [LOW Findings](#low-findings)
6. [Performance Findings](#performance-findings)
7. [Gap Analysis](#gap-analysis)
8. [Recommendations](#recommendations)

---

## Existing Implementation Analysis

### What Exists

| Component | File | Purpose | Kill Switch Readiness |
|-----------|------|---------|---------------------|
| Election Manager | `src/election/ElectionManager.js` | Leader election via RequestVote RPC | ✅ Foundation ready |
| State Machine | `src/election/state-machine.js` | Raft log replication | ⚠️ No revocation entry type |
| Network Partition Handler | `src/election/network-partition-handler.js` | Split-brain handling | ⚠️ No revocation awareness |
| Agent Model | `src/api/models/Agent.js` | NHI state transitions | ✅ `AgentState.REVOKED` exists |
| Agent Registry | `src/agents/registry.js` | Local revocation | ✅ `revoke()` exists |
| Identity Provider | `src/agents/identity-provider.js` | JWT lifecycle | ✅ Token cache invalidation exists |
| Audit Logging | `src/agents/registry.js` | Lifecycle audit | ✅ `audit()` exists |

### Raft Implementation Assessment

The current `ElectionManager.js` implements:
- Leader election via RequestVote RPC (Section 3.4 of Raft paper)
- Heartbeats via AppendEntries RPC (Section 3.5)
- Randomized election timeouts (150-300ms range)
- Term-based vote validity

**What's missing for Kill Switch:**
1. No `RevocationEntry` type in the log (vs `CommandEntry`)
2. No `revoke-agent` broadcast through existing heartbeat channel
3. No committed revocation applied to local state on followers
4. No majority-quorum requirement for revocation (leader acts unilaterally)
5. No revocation rollback mechanism

---

## CRITICAL Findings

### C-01: No Raft Log Entry Type for Agent Revocation

**Severity:** CRITICAL  
**Location:** `src/election/state-machine.js`

**Finding:** The Raft state machine only supports generic `CommandEntry` log entries. There is no dedicated `RevocationEntry` type for agent revocation operations. The heartbeat protocol (`sendHeartbeatToNode`) only sends empty `entries: []` — it cannot carry revocation payloads.

**Evidence:**
```javascript
// ElectionManager.js:sendHeartbeatToNode()
const heartbeat = {
  term: this.currentTerm,
  leaderId: this.nodeId,
  prevLogIndex: this.log.length - 1,
  prevLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
  entries: [],  // ← Always empty, cannot carry revocation
  leaderCommit: this.commitIndex
};
```

**Impact:** Even if a leader issues a revocation, followers have no mechanism to receive or apply it. The Raft consensus cannot be used for revocation propagation.

**Fix Required:**
1. Define `RevocationEntry` type: `{ type: 'agent_revoke', term, agentId, reason, initiator, timestamp }`
2. Extend `AppendEntries` RPC to carry revocation entries
3. Extend state machine `applyEntry()` to handle revocation entry type
4. Ensure revocation is committed before broadcast (Raft safety)

---

### C-02: Revocation Not Committed Through Raft Consensus

**Severity:** CRITICAL  
**Location:** `src/agents/registry.js:revoke()`

**Finding:** The `AgentRegistry.revoke()` function modifies local agent state directly without going through Raft log replication. This means:

1. **Single-node revocation:** Only the node that processes the revocation applies it
2. **No cluster-wide effect:** Other cluster nodes retain the agent as `ACTIVE`
3. **Byzantine failure possible:** If leader crashes mid-revocation, cluster may be in inconsistent state

**Evidence:**
```javascript
// AgentRegistry.js:revoke()
revoke(agentId, reason = 'manual') {
  const agent = Agent.findByAgentId(agentId);  // ← Local lookup
  if (!agent) { ... }
  const revoked = Agent.revoke(agent.id, reason);  // ← Local state only
  audit('AGENT_REVOKED', ...);  // ← Local audit only
  return { success: true, agent: revoked };  // ← No Raft commitment
}
```

**Impact:** A leader can claim to revoke an agent, but the revocation only takes effect locally. The agent continues to operate on other nodes that never received the revocation.

**Fix Required:**
1. Leader must append revocation as Raft log entry
2. Wait for majority replication before applying
3. Apply to committed state machine
4. Followers apply revocation after commit acknowledgment

---

### C-03: No Mechanism to Prevent Revocation on Stale Leaders

**Severity:** CRITICAL  
**Location:** `src/election/ElectionManager.js`

**Finding:** The current `handleRequestVote()` uses term-based validity checks, but there is no mechanism to prevent a **partitioned leader** from issuing revocations. If a network partition isolates the leader:

1. Leader continues to believe it is leader (heartbeat timeout not triggered on leader)
2. Leader can issue revocations that only affect its own partition
3. Other partition elects new leader but has no knowledge of revocations from old leader

**Evidence:**
```javascript
// ElectionManager.js:handleRequestVote()
handleRequestVote(term, candidateId, lastLogIndex, lastLogTerm) {
  if (term > this.currentTerm) {
    this.currentTerm = term;
    this.state = 'follower';  // ← Only steps down if term increases
    // ← No check for ongoing leader lease
  }
  // ← No revocation-specific safeguard
}
```

**Impact:** During network partitions, a stale leader could issue revocations that are irreversible even after partition heals.

**Fix Required:**
1. Implement leader lease mechanism (Extends Raft with: follower grants lease, leader extends lease via heartbeat, lease expiry triggers new election)
2. Revocations must carry lease epoch
3. Reject revocations from expired leases

---

## HIGH Findings

### H-01: No Distributed Revocation State Store

**Severity:** HIGH  
**Location:** `src/agents/registry.js` / data layer

**Finding:** The agent registry uses a local JSON file (`src/api/models/Agent.js` → `data/agents.json`) as its sole data store. Revocations are not persisted to a distributed store accessible by all cluster nodes.

**Evidence:**
```javascript
// Agent.js
const AGENTS_DATA_FILE = path.join(__dirname, '..', '..', 'data', 'agents.json');
static findByAgentId(agentId) {
  const agentsData = JSON.parse(fs.readFileSync(AGENTS_DATA_FILE, 'utf8'));  // ← Local file only
  ...
}
```

**Impact:** Each node has its own copy of `agents.json`. A revocation on node A does not propagate to nodes B and C. The system is not cluster-aware.

**Fix Required:**
1. Migrate agent state to distributed store (etcd per architecture docs, or Raft log as source of truth)
2. All state changes (including revocations) must go through Raft log
3. Followers reconstruct state from Raft log, not local files

---

### H-02: No Idempotent Revocation Handling

**Severity:** HIGH  
**Location:** `src/agents/registry.js:revoke()`

**Finding:** The revocation function throws an error if the agent is not in `ACTIVE` state:

```javascript
// Agent.js:transitionTo()
transitionTo(newState) {
  const validTransitions = {
    [AgentState.ACTIVE]: [AgentState.SUSPENDED, AgentState.REVOKED, AgentState.DECOMMISSIONED],
    [AgentState.REVOKED]: [AgentState.DECOMMISSIONED],  // ← Cannot go REVOKED → REVOKED
    ...
  };
}
```

If a revocation is issued twice (e.g., network retry), the second attempt throws an error.

**Impact:**
1. Raft log may contain duplicate `agent_revoke` entries for the same agent
2. Re-applying committed revocation will fail
3. Cannot achieve exactly-once revocation semantics

**Fix Required:**
1. Make revocation idempotent: `REVOKED → REVOKED` should be a no-op, not an error
2. Revocation log entry should include `index` for deduplication
3. State machine should skip already-revoked agents

---

### H-03: No Audit Log for Kill Switch Events

**Severity:** HIGH  
**Location:** `src/agents/registry.js` / `src/election/`

**Finding:** The existing audit log (`audit()` function) records agent lifecycle events but does not capture kill switch specifics:

```javascript
// registry.js:audit()
audit('AGENT_REVOKED', 'system', agent.agentId, 'SUCCESS', { reason });  // ← Basic
```

**Missing kill switch fields:**
- `initiator` — Who/what triggered the revocation (human operator, anomaly detector, automated policy)
- `triggerReason` — Specific reason (e.g., "anomaly detected: unusual tool-call pattern", "manual override")
- `quorumVotes` — How many nodes acknowledged the revocation
- `term` — Raft term at time of revocation
- `leaseEpoch` — Leader lease epoch
- `clusterNodeId` — Which node processed the revocation
- `taskReassignmentStatus` — Whether in-flight tasks were reassigned

**Impact:** Compliance reporting (DORA Art. 17, NIST AI RMF MANAGE 4.1) requires detailed kill switch audit trails.

**Fix Required:**
1. Extend audit entry schema to include all kill switch fields
2. Integrate with existing alert system (`src/alerts/`)
3. Ensure tamper-evidence (append-only, hash-chained)

---

### H-04: No Task Reassignment After Revocation

**Severity:** HIGH  
**Location:** `src/agents/registry.js` / ant colony coordination

**Finding:** The EVOLUTION-BRIEF.md specifies: *"Graceful degradation: revoked agent's in-flight tasks reassigned via ant colony rebalancing."* The current revocation function only transitions agent state — it does not:

1. Identify in-flight tasks assigned to the revoked agent
2. Trigger pheromone-based task reassignment
3. Transfer task state to a replacement agent
4. Notify upstream orchestrator of task transfer

**Evidence:**
```javascript
// registry.js:revoke()
revoke(agentId, reason = 'manual') {
  const revoked = Agent.revoke(agent.id, reason);  // ← State change only
  audit('AGENT_REVOKED', ...);
  return { success: true, agent: revoked };  // ← No task reassignment
}
```

**Impact:** Revoked agents leave tasks in indeterminate state. Clients may wait for responses that never arrive.

**Fix Required:**
1. Implement task tracking per agent (task queue)
2. On revocation: mark tasks for reassignment, trigger ant colony pheromone update
3. Emit `TASK_REASSIGNMENT_INITIATED` event with task IDs
4. Await acknowledgment from replacement agents

---

## MEDIUM Findings

### M-01: Revocation Timeout Not Enforced

**Severity:** MEDIUM  
**Location:** `src/agents/identity-provider.js`

**Finding:** When `revokeAgent()` is called, cached JWTs are invalidated immediately in the identity provider's token cache. However, there is no timeout on how long a revocation takes to propagate. With the current Raft heartbeat interval (100ms), worst-case propagation could be 100-300ms.

**Impact:** An agent with a freshly-issued JWT could execute one additional tool call during the propagation window.

**Fix Required:**
1. Implement shorter heartbeat interval for revocation-critical periods
2. Consider revocation as higher-priority RPC than standard heartbeat
3. Add `revocationDeadline` to JWT claims — agents should check with identity provider before sensitive operations

---

### M-02: No Bulk Revocation Support

**Severity:** MEDIUM  
**Location:** `src/agents/registry.js`

**Finding:** Revocation is agent-by-agent. There is no support for atomic bulk revocation (e.g., "revoke all agents of type X" or "revoke agents matching filter Y").

**Impact:**
1. Cannot handle correlated security incidents atomically (e.g., compromise of one agent may require revoking its collaborators)
2. Multiple Raft log entries required, increasing failure surface

**Fix Required:**
1. Implement `revokeAgents(filter)` with single Raft log entry
2. All-or-nothing semantics: either all matching agents are revoked or none
3. Include filter criteria in log entry for auditability

---

### M-03: No Revocation Rollback Mechanism

**Severity:** MEDIUM  
**Location:** `src/election/state-machine.js`

**Finding:** Raft provides log compaction and snapshotting, but there is no mechanism to rollback a revocation if it was issued in error. Once a revocation is committed, the only recovery is decommissioning the agent entirely.

**Impact:**
1. Accidental revocation (e.g., misidentified agent) cannot be undone
2. Compromised operator can permanently disable legitimate agents

**Fix Required:**
1. Implement `reinstatement` log entry type
2. `REVOKED → ACTIVE` transition allowed via Raft log
3. Reinstatement requires same quorum as original revocation
4. Track revocation-reinstatement pairs in audit log

---

### M-04: No Leader-Only Revocation Constraint

**Severity:** MEDIUM  
**Location:** `src/election/ElectionManager.js`

**Finding:** The current architecture allows any node to call `registry.revoke()`. However, per Raft safety, only the leader should be allowed to process state changes (including revocations). Followers that receive revocation requests should redirect to the leader.

**Evidence:**
```javascript
// ElectionManager.js — no leader check in revoke path
// AgentRegistry.js — no leader verification
```

**Impact:**
1. Follower could issue fraudulent revocation
2. Cluster state diverges (follower has revocation, leader does not)

**Fix Required:**
1. Add leader verification to all registry operations
2. Followers should return `{ redirect: true, leaderId }` for non-idempotent operations
3. Leader must verify `isLeader()` before appending to Raft log

---

## LOW Findings

### L-01: Election Timeout Too Short for Revocation Safety

**Severity:** LOW  
**Location:** `src/election/ElectionManager.js`

**Finding:** Election timeout range is 300-600ms. For kill switch operations, this means:
- Leader election could interrupt a revocation broadcast
- A newly elected leader may not have received the previous leader's revocation

**Impact:** Small window for inconsistency during leader transitions.

**Fix Required:**
1. During active revocation broadcast, extend heartbeat interval
2. New leader should not commit any entries until it has received all previous term's entries
3. Add `lastRevocationIndex` to vote requests

---

### L-02: No Rate Limiting on Revocation API

**Severity:** LOW  
**Location:** `src/api/routes/agents.js`

**Finding:** The revocation endpoint (`DELETE /api/agents/:agentId`) has no rate limiting. A compromised operator account could issue unlimited revocations.

**Impact:** Denial of service via mass revocation.

**Fix Required:**
1. Add rate limiting to revocation endpoint
2. Require additional confirmation (e.g., `reason` field, operator credentials)
3. Log all revocation attempts regardless of success/failure

---

### L-03: Heartbeat Does Not Carry Revocation State Hash

**Severity:** LOW  
**Location:** `src/election/ElectionManager.js:sendHeartbeatToNode()`

**Finding:** Heartbeat currently sends `leaderCommit` (last committed log index) but not a hash of the committed revocation set. Followers cannot detect whether they have missed a revocation.

**Impact:** If a follower misses a revocation entry, it may not detect the gap until a full log comparison.

**Fix Required:**
1. Include `revocationStateHash` in heartbeat: `SHA256(sorted(revokedAgentIds))`
2. Followers compare hash to detect revocation gaps
3. Trigger log replication if hash mismatch

---

## Performance Findings

### P-01: Linear Scan on Every Agent Lookup

**Severity:** PERFORMANCE  
**Location:** `src/api/models/Agent.js`

**Finding:** Every `findByAgentId()` and `findAll()` reads and parses the entire `agents.json` file:

```javascript
static findByAgentId(agentId) {
  const agentsData = JSON.parse(fs.readFileSync(AGENTS_DATA_FILE, 'utf8'));  // ← Full file read
  const agentData = agentsData.agents.find(a => a.agentId === agentId);  // ← Linear scan
  return agentData ? new Agent(agentData) : null;
}
```

**Impact:** With many agents, revocation verification (token validation path) becomes slow. Token verification is on the hot path for every agent request.

**Fix Required:**
1. Use in-memory index (`Map<agentId, Agent>`) with file as persistence
2. Invalidate index on Raft log application
3. Background sync from Raft log on follower

---

### P-02: Synchronous File I/O on Every Audit Entry

**Severity:** PERFORMANCE  
**Location:** `src/agents/registry.js`

**Finding:** Audit log is written synchronously to an in-memory array:

```javascript
const auditLog = [];
const audit = (event, initiator, target, result, metadata = {}) => {
  const entry = { timestamp, event, initiator, target, result, metadata };
  auditLog.push(entry);  // ← Synchronous, blocking
  console.log(`[AUDIT] ...`);  // ← Additional I/O
};
```

**Impact:** High-frequency revocations (e.g., bulk revocation during incident) could block the election loop.

**Fix Required:**
1. Async audit log write (batch to file periodically)
2. In-memory ring buffer with periodic flush
3. Integration with centralized logging (SIEM) for production

---

## Gap Analysis

### vs. EVOLUTION-BRIEF.md Requirements

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Leader can revoke any agent | ✅ Leader has `revoke()` | ❌ Only local, not cluster-wide |
| Immediate effect across all nodes | ❌ | No Raft broadcast |
| Graceful degradation (task reassignment) | ❌ | No task tracking |
| Audit log (timestamp, reason, initiator) | ⚠️ Partial | Missing Raft-specific fields |
| Extend heartbeat protocol | ❌ | Heartbeat carries empty `entries` |

### vs. Enterprise Products (Okta Agent Gateway, Microsoft Agent 365)

| Feature | Okta Agent Gateway | Microsoft Agent 365 | AWARE (Current) |
|---------|-------------------|---------------------|-----------------|
| Distributed kill switch | ✅ | ✅ | ❌ (single-node) |
| Consensus-based revocation | ✅ | ✅ | ❌ |
| Automatic task reassignment | ❌ | ❌ | ❌ |
| Compliance-ready audit trail | ✅ | ✅ | ⚠️ (partial) |
| Idempotent revocation | ✅ | ✅ | ❌ |
| Bulk revocation | ✅ | ✅ | ❌ |
| Revocation rollback | ❌ | ❌ | ❌ |

---

## Recommendations

### Priority Order for Implementation

1. **C-01 + C-02 (CRITICAL):** Add Raft log entry type + broadcast mechanism
2. **H-01 (HIGH):** Migrate to distributed agent state (Raft log as source of truth)
3. **C-03 (CRITICAL):** Leader lease mechanism to prevent stale leader revocations
4. **H-04 (HIGH):** Task reassignment coordination
5. **H-03 (HIGH):** Extend audit log schema
6. **M-01 through M-04 (MEDIUM):** Various safety and correctness improvements
7. **L-01 through L-03 + P-01 + P-02 (LOW/PERF):** Polish and optimization

### Implementation Approach

The Raft heartbeat extension is the natural integration point:

```javascript
// Extended AppendEntries RPC
{
  term,
  leaderId,
  prevLogIndex,
  prevLogTerm,
  entries: [
    // Existing command entries
    { type: 'command', index, term, command },
    // NEW: revocation entry
    { type: 'agent_revoke', index, term, agentId, reason, initiator, timestamp }
  ],
  leaderCommit,
  // NEW: revocation metadata
  revocationStateHash: SHA256(sorted(activeRevokedAgentIds))
}
```

### ADR Required

Before implementation, Archimedes should author an ADR covering:
- **ADR-011:** Raft log entry types for agent lifecycle
- **ADR-012:** Heartbeat protocol extension for revocation broadcast
- **ADR-013:** Leader lease mechanism for revocation safety
- **ADR-014:** Task reassignment coordination protocol

---

## Findings Summary

| Severity | Count | Issues |
|----------|-------|--------|
| CRITICAL | 3 | C-01 (no revocation entry type), C-02 (no Raft consensus), C-03 (stale leader risk) |
| HIGH | 4 | H-01 (no distributed state), H-02 (no idempotency), H-03 (incomplete audit), H-04 (no task reassignment) |
| MEDIUM | 4 | M-01 (timeout gap), M-02 (no bulk revoke), M-03 (no rollback), M-04 (no leader constraint) |
| LOW | 3 | L-01 (timeout), L-02 (no rate limit), L-03 (no state hash) |
| Performance | 2 | P-01 (linear scan), P-02 (sync I/O) |

**Total: 16 findings**

---

## Appendix: Relevant Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/election/ElectionManager.js` | 188 | Raft leader election |
| `src/election/state-machine.js` | 148 | Raft log replication |
| `src/election/network-partition-handler.js` | 170 | Split-brain handling |
| `src/agents/registry.js` | 240 | Agent registry + revoke |
| `src/agents/identity-provider.js` | 189 | JWT issuance + verification |
| `src/api/models/Agent.js` | 237 | Agent state machine |

---

*Audit complete. Ready for Step 2 (Architecture) with Archimedes.*
