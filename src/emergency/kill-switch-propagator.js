// src/emergency/kill-switch-propagator.js
// Phase 3.2: Kill Switch Propagation — Raft broadcast and fan-out

const EventEmitter = require('events');
const { KillSignalEntry, KillSignalState } = require('./kill-signal-entry');

/**
 * KillSwitchPropagator — broadcasts kill signals via Raft consensus
 * Extends Phase 1.4 revocation with propagation protocol
 */
class KillSwitchPropagator extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.stateMachine - Raft state machine
   * @param {Object} deps.electionManager - Raft election manager
   * @param {Object} deps.agentRegistry - Agent registry
   * @param {Object} deps.acknowledgmentTracker - Ack tracker
   * @param {Object} deps.shutdownController - Shutdown controller
   * @param {Object} deps.config
   */
  constructor(deps) {
    super();
    this.stateMachine = deps.stateMachine;
    this.electionManager = deps.electionManager;
    this.agentRegistry = deps.agentRegistry;
    this.acknowledgmentTracker = deps.acknowledgmentTracker;
    this.shutdownController = deps.shutdownController;
    this.config = deps.config || {};

    // Track pending kill signals awaiting consensus
    this.pendingKillSignals = new Map(); // killSignalId -> { entry, resolve, reject }

    // Active kill signals being propagated
    this.activeKillSignals = new Map(); // killSignalId -> entry
  }

  /**
   * Propagate a kill signal via Raft consensus
   * C-02: Must achieve majority quorum before execution
   *
   * @param {KillSignalEntry} entry - Kill signal entry
   * @returns {Promise<{success: boolean, entry: KillSignalEntry, committed: boolean}>}
   */
  async propagate(entry) {
    // C-02: Only leader can propagate kill signals
    if (!this.electionManager.isLeader()) {
      const leaderId = this.electionManager.getLeader();
      return {
        success: false,
        error: 'NOT_LEADER',
        redirect: leaderId,
        message: `Kill signal must be propagated by leader. Current leader: ${leaderId || 'unknown'}`,
        entry,
      };
    }

    // Check if already committed
    if (this.activeKillSignals.has(entry.killSignalId)) {
      return {
        success: true,
        entry,
        idempotent: true,
        message: 'Kill signal already active',
      };
    }

    // Create promise that resolves when consensus is reached
    const propagationPromise = new Promise((resolve, reject) => {
      this.pendingKillSignals.set(entry.killSignalId, { entry, resolve, reject });
    });

    try {
      // Add to Raft log
      const logEntry = this.stateMachine.addKillSignalEntry(entry);

      // Propose to followers via heartbeat
      this.electionManager.proposeKillSignal(logEntry);

      // Wait for commit acknowledgment from majority
      const result = await this._waitForCommit(logEntry);

      if (result.committed) {
        // Mark as active
        entry.state = KillSignalState.ACTIVE;
        this.activeKillSignals.set(entry.killSignalId, entry);
        this.pendingKillSignals.delete(entry.killSignalId);

        // Emit event for acknowledgment tracking
        this.emit('killSignalActivated', {
          killSignalId: entry.killSignalId,
          severity: entry.severity,
          target: entry.target,
        });

        return { success: true, entry, committed: true };
      } else {
        this.pendingKillSignals.delete(entry.killSignalId);
        return { success: false, error: 'CONSENSUS_NOT_REACHED', entry };
      }
    } catch (error) {
      this.pendingKillSignals.delete(entry.killSignalId);
      return { success: false, error: error.message, entry };
    }
  }

  /**
   * Wait for kill signal to be committed by majority
   */
  async _waitForCommit(logEntry) {
    return new Promise(resolve => {
      const checkInterval = 10; // ms

      const check = () => {
        const commitIndex = this.stateMachine.commitIndex;

        if (commitIndex >= logEntry.index) {
          resolve({ committed: true, commitIndex });
        } else if (!this.electionManager.isLeader()) {
          // Lost leadership during consensus
          resolve({ committed: false, reason: 'LOST_LEADERSHIP' });
        } else {
          setTimeout(check, checkInterval);
        }
      };

      // Start checking
      setTimeout(check, checkInterval);
    });
  }

  /**
   * Handle kill signal entry received via heartbeat (follower side)
   * @param {Object} logEntry - The committed log entry
   */
  handleKillSignalEntry(logEntry) {
    const entry = new KillSignalEntry(logEntry);
    entry.state = KillSignalState.ACTIVE;

    // Store as active
    this.activeKillSignals.set(entry.killSignalId, entry);

    // Emit event for local execution
    this.emit('killSignalReceived', {
      killSignalId: entry.killSignalId,
      severity: entry.severity,
      target: entry.target,
      shutdownProcedure: entry.shutdownProcedure,
    });

    return entry;
  }

  /**
   * Execute kill signal locally (on each agent)
   * @param {string} killSignalId - Kill signal to execute
   * @param {string} agentId - This agent's ID
   * @returns {Promise<{success: boolean}>}
   */
  async executeLocally(killSignalId, agentId) {
    const entry = this.activeKillSignals.get(killSignalId);

    if (!entry) {
      return { success: false, error: 'Kill signal not found' };
    }

    // Check if this agent is a target
    const targetAgents = entry.getTargetAgents(this.agentRegistry);
    if (targetAgents.length > 0 && !targetAgents.includes(agentId)) {
      return { success: false, error: 'Agent not in target scope' };
    }

    // Execute shutdown
    if (this.shutdownController) {
      await this.shutdownController.executeShutdown(agentId, entry);
    }

    // Record acknowledgment
    if (this.acknowledgmentTracker) {
      await this.acknowledgmentTracker.recordAcknowledgment(killSignalId, agentId, 'KILLED');
    }

    return { success: true };
  }

  /**
   * Get active kill signals
   */
  getActiveKillSignals() {
    return Array.from(this.activeKillSignals.values());
  }

  /**
   * Get a specific kill signal
   */
  getKillSignal(killSignalId) {
    return this.activeKillSignals.get(killSignalId);
  }

  /**
   * Check if a kill signal is active
   */
  isActive(killSignalId) {
    return this.activeKillSignals.has(killSignalId);
  }

  /**
   * Cancel a kill signal
   * F-2: Must satisfy authority matrix
   */
  async cancel(killSignalId, cancelEntry) {
    const entry = this.activeKillSignals.get(killSignalId);

    if (!entry) {
      return { success: false, error: 'Kill signal not found' };
    }

    // Check authority (F-2)
    if (!cancelEntry.isAuthorized(entry.severity)) {
      return {
        success: false,
        error: 'INSUFFICIENT_AUTHORITY',
        message: `${entry.severity} kill signal requires proper authority for cancellation`,
      };
    }

    // Add cancel entry to Raft log
    const logEntry = this.stateMachine.addCancelRequestEntry(cancelEntry);
    this.electionManager.proposeKillSignal(logEntry);

    // Wait for commit
    const result = await this._waitForCommit(logEntry);

    if (result.committed) {
      entry.state = KillSignalState.CANCELLED;
      this.emit('killSignalCancelled', { killSignalId });
      return { success: true };
    }

    return { success: false, error: 'CONSENSUS_NOT_REACHED' };
  }

  /**
   * Mark kill signal as completed (all agents acknowledged)
   */
  complete(killSignalId) {
    const entry = this.activeKillSignals.get(killSignalId);

    if (entry) {
      entry.state = KillSignalState.COMPLETED;
      this.emit('killSignalCompleted', { killSignalId });
    }
  }

  /**
   * Mark kill signal as expired (deadline passed)
   */
  expire(killSignalId) {
    const entry = this.activeKillSignals.get(killSignalId);

    if (entry) {
      entry.state = KillSignalState.EXPIRED;
      this.emit('killSignalExpired', { killSignalId });
    }
  }
}

module.exports = KillSwitchPropagator;
