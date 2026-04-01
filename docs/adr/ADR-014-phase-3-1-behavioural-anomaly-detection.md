# ADR-014: Phase 3.1 — Behavioural Anomaly Detection & Baseline

**Status:** REVISIONS NEEDED (Critor, 2026-04-01 18:39 BST) — 3 CRITICAL findings  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** Phase 1.3 (Behavioural Baseline); ADR-010 (Trust Score); ADR-013 (Identity Framework); Scout Audit findings  
**Depends on:** ADR-010 (Trust Score integration), ADR-013 (Identity Framework)  
**Phase:** 3.1 (P0 — blocking for trust_score integration)  

---

## Critic Review Findings (2026-04-01 18:39 BST)

**VERDICT: REVISIONS NEEDED — 3 CRITICAL issues must be resolved before APPROVAL**

### F-1 [CRITICAL]: Pheromone Penalty Formula Goes Negative
**Location:** applyAnomalyPenalty() function
**Problem:** At anomalyScore >= 0.9, penaltyFactor becomes NEGATIVE, MULTIPLYING pheromone by a negative number — rewarding bad actors instead of penalizing.
**Fix:** Reverse formula so penalty INCREASES with anomaly score.

### F-2 [CRITICAL]: Division by Zero in Z-score
**Location:** computeZscore() function
**Problem:** When baseline.stddev === 0, Z-score produces NaN, breaking the routing heuristic.
**Fix:** Add stddev=0 guard.

### F-3 [CRITICAL]: Alert Classification Ignores Anomaly Score
**Location:** classifySeverity() function
**Problem:** Severity only checks trust score, ignoring anomaly score. Acute anomalies missed.
**Fix:** Classify based on BOTH anomaly AND trust score.

---

## Context

ADR-010 introduced `trust_score` as a component of the security-weighted heuristic:

```
η_secure(agent, task) = w1·capability + w2·load_balance + w3·trust_score + ...
```

The `trust_score` was defined as:
> "Anomaly detection trust score; 1.0 = consistently normal behaviour"

However, **how to compute the trust_score** was left as an open question in ADR-010.

ADR-014 defines the behavioural anomaly detection system that computes trust_score values.

Phase 1.3 established a "behavioural baseline" but its implementation details are unspecified. ADR-014 fills this gap.

---

## Decision

Implement a **Behavioural Anomaly Detection (BAD) system** that:

1. **Establishes behavioural baselines** per agent for each task category
2. **Continuously monitors** tool usage, API calls, data access, timing patterns
3. **Computes anomaly scores** as deviation from baseline
4. **Feeds trust_score** into ADR-010's heuristic function
5. **Triggers alerts** when anomaly exceeds threshold

---

## Behavioural Dimensions

### What Gets Monitored

| Dimension | Metrics | Example Anomaly |
|-----------|---------|----------------|
| **Tool Usage** | Tools called per hour, tool frequency distribution, tool sequences | Calling `curl` 100x/hour when baseline is 5x/hour |
| **API Calls** | Requests per minute, endpoint distribution, error rates | Sudden spike in `/api/agents/*` calls |
| **Data Access** | Files accessed, data volume, sensitivity levels | Accessing `credentials/` when normally only accessing `workspace/` |
| **Timing** | Activity patterns, response latency, task duration | Working at 3 AM when normally 9-5 |
| **Capability Usage** | Task types attempted, success rate, error patterns | Attempting `security_review` when only coded before |

### Baseline Profile Per Agent

```javascript
{
  agentId: 'agent-001',
  baselineVersion: 7,
  establishedAt: '2026-03-15T00:00:00Z',
  taskCategories: {
    'code_generation': {
      toolUsage: {
        'read': { mean: 45.2, stddev: 12.1, unit: 'calls_per_hour' },
        'write': { mean: 23.1, stddev: 8.3 },
        'exec': { mean: 12.4, stddev: 5.2 },
        'git': { mean: 8.7, stddev: 3.1 }
      },
      apiCalls: {
        mean: 156.3,
        stddev: 34.2,
        unit: 'calls_per_hour'
      },
      dataAccess: {
        'workspace/*': { mean: 89.1, stddev: 12.3 },
        'credentials/*': { mean: 0.0, stddev: 0.0 }
      },
      timing: {
        activeHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
        avgTaskDuration: { mean: 847, stddev: 234, unit: 'seconds' }
      }
    },
    'security_review': {
      // ... separate baseline for security_review tasks
    }
  },
  globalMetrics: {
    errorRate: { mean: 0.02, stddev: 0.005 },
    avgResponseTime: { mean: 234, stddev: 45, unit: 'ms' }
  }
}
```

---

## Anomaly Scoring

### Per-Dimension Anomaly Score

For each dimension, compute Z-score (standard deviations from baseline mean):

```javascript
function computeZScore(currentValue, baseline) {
  const z = (currentValue - baseline.mean) / baseline.stddev;
  
  // Clip extreme values
  return Math.max(-5, Math.min(5, z));
}

// Example: tool usage anomaly
const z_toolUsage = computeZScore(currentToolUsageRate, baseline.toolUsage.exec);
// z = 2.3 → 2.3 standard deviations above baseline
```

### Aggregate Anomaly Score

```javascript
function computeAnomalyScore(zScores, weights) {
  // Weighted combination of dimension scores
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (const [dimension, { z, weight }] of Object.entries(zScores)) {
    // Use squared Z to capture magnitude (both high and low are bad)
    const squaredZ = z * z;
    weightedSum += squaredZ * weight;
    totalWeight += weight;
  }
  
  // Chi-squared-like aggregate (0 = normal, higher = more anomalous)
  const aggregate = Math.sqrt(weightedSum / totalWeight);
  
  // Convert to 0-1 range (softmax-like)
  const anomalyScore = 1 - Math.exp(-aggregate);
  
  return Math.max(0, Math.min(1, anomalyScore));
}
```

### Trust Score Derivation

```javascript
function computeTrustScore(anomalyScore, historicalTrend) {
  // anomalyScore: 0 = normal, 1 = highly anomalous
  // historicalTrend: 0 = degrading, 1 = improving
  
  const baseScore = 1 - anomalyScore;
  
  // Apply trend adjustment (5% max adjustment)
  const trendAdjustment = (historicalTrend - 0.5) * 0.10;
  
  const trustScore = Math.max(0, Math.min(1, baseScore + trendAdjustment));
  
  return {
    trustScore,
    anomalyScore,
    components: { baseScore, trendAdjustment },
    status: trustScore >= 0.7 ? 'trusted' : 
            trustScore >= 0.4 ? 'caution' : 'untrusted'
  };
}
```

---

## Baseline Establishment

### Initial Baseline (First 7 Days)

During the initial learning period, baselines are established:

```
Day 1-2: OBSERVATION ONLY (no anomaly scoring)
Day 3-7: SOFT BASELINE (anomaly detected but no alerts)
Day 7+:  FULL BASELINE (active anomaly scoring and alerts)
```

### Baseline Refresh

Baselines drift slowly as agents improve. Periodic refresh:

```javascript
const BASELINE_REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
const BASELINE_MIN_SAMPLES = 1000; // minimum data points

async function refreshBaseline(agentId, taskCategory) {
  const dataPoints = await getHistoricalData(agentId, taskCategory, {
    since: Date.now() - 14 * 24 * 60 * 60 * 1000 // last 14 days
  });
  
  if (dataPoints.length < BASELINE_MIN_SAMPLES) {
    logger.warn({ event: 'BASELINE_REFRESH_SKIPPED', agentId, reason: 'insufficient_data' });
    return;
  }
  
  // Compute new baseline with exponential smoothing (smoothing factor: 0.3)
  const newBaseline = computeBaselineStats(dataPoints);
  const SMOOTHING = 0.3;
  
  const updatedBaseline = {
    ...newBaseline,
    previousVersion: currentBaseline.version,
    version: currentBaseline.version + 1,
    establishedAt: new Date().toISOString()
  };
  
  await saveBaseline(agentId, taskCategory, updatedBaseline);
  
  logger.info({
    event: 'BASELINE_REFRESHED',
    agentId,
    taskCategory,
    newVersion: updatedBaseline.version,
    dataPoints: dataPoints.length
  });
}
```

---

## Alert System

### Alert Severity Levels

| Level | Anomaly Score | Trust Score | Action |
|-------|--------------|-------------|--------|
| INFO | 0.0 – 0.3 | 0.9 – 1.0 | Log only |
| WARNING | 0.3 – 0.6 | 0.7 – 0.9 | Alert, investigate |
| HIGH | 0.6 – 0.8 | 0.4 – 0.7 | Alert + auto-rotation recommended |
| CRITICAL | 0.8 – 1.0 | 0.0 – 0.4 | Auto-freeze agent, revoke credentials |

### Alert Actions

```javascript
const ALERT_ACTIONS = {
  INFO: ['log'],
  WARNING: ['log', 'notify_admin'],
  HIGH: ['log', 'notify_admin', 'recommend_rotation'],
  CRITICAL: ['log', 'notify_admin', 'auto_freeze', 'revoke_credentials', 'apply_blast_radius']
};
```

### Alert Flow

```
Anomaly Detected
      │
      ▼
┌─────────────────┐
│ Compute Severity│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execute Actions │
└────────┬────────┘
         │
    ┌────┴────┐
    │ CRITICAL?│
    └────┬────┘
      Yes │ No
         ▼      ▼
┌───────────┐  ┌───────────┐
│ Auto-freeze │  │ Continue  │
│ + Revoke   │  │ Monitoring│
└───────────┘  └───────────┘
```

---

## Integration with ADR-010 Trust Score

### Feedback Loop

```
ADR-010 Routing Decision
         │
         ▼
┌─────────────────┐
│ Agent Executes  │
│ Task            │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Behavioural     │───────┐
│ Monitor         │       │
└────────┬────────┘       │
         │                │
         ▼                ▼
┌─────────────────┐  ┌─────────────────┐
│ Update Trust    │  │ ADR-011 Quality │
│ Score           │  │ Gate            │
└────────┬────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Next Routing    │◀──────┐
│ Decision        │       │
└─────────────────┘       │
                          │
         ┌────────────────┘
         │ (feedback loop)
```

### Trust Score Update Frequency

```javascript
const TRUST_SCORE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const TRUST_SCORE_DECAY = 0.98; // Decay factor per interval when no new data

async function updateTrustScore(agentId) {
  const currentScore = await getCurrentTrustScore(agentId);
  const recentAnomalies = await getRecentAnomalies(agentId, { 
    since: Date.now() - TRUST_SCORE_UPDATE_INTERVAL 
  });
  
  if (recentAnomalies.length === 0) {
    // No new data: apply decay
    const decayedScore = currentScore * TRUST_SCORE_DECAY;
    await saveTrustScore(agentId, decayedScore);
    return decayedScore;
  }
  
  // Compute new score from recent anomalies
  const avgAnomalyScore = average(recentAnomalies.map(a => a.score));
  const newScore = computeTrustScore(avgAnomalyScore, getTrend(agentId));
  
  await saveTrustScore(agentId, newScore);
  await propagateToPheromoneMatrix(agentId, newScore); // ADR-011 trigger
  
  return newScore;
}
```

---

## Pheromone Feedback Integration

### Anomaly → Pheromone Erosion

When anomaly score exceeds threshold, pheromone trails erode (ADR-011 negative reinforcement):

```javascript
async function applyAnomalyPenalty(agentId, anomalyScore) {
  const agent = registry.lookup(agentId);
  
  if (anomalyScore < 0.3) {
    return; // No penalty for minor anomalies
  }
  
  // Penalty factor: linear from 0.1 (score=0.3) to 0.0 (score=1.0)
  const penaltyFactor = Math.max(0, 0.1 - (anomalyScore - 0.3) * 0.14);
  
  const pheromoneMatrix = await pheromoneStore.getMatrix();
  
  for (const taskType of pheromoneMatrix.keys()) {
    const current = pheromoneMatrix.get(taskType, agentId);
    pheromoneMatrix.set(taskType, agentId, current * penaltyFactor);
  }
  
  await pheromoneStore.saveMatrix(pheromoneMatrix);
  
  logger.info({
    event: 'ANOMALY_PENALTY_APPLIED',
    agentId,
    anomalyScore,
    penaltyFactor,
    tasksAffected: pheromoneMatrix.keys().length
  });
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/monitoring/baseline/:agentId` | GET | Get agent's baseline profile |
| `/api/monitoring/baseline/:agentId/:taskCategory` | PUT | Update baseline (admin) |
| `/api/monitoring/anomaly/:agentId` | GET | Get current anomaly status |
| `/api/monitoring/anomaly/:agentId/history` | GET | Get anomaly history |
| `/api/monitoring/trust-score/:agentId` | GET | Get current trust score |
| `/api/monitoring/alert/:agentId` | GET | Get alerts for agent |
| `/api/monitoring/alert/:alertId/acknowledge` | POST | Acknowledge alert |

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| BehaviouralMonitor | `src/monitoring/behavioural-monitor.js` | Collect metrics per agent |
| BaselineMapper | `src/monitoring/baseline-mapper.js` | Establish and refresh baselines |
| AnomalyScorer | `src/monitoring/anomaly-scorer.js` | Compute Z-scores and anomaly score |
| TrustScoreUpdater | `src/monitoring/trust-score-updater.js` | Maintain and propagate trust scores |
| AlertDispatcher | `src/monitoring/alert-dispatcher.js` | Execute alert actions |
| BaselineStore | `src/monitoring/baseline-store.js` | Persist baselines to etcd |

---

## Open Questions

1. **ML vs Statistical:** Should we use ML models (isolation forest, LSTM) instead of statistical baselines? (ML more accurate but less explainable for audit)

2. **Baseline initialization:** Should new agents start with a "generic" baseline from similar agents, or learn from scratch? (Faster ramp-up vs accuracy trade-off)

3. **Alert fatigue:** What happens when an agent has many false positive alerts? (Should we auto-tune thresholds?)

4. **Trust score caching:** How long should trust_score be cached? (Shorter = more responsive but more computation)

5. **Cross-agent baselines:** Should we establish baselines for agent teams, not just individuals? (Detect coordinated anomalous behaviour)

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.MT-01 (Monitoring) | Continuous behavioural monitoring |
| CSA AI Control Matrix | AI.MT-02 (Anomaly detection) | Anomaly scoring, alerting |
| NIST AI RMF | DE.CM (Continuous monitoring) | Behavioural baseline, anomaly detection |
| NIST AI RMF | DE.AE (Anomaly detection) | Alert system, response actions |
| ISO 27001 | A.12.4 (Monitoring) | Audit trail, anomaly logging |
| DORA | Art. 26 (Incident detection) | Anomaly → alert pipeline |

---

## Status

**DRAFT** — Ready for Critor review and Scout research on anomaly detection methodologies.

---

*Next: ADR-015 (Tool Access Control & Enforcement)*
