# ADR-014 Phase 3.1 — VERDICT (Re-Review Post-Fixes)

**Reviewer:** Critic ⚖️ (reviewer@openclaw.local)
**Date:** 2026-04-14
**Status:** APPROVED ✅ (post-revision — 3 critical fixes confirmed)

---

## Verdict: APPROVED ✅

The three critical fixes from the 2026-04-01 preliminary review are correctly implemented. ADR-014 is **APPROVED** as a specification document. No blocking issues remain.

---

## F-1: Pheromone Penalty Inverted ✅ CONFIRMED

**Location:** `applyAnomalyPenalty()` — pheromone penalty formula  
**Verification:** The formula now reads:

```javascript
const penaltyFactor = Math.min(1.0, (anomalyScore - 0.3) / 0.7);
```

This correctly scales penaltyFactor from 0.0 at anomalyScore=0.3 to 1.0 at anomalyScore=1.0. The multiplier `(1 - penaltyFactor)` erodes pheromones more when anomaly is high. Prior version had the logic inverted (penalty decreasing as anomaly increased). **Fixed.**

---

## F-2: Division by Zero Guard ✅ CONFIRMED

**Location:** `computeZScore()` — Z-score computation  
**Verification:**

```javascript
if (baseline.stddev === 0) {
  return currentValue === baseline.mean ? 0 : 3;
}
```

When stddev=0, the function returns 0 for values matching the mean (normal) and 3 for any deviation (high anomaly). This prevents NaN from `0 / 0`. **Fixed.**

---

## F-3: Severity Classification Uses Both Anomaly AND Trust Score ✅ CONFIRMED

**Location:** `classifySeverity()` — severity classification  
**Verification:**

```javascript
function classifySeverity(anomalyScore, trustScore) {
  if (anomalyScore >= 0.8 && trustScore < 0.4) return 'CRITICAL';
  if (anomalyScore >= 0.6 || trustScore < 0.7)  return 'HIGH';
  if (anomalyScore >= 0.3 || trustScore < 0.9)  return 'WARNING';
  return 'INFO';
}
```

The function now checks BOTH dimensions at each tier. Acute anomalies (high anomaly AND low trust) escalate to CRITICAL, matching the stated intent. **Fixed.**

---

## Review Assessment Against 4 Key Questions

### 1. Is the anomaly detection system properly specified?

**Yes, adequately specified.** The system defines:
- **5 behavioural dimensions:** tool usage, API calls, data access, timing, capability usage
- **Z-score per dimension:** standard deviations from baseline mean, clipped to [-5, 5]
- **Aggregate anomaly score:** chi-squared-like weighted sum of squared Z-scores, converted to [0,1] via `1 - exp(-aggregate)`
- **Trust score:** derived from anomaly score plus a ±5% historical trend adjustment
- **Baseline profiles:** per-agent, per-task-category with mean/stddev per dimension

**Non-blocking observations:**
- `computeAnomalyScore()` has a potential edge case: if `totalWeight === 0` (no dimensions provided), it computes `Math.sqrt(0/0)` which is NaN. Should add a guard: `if (totalWeight === 0) return 0;`
- `trustScore` update with trend adjustment: `trendAdjustment = (historicalTrend - 0.5) * 0.10` can shift score by up to ±0.05, which is small relative to the 0.1 range of the clamping but worth noting.

### 2. Are the baseline profiles clear?

**Yes, structurally clear.** The JSON schema for baseline profiles is explicit — agentId, baselineVersion, establishedAt, per-task-category metrics (toolUsage with per-tool mean/stddev, apiCalls, dataAccess with per-path mean/stddev, timing with activeHours array, avgTaskDuration), and globalMetrics (errorRate, avgResponseTime). The `credentials/*` entry has stddev=0.0 which correctly represents "never accessed" as a hard constraint.

**Non-blocking observations:**
- The `activeHours: [9, 10, 11, 12, 13, 14, 15, 16, 17]` format is clear but the ADR does not specify how this array is used in anomaly scoring (e.g., does a 3 AM activity convert to a numeric Z-score?). This is noted as an open question and acceptable for a specification document.
- `BASELINE_MIN_SAMPLES = 1000` is specified as a guard for baseline refresh — this is appropriate.
- `BASELINE_REFRESH_INTERVAL = 7 days` with `SMOOTHING = 0.3` exponential smoothing is well-specified.

### 3. Is trust_score computation correctly integrated with ADR-010?

**Yes, correctly integrated.** The integration is consistent:
- `trust_score` feeds into `η_secure()` (ADR-010) as `w3·trust_score` (weight 0.25)
- The feedback loop diagram shows anomaly detection → trust score update → pheromone propagation → routing decision
- ADR-010's `GLOBAL_MIN_TRUST_SCORE: 0.3` is referenced as an eligibility filter separate from severity classification, which is consistent
- `propagateToPheromoneMatrix()` is called in `updateTrustScore()` connecting to ADR-011

**Minor note:** The `classifySeverity()` WARNING threshold (`anomalyScore >= 0.3 || trustScore < 0.9`) will flag WARNING for any agent with trustScore below 0.9 even with zero anomalies. This is aggressive — a fully trusted agent with a temporarily low trust score reading would trigger WARNING. However, this is a design choice and not a specification error.

### 4. Any remaining blocking issues?

**No blocking issues.** All three critical findings from the prior review are resolved. The ADR is a specification document — it does not include implementation code so correctness of the JavaScript snippets cannot be runtime-verified, but the logic is internally consistent and mathematically sound.

---

## Non-Blocking Observations (for Architect/Coder)

| # | Observation | Location | Severity |
|---|-------------|----------|----------|
| N-1 | `computeAnomalyScore()` returns NaN if `totalWeight === 0` (no dimensions provided) | Anomaly scoring | LOW — add guard `if (totalWeight === 0) return 0` |
| N-2 | `activeHours` array usage in Z-score not specified (how does 3 AM convert to numeric score?) | Baseline timing | LOW — design choice needed; specification is acceptable as-is |
| N-3 | `classifySeverity()` WARNING tier: `trustScore < 0.9` triggers WARNING even at anomalyScore=0 (fully normal behaviour) | Alert classification | MINOR — aggressive but intentional; document the intent if it feels wrong to implementors |

---

## Summary Table

| Finding | Type | Status |
|---------|------|--------|
| F-1: Pheromone penalty inverted | CRITICAL | ✅ FIXED |
| F-2: Division by zero in Z-score | CRITICAL | ✅ FIXED |
| F-3: Severity ignores anomaly score | CRITICAL | ✅ FIXED |
| N-1: totalWeight=0 NaN guard | LOW | Non-blocking |

**Blocking Issues: 0**

---

*⚖️ Critic — reviewer@openclaw.local*
