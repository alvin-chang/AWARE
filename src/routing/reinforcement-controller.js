/**
 * ADR-011: Phase 2.3 — Reinforcement Controller
 * 
 * Orchestrates dual-gate (quality + security) pheromone reinforcement.
 * Per ADR-011 §Dual-Gate Flow.
 * 
 * @module routing/reinforcement-controller
 * @author Forge (Coder)
 * @license GPL-3.0
 */

'use strict';

const { 
  evaluateQuality,
  QUALITY_THRESHOLDS 
} = require('./quality-evaluator');

const { 
  checkPolicyCompliance,
  VIOLATION_SEVERITY 
} = require('./policy-checker');

const {
  depositPheromone,
  applyNegativeReinforcement,
  TaskCategory
} = require('./pheromone-table');

// ============================================================================
// Constants
// ============================================================================

/**
 * Event types per ADR-011 §Reinforcement Triggers.
 */
const EVENT_TYPES = {
  TASK_SUCCESS: 'task_success',
  TASK_PARTIAL: 'task_partial',
  TASK_FAILURE: 'task_failure',
  POLICY_VIOLATION: 'policy_violation'
};

/**
 * Learning rate for pheromone reinforcement.
 */
const LEARNING_RATE = 0.1;

/**
 * Minimum pheromone value (for negative reinforcement floor).
 */
const PHEROMONE_MIN = 0.01;

// ============================================================================
// Reinforcement Decision
// ============================================================================

/**
 * @typedef {Object} ReinforcementResult
 * @property {boolean} reinforced - Whether pheromones were reinforced
 * @property {string} eventType - Event type (task_success, policy_violation, etc.)
 * @property {string} reason - Human-readable reason
 * @property {Object} qualityGate - Quality gate result
 * @property {Object} securityGate - Security gate result
 * @property {number} [multiplier] - Reinforcement multiplier (if reinforced)
 */

// ============================================================================
// Reinforcement Controller
// ============================================================================

/**
 * Process task completion and determine reinforcement.
 * 
 * @param {Object} params
 * @param {string} params.taskId - Task identifier
 * @param {string} params.category - TaskCategory
 * @param {string[]} params.pathAgents - Agent path [A, B, C]
 * @param {Object} params.outcomeMetrics - OutcomeMetrics for quality evaluation
 * @param {Object} [params.securityParams] - Parameters for security check
 * @param {Object} [params.agentId] - Primary agent ID
 * @returns {ReinforcementResult}
 */
function processTaskCompletion(params) {
  const { taskId, category, pathAgents, outcomeMetrics, securityParams = {}, agentId } = params;
  
  // Step 1: Evaluate quality gate
  const qualityGate = evaluateQuality(outcomeMetrics);
  
  // Step 2: Evaluate security gate
  const securityGate = checkPolicyCompliance({
    taskId,
    agentId: agentId || pathAgents[pathAgents.length - 1],
    ...securityParams
  });
  
  // Step 3: Determine event type and reinforcement
  let eventType;
  let reinforced = false;
  let multiplier;
  let reason;
  
  if (!securityGate.passed) {
    // Security gate failed — policy violation
    eventType = EVENT_TYPES.POLICY_VIOLATION;
    reason = `Policy violation: ${securityGate.reasons.join(', ')}`;
    
    // Apply negative reinforcement with blast radius
    applyReinforcement({
      taskId,
      category,
      pathAgents,
      qualityGate,
      securityGate,
      eventType
    });
    
    reinforced = true;
    
  } else if (!qualityGate.passed) {
    // Quality gate failed — task failure
    eventType = EVENT_TYPES.TASK_FAILURE;
    reason = `Task failed: ${qualityGate.reasons.join(', ')}`;
    
    // Apply negative reinforcement
    applyReinforcement({
      taskId,
      category,
      pathAgents,
      qualityGate,
      securityGate,
      eventType
    });
    
    reinforced = true;
    
  } else if (qualityGate.rating === 'MARGINAL') {
    // Marginal quality — neutral reinforcement
    eventType = EVENT_TYPES.TASK_PARTIAL;
    reason = `Task partially succeeded: ${qualityGate.reasons.join(', ')}`;
    reinforced = false;  // No reinforcement for marginal tasks (multiplier = 0)
    
  } else {
    // Quality and security passed — positive reinforcement
    eventType = EVENT_TYPES.TASK_SUCCESS;
    reason = `Task succeeded: quality=${qualityGate.qualityScore.toFixed(3)}, rating=${qualityGate.rating}`;
    
    // Apply positive reinforcement
    applyReinforcement({
      taskId,
      category,
      pathAgents,
      qualityGate,
      securityGate,
      eventType
    });
    
    reinforced = true;
    multiplier = qualityGate.multiplier;
  }
  
  return {
    reinforced,
    eventType,
    reason,
    qualityGate,
    securityGate,
    multiplier
  };
}

/**
 * Apply reinforcement based on event type.
 * 
 * @param {Object} params
 */
function applyReinforcement(params) {
  const { taskId, category, pathAgents, qualityGate, securityGate, eventType } = params;
  
  const deposit = {
    taskCategory: category || TaskCategory.GENERAL,
    taskId,
    pathAgents,
    qualityGate,
    securityGate
  };
  
  switch (eventType) {
    case EVENT_TYPES.TASK_SUCCESS:
      // Positive reinforcement
      depositPheromone(deposit);
      break;
      
    case EVENT_TYPES.TASK_PARTIAL:
      // Neutral reinforcement — no change (multiplier = 0)
      break;
      
    case EVENT_TYPES.TASK_FAILURE:
      // Negative reinforcement
      const severity = 1.0;  // Full severity for failure
      applyNegativeReinforcement(deposit, severity);
      break;
      
    case EVENT_TYPES.POLICY_VIOLATION:
      // Policy violation — use security gate severity
      const violationSeverity = securityGate.maxSeverity || VIOLATION_SEVERITY.HIGH;
      applyNegativeReinforcement(deposit, violationSeverity);
      break;
  }
}

// ============================================================================
// Emergency Override
// ============================================================================

/**
 * Apply emergency bypass for critical fixes.
 * Per ADR-011 §Quality Gate Bypass (Emergency Override).
 * 
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.agentId
 * @param {string} params.authorizedBy - Admin who authorized bypass
 * @param {string} params.reason - Justification for bypass
 * @returns {Object} Override result
 */
function applyEmergencyBypass(params) {
  const { taskId, agentId, authorizedBy, reason } = params;
  
  // Validate authorization
  if (!authorizedBy || authorizedBy !== 'admin') {
    throw new Error('Emergency bypass requires admin authorization');
  }
  
  // Log the bypass
  const bypassLog = {
    event: 'EMERGENCY_BYPASS',
    taskId,
    agentId,
    authorizedBy,
    reason,
    timestamp: new Date().toISOString()
  };
  
  console.log('[reinforcement-controller] EMERGENCY BYPASS:', JSON.stringify(bypassLog));
  
  // TODO: Persist to audit log (Phase 2.4)
  
  return {
    success: true,
    bypassLog
  };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Constants
  EVENT_TYPES,
  LEARNING_RATE,
  PHEROMONE_MIN,
  
  // Core functions
  processTaskCompletion,
  applyReinforcement,
  applyEmergencyBypass
};
