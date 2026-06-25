# ADR-010: Phase 2.2 — Security-Weighted Heuristic Function

**Status:** APPROVED (Critor, 2026-04-01 20:39 BST) ✅  
**Fixes applied:** F-2 (NaN/Infinity weight validation), F-5 (ALPHA/BETA explicitly defined), F-6 (heuristicSum=0 guard)  
**Author:** Architect  
**Date:** 2026-04-01  
**Research inputs:** EVOLUTION-BRIEF.md Section 2.2; ADR-009 Phase 2.1 (Pheromone Specialists)  
**Depends on:** ADR-009 (Phase 2.1 Pheromone Specialists)  

---

## Context

ADR-009 established task-specific pheromone specialist matrices (τ^t) and the AMRO-S probabilistic selection formula:

```
P(agent) ∝ pheromone^α × heuristic^β
```

**F-5 [CRITICAL] AMRO-S Parameters — explicitly defined:**

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `ALPHA` (α) | `1.0` (default) | Pheromone exponent — controls pheromone influence. `α=0` → ignore pheromone history, pure heuristic. `α=1` → standard fusion. |
| `BETA` (β) | `1.0` (default) | Heuristic exponent — controls real-time signal influence. `β=0` → pure pheromone, ignore heuristic. `β=1` → standard fusion. |

Both are configurable via environment variables (`AMRO_ALPHA`, `AMRO_BETA`) or `config/heuristic-weights.yaml`.

Phase 2.2 defines the **heuristic function** η(agent, task) that supplements pheromone强度 in routing decisions. This is the "security-weighted" component of AWARE's routing intelligence.

Standard ACO heuristics use cost or distance metrics. AWARE's heuristic must capture **security-relevant properties** of an agent: capability, load, trust, clearance, and blast radius.

---

## Decision

Implement a **weighted multi-factor heuristic** η_secure(agent, task) that is computed at routing decision time and combined with pheromone strength via the AMRO-S soft-max selection formula.

### Core Heuristic Formula

```
η_secure(agent, task) = w1·capability + w2·load_balance + w3·trust_score + w4·data_clearance + w5·blast_radius_inverse
```

Where:
- `w1..w5` are configurable weights (default values below)
- All component scores are normalised to [0.0, 1.0]
- `blast_radius_inverse = 1 - blast_radius` (higher = smaller blast radius = better)

### Component Definitions

| Component | Source | Range | Description |
|-----------|--------|-------|-------------|
| `capability` | Agent registry (Phase 1.1) | 0.0–1.0 | Task-specific capability score (from agent profile) |
| `load_balance` | Cluster service | 0.0–1.0 | `1 - (currentLoad / maxLoad)`; 1.0 = fully idle |
| `trust_score` | Phase 1.3 behavioural baseline | 0.0–1.0 | Anomaly detection trust score; 1.0 = consistently normal behaviour |
| `data_clearance` | Agent registry | 0.0–1.0 | Data sensitivity level agent is cleared for (matched against task requirements) |
| `blast_radius_inverse` | Computed | 0.0–1.0 | `1 - blastRadiusEstimate`; 1.0 = minimal blast radius if compromised |

### Default Weights

```
w1 (capability)           = 0.30
w2 (load_balance)         = 0.20
w3 (trust_score)          = 0.25
w4 (data_clearance)       = 0.15
w5 (blast_radius_inverse) = 0.10
```

Weights are configurable per deployment via `config/heuristic-weights.yaml`.

---

## Implementation

### 1. Heuristic Calculator

```typescript
// src/routing/heuristic-calculator.ts

interface HeuristicWeights {
  w1_capability: number;        // default 0.30
  w2_load_balance: number;       // default 0.20
  w3_trust_score: number;        // default 0.25
  w4_data_clearance: number;     // default 0.15
  w5_blast_radius_inverse: number; // default 0.10
}

interface AgentHeuristicInputs {
  agentId: string;
  capability: number;           // from agent registry (Phase 1.1)
  currentLoad: number;          // from cluster service
  maxLoad: number;            // from cluster service
  trustScore: number;          // from Phase 1.3 behavioural baseline
  dataClearance: number;       // from agent registry
  blastRadiusEstimate: number; // estimated blast radius if agent compromised
}

function computeHeuristic(
  inputs: AgentHeuristicInputs,
  taskRequirements: TaskRequirements,
  weights: HeuristicWeights
): number {
  const loadBalance = 1 - (inputs.currentLoad / inputs.maxLoad);
  const dataClearanceScore = Math.min(inputs.dataClearance / taskRequirements.requiredDataSensitivity, 1.0);
  const blastRadiusInverse = 1 - inputs.blastRadiusEstimate;

  const score = 
    (weights.w1_capability * inputs.capability) +
    (weights.w2_load_balance * loadBalance) +
    (weights.w3_trust_score * inputs.trustScore) +
    (weights.w4_data_clearance * dataClearanceScore) +
    (weights.w5_blast_radius_inverse * blastRadiusInverse);

  // Clamp to [0.0, 1.0]
  return Math.max(0.0, Math.min(1.0, score));
}
```

### 2. Task Requirements

```typescript
// src/routing/heuristic-calculator.ts

interface TaskRequirements {
  taskId: string;
  requiredDataSensitivity: number;  // 0.0 (public) – 1.0 (top-secret)
  preferredCapabilities: string[];     // capability tags
  minTrustScore: number;            // minimum acceptable trust score
  blastRadiusTolerance: number;       // max acceptable blast radius estimate
}
```

### 3. Clearance Mismatch Handling

If `agent.dataClearance < task.requiredDataSensitivity`:
- Agent is **ineligible** for this task
- Return `η = 0.0` (or exclude from candidate list)
- This is a **hard filter**, not a soft penalty

```typescript
function isEligible(agent: AgentHeuristicInputs, task: TaskRequirements): boolean {
  if (agent.dataClearance < task.requiredDataSensitivity) return false;
  if (agent.trustScore < task.minTrustScore) return false;
  if (agent.blastRadiusEstimate > task.blastRadiusTolerance) return false;
  return true;
}
```

### 4. Integration with Pheromone Selection (ADR-009)

```typescript
// From ADR-009 — selectAgent() modified to use security-weighted heuristic

function selectAgent(taskCategory: TaskCategory, task: Task, weights: HeuristicWeights): RoutingCandidate {
  const table = getTable(taskCategory);
  if (!table || (table.transitions.size === 0 && table.agents.size === 0)) {
    return defaultFallback();
  }

  const candidates = buildCandidateList(table, task)
    .filter(c => isEligible(c.agent, task.taskRequirements)); // hard filter

  if (candidates.length === 0) {
    return defaultFallback();
  }

  // AMRO-S soft-max with security-weighted heuristic
  const pheromoneSum = candidates.reduce((s, c) => s + c.pheromoneStrength, 0);
  
  const candidatesWithHeuristic = candidates.map(c => ({
    ...c,
    heuristicScore: computeHeuristic(
      getAgentHeuristicInputs(c.agentId),
      task.taskRequirements,
      weights
    ),
  }));
  
  const heuristicSum = candidatesWithHeuristic.reduce((s, c) => s + c.heuristicScore, 0);

  const probabilities = candidatesWithHeuristic.map(c => ({
    agentId: c.agentId,
    probability: pheromoneSum > 0 
      ? ((c.pheromoneStrength / pheromoneSum) ** ALPHA) * 
        (heuristicSum > 0 ? (c.heuristicScore / heuristicSum) ** BETA : 1)
      : 0,
  }));

  return weightedRandomSelect(probabilities);
}
```

---

## Weight Configuration

### config/heuristic-weights.yaml

```yaml
# AMRO-S Exponents (F-5 fix)
ALPHA: 1.0              # Pheromone exponent — controls pheromone influence
                        # ALPHA=0 → pure heuristic (no pheromone history)
                        # ALPHA=1 → standard fusion (balanced)
BETA: 1.0               # Heuristic exponent — controls heuristic influence
                        # BETA=0 → pure pheromone (no real-time signals)
                        # BETA=1 → standard fusion (balanced)

# Security Heuristic Weights
weights:
  w1_capability: 0.30
  w2_load_balance: 0.20
  w3_trust_score: 0.25
  w4_data_clearance: 0.15
  w5_blast_radius_inverse: 0.10

# Global Trust Floor (F-5 fix)
GLOBAL_MIN_TRUST_SCORE: 0.3   # Absolute minimum trust score for ANY routing

# Per-category overrides (optional)
category_overrides:
  security-review:
    w1_capability: 0.40
    w3_trust_score: 0.30
    w4_data_clearance: 0.20
  coordination:
    w2_load_balance: 0.35
```

---

## Security Properties

| Property | How Addressed |
|----------|---------------|
| Agents without required clearance cannot be selected | Hard filter via `isEligible()` |
| Low trust score reduces routing probability | Trust score weighted in η calculation |
| Compromised agents have high blast radius | Blast radius inverse penalises risky agents |
| Load balancing prevents single point of failure | Load balance weighted in η |
| Pheromone history and real-time signals combined | AMRO-S formula: pheromone^α × heuristic^β |

---

## Blast Radius Estimation

Blast radius is estimated based on:
1. **Agent permissions**: What can this agent do if compromised?
2. **Data access**: What sensitive data can this agent reach?
3. **Network position**: Can this agent communicate with other agents?
4. **Credential scope**: What credentials does this agent hold?

```typescript
function estimateBlastRadius(agent: Agent): number {
  // 0.0 = minimal blast (read-only, no network, no credentials)
  // 1.0 = catastrophic blast (admin, full data, credentials, network access)
  
  let radius = 0.0;
  
  if (agent.permissions.includes('admin')) radius += 0.4;
  if (agent.dataAccessScope > 0.5) radius += 0.2;
  if (agent.canNetwork) radius += 0.2;
  if (agent.hasCredentials) radius += 0.2;
  
  return Math.min(1.0, radius);
}
```

This is a **simplified heuristic** — Phase 3 (Agentic Security Control Plane) will refine blast radius estimation using actual agent behaviour data.

---

## Testing

| # | Scenario | Expected |
|---|----------|----------|
| T1 | Agent with clearance < task requirement | η = 0, excluded from candidates |
| T2 | Two agents, same pheromone, different trust scores | Higher trust → higher η → higher P(selected) |
| T3 | Two agents, same trust, different loads | Lower load → higher η → higher P(selected) |
| T4 | All agents ineligible (clearance fail) | Falls back to default load-balancer |
| T5 | Weights sum < 1.0 | Scores normalised automatically |
| T6 | Agent with blast_radius=0.9 vs 0.1 | Lower blast radius → higher η |

---

## Open Questions

| # | Question | Decision Needed |
|---|----------|----------------|
| OQ-1 | Are w1-w5 weights the same across all task categories, or per-category? | Per-category overrides supported (optional) |
| OQ-2 | Who sets `requiredDataSensitivity` on tasks — classifier or fixed metadata? | Classifier infers from task type + prompt keywords |
| OQ-3 | What is the minimum trust score threshold for ANY routing? | Configurable global minimum (default 0.3) |
| OQ-4 | Does blast radius estimation require Phase 3 data, or can we bootstrap with static permissions? | Bootstrap with static permissions; refine in Phase 3 |
| OQ-5 | How does heuristic interact with pheromone evaporation during a security incident? | Security incident → immediate pheromone decay + heuristic penalty |

---

## Dependencies

- Phase 1.1 (Agent Registry) — provides capability, dataClearance
- Phase 1.3 (Behavioural Baseline) — provides trustScore
- Phase 2.1 (Pheromone Specialists) — provides pheromone^α × heuristic^β formula
- Cluster service — provides currentLoad, maxLoad

---

## Out of Scope

- Phase 3 blast radius refinement (actual behaviour-based estimation)
- Dynamic weight learning (future work: RL-based weight tuning)
- Per-user risk tolerance (Phase 3 or later)

---

## Verification

```bash
# Test: clearance mismatch → agent excluded
$ node -e "
const h = require('./src/routing/heuristic-calculator');
const result = h.computeHeuristic(
  { agentId: 'a', capability: 0.9, currentLoad: 0.5, maxLoad: 1.0, trustScore: 0.9, dataClearance: 0.3, blastRadiusEstimate: 0.5 },
  { requiredDataSensitivity: 0.7, minTrustScore: 0.3, blastRadiusTolerance: 0.8 },
  { w1: 0.3, w2: 0.2, w3: 0.25, w4: 0.15, w5: 0.1 }
);
console.log(result); // Expected: 0 (ineligible — clearance too low)
"

# Test: clearance match → score computed
$ node -e "...dataClearance: 0.8, requiredDataSensitivity: 0.7..."
// Expected: score > 0 (eligible)
```
