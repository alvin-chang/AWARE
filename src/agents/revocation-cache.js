// src/agents/revocation-cache.js
// Revocation Cache — Agent Identity & Authentication Framework
// Phase 3.1: Distributed revocation state management
// Provides fast revocation lookups with TTL-based distributed caching

const crypto = require('crypto');
const { Agent, AgentState } = require('../api/models/Agent');

// Revocation grace periods by severity (in milliseconds)
const GRACE_PERIODS = {
  CRITICAL: 0,      // Immediate
  HIGH: 60 * 60 * 1000,      // 1 hour
  MEDIUM: 6 * 60 * 60 * 1000, // 6 hours
  LOW: 24 * 60 * 60 * 1000   // 24 hours
};

/**
 * Revocation Cache
 * Manages distributed revocation state with:
 * - Fast in-memory lookup cache
 * - TTL-based cache invalidation
 * - Severity-based grace periods
 * - Blast radius application on revocation
 * - Event emission for revocation events
 */
class RevocationCache {
  constructor(config = {}) {
    this.config = {
      cacheTtlMs: config.cacheTtlMs || 60 * 1000, // 1 minute default
      enableDistributedSync: config.enableDistributedSync !== false,
      ...config
    };
    
    // In-memory revocation cache: agentId -> { status, severity, reason, revokedAt, expiresAt }
    this.revocationCache = new Map();
    
    // Blast radius cache: agentId -> penalty factor
    this.blastRadiusCache = new Map();
    
    // Event handlers
    this.eventHandlers = {
      onAgentRevoked: [],
      onAgentReinstated: [],
      onBlastRadiusApplied: []
    };
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanupExpiredEntries(), 30 * 1000);
  }

  /**
   * Check if an agent is revoked (fast lookup)
   * @param {string} agentId - The agent ID
   * @returns {boolean} True if revoked
   */
  isRevoked(agentId) {
    // Check cache first
    const cached = this.revocationCache.get(agentId);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.status === 'revoked';
      }
      // Expired - remove
      this.revocationCache.delete(agentId);
    }
    
    // Fall back to agent registry
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return true; // Unknown agents are considered revoked
    }
    
    return agent.state === AgentState.REVOKED;
  }

  /**
   * Revoke an agent
   * @param {string} agentId - The agent ID
   * @param {string} severity - CRITICAL, HIGH, MEDIUM, LOW
   * @param {string} reason - Revocation reason
   * @param {object} options - Additional options
   * @returns {object} Revocation result
   */
  async revoke(agentId, severity = 'HIGH', reason = 'manual', options = {}) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'AGENT_NOT_FOUND' };
    }
    
    if (agent.state === AgentState.REVOKED) {
      return { success: false, error: 'ALREADY_REVOKED' };
    }
    
    // Calculate expiry based on grace period
    const gracePeriodMs = GRACE_PERIODS[severity] || GRACE_PERIODS.HIGH;
    const now = Date.now();
    const expiresAt = now + gracePeriodMs;
    
    // Update agent state
    agent.transitionTo(AgentState.REVOKED);
    agent.metadata = agent.metadata || {};
    agent.metadata.revocationReason = reason;
    agent.metadata.revocationSeverity = severity;
    agent.metadata.revokedAt = new Date(now).toISOString();
    Agent.saveAgent(agent);
    
    // Cache the revocation
    this.revocationCache.set(agentId, {
      status: 'revoked',
      severity,
      reason,
      revokedAt: now,
      expiresAt: expiresAt + this.config.cacheTtlMs,
      revokedBy: options.issuedBy || 'system'
    });
    
    // Apply blast radius
    const blastRadiusPenalty = await this._applyBlastRadius(agentId, severity);
    
    // Emit event
    this._emit('onAgentRevoked', {
      agentId,
      severity,
      reason,
      blastRadiusPenalty,
      issuedBy: options.issuedBy
    });
    
    // Sync to distributed cache if enabled
    if (this.config.enableDistributedSync) {
      await this._syncRevocation(agentId, 'revoked', severity);
    }
    
    return {
      success: true,
      agentId,
      severity,
      reason,
      blastRadiusPenalty,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Reinstate a revoked agent
   * @param {string} agentId - The agent ID
   * @param {object} options - Additional options
   * @returns {object} Reinstatement result
   */
  async reinstate(agentId, options = {}) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'AGENT_NOT_FOUND' };
    }
    
    if (agent.state !== AgentState.REVOKED) {
      return { success: false, error: 'AGENT_NOT_REVOKED' };
    }
    
    // Transition back to active
    agent.transitionTo(AgentState.ACTIVE);
    delete agent.metadata.revocationReason;
    delete agent.metadata.revocationSeverity;
    delete agent.metadata.revokedAt;
    Agent.saveAgent(agent);
    
    // Clear revocation cache
    this.revocationCache.delete(agentId);
    
    // Clear blast radius penalty
    this.blastRadiusCache.delete(agentId);
    
    // Emit event
    this._emit('onAgentReinstated', {
      agentId,
      issuedBy: options.issuedBy
    });
    
    // Sync to distributed cache if enabled
    if (this.config.enableDistributedSync) {
      await this._syncRevocation(agentId, 'reinstated');
    }
    
    return { success: true, agentId };
  }

  /**
   * Apply blast radius penalty to pheromone trails
   * @private
   */
  async _applyBlastRadius(agentId, severity) {
    const penaltyFactors = {
      CRITICAL: 0.0,  // Complete reset
      HIGH: 0.1,     // Near-complete erosion
      MEDIUM: 0.3,   // Significant erosion
      LOW: 0.5       // Moderate erosion
    };
    
    const factor = penaltyFactors[severity] || 0.1;
    
    // Store penalty factor for this agent
    this.blastRadiusCache.set(agentId, factor);
    
    // Emit blast radius event
    this._emit('onBlastRadiusApplied', {
      agentId,
      severity,
      penaltyFactor: factor
    });
    
    return factor;
  }

  /**
   * Get blast radius penalty for an agent
   * @param {string} agentId - The agent ID
   * @returns {number} Penalty factor (0-1)
   */
  getBlastRadiusPenalty(agentId) {
    return this.blastRadiusCache.get(agentId) || 0;
  }

  /**
   * Sync revocation status to distributed cache (etcd)
   * @private
   */
  async _syncRevocation(agentId, status, severity = null) {
    // In production, this would sync to etcd or similar distributed store
    // For now, this is a placeholder for the distributed sync protocol
    const entry = {
      agentId,
      status,
      severity,
      syncedAt: Date.now()
    };
    
    // Log for audit
    console.log(`[REVOCATION-SYNC] ${JSON.stringify(entry)}`);
    
    return entry;
  }

  /**
   * Get revocation status for an agent
   * @param {string} agentId - The agent ID
   * @returns {object|null} Revocation status
   */
  getStatus(agentId) {
    // Check cache
    const cached = this.revocationCache.get(agentId);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached;
      }
      this.revocationCache.delete(agentId);
    }
    
    // Fall back to agent registry
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return null;
    }
    
    if (agent.state === AgentState.REVOKED) {
      return {
        status: 'revoked',
        reason: agent.metadata?.revocationReason || 'unknown',
        severity: agent.metadata?.revocationSeverity || 'HIGH',
        revokedAt: agent.metadata?.revokedAt || agent.updatedAt
      };
    }
    
    return { status: 'active' };
  }

  /**
   * Get all revoked agents
   * @returns {array} Array of revoked agent IDs
   */
  getRevokedAgents() {
    const revoked = [];
    
    // Check cache
    for (const [agentId, cached] of this.revocationCache.entries()) {
      if (cached.status === 'revoked' && cached.expiresAt > Date.now()) {
        revoked.push({ agentId, ...cached });
      }
    }
    
    return revoked;
  }

  /**
   * Cleanup expired cache entries
   * @private
   */
  _cleanupExpiredEntries() {
    const now = Date.now();
    
    for (const [agentId, cached] of this.revocationCache.entries()) {
      if (cached.expiresAt < now) {
        // Check if agent is still revoked in registry
        const agent = Agent.findByAgentId(agentId);
        if (!agent || agent.state !== AgentState.REVOKED) {
          this.revocationCache.delete(agentId);
        } else {
          // Extend expiry if still revoked
          cached.expiresAt = now + this.config.cacheTtlMs;
        }
      }
    }
  }

  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {function} handler - Event handler function
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  /**
   * Emit an event
   * @private
   */
  _emit(event, data) {
    if (this.eventHandlers[event]) {
      for (const handler of this.eventHandlers[event]) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Statistics
   */
  getStats() {
    let revoked = 0;
    const now = Date.now();
    
    for (const cached of this.revocationCache.values()) {
      if (cached.status === 'revoked' && cached.expiresAt > now) {
        revoked++;
      }
    }
    
    return {
      totalEntries: this.revocationCache.size,
      revokedAgents: revoked,
      blastRadiusEntries: this.blastRadiusCache.size,
      cacheTtlMs: this.config.cacheTtlMs
    };
  }

  /**
   * Clear the revocation cache
   */
  clearCache() {
    this.revocationCache.clear();
  }

  /**
   * Destroy the revocation cache
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.revocationCache.clear();
    this.blastRadiusCache.clear();
    this.eventHandlers = {
      onAgentRevoked: [],
      onAgentReinstated: [],
      onBlastRadiusApplied: []
    };
  }
}

// Export grace periods for use elsewhere
RevocationCache.GRACE_PERIODS = GRACE_PERIODS;

module.exports = RevocationCache;
