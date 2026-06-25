/**
 * ADR (internal): Phase 3.1B — Behavioural Anomaly Detection & Trust Score
 * 
 * Computes trust_score values for ADR (internal)'s security-weighted heuristic function.
 * Implements the Behavioural Anomaly Detection (BAD) system.
 * 
 * Key functions:
 * - computeZScore(): Z-score with stddev=0 guard (F-2 fix)
 * - computeAnomalyScore(): Aggregate anomaly from multiple dimensions
 * - computeTrustScore(): Derives trust score from anomaly
 * - classifySeverity(): Uses BOTH anomaly AND trust (F-3 fix)
 * 
 * @module monitoring/anomaly-scorer
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const store = require('./store');
const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

/**
 * Anomaly scoring weights per dimension
 */
const DEFAULT_DIMENSION_WEIGHTS = {
  toolUsage: 0.30,
  apiCalls: 0.25,
  dataAccess: 0.25,
  timing: 0.10,
  capabilityUsage: 0.10
};

/**
 * Trust score thresholds
 */
const TRUST_THRESHOLDS = {
  TRUSTED: 0.7,
  CAUTION: 0.4,
  UNTRUSTED: 0.0
};

/**
 * Severity levels per ADR (internal)
 */
const Severity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * Alert actions per severity level
 */
const ALERT_ACTIONS = {
  INFO: ['log'],
  WARNING: ['log', 'notify_admin'],
  HIGH: ['log', 'notify_admin', 'recommend_rotation'],
  CRITICAL: ['log', 'notify_admin', 'auto_freeze', 'revoke_credentials', 'apply_blast_radius']
};

// ============================================================================
// Z-Score Computation (F-2 Fix)
// ============================================================================

/**
 * Compute Z-score (standard deviations from baseline mean).
 * 
 * F-2 FIX: Added stddev=0 guard to prevent NaN when baseline has no variance.
 * 
 * @param {number} currentValue - Current metric value
 * @param {Object} baseline - Baseline statistics { mean, stddev }
 * @returns {number} Z-score (-5 to +5, clipped)
 */
function computeZScore(currentValue, baseline) {
  // Guard: if no variance, return 0 for normal values, high anomaly for deviations
  if (baseline.stddev === 0) {
    return currentValue === baseline.mean ? 0 : 3;
  }
  
  const z = (currentValue - baseline.mean) / baseline.stddev;
  return Math.max(-5, Math.min(5, z));
}

// ============================================================================
// Anomaly Score Computation
// ============================================================================

/**
 * Compute aggregate anomaly score from weighted Z-scores.
 * 
 * @param {Object} zScores - Map of dimension -> { z, weight }
 * @param {Object} [weights=DEFAULT_DIMENSION_WEIGHTS] - Dimension weights
 * @returns {number} Anomaly score [0.0-1.0]
 */
function computeAnomalyScore(zScores, weights = DEFAULT_DIMENSION_WEIGHTS) {
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (const [dimension, data] of Object.entries(zScores)) {
    const weight = data.weight || weights[dimension] || 0.2;
    const z = data.z;
    const squaredZ = z * z;
    weightedSum += squaredZ * weight;
    totalWeight += weight;
  }
  
  if (totalWeight === 0) return 0;
  
  const aggregate = Math.sqrt(weightedSum / totalWeight);
  const anomalyScore = 1 - Math.exp(-aggregate);
  
  return Math.max(0, Math.min(1, anomalyScore));
}

// ============================================================================
// Trust Score Computation
// ============================================================================

/**
 * Compute trust score from anomaly score and historical trend.
 * 
 * @param {number} anomalyScore - Anomaly score [0.0-1.0]
 * @param {number} [historicalTrend=0.5] - Historical trend [0.0-1.0]
 * @returns {Object} { trustScore, anomalyScore, components, status }
 */
function computeTrustScore(anomalyScore, historicalTrend = 0.5) {
  const baseScore = 1 - anomalyScore;
  const trendAdjustment = (historicalTrend - 0.5) * 0.10;
  const trustScore = Math.max(0, Math.min(1, baseScore + trendAdjustment));
  
  let status;
  if (trustScore >= TRUST_THRESHOLDS.TRUSTED) status = 'trusted';
  else if (trustScore >= TRUST_THRESHOLDS.CAUTION) status = 'caution';
  else status = 'untrusted';
  
  return {
    trustScore: Math.round(trustScore * 1000) / 1000,
    anomalyScore: Math.round(anomalyScore * 1000) / 1000,
    components: {
      baseScore: Math.round(baseScore * 1000) / 1000,
      trendAdjustment: Math.round(trendAdjustment * 1000) / 1000,
      historicalTrend
    },
    status
  };
}

// ============================================================================
// Severity Classification (F-3 Fix)
// ============================================================================

/**
 * Classify alert severity using BOTH anomaly score AND trust score.
 * 
 * F-3 FIX: Previously only checked trust score, now uses both dimensions.
 * 
 * @param {number} anomalyScore - Anomaly score [0.0-1.0]
 * @param {number} trustScore - Trust score [0.0-1.0]
 * @returns {string} Severity level
 */
function classifySeverity(anomalyScore, trustScore) {
  // CRITICAL: High anomaly AND low trust
  if (anomalyScore >= 0.8 && trustScore < 0.4) {
    return Severity.CRITICAL;
  }
  
  // HIGH: High anomaly OR degraded trust
  if (anomalyScore >= 0.6 || trustScore < 0.7) {
    return Severity.HIGH;
  }
  
  // WARNING: Moderate anomaly or moderate trust
  if (anomalyScore >= 0.3 || trustScore < 0.9) {
    return Severity.WARNING;
  }
  
  // INFO: Low anomaly AND high trust
  return Severity.INFO;
}

// ============================================================================
// Anomaly Penalty Application (F-1 Fix)
// ============================================================================

/**
 * Apply anomaly penalty to pheromone matrix (ADR (internal) negative reinforcement).
 * 
 * F-1 FIX: Penalty now INCREASES with anomaly (was decreasing/inverted).
 * 
 * @param {string} agentId - Agent ID
 * @param {number} anomalyScore - Anomaly score [0.0-1.0]
 * @param {Object} [pheromoneMatrix] - Optional pheromone matrix
 * @returns {Object} Penalty result
 */
function applyAnomalyPenalty(agentId, anomalyScore, pheromoneMatrix = null) {
  if (anomalyScore < 0.3) {
    return { agentId, anomalyScore, penaltyFactor: 0, tasksAffected: 0, status: 'no_penalty' };
  }
  
  // F-1 FIX: Penalty factor INCREASES with anomaly (not decreases)
  const penaltyFactor = Math.min(1.0, (anomalyScore - 0.3) / 0.7);
  const estimatedTasksAffected = pheromoneMatrix ? pheromoneMatrix.keys().length : 10;
  
  return {
    agentId,
    anomalyScore,
    penaltyFactor: Math.round(penaltyFactor * 1000) / 1000,
    estimatedTasksAffected,
    erosionPercent: Math.round(penaltyFactor * 100),
    status: 'penalty_applied'
  };
}

// ============================================================================
// Alert Generation
// ============================================================================

/**
 * Generate alert for an anomaly detection event.
 */
function generateAlert(agentId, anomalyResult, trustResult, context = {}) {
  const severity = classifySeverity(anomalyResult.anomalyScore, trustResult.trustScore);
  
  const alert = {
    alertId: `alert_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    agentId,
    severity,
    anomalyScore: anomalyResult.anomalyScore,
    trustScore: trustResult.trustScore,
    trustStatus: trustResult.status,
    dimensions: anomalyResult.dimensions,
    actions: ALERT_ACTIONS[severity],
    detectedAt: new Date().toISOString(),
    context,
    status: 'active'
  };
  
  store.storeAlert(alert);
  return alert;
}

// ============================================================================
// Tests (F-1, F-2, F-3)
// ============================================================================

function runTests() {
  const results = { passed: 0, failed: 0, tests: [] };
  
  function test(name, fn) {
    try {
      fn();
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
      console.log(`✅ ${name}`);
    } catch (err) {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', error: err.message });
      console.log(`❌ ${name}: ${err.message}`);
    }
  }
  
  // F-2 Tests
  test('F-2: computeZScore stddev=0 normal → 0', () => {
    const z = computeZScore(10, { mean: 10, stddev: 0 });
    if (z !== 0) throw new Error(`Expected 0, got: ${z}`);
  });
  
  test('F-2: computeZScore stddev=0 deviant → 3', () => {
    const z = computeZScore(15, { mean: 10, stddev: 0 });
    if (z !== 3) throw new Error(`Expected 3, got: ${z}`);
  });
  
  test('F-2: computeZScore normal → correct', () => {
    const z = computeZScore(15, { mean: 10, stddev: 2 });
    if (z !== 2.5) throw new Error(`Expected 2.5, got: ${z}`);
  });
  
  // F-3 Tests
  test('F-3: high anomaly + low trust → CRITICAL', () => {
    if (classifySeverity(0.85, 0.3) !== 'CRITICAL') throw new Error('Expected CRITICAL');
  });
  
  test('F-3: high anomaly + moderate trust → HIGH', () => {
    if (classifySeverity(0.85, 0.6) !== 'HIGH') throw new Error('Expected HIGH');
  });
  
  test('F-3: low anomaly + high trust → INFO', () => {
    if (classifySeverity(0.1, 0.95) !== 'INFO') throw new Error('Expected INFO');
  });
  
  test('F-3: moderate anomaly → WARNING', () => {
    if (classifySeverity(0.4, 0.9) !== 'WARNING') throw new Error('Expected WARNING');
  });
  
  test('F-3: low trust alone → HIGH', () => {
    if (classifySeverity(0.2, 0.5) !== 'HIGH') throw new Error('Expected HIGH');
  });
  
  // F-1 Tests
  test('F-1: anomalyScore < 0.3 → no penalty', () => {
    const r = applyAnomalyPenalty('a', 0.2);
    if (r.status !== 'no_penalty') throw new Error('Expected no_penalty');
  });
  
  test('F-1: anomalyScore = 0.65 → penalty ≈ 0.5', () => {
    const r = applyAnomalyPenalty('a', 0.65);
    const expected = (0.65 - 0.3) / 0.7;
    if (Math.abs(r.penaltyFactor - expected) > 0.01) throw new Error(`Expected ~${expected}, got: ${r.penaltyFactor}`);
  });
  
  test('F-1: anomalyScore = 1.0 → penalty = 1.0', () => {
    const r = applyAnomalyPenalty('a', 1.0);
    if (r.penaltyFactor !== 1.0) throw new Error('Expected 1.0');
  });
  
  // Trust score tests
  test('Trust: normal anomaly → trusted', () => {
    const r = computeTrustScore(0.1, 0.5);
    if (r.status !== 'trusted') throw new Error(`Expected trusted, got: ${r.status}`);
  });
  
  test('Trust: high anomaly → untrusted', () => {
    const r = computeTrustScore(0.8, 0.5);
    if (r.status !== 'untrusted') throw new Error(`Expected untrusted, got: ${r.status}`);
  });
  
  test('Trust: improving trend → boost', () => {
    const base = computeTrustScore(0.5, 0.5);
    const improved = computeTrustScore(0.5, 0.8);
    if (improved.trustScore <= base.trustScore) throw new Error('Expected boost');
  });
  
  return results;
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  computeZScore,
  computeAnomalyScore,
  computeTrustScore,
  classifySeverity,
  applyAnomalyPenalty,
  generateAlert,
  Severity,
  TRUST_THRESHOLDS,
  DEFAULT_DIMENSION_WEIGHTS,
  ALERT_ACTIONS,
  runTests
};
