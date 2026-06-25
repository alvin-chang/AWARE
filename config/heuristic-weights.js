/**
 * ADR (internal): Phase 2.2 — Security-Weighted Heuristic Configuration
 * 
 * Configurable weights for the security-weighted heuristic function.
 * Weights determine the relative importance of each factor in routing decisions.
 * 
 * All weights should sum to 1.0 for balanced scoring.
 * Per-category overrides can be defined for different task types.
 * 
 * @module config/heuristic-weights
 * @license GPL-3.0
 */

'use strict';

/**
 * @typedef {Object} HeuristicWeightConfig
 * @property {Object} weights - Default weight configuration
 * @property {number} weights.w1_capability - Agent capability weight (default: 0.30)
 * @property {number} weights.w2_load_balance - Load balance weight (default: 0.20)
 * @property {number} weights.w3_trust_score - Trust score weight (default: 0.25)
 * @property {number} weights.w4_data_clearance - Data clearance weight (default: 0.15)
 * @property {number} weights.w5_blast_radius_inverse - Blast radius inverse weight (default: 0.10)
 * @property {Object} [category_overrides] - Per-category weight overrides
 * @property {Object} [global_minimums] - Global minimum thresholds
 */

/**
 * Default weights per ADR (internal) specification.
 * Balanced configuration emphasising capability and trust.
 * 
 * Security rationale:
 * - w3 (trust_score) = 0.25: Behavioural trust is critical for security
 * - w1 (capability) = 0.30: Task capability is important but not at expense of security
 * - w2 (load_balance) = 0.20: Load balancing prevents single points of failure
 * - w4 (data_clearance) = 0.15: Data sensitivity matching is important
 * - w5 (blast_radius_inverse) = 0.10: Blast radius is a secondary security concern
 */
const DEFAULT_WEIGHTS = {
  w1_capability: 0.30,
  w2_load_balance: 0.20,
  w3_trust_score: 0.25,
  w4_data_clearance: 0.15,
  w5_blast_radius_inverse: 0.10
};

/**
 * Per-category weight overrides.
 * 
 * security-review: Emphasise trust and clearance for security-sensitive tasks
 * coordination: Emphasise load balancing for coordination tasks
 */
const CATEGORY_OVERRIDES = {
  /**
   * Security review tasks: Higher weight on trust and clearance
   */
  'security-review': {
    w1_capability: 0.25,
    w2_load_balance: 0.10,
    w3_trust_score: 0.35,  // Increased trust emphasis
    w4_data_clearance: 0.25,  // Increased clearance emphasis
    w5_blast_radius_inverse: 0.05
  },
  
  /**
   * Code review tasks: Balanced with trust emphasis
   */
  'code-review': {
    w1_capability: 0.35,
    w2_load_balance: 0.10,
    w3_trust_score: 0.30,
    w4_data_clearance: 0.15,
    w5_blast_radius_inverse: 0.10
  },
  
  /**
   * Coordination tasks: Higher weight on load balancing
   */
  'coordination': {
    w1_capability: 0.20,
    w2_load_balance: 0.35,  // Increased load balance emphasis
    w3_trust_score: 0.25,
    w4_data_clearance: 0.10,
    w5_blast_radius_inverse: 0.10
  },
  
  /**
   * Monitoring tasks: Higher weight on trust
   */
  'monitoring': {
    w1_capability: 0.20,
    w2_load_balance: 0.15,
    w3_trust_score: 0.40,  // Maximum trust emphasis
    w4_data_clearance: 0.15,
    w5_blast_radius_inverse: 0.10
  },
  
  /**
   * High-security tasks: Maximum weight on clearance and blast radius
   */
  'high-security': {
    w1_capability: 0.20,
    w2_load_balance: 0.05,
    w3_trust_score: 0.25,
    w4_data_clearance: 0.30,
    w5_blast_radius_inverse: 0.20  // Maximum blast radius emphasis
  }
};

/**
 * Global minimum thresholds.
 * Agents below these thresholds are ineligible for ANY task.
 */
const GLOBAL_MINIMUMS = {
  /** Minimum trust score for any routing (default: 0.3) */
  minTrustScore: 0.30,
  
  /** Maximum blast radius tolerance for any routing (default: 0.8) */
  maxBlastRadiusTolerance: 0.80
};

/**
 * Get weights for a specific task category.
 * Returns category-specific weights if defined, otherwise default weights.
 * 
 * @param {string} [category] - Task category (e.g., 'security-review', 'coordination')
 * @returns {Object} Weight configuration object
 * 
 * @example
 * const weights = getWeights('security-review');
 * // Returns: { w1_capability: 0.25, w2_load_balance: 0.10, ... }
 */
function getWeights(category) {
  if (category && CATEGORY_OVERRIDES[category]) {
    return { ...DEFAULT_WEIGHTS, ...CATEGORY_OVERRIDES[category] };
  }
  return { ...DEFAULT_WEIGHTS };
}

/**
 * Validate weights configuration.
 * Ensures all weights are valid numbers and sum is positive.
 * 
 * @param {Object} weights - Weights to validate
 * @returns {boolean} True if valid
 * @throws {Error} If weights are invalid
 */
function validateConfig(weights) {
  const weightKeys = ['w1_capability', 'w2_load_balance', 'w3_trust_score', 'w4_data_clearance', 'w5_blast_radius_inverse'];
  
  for (const key of weightKeys) {
    if (typeof weights[key] !== 'number' || isNaN(weights[key])) {
      throw new Error(`Weight ${key} must be a valid number, got: ${weights[key]}`);
    }
    if (weights[key] < 0 || weights[key] > 1) {
      throw new Error(`Weight ${key} must be in [0, 1], got: ${weights[key]}`);
    }
  }
  
  const sum = weightKeys.reduce((s, k) => s + weights[k], 0);
  if (sum <= 0) {
    throw new Error(`Weights sum must be positive, got: ${sum}`);
  }
  
  return true;
}

module.exports = {
  DEFAULT_WEIGHTS,
  CATEGORY_OVERRIDES,
  GLOBAL_MINIMUMS,
  getWeights,
  validateConfig
};
