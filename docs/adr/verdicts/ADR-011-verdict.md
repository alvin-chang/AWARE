# ADR-011 Phase 2.3 — VERDICT

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)  
**Date:** 2026-04-02  
**Status:** REVISIONS NEEDED

---

## Verdict: REVISIONS NEEDED

### F-1 CRITICAL — Missing Implementation Spec: Quality Score Calculation
**File:** ADR-011 (Quality Gate Specification)  
**Issue:** The ADR defines quality gate outcomes (EXCELLENT ≥0.9, ACCEPTABLE ≥0.6, etc.) but provides NO actual implementation for how `quality_score = f(outcome_metrics, task_specification)` is computed. The "Quality Evaluator" component at `src/routing/quality-evaluator.js` is a black box.  
**Fix:** Specify the actual quality_score calculation algorithm. For example:
```typescript
function computeQualityScore(outcome, spec) {
  const correctness = outcome.correctOutputs / spec.expectedOutputs;
  const completeness = outcome.completedSubtasks / spec.totalSubtasks;
  const efficiency = spec.baselineResourceUsage / outcome.actualResourceUsage;
  return 0.5 * correctness + 0.3 * completeness + 0.2 * Math.min(efficiency, 1.0);
}
```

### F-2 CRITICAL — Undefined: blast_radius_estimate
**File:** ADR-011 (Policy Violation Penalty section)  
**Issue:** The blast radius penalty formula references `blast_radius_estimate` but never defines how it's computed. Open Question 5 ("How is blast_radius_estimate computed?") is unanswered.  
**Fix:** Define the blast_radius_estimate calculation. For example:
```typescript
function computeBlastRadiusEstimate(agentId, violationType) {
  // Based on agent's access scope and violation severity
  const accessScope = getAgentAccessScope(agentId); // 0.0-1.0
  const dataSensitivity = violationType.dataSensitivity ?? 0.5; // 0.0-1.0
  return accessScope * dataSensitivity; // 0.0-1.0
}
```

### F-3 MEDIUM — Schema Gap: blast-radius-matrix
**File:** ADR-011 (Policy Schema Registry)  
**Issue:** `POLICY_SCHEMAS` lacks entry for `blast-radius-matrix` even though the ADR references `blast-radius.json` in the policy storage schema.  
**Fix:** Add to POLICY_SCHEMAS:
```javascript
'blast-radius-matrix': {
  type: 'object',
  required: ['matrix', 'version'],
  properties: {
    matrix: { type: 'object' },  // agent-to-impact mapping
    version: { type: 'number' }
  }
}
```

---

## Blocking Issues: 2 CRITICAL
- F-1: Quality evaluator is a black box
- F-2: blast_radius_estimate undefined

## Non-Blocking: 1 (F-3)

---

*⚖️ Critic — reviewer@openclaw.local*
