# ADR-009 Phase 2.1 — VERDICT

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)  
**Date:** 2026-04-02  
**Status:** REVISIONS NEEDED

---

## Verdict: REVISIONS NEEDED

### F-1 CRITICAL — Code Bug: evaporatePheromones() Wrong Data Structure
**File:** ADR-009 (implementation section)  
**Line:** ~95  
**Issue:** `evaporatePheromones()` iterates `table.trails` but `PheromoneMatrix` interface defines `transitions` (Map<string, Map<string, number>>) and `agents` (Map<string, number>). There is no `trails` property. This would cause runtime TypeError.  
**Fix:** Iterate `table.agents` and `table.transitions` separately:

```typescript
// For agents:
for (const [agentId, strength] of table.agents) {
  const evaporated = strength * (1 - decay);
  if (evaporated < 0.01) {
    table.agents.delete(agentId);
  } else {
    table.agents.set(agentId, evaporated);
  }
}

// For transitions:
for (const [from, toMap] of table.transitions) {
  for (const [to, strength] of toMap) {
    const evaporated = strength * (1 - decay);
    if (evaporated < 0.01) {
      toMap.delete(to);
    } else {
      toMap.set(to, evaporated);
    }
  }
}
```

### F-2 CRITICAL — Incomplete: computeHeuristic() Stub
**File:** ADR-009  
**Line:** ~175  
**Issue:** `computeHeuristic()` throws "ADR-011: Security-Weighted Heuristic (pending)". But ADR-010 (Phase 2.2) is APPROVED. The security-weighted heuristic should be implementable using the weights defined in ADR-010.  
**Fix:** Implement computeHeuristic() using ADR-010's security-weighted formula, or reference ADR-010 explicitly with the actual weight values.

### F-3 MEDIUM — Missing Constants: ALPHA and BETA
**File:** ADR-009  
**Issue:** Soft-max selection formula uses ALPHA and BETA hyperparameters but they are never defined.  
**Fix:** Add before selectAgent():
```typescript
const ALPHA = 1.0;  // pheromone weight
const BETA = 0.5;   // heuristic weight
```

### F-4 MINOR — Documentation Gap
**Issue:** Query-conditioned pheromone fusion (AMRO-S equation with Σ_t∈T w_t(q)·τ^t_ij) is shown but implementation note says "single-category only (no fusion yet)". This should be more prominent — either remove the equation or clearly mark as Phase 2.5 future work.

---

## Blocking Issues: 2 CRITICAL
- F-1: Runtime error (table.trails doesn't exist)
- F-2: Incomplete implementation (blocked by APPROVED ADR)

## Non-Blocking: 2 (F-3, F-4)

---

*⚖️ Critic — reviewer@openclaw.local*
