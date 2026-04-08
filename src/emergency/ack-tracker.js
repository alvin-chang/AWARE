// src/emergency/ack-tracker.js
// Phase 3.2: Kill Switch Propagation — Acknowledgment tracking with etcd write verification
// F-1 [MEDIUM]: Acknowledgment etcd write verification with retry

const EventEmitter = require('events');

/**
 * AcknowledgmentTracker — tracks agent acknowledgments for kill signals
 * Implements F-1: etcd write verification with retry logic
 */
class AcknowledgmentTracker extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.store - Key-value store (etcd or mock)
   * @param {Object} deps.config
   */
  constructor(deps) {
    super();
    this.store = deps.store;
    this.config = deps.config || {};

    // Track acknowledgments in memory (cached view)
    // Key: killSignalId, Value: Map of agentId -> ack data
    this.acknowledgments = new Map();

    // Retry configuration for F-1
    this.retryAttempts = this.config.retryAttempts || 3;
    this.retryDelayMs = this.config.retryDelayMs || 100;
  }

  /**
   * Record an acknowledgment from an agent
   * F-1: Verifies etcd write succeeded before considering ack complete
   *
   * @param {string} killSignalId - The kill signal being acknowledged
   * @param {string} agentId - Agent acknowledging
   * @param {string} status - 'KILLED' | 'REJECTED' | 'ERROR'
   * @param {Object} [metadata] - Additional ack metadata
   * @returns {Promise<{success: boolean, agentId: string, killSignalId: string}>}
   */
  async recordAcknowledgment(killSignalId, agentId, status = 'KILLED', metadata = {}) {
    const ackData = {
      agentId,
      acknowledgedAt: Date.now(),
      status,
      ...metadata,
    };

    // F-1: Write to etcd with verification and retry
    const writeResult = await this._writeAcknowledgmentWithRetry(killSignalId, agentId, ackData);

    if (!writeResult.success) {
      // Log critical failure - this agent may be falsely "missing"
      this.emit('ackWriteFailure', {
        agentId,
        killSignalId,
        error: writeResult.error,
        attempts: writeResult.attempts,
      });

      // Still throw - issuer must know about this
      throw new Error(
        `ACK_WRITE_FAILED: Agent ${agentId} failed to persist acknowledgment for ${killSignalId}`
      );
    }

    // Update in-memory cache
    if (!this.acknowledgments.has(killSignalId)) {
      this.acknowledgments.set(killSignalId, new Map());
    }
    this.acknowledgments.get(killSignalId).set(agentId, ackData);

    // Emit event
    this.emit('acknowledgmentReceived', {
      killSignalId,
      agentId,
      status,
      totalAcknowledgments: this.getAcknowledgmentCount(killSignalId),
    });

    return { success: true, agentId, killSignalId };
  }

  /**
   * F-1: Write acknowledgment to etcd with retry verification
   * Ensures write succeeds before returning success
   */
  async _writeAcknowledgmentWithRetry(killSignalId, agentId, ackData) {
    const key = this._getAckKey(killSignalId, agentId);

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Attempt to write to etcd
        const putResult = await this._put(key, ackData);

        // Verify write succeeded
        if (putResult && putResult.succeeded) {
          return { success: true, attempts: attempt };
        }

        // Write didn't succeed, retry
        console.log(
          `[ACK-TRACKER] Write attempt ${attempt}/${this.retryAttempts} failed for ${key}, retrying...`
        );

        if (attempt < this.retryAttempts) {
          await this._sleep(this.retryDelayMs * attempt); // Exponential backoff
        }
      } catch (error) {
        console.error(
          `[ACK-TRACKER] Write attempt ${attempt}/${this.retryAttempts} error for ${key}:`,
          error.message
        );

        if (attempt < this.retryAttempts) {
          await this._sleep(this.retryDelayMs * attempt);
        } else {
          return { success: false, error: error.message, attempts: attempt };
        }
      }
    }

    return { success: false, error: 'Max retries exceeded', attempts: this.retryAttempts };
  }

  /**
   * Get acknowledgment key for store
   */
  _getAckKey(killSignalId, agentId) {
    return `/aware/kill-signals/${killSignalId}/acks/${agentId}`;
  }

  /**
   * Put data to store (etcd or mock)
   */
  async _put(key, value) {
    if (!this.store) {
      // No store configured - use in-memory only (testing mode)
      return { succeeded: true };
    }

    try {
      const result = await this.store.put(key, value);
      return result;
    } catch (error) {
      console.error(`[ACK-TRACKER] Store put error for ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Get data from store
   */
  async _get(key) {
    if (!this.store) {
      return null;
    }

    try {
      return await this.store.get(key);
    } catch (error) {
      console.error(`[ACK-TRACKER] Store get error for ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Sleep utility
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Load acknowledgments from store for a kill signal
   * @param {string} killSignalId
   * @returns {Promise<Map>} Map of agentId -> ack data
   */
  async loadAcknowledgments(killSignalId) {
    if (!this.store) {
      return this.acknowledgments.get(killSignalId) || new Map();
    }

    try {
      const acks = await this.store.get(`/aware/kill-signals/${killSignalId}/acks`);
      const ackMap = new Map();

      if (acks) {
        for (const [agentId, ackData] of Object.entries(acks)) {
          ackMap.set(agentId, ackData);
        }
      }

      // Cache in memory
      this.acknowledgments.set(killSignalId, ackMap);
      return ackMap;
    } catch (error) {
      console.error(
        `[ACK-TRACKER] Failed to load acknowledgments for ${killSignalId}:`,
        error.message
      );
      return this.acknowledgments.get(killSignalId) || new Map();
    }
  }

  /**
   * Get acknowledgment count for a kill signal
   */
  getAcknowledgmentCount(killSignalId) {
    const acks = this.acknowledgments.get(killSignalId);
    return acks ? acks.size : 0;
  }

  /**
   * Get acknowledgment details for a kill signal
   */
  getAcknowledgments(killSignalId) {
    const acks = this.acknowledgments.get(killSignalId);
    if (!acks) return [];

    return Array.from(acks.entries()).map(([agentId, data]) => ({
      agentId,
      ...data,
    }));
  }

  /**
   * Check progress of a kill signal
   * @param {string} killSignalId
   * @param {number} totalExpected - Total agents expected to acknowledge
   * @returns {Object} Progress status
   */
  checkProgress(killSignalId, totalExpected) {
    const acks = this.acknowledgments.get(killSignalId);
    const acknowledged = acks ? acks.size : 0;
    const missing = totalExpected - acknowledged;

    return {
      totalExpected,
      acknowledged,
      missing,
      isComplete: missing === 0,
      isPartial: acknowledged > 0 && missing > 0,
      percentage: totalExpected > 0 ? (acknowledged / totalExpected) * 100 : 100,
    };
  }

  /**
   * Get agents that haven't acknowledged
   * @param {string} killSignalId
   * @param {string[]} expectedAgents - List of agents expected to acknowledge
   * @returns {string[]} Agents that haven't acknowledged
   */
  getMissingAgents(killSignalId, expectedAgents) {
    const acks = this.acknowledgments.get(killSignalId);
    const acknowledgedSet = acks ? new Set(acks.keys()) : new Set();

    return expectedAgents.filter(agentId => !acknowledgedSet.has(agentId));
  }

  /**
   * Clear acknowledgments for a kill signal (after completion/cancellation)
   */
  async clearAcknowledgments(killSignalId) {
    this.acknowledgments.delete(killSignalId);

    // Also clear from store if available
    if (this.store) {
      try {
        await this.store.delete(`/aware/kill-signals/${killSignalId}/acks`);
      } catch (error) {
        console.error(
          `[ACK-TRACKER] Failed to clear acknowledgments for ${killSignalId}:`,
          error.message
        );
      }
    }
  }
}

module.exports = AcknowledgmentTracker;
