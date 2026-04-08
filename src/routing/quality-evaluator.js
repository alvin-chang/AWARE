/**
 * ADR-011: Phase 2.3 — Quality Evaluator
 * 
 * Computes quality score from outcome metrics using weighted multi-factor model.
 * Per ADR-011 F-1 fix: specified algorithm using weighted combination.
 * 
 * @module routing/quality-evaluator
 * @author Forge (Coder)
 * @license GPL-3.0
 */

'use strict';

// ============================================================================
// Constants
// ============================================================================

/**
 * Quality rating thresholds per ADR-011 §Quality Thresholds.
 */
const QUALITY_THRESHOLDS = {
  EXCELLENT: 0.9,
  ACCEPTABLE: 0.6,
  MARGINAL: 0.4
};

/**
 * Quality rating multipliers for reinforcement.
 */
const QUALITY_MULTIPLIERS = {
  EXCELLENT: 1.5,   // Bonus multiplier
  ACCEPTABLE: 1.0,  // Standard
  MARGINAL: 0.0,    // Neutral
  FAIL: -0.5        // Negative
};

/**
 * Default weights for quality score components.
 * Per ADR-011 §Quality Assessment.
 */
const DEFAULT_WEIGHTS = {
  correctness: 0.40,    // Primary: did it solve the problem?
  completeness: 0.30,   // Secondary: was the work thorough?
  efficiency: 0.15,     // Tertiary: was it resource-efficient?
  timeliness: 0.15      // Minor: was it delivered on time?
};

// ============================================================================
// Quality Score Computation
// ============================================================================

/**
 * @typedef {Object} OutcomeMetrics
 * @property {number} correctness - 0.0–1.0, % of expected outcomes achieved
 * @property {number} completeness - 0.0–1.0, proportion of required subtasks completed
 * @property {number} efficiency - 0.0–1.0, resource usage vs baseline (1.0 = optimal)
 * @property {number} timeliness - 0.0–1.0, within SLA window (1.0 = on-time)
 */

/**
 * @typedef {Object} TaskSpecification
 * @property {number} requiredSubtasks - Number of required subtasks
 * @property {number} baselineResourceUsage - Expected resource units
 * @property {number} slaHours - SLA window in hours
 */

/**
 * Compute quality score using weighted multi-factor model.
 * 
 * Algorithm (ADR-011 F-1 fix):
 * quality_score = Σ (weight_i × metric_i)
 * 
 * @param {OutcomeMetrics} metrics - Outcome metrics
 * @param {TaskSpecification} spec - Task specification
 * @param {Object} [weights=DEFAULT_WEIGHTS] - Component weights
 * @returns {number} Quality score [0.0–1.0]
 */
function computeQualityScore(metrics, spec, weights = DEFAULT_WEIGHTS) {
  // Validate inputs
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('metrics must be an OutcomeMetrics object');
  }
  
  const { correctness, completeness, efficiency, timeliness } = metrics;
  
  // Validate metrics are numbers
  for (const [key, value] of Object.entries({ correctness, completeness, efficiency, timeliness })) {
    if (typeof value !== 'number' || isNaN(value) || value < 0 || value > 1) {
      throw new Error(`metrics.${key} must be a number in [0,1], got: ${value}`);
    }
  }
  
  // Compute weighted sum
  const score = 
    (weights.correctness * correctness) +
    (weights.completeness * completeness) +
    (weights.efficiency * efficiency) +
    (weights.timeliness * timeliness);
  
  // Clamp to [0.0, 1.0]
  return Math.max(0.0, Math.min(1.0, score));
}

/**
 * Get quality rating from quality score.
 * 
 * @param {number} score - Quality score [0.0–1.0]
 * @returns {string} Quality rating: EXCELLENT | ACCEPTABLE | MARGINAL | FAIL
 */
function getQualityRating(score) {
  if (score >= QUALITY_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
  if (score >= QUALITY_THRESHOLDS.ACCEPTABLE) return 'ACCEPTABLE';
  if (score >= QUALITY_THRESHOLDS.MARGINAL) return 'MARGINAL';
  return 'FAIL';
}

/**
 * Get reinforcement multiplier for quality rating.
 * 
 * @param {string} rating - Quality rating
 * @returns {number} Multiplier
 */
function getQualityMultiplier(rating) {
  return QUALITY_MULTIPLIERS[rating] ?? 0;
}

// ============================================================================
// Quality Evaluation
// ============================================================================

/**
 * @typedef {Object} QualityGateResult
 * @property {boolean} passed - Whether quality gate passed
 * @property {number} qualityScore - Computed quality score [0.0–1.0]
 * @property {string} rating - Quality rating
 * @property {number} multiplier - Reinforcement multiplier
 * @property {string[]} reasons - Reasons for the rating
 */

/**
 * Evaluate task outcome quality.
 * 
 * @param {OutcomeMetrics} metrics - Outcome metrics
 * @param {TaskSpecification} [spec] - Optional task specification
 * @param {Object} [options] - Evaluation options
 * @param {number} [options.minAcceptableScore] - Minimum acceptable score (default: 0.6)
 * @returns {QualityGateResult}
 */
function evaluateQuality(metrics, spec, options = {}) {
  const minAcceptableScore = options.minAcceptableScore ?? QUALITY_THRESHOLDS.ACCEPTABLE;
  
  // Compute quality score
  const qualityScore = computeQualityScore(metrics, spec);
  const rating = getQualityRating(qualityScore);
  const multiplier = getQualityMultiplier(rating);
  
  // Determine if gate passed
  const passed = qualityScore >= minAcceptableScore;
  
  // Build reasons
  const reasons = buildReasons(metrics, qualityScore, rating);
  
  return {
    passed,
    qualityScore,
    rating,
    multiplier,
    reasons
  };
}

/**
 * Build human-readable reasons for quality rating.
 * 
 * @param {OutcomeMetrics} metrics
 * @param {number} score
 * @param {string} rating
 * @returns {string[]}
 */
function buildReasons(metrics, score, rating) {
  const reasons = [];
  
  // Overall rating
  reasons.push(`Overall quality: ${rating} (score: ${score.toFixed(3)})`);
  
  // Component breakdown
  if (metrics.correctness < 0.6) {
    reasons.push(`Correctness below target: ${(metrics.correctness * 100).toFixed(0)}%`);
  }
  if (metrics.completeness < 0.6) {
    reasons.push(`Completeness below target: ${(metrics.completeness * 100).toFixed(0)}%`);
  }
  if (metrics.efficiency < 0.6) {
    reasons.push(`Efficiency below target: ${(metrics.efficiency * 100).toFixed(0)}%`);
  }
  if (metrics.timeliness < 0.6) {
    reasons.push(`Timeliness below target: ${(metrics.timeliness * 100).toFixed(0)}%`);
  }
  
  return reasons;
}

// ============================================================================
// Convenience Factory
// ============================================================================

/**
 * Create OutcomeMetrics from common inputs.
 * 
 * @param {Object} params
 * @param {number} params.totalTests - Total tests run
 * @param {number} params.passedTests - Tests passed
 * @param {number} params.completedSubtasks - Subtasks completed
 * @param {number} params.totalSubtasks - Total subtasks
 * @param {number} params.actualDurationMs - Actual duration in ms
 * @param {number} params.slaDurationMs - SLA duration in ms
 * @returns {OutcomeMetrics}
 */
function createMetricsFromTestResults({ totalTests, passedTests, completedSubtasks, totalSubtasks, actualDurationMs, slaDurationMs }) {
  const correctness = totalTests > 0 ? passedTests / totalTests : 0;
  const completeness = totalSubtasks > 0 ? completedSubtasks / totalSubtasks : 0;
  const efficiency = slaDurationMs > 0 ? Math.min(1, slaDurationMs / actualDurationMs) : 1;
  const timeliness = slaDurationMs > 0 && actualDurationMs <= slaDurationMs ? 1 : 0;
  
  return { correctness, completeness, efficiency, timeliness };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Constants
  QUALITY_THRESHOLDS,
  QUALITY_MULTIPLIERS,
  DEFAULT_WEIGHTS,
  
  // Core functions
  computeQualityScore,
  getQualityRating,
  getQualityMultiplier,
  evaluateQuality,
  createMetricsFromTestResults
};
