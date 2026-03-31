# ADR-009: Phase 2.1 — Task-Specific Pheromone Specialists

**Status:** DRAFT  
**Author:** Archimedes  
**Date:** 2026-03-31  
**Research inputs:** Scout (commit `bba2ce6`), AMRO-S paper (arXiv:2603.12933)  
**Depends on:** ADR-003 / Phase 1b (Policy Engine + Per-Agent Sandboxes)  

---

## Context

Phase 1 established the Agent Identity Layer (ADR-001) and Policy Engine (ADR-003): agents have identities, sandbox policies, and behavioural baselines. Phase 2 extends this to **routing intelligence** — selecting the optimal agent for a given task.

AMRO-S (Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimisation, arXiv:2603.12933) provides the core pattern: **pheromone-based routing** where agents deposit virtual pheromones on paths they traverse, and future agents follow high-pheromone paths with probability proportional to pheromone strength.

A critical limitation of a single global pheromone table is **cross-task interference** (AMRO-S Section 3.2): pheromones deposited by code-generation tasks reward paths that may be suboptimal for research tasks, degrading overall routing quality by 40-60% in mixed-task environments.

Phase 2.1 addresses this by implementing **task-specific pheromone specialists** — separate pheromone tables per task category, preventing cross-task pheromone contamination.

---

## Decision

Implement **task-specific pheromone specialist matrices** (AMRO-S Section 3.2 pattern) where each task category t has an independent pheromone matrix τ^t. This prevents cross-task pheromone contamination that degrades routing quality by 40-60% in mixed-task environments.

### AMRO-S Mathematical Framework

AMRO-S defines the pheromone state at time t as a set of specialist matrices {τ^t}, where each τ^t_ij represents the accumulated utility of transitioning from agent i to agent j under task category t.

**Query-conditioned pheromone fusion (AMRO-S equation):**
```
τ^(q)_ij = Σ_t∈T  w_t(q) · τ^t_ij
```
where w_t(q) is the semantic attribution weight for task t given query q, and T is the set of task categories.

This factorize–fuse design:
- Isolates task memories within specialist matrices to prevent contamination
- Enables smooth interpolation for mixed-intent queries

**Implementation:** We maintain separate τ^t matrices per TaskCategory. For routing decision, we use τ^taskCategory_ij directly (no fusion needed for single-category tasks).

### Task Category Definitions

```typescript
enum TaskCategory {
  CODE_GENERATION = 'code-generation',
  RESEARCH = 'research',
  SECURITY_REVIEW = 'security-review',
  DATA_ANALYSIS = 'data-analysis',
  COORDINATION = 'coordination',
  GENERAL = 'general',
}

interface PheromoneMatrix {
  category: TaskCategory;
  // agent-to-agent transition pheromone strengths
  transitions: Map<string, Map<string, number>>; // fromAgentId → toAgentId → pheromone strength
  // standalone agent pheromone strengths (terminal nodes)
  agents: Map<string, number>; // agentId → pheromone strength
  updatedAt: Date;
  decayRate: number; // per-hour decay coefficient
  version: number;   // optimistic concurrency control
}
```

Note: We extend AMRO-S with per-agent standalone pheromone strengths (τ_i) for agents that are terminal nodes (selected without a transition from another agent).

### Per-Category Decay Rates

Different task categories have different volatility profiles:

| Category | Typical Task Duration | Pheromone Decay Rate | Rationale |
|----------|----------------------|---------------------|-----------|
| CODE_GENERATION | Minutes | 0.15/hour | Fast-changing requirements, model upgrades invalidate quickly |
| RESEARCH | Hours | 0.05/hour | Longer validity, knowledge积累 |
| SECURITY_REVIEW | Minutes | 0.20/hour | High-stakes, must adapt fast to new vulnerabilities |
| DATA_ANALYSIS | Hours | 0.03/hour | Stable patterns, slow drift |
| COORDINATION | Seconds | 0.30/hour | Near-real-time, high turnover |
| GENERAL | Variable | 0.10/hour | Default |

Decay rates are configurable per deployment in `config/pheromone-rates.yaml`.

---

## Pheromone Operations

### 1. Quality + Security Gated Deposit (after task completion)

**AMRO-S pattern:** Only gated samples reinforce pheromones. AMRO-S uses LLM-Judge binary quality gate (g ∈ {0,1}).

**AWARE extension:** AWARE's gate must pass BOTH quality AND security validation before pheromone reinforcement.

```typescript
interface SecurityGateResult {
  passed: boolean;
  reasons: string[];        // reasons if failed
  contentFilterPassed: boolean;
  policyViolations: string[];
  dataLeakageDetected: boolean;
  toolAuthPassed: boolean;
}

interface QualityGateResult {
  passed: boolean;
  qualityScore: number;     // 0.0–1.0
  reasons: string[];
}

interface PheromoneDeposit {
  taskCategory: TaskCategory;
  taskId: string;
  pathAgents: string[];     // ordered list of agents on this path: [A, B, C] means A→B→C
  qualityGate: QualityGateResult;
  securityGate: SecurityGateResult;
}
```

**Quality + Security Gate (Phase 2.3 — detailed in ADR-010):**
```
gate_passed = qualityGate.passed AND securityGate.passed
```

**Deposit operation:**
```typescript
function depositPheromone(deposit: PheromoneDeposit): void {
  // Phase 2.3 quality gate must pass before reinforcement
  if (!deposit.qualityGate.passed || !deposit.securityGate.passed) {
    logPheromoneSkipped(deposit);
    return; // No reinforcement for failed gates
  }

  const table = getOrCreateTable(deposit.taskCategory);
  
  // Combined quality-security score (Phase 2.3 defines exact weights)
  // w_quality + w_security = 1.0
  const qualityWeight = 0.7;
  const securityWeight = 0.3;
  const combinedScore = 
    (deposit.qualityGate.qualityScore * qualityWeight) +
    (deposit.securityGate.contentFilterPassed ? 1.0 : 0.0) * securityWeight;

  // AMRO-S reinforcement formula: τ_new = (1-ρ)·τ_old + Δτ
  // where Δτ = w_t(q) · Q / (f_sys(P) + ε)
  const evaporationRate = table.decayRate / 3600; // per-second
  const reinforcement = combinedScore;

  // Update transition pheromones (fromAgent → toAgent)
  for (let i = 0; i < deposit.pathAgents.length - 1; i++) {
    const from = deposit.pathAgents[i];
    const to = deposit.pathAgents[i + 1];
    const current = table.transitions.get(from)?.get(to) ?? 0.0;
    const updated = current + (1 - current) * reinforcement;
    setTransition(table, from, to, updated);
  }

  // Update terminal agent pheromone (last agent in path)
  const terminalAgent = deposit.pathAgents[deposit.pathAgents.length - 1];
  const terminalCurrent = table.agents.get(terminalAgent) ?? 0.0;
  table.agents.set(terminalAgent, terminalCurrent + (1 - terminalCurrent) * reinforcement);

  table.updatedAt = new Date();
  table.version++;
}
```

**Negative Reinforcement (policy violations — Phase 2.3):**
```typescript
function applyNegativeReinforcement(deposit: PheromoneDeposit, violationSeverity: number): void {
  // Penalty proportional to severity (0.0–1.0, higher = more severe)
  // Severity 1.0 → 50% pheromone reduction on affected paths
  const penalty = violationSeverity * 0.5;
  
  const table = getOrCreateTable(deposit.taskCategory);
  
  for (const agentId of deposit.pathAgents) {
    const current = table.agents.get(agentId) ?? 0.0;
    table.agents.set(agentId, current * (1 - penalty));
  }
  
  for (let i = 0; i < deposit.pathAgents.length - 1; i++) {
    const from = deposit.pathAgents[i];
    const to = deposit.pathAgents[i + 1];
    const current = table.transitions.get(from)?.get(to) ?? 0.0;
    setTransition(table, from, to, current * (1 - penalty));
  }
  
  logPheromonePenalty(deposit, penalty);
}
```

### 2. Evaporate (periodic background job)

```typescript
function evaporatePheromones(): void {
  for (const table of allTables()) {
    const decay = table.decayRate / 3600; // per-second decay
    for (const [agentId, strength] of table.trails) {
      const evaporated = strength * (1 - decay);
      if (evaporated < 0.01) {
        table.trails.delete(agentId); // prune near-zero trails
      } else {
        table.trails.set(agentId, evaporated);
      }
    }
  }
}
```

Run evaporation every 60 seconds via `setInterval`.

### 3. Select (routing decision with security-weighted heuristic)

```typescript
interface RoutingCandidate {
  agentId: string;
  pheromoneStrength: number;
  heuristicScore: number;   // from Phase 2.2 security-weighted heuristic
}

/**
 * Security-weighted heuristic function (Phase 2.2 — detailed in ADR-011).
 * 
 * Standard AMRO-S heuristic:
 *   η_j(t) = λ_A · Ability~[j][t] + λ_L · (1/Load[j] + ε) + λ_R · (1/RT[j] + ε)
 * 
 * AWARE extension (EVOLUTION-BRIEF.md Section 2.2):
 *   n_secure(agent, task) = w1·capability + w2·load_balance 
 *                          + w3·trust_score + w4·data_clearance + w5·blast_radius_inverse
 * 
 * Where:
 *   - w1–w5: configurable weights (Phase 2.2 defines defaults)
 *   - trust_score: derived from Phase 1.3 behavioural baseline
 *   - blast_radius_inverse: estimated impact if agent compromised mid-task (1 = minimal, 0 = catastrophic)
 */
function computeHeuristic(agentId: string, task: Task): number {
  // Phase 2.2 ADR defines exact implementation
  throw new Error('ADR-011: Security-Weighted Heuristic (pending)');
}

function selectAgent(taskCategory: TaskCategory, task: Task): RoutingCandidate {
  const table = getTable(taskCategory);
  if (!table || (table.transitions.size === 0 && table.agents.size === 0)) {
    return defaultFallback(); // load-balance across available agents
  }

  // AMRO-S probabilistic selection: P(agent) ∝ pheromone^α × heuristic^β
  const candidates = buildCandidateList(table, task);

  if (candidates.length === 0) {
    return defaultFallback();
  }

  // Normalise pheromones
  const pheromoneSum = candidates.reduce((s, c) => s + c.pheromoneStrength, 0);
  
  // Compute heuristic scores (Phase 2.2)
  const candidatesWithHeuristic = candidates.map(c => ({
    ...c,
    heuristicScore: computeHeuristic(c.agentId, task),
  }));
  const heuristicSum = candidatesWithHeuristic.reduce((s, c) => s + c.heuristicScore, 0);

  // AMRO-S soft-max selection
  const probabilities = candidatesWithHeuristic.map(c => ({
    agentId: c.agentId,
    probability: pheromoneSum > 0 
      ? ((c.pheromoneStrength / pheromoneSum) ** ALPHA) * 
        (heuristicSum > 0 ? (c.heuristicScore / heuristicSum) ** BETA : 1)
      : 0,
  }));

  return weightedRandomSelect(probabilities);
}

function buildCandidateList(table: PheromoneMatrix, task: Task): RoutingCandidate[] {
  const candidates: RoutingCandidate[] = [];
  
  // Terminal agents (no outgoing transition)
  for (const [agentId, pheromone] of table.agents) {
    candidates.push({ agentId, pheromoneStrength: pheromone });
  }
  
  // Agents reachable via transitions from other agents
  for (const [from, toMap] of table.transitions) {
    for (const [to, pheromone] of toMap) {
      if (!candidates.find(c => c.agentId === to)) {
        candidates.push({ agentId: to, pheromoneStrength: pheromone });
      }
    }
  }
  
  return candidates;
}
```

**Hyperparameters (configurable):**
- `ALPHA = 1.0` — pheromone weight
- `BETA = 0.5` — heuristic weight
- Default weights for security heuristic (w1–w5): Phase 2.2 ADR defines

---

## Pheromone Persistence

Pheromone tables are stored in etcd, leveraging existing AWARE data store:

```
/aware/pheromones/{category}       → JSON PheromoneTable
/aware/pheromones/{category}/meta  → { updatedAt, decayRate, version }
```

Periodically serialise to disk (`/data/pheromones/`) for durability across restarts. On startup, reload from etcd; if etcd empty, rebuild from disk.

---

## Task Category Classification

Tasks arriving at the router are classified into categories:

```typescript
interface TaskClassifier {
  classify(task: { prompt: string; metadata?: Record<string, unknown> }): TaskCategory;
}

// Rule-based classifier (extendable to ML classifier in Phase 2.3)
const KEYWORD_PATTERNS: Record<TaskCategory, string[]> = {
  [TaskCategory.CODE_GENERATION]: ['write', 'implement', 'refactor', 'debug', 'test', 'function', 'class'],
  [TaskCategory.RESEARCH]: ['research', 'find', 'analyse', 'investigate', 'compare'],
  [TaskCategory.SECURITY_REVIEW]: ['security', 'vulnerability', 'audit', 'penetration', 'CVE'],
  [TaskCategory.DATA_ANALYSIS]: ['data', 'statistics', 'chart', 'graph', 'calculate', 'trend'],
  [TaskCategory.COORDINATION]: ['orchestrate', 'coordinate', 'delegate', 'route', 'schedule'],
  [TaskCategory.GENERAL]: [],
};

function classifyTask(task: Task): TaskCategory {
  const prompt = task.prompt.toLowerCase();
  for (const [category, keywords] of Object.entries(KEYWORD_PATTERNS)) {
    if (category === TaskCategory.GENERAL) continue;
    if (keywords.some(k => prompt.includes(k))) {
      return category as TaskCategory;
    }
  }
  return TaskCategory.GENERAL;
}
```

Classification is logged to the pheromone audit trail (Phase 2.4) for interpretability.

---

## Implementation Order

1. **PheromoneTable data model** — add `src/routing/pheromone-table.ts`
2. **Etcd persistence layer** — read/write pheromone tables to etcd
3. **Deposit operation** — called after Phase 2.3 quality gate passes
4. **Evaporation job** — background interval, configurable
5. **Task classifier** — rule-based classification by keyword
6. **Select operation** — probabilistic routing using AMRO-S formula
7. **Health dashboard** — expose pheromone table stats via existing dashboard

---

## Test Requirements

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Task with CODE_GENERATION keywords routed to code-generation table | Table updated on completion |
| 2 | RESEARCH task pheromones do NOT appear in CODE_GENERATION table | Tables isolated |
| 3 | After 1 hour, low-strength trails (<0.01) are pruned | Table size bounded |
| 4 | Agent with 0.8 pheromone strength selected over 0.2 with probability ~0.8/(0.8+0.2) | Probabilistic selection works |
| 5 | New agent with no pheromone history gets default load-balance | Fallback on empty table |
| 6 | Evaporation reduces all trails by ~5% per hour (RESEARCH) | Decay applied |
| 7 | Task with no keywords classified as GENERAL | Default category |

---

## Out of Scope (Phase 2.1)

- Phase 2.2: Security-weighted heuristic function (separate ADR)
- Phase 2.3: Quality-gated reinforcement (separate ADR)
- Phase 2.4: Interpretable routing audit (separate ADR)
- ML-based task classifier (future work)
- Pheromone anomaly detection (Phase 3)

---

## Dependencies

- Phase 1.1 Agent Registry (ADR-001) — agents must be registered to receive pheromone scores
- Phase 1.3 Behavioural Baseline (ADR-004) — securityScore from anomaly detection
- etcd on port 18900 — pheromone table storage
- Existing data store (`/data/pheromones/`) — disk persistence

---

## Security Model

- Pheromone tables are **append-optimised**: writes only on task completion, reads on every routing decision
- Evaporation is **non-destructive** (never deletes recent high-quality trails)
- Task classification is **loggable** (Phase 2.4 audit trail) — no classification bypass
- No agent can modify another agent's pheromone trail directly; only the router can update trails after quality-gated completion

---

## Differentiation from AMRO-S

AMRO-S Section 3.2 proposes task-specific specialists but does not specify:
- Decay rate per task category (we add configurable rates)
- Persistence backend (we specify etcd + disk)
- Security-weighted reinforcement (Phase 2.3)
- Interpretable audit trail (Phase 2.4)

### AMRO-S Comparison Summary

| Feature | AMRO-S | AWARE Phase 2.1 |
|---------|--------|----------------|
| Task-specific pheromone matrices | ✅ τ^t | ✅ TaskCategory specialist |
| Query-conditioned fusion | ✅ τ^(q)_ij equation | Single-category only (no fusion yet) |
| Per-category decay rates | Not specified | ✅ Configurable per category |
| Quality gate | LLM-Judge binary | Quality + Security dual gate |
| Negative reinforcement | Not in paper | ✅ For policy violations |
| Persistence backend | Not specified | etcd + disk backup |
| Security heuristic | Not in paper | Phase 2.2 (ADR-011) |

---

## Open Questions (5 items from Scout's research)

These must be resolved before or during Phase 2.1 implementation:

### OQ-1: Pheromone Storage Backend
**Question:** Should pheromone matrices be stored in the existing AWARE data store (etcd) or a separate dedicated store?
**Trade-offs:** Using etcd leverages existing infrastructure but may hit size limits with large matrices. A dedicated store adds complexity but isolates pheromone traffic from core data.
**Decision:** Use etcd for initial implementation; migrate to dedicated store if scaling issues arise.

### OQ-2: Raft Consensus Integration
**Question:** Must pheromone updates be cluster-wide consistent via Raft consensus?
**Trade-offs:** Strong consistency ensures all nodes see the same pheromone state, but adds latency to routing decisions. Eventual consistency is faster but may cause transient routing anomalies.
**Decision:** Pheromone reads are local (eventual consistency); writes use Raft broadcast to ensure cluster-wide convergence within 100ms SLA.

### OQ-3: Warm-Start Strategy
**Question:** How do we initialise pheromone matrices for new agents or new task categories with no history?
**Trade-offs:** Starting from zero (cold start) is safe but slow to converge. Starting from capability priors (warm start) is faster but may bias toward initial assumptions.
**Decision:** Use capability-based priors as initial pheromone values (warm start). Phase 2.3 offline warm-up uses labelled data to bootstrap.

### OQ-4: Pheromone Propagation SLA
**Question:** What is the maximum acceptable time for pheromone updates to propagate across all cluster nodes?
**Trade-offs:** Fast propagation (10ms) requires more network overhead. Slow propagation (1s) may cause stale routing decisions.
**Decision:** Target: <100ms end-to-end propagation for critical security signals. <1s for quality-only updates.

### OQ-5: Memory Growth Boundedness
**Question:** Without bounds, pheromone matrices could grow unboundedly with agent count and task history.
**Trade-offs:** Hard size limits may evict useful pheromones. Soft limits with LRU eviction may lose recent high-quality paths.
**Decision:** Implement both: hard limit on max agents per matrix (configurable, default 1000), and pruning of trails <0.01 strength (already in evaporate). Revisit if limits hit.
