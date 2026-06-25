// src/emergency/blast-radius-estimator.js
// Phase 3.2: Kill Switch Propagation — Blast radius estimation before issuing kill

const { KillSeverity } = require('./kill-signal-entry');

/**
 * BlastRadiusEstimator — estimates impact before issuing a kill signal
 * Helps admins make informed decision about scope
 */
class BlastRadiusEstimator {
  /**
   * @param {Object} deps
   * @param {Object} deps.agentRegistry - Agent registry
   * @param {Object} deps.taskQueue - Task queue
   */
  constructor(deps) {
    this.agentRegistry = deps.agentRegistry;
    this.taskQueue = deps.taskQueue;
  }

  /**
   * Estimate blast radius for a target
   * @param {Object} target - Target scope
   * @param {string} target.scope - 'GLOBAL' or trust domain
   * @param {string[]} [target.agentIds] - Specific agent IDs (null = all in scope)
   * @returns {Object} Blast radius estimation
   */
  async estimate(target) {
    if (target.scope === 'GLOBAL' || (!target.scope && !target.agentIds)) {
      return this._estimateGlobal();
    }

    const agentsInScope = target.agentIds ||
      await this._getAgentsByScope(target.scope);

    return this._estimateForAgents(agentsInScope, target.scope);
  }

  /**
   * Estimate for GLOBAL scope
   */
  async _estimateGlobal() {
    const allAgents = await this._getAllAgents();
    const activeTasks = await this._countActiveTasks();
    const pendingTasks = await this._countPendingTasks();

    return {
      agentsAffected: allAgents.length,
      tasksAffected: activeTasks + pendingTasks,
      estimatedDowntime: this._estimateRestartTime(allAgents.length),
      businessImpact: 'CRITICAL',
      scope: 'GLOBAL',
      recommendation: 'GLOBAL kill should only be used as last resort',
      affectedServices: await this._identifyRevieweralServices(allAgents),
    };
  }

  /**
   * Estimate for specific agents
   */
  async _estimateForAgents(agentIds, scope) {
    const activeTasks = await this._countTasksForAgents(agentIds);
    const pendingTasks = await this._countPendingTasksForAgents(agentIds);
    const restartTime = this._estimateRestartTime(agentIds.length);

    let businessImpact = 'LOW';
    if (agentIds.length > 5 || activeTasks > 10) {
      businessImpact = 'MEDIUM';
    }
    if (agentIds.length > 10 || activeTasks > 20) {
      businessImpact = 'HIGH';
    }
    if (agentIds.length > 20 || activeTasks > 50) {
      businessImpact = 'CRITICAL';
    }

    return {
      agentsAffected: agentIds.length,
      tasksAffected: activeTasks + pendingTasks,
      estimatedDowntime: restartTime,
      businessImpact,
      scope: scope || 'SPECIFIC',
      affectedAgents: agentIds,
    };
  }

  /**
   * Get all agents in the system
   */
  async _getAllAgents() {
    if (!this.agentRegistry) return [];
    try {
      return this.agentRegistry.getAllAgents
        ? this.agentRegistry.getAllAgents()
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Get agents by trust domain scope
   */
  async _getAgentsByScope(scope) {
    if (!this.agentRegistry) return [];
    try {
      return this.agentRegistry.getAgentsByScope
        ? this.agentRegistry.getAgentsByScope(scope)
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Count all active tasks
   */
  async _countActiveTasks() {
    if (!this.taskQueue) return 0;
    try {
      return this.taskQueue.countActiveTasks
        ? await this.taskQueue.countActiveTasks()
        : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Count pending tasks
   */
  async _countPendingTasks() {
    if (!this.taskQueue) return 0;
    try {
      return this.taskQueue.countPendingTasks
        ? await this.taskQueue.countPendingTasks()
        : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Count active tasks for specific agents
   */
  async _countTasksForAgents(agentIds) {
    if (!this.taskQueue || !agentIds.length) return 0;
    try {
      return this.taskQueue.countTasksForAgents
        ? await this.taskQueue.countTasksForAgents(agentIds)
        : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Count pending tasks for specific agents
   */
  async _countPendingTasksForAgents(agentIds) {
    if (!this.taskQueue || !agentIds.length) return 0;
    try {
      return this.taskQueue.countPendingTasksForAgents
        ? await this.taskQueue.countPendingTasksForAgents(agentIds)
        : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Estimate restart time based on agent count
   * Assumes ~30 seconds per agent for graceful restart
   */
  _estimateRestartTime(agentCount) {
    const perAgentTime = 30 * 1000; // 30 seconds
    const minTime = 60 * 1000; // 1 minute minimum
    const maxTime = 30 * 60 * 1000; // 30 minutes maximum

    const estimated = Math.max(minTime, Math.min(maxTime, agentCount * perAgentTime));

    return {
      milliseconds: estimated,
      humanReadable: this._formatDuration(estimated),
    };
  }

  /**
   * Format duration in human readable form
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Identify critical services that would be affected
   */
  async _identifyRevieweralServices(agents) {
    // This would integrate with service discovery
    // For now, return placeholder
    const criticalRoles = ['coordinator', 'reviewer', 'tester'];
    const critical = [];

    for (const agent of agents) {
      if (criticalRoles.includes(agent.role)) {
        critical.push({
          agentId: agent.id,
          role: agent.role,
          reason: 'Revieweral pipeline role',
        });
      }
    }

    return critical;
  }

  /**
   * Get recommendation for severity level
   * Helps choose between LOCAL, DOMAIN, GLOBAL
   */
  getRecommendation(agentIds, scope) {
    const count = agentIds ? agentIds.length : 0;

    if (count <= 1) {
      return {
        recommendedSeverity: KillSeverity.LOCAL,
        reason: 'Single agent issue - use LOCAL kill',
      };
    }

    if (count <= 5 && scope !== 'GLOBAL') {
      return {
        recommendedSeverity: KillSeverity.DOMAIN,
        reason: 'Small scope - use DOMAIN kill to contain damage',
      };
    }

    return {
      recommendedSeverity: KillSeverity.GLOBAL,
      reason: 'Large scope - consider GLOBAL kill if compromise is widespread',
    };
  }
}

module.exports = BlastRadiusEstimator;
