# ADR-009: Phase 2.1 — Task-Specific Pheromone Specialists

**Status:** DRAFT  
**Author:** Archimedes  
**Date:** 2026-03-31  
**Depends on:** ADR-003 / Phase 1b (Policy Engine + Per-Agent Sandboxes)  

---

## Context

Phase 1 established the Agent Identity Layer (ADR-001) and Policy Engine (ADR-003): agents have identities, sandbox policies, and behavioural baselines. Phase 2 extends this to **routing intelligence** — selecting the optimal agent for a given task.

AMRO-S (Efficient and Interpretable Multi-Agent LLM Routing via Ant Colony Optimisation, arXiv:2603.12933) provides the core pattern: **pheromone-based routing** where agents deposit virtual pheromones on paths they traverse, and future agents follow high-pheromone paths with probability proportional to pheromone strength.

A critical limitation of a single global pheromone table is **cross-task interference** (AMRO-S Section 3.2): pheromones deposited by code-generation tasks reward paths that may be suboptimal for research tasks, degrading overall routing quality by 40-60% in mixed-task environments.

Phase 2.1 addresses this by implementing **task-specific pheromone specialists** — separate pheromone tables per task category, preventing cross-task pheromone contamination.

---

## Decision

Implement **task-specific pheromone tables** where each table corresponds to a task category. Agents routing to a task in category T read and write only from table T, isolating routing memory between task types.

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

interface PheromoneTable {
  category: TaskCategory;
  trails: Map<string, number>; // agentId → pheromone strength
  updatedAt: Date;
  decayRate: number; // per-hour decay coefficient
}
```

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

### 1. Deposit (after successful task completion)

```typescript
interface PheromoneDeposit {
  taskCategory: TaskCategory;
  agentId: string;
  taskId: string;
  qualityScore: number;      // 0.0–1.0, from Phase 2.3 quality gate
  securityScore: number;     // 0.0–1.0, from Phase 1.3 anomaly detection
  pathAgents: string[];     // ordered list of agents on this path
}

function depositPheromone(deposit: PheromoneDeposit): void {
  const table = getOrCreateTable(deposit.taskCategory);
  const reinforcement = (deposit.qualityScore * 0.7) + (deposit.securityScore * 0.3);
  
  for (const agentId of deposit.pathAgents) {
    const current = table.trails.get(agentId) ?? 0.0;
    // Reinforcement formula from AMRO-S: new = current + (1 - current) * reinforcement
    table.trails.set(agentId, current + (1 - current) * reinforcement);
  }
  
  table.updatedAt = new Date();
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

### 3. Select (routing decision)

```typescript
interface RoutingCandidate {
  agentId: string;
  pheromoneStrength: number;
  heuristicScore: number;   // from Phase 2.2 security-weighted heuristic
}

function selectAgent(taskCategory: TaskCategory, task: Task): RoutingCandidate {
  const table = getTable(taskCategory);
  if (!table || table.trails.size === 0) {
    return defaultFallback(); // load-balance across available agents
  }

  // AMRO-S probabilistic selection: P(agent) ∝ pheromone^α × heuristic^β
  const candidates = Array.from(table.trails.entries()).map(([agentId, pheromone]) => ({
    agentId,
    pheromoneStrength: pheromone,
    heuristicScore: computeHeuristic(agentId, task), // Phase 2.2
  }));

  // Normalise
  const totalPheromone = candidates.reduce((s, c) => s + c.pheromoneStrength, 0);
  const totalHeuristic = candidates.reduce((s, c) => s + c.heuristicScore, 0);

  const probabilities = candidates.map(c => ({
    agentId: c.agentId,
    probability: (c.pheromoneStrength / totalPheromone) ** ALPHA * 
                 (c.heuristicScore / totalHeuristic) ** BETA,
  }));

  // Soft-max selection
  return weightedRandomSelect(probabilities);
}
```

**Hyperparameters (configurable):**
- `ALPHA = 1.0` — pheromone weight
- `BETA = 0.5` — heuristic weight

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
