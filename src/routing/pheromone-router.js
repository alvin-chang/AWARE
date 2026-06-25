const crypto = require('crypto');
/**
 * ADR (internal): Phase 2.1 — Pheromone Router Integration
 * 
 * Integrates pheromone-table with heuristic-calculator for
 * AMRO-S soft-max probabilistic agent selection.
 * 
 * @module routing/pheromone-router
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const { 
  TaskCategory, 
  selectAgent, 
  depositPheromone, 
  applyNegativeReinforcement,
  startEvaporationJob,
  loadFromDisk,
  getOrCreateTable,
  getStats,
  getAllStats
} = require('./pheromone-table');

const { classifyTask } = require('./task-classifier');
const { computeHeuristic, DEFAULT_WEIGHTS, isEligible } = require('./heuristic-calculator');

// ============================================================================
// Initialization
// ============================================================================

/** @type {IntervalHandle|null} */
let evaporationJob = null;

/**
 * Initialize pheromone router.
 * Loads persisted tables and starts evaporation job.
 * 
 * @returns {void}
 */
function init() {
  console.log('[pheromone-router] Initializing...');
  loadFromDisk();
  evaporationJob = startEvaporationJob();
  console.log('[pheromone-router] Initialized. Evaporation job started.');
}

/**
 * Shutdown pheromone router.
 * Stops evaporation job gracefully.
 * 
 * @returns {void}
 */
function shutdown() {
  if (evaporationJob) {
    clearInterval(evaporationJob);
    evaporationJob = null;
    console.log('[pheromone-router] Shutdown complete.');
  }
}

// ============================================================================
// Routing
// ============================================================================

/**
 * Route a task to an agent using AMRO-S pheromone-based selection.
 * 
 * @param {Object} task - Task object with prompt and requirements
 * @param {string} task.prompt - Task description
 * @param {Object} [task.metadata] - Optional metadata
 * @param {Object} task.requirements - Task requirements for heuristic
 * @param {number} task.requirements.requiredDataSensitivity
 * @param {string[]} task.requirements.preferredCapabilities
 * @param {number} task.requirements.minTrustScore
 * @param {number} task.requirements.blastRadiusTolerance
 * @returns {Object} Routing decision
 */
function routeTask(task) {
  // Classify task into category
  const category = classifyTask(task);
  
  // Build heuristic function wrapper for selectAgent
  const heuristicFn = (agentId, t) => {
    // TODO: Fetch actual agent heuristic inputs from registry
    // For now, return neutral score
    return 0.5;
  };
  
  // Select agent using pheromone routing
  const selection = selectAgent(category, task, heuristicFn);
  
  return {
    taskId: task.taskId || generateTaskId(),
    category,
    agentId: selection.agentId,
    pheromoneStrength: selection.pheromoneStrength,
    heuristicScore: selection.heuristicScore,
    allScores: selection.allScores,
    routedAt: new Date().toISOString()
  };
}

/**
 * Record task completion for pheromone reinforcement.
 * 
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.category - TaskCategory
 * @param {string[]} params.pathAgents - Agent path [A, B, C]
 * @param {Object} params.qualityGate - QualityGateResult
 * @param {Object} params.securityGate - SecurityGateResult
 * @param {number} [params.violationSeverity] - For negative reinforcement
 */
function recordCompletion(params) {
  const { taskId, category, pathAgents, qualityGate, securityGate, violationSeverity } = params;
  
  const deposit = {
    taskCategory: category || TaskCategory.GENERAL,
    taskId,
    pathAgents,
    qualityGate,
    securityGate
  };
  
  if (violationSeverity !== undefined && violationSeverity > 0) {
    applyNegativeReinforcement(deposit, violationSeverity);
  } else {
    depositPheromone(deposit);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateTaskId() {
  return `task-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Get routing statistics.
 * @returns {Object}
 */
function getRoutingStats() {
  return {
    tables: getAllStats(),
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Initialization
  init,
  shutdown,
  
  // Routing
  routeTask,
  recordCompletion,
  
  // Utilities
  getRoutingStats,
  
  // Re-exports
  TaskCategory
};
