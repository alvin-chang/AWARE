// src/emergency/shutdown-controller.js
// Phase 3.2: Kill Switch Propagation — Execute GRACEFUL or FORCED shutdown

const EventEmitter = require('events');
const { ShutdownProcedure } = require('./kill-signal-entry');

/**
 * ShutdownController — executes shutdown procedures on agents
 * Handles both GRACEFUL (complete work then stop) and FORCED (stop immediately)
 */
class ShutdownController extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.agentRegistry - Agent registry
   * @param {Object} deps.taskQueue - Task queue
   * @param {Object} deps.sessionManager - Session manager (ADR (internal))
   * @param {Object} deps.credentialRotator - Credential rotator (ADR (internal))
   * @param {Object} deps.pheromoneStore - Pheromone store (ADR (internal))
   * @param {Object} deps.auditLogger - Audit logger
   * @param {Object} deps.config
   */
  constructor(deps) {
    super();
    this.agentRegistry = deps.agentRegistry;
    this.taskQueue = deps.taskQueue;
    this.sessionManager = deps.sessionManager;
    this.credentialRotator = deps.credentialRotator;
    this.pheromoneStore = deps.pheromoneStore;
    this.auditLogger = deps.auditLogger;
    this.config = deps.config || {};

    // Configuration
    this.maxGracePeriodMs = this.config.maxGracePeriodMs || 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Execute shutdown for an agent
   * @param {string} agentId - Agent to shutdown
   * @param {Object} killSignal - The kill signal being executed
   * @returns {Promise<{success: boolean, procedure: string}>}
   */
  async executeShutdown(agentId, killSignal) {
    const procedure = killSignal.shutdownProcedure || ShutdownProcedure.GRACEFUL;

    console.log(`[SHUTDOWN] Executing ${procedure} shutdown for agent ${agentId}`);

    try {
      // Update state to SHUTTING_DOWN
      await this._updateAgentState(agentId, 'SHUTTING_DOWN');

      if (procedure === ShutdownProcedure.GRACEFUL) {
        await this._executeGracefulShutdown(agentId, killSignal);
      } else {
        await this._executeForcedShutdown(agentId, killSignal);
      }

      return { success: true, procedure };
    } catch (error) {
      console.error(`[SHUTDOWN] Error executing shutdown for ${agentId}:`, error.message);
      this.emit('shutdownError', { agentId, error: error.message });
      throw error;
    }
  }

  /**
   * Execute GRACEFUL shutdown
   * Completes current work (up to maxGracePeriodMs) then stops
   */
  async _executeGracefulShutdown(agentId, killSignal) {
    console.log(`[SHUTDOWN] Graceful shutdown for ${agentId}`);

    // Stop accepting new work
    await this._updateAgentState(agentId, 'SHUTTING_DOWN');

    // Set deadline
    const deadline = Date.now() + this.maxGracePeriodMs;

    // Wait for current tasks to complete
    const tasks = await this._getActiveTasks(agentId);
    console.log(`[SHUTDOWN] ${tasks.length} active tasks for ${agentId}`);

    await Promise.all(
      tasks.map(async task => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          console.log(`[SHUTDOWN] Deadline passed, cancelling task ${task.taskId}`);
          await this._cancelTask(task.taskId);
          return;
        }

        try {
          await task.complete({ timeout: remaining });
        } catch (error) {
          console.log(`[SHUTDOWN] Task ${task.taskId} failed to complete: ${error.message}`);
          await this._cancelTask(task.taskId);
        }
      })
    );

    // Perform cleanup
    await this._performCleanup(agentId, 'GRACEFUL');

    // Update state to KILLED
    await this._updateAgentState(agentId, 'KILLED');
  }

  /**
   * Execute FORCED shutdown
   * Stops immediately without completing work
   */
  async _executeForcedShutdown(agentId, killSignal) {
    console.log(`[SHUTDOWN] Forced shutdown for ${agentId}`);

    // Cancel all active tasks immediately
    const tasks = await this._getActiveTasks(agentId);
    console.log(`[SHUTDOWN] Cancelling ${tasks.length} active tasks for ${agentId}`);

    for (const task of tasks) {
      await this._cancelTask(task.taskId, { reason: 'EMERGENCY_SHUTDOWN' });
    }

    // Force stop execution
    await this._forceTerminate(agentId);

    // Perform cleanup
    await this._performCleanup(agentId, 'FORCED');

    // Update state to KILLED
    await this._updateAgentState(agentId, 'KILLED');
  }

  /**
   * Perform cleanup procedures
   * Revokes credentials, invalidates sessions, resets pheromones, etc.
   */
  async _performCleanup(agentId, type) {
    console.log(`[SHUTDOWN] Performing cleanup for ${agentId} (${type})`);

    // 1. Revoke credentials (ADR (internal))
    if (this.credentialRotator) {
      try {
        await this.credentialRotator.revokeAll(agentId);
        console.log(`[SHUTDOWN] Credentials revoked for ${agentId}`);
      } catch (error) {
        console.error(`[SHUTDOWN] Failed to revoke credentials for ${agentId}:`, error.message);
      }
    }

    // 2. Invalidate sessions (ADR (internal))
    if (this.sessionManager) {
      try {
        await this.sessionManager.invalidateAll(agentId);
        console.log(`[SHUTDOWN] Sessions invalidated for ${agentId}`);
      } catch (error) {
        console.error(`[SHUTDOWN] Failed to invalidate sessions for ${agentId}:`, error.message);
      }
    }

    // 3. Erode pheromone trails (ADR (internal)) - complete reset
    if (this.pheromoneStore) {
      try {
        await this.pheromoneStore.applyKillPenalty(agentId, {
          factor: 0, // Complete reset
          reason: 'EMERGENCY_SHUTDOWN',
        });
        console.log(`[SHUTDOWN] Pheromone trails reset for ${agentId}`);
      } catch (error) {
        console.error(`[SHUTDOWN] Failed to reset pheromones for ${agentId}:`, error.message);
      }
    }

    // 4. Log audit event
    if (this.auditLogger) {
      try {
        await this.auditLogger.log({
          event: 'AGENT_SHUTDOWN',
          agentId,
          timestamp: Date.now(),
          type,
        });
      } catch (error) {
        console.error(`[SHUTDOWN] Failed to log audit event for ${agentId}:`, error.message);
      }
    }
  }

  /**
   * Update agent state in registry
   */
  async _updateAgentState(agentId, state) {
    if (!this.agentRegistry) return;

    try {
      await this.agentRegistry.updateState(agentId, state);
    } catch (error) {
      console.error(`[SHUTDOWN] Failed to update state for ${agentId}:`, error.message);
    }
  }

  /**
   * Get active tasks for an agent
   */
  async _getActiveTasks(agentId) {
    if (!this.taskQueue) return [];

    try {
      return this.taskQueue.getActiveTasks
        ? await this.taskQueue.getActiveTasks(agentId)
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Cancel a task
   */
  async _cancelTask(taskId, options = {}) {
    if (!this.taskQueue) return;

    try {
      await this.taskQueue.cancel(taskId, options);
    } catch (error) {
      console.error(`[SHUTDOWN] Failed to cancel task ${taskId}:`, error.message);
    }
  }

  /**
   * Force terminate agent execution
   */
  async _forceTerminate(agentId) {
    // This would integrate with the execution context
    // For now, emit event for external handler
    this.emit('forceTerminate', { agentId });
  }
}

module.exports = ShutdownController;
