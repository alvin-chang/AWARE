// src/emergency/kill-signal-entry.js
// Phase 3.2: Kill Switch Propagation — KillSignalEntry for Raft log

const crypto = require('crypto');

/**
 * Kill signal severity levels
 */
const KillSeverity = {
  LOCAL: 'LOCAL',     // Single agent self-revokes
  DOMAIN: 'DOMAIN',   // All agents in trust domain
  GLOBAL: 'GLOBAL',   // All agents everywhere
};

/**
 * Shutdown procedure types
 */
const ShutdownProcedure = {
  GRACEFUL: 'GRACEFUL',  // Complete current work, then stop
  FORCED: 'FORCED',      // Stop immediately
};

/**
 * Kill signal states
 */
const KillSignalState = {
  PENDING: 'PENDING',       // Issued but not yet committed
  ACTIVE: 'ACTIVE',         // Committed and propagating
  COMPLETED: 'COMPLETED',   // All agents acknowledged
  CANCELLED: 'CANCELLED',   // Cancelled by authority
  EXPIRED: 'EXPIRED',       // Deadline passed without full ack
};

/**
 * Kill switch trigger conditions
 */
const KILL_SWITCH_TRIGGERS = {
  [KillSeverity.LOCAL]: [
    { condition: 'trust_score < 0.2', duration: '5min', type: 'auto' },
    { condition: 'anomaly_score > 0.95', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' },
  ],
  [KillSeverity.DOMAIN]: [
    { condition: 'domain_breach_detected', type: 'auto' },
    { condition: 'multiple_local_kills_in_domain', threshold: 3, window: '1h', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' },
  ],
  [KillSeverity.GLOBAL]: [
    { condition: 'leader_compromised', type: 'auto' },
    { condition: 'consensus_failure', type: 'auto' },
    { condition: 'manual_admin_request', type: 'manual' },
    { condition: 'regulatory_emergency', type: 'manual' },
  ],
};

/**
 * GLOBAL kill signal cancel authority matrix (F-2 fix)
 * GLOBAL kills require 3 C-level approvers
 */
const GLOBAL_KILL_CANCEL_AUTHORITY = {
  requiredApprovers: 3,
  eligibleRoles: ['CEO', 'CTO', 'CISO', 'BOARD_MEMBER'],
  minBoardQuorum: 0.6,  // 60% of board must be represented
  requireIndependentApproval: true,  // Approvers from different departments
  cancelCooldown: 5 * 60 * 1000,  // 5 min between cancel attempts
  requiresWrittenJustification: true,
};

/**
 * KillSignalEntry — represents a kill signal in the Raft log
 * Phase 3.2: Extends Phase 1.4 revocation with propagation protocol
 */
class KillSignalEntry {
  /**
   * @param {Object} killSignal - The kill signal data
   * @param {string} killSignal.killSignalId - Unique identifier
   * @param {string} killSignal.issuedBy - Admin identity
   * @param {string} killSignal.severity - LOCAL | DOMAIN | GLOBAL
   * @param {Object} killSignal.target - Target scope
   * @param {string} killSignal.target.scope - trustDomain or 'GLOBAL'
   * @param {string[]} killSignal.target.agentIds - null = all in scope
   * @param {Object} killSignal.reason - Reason for kill
   * @param {boolean} killSignal.requiresAcknowledgment - Whether agents must ack
   * @param {string} killSignal.shutdownProcedure - GRACEFUL | FORCED
   * @param {string} [killSignal.acknowledgmentDeadline] - ISO timestamp
   */
  constructor(killSignal) {
    this.type = 'KILL_SIGNAL';
    this.killSignalId = killSignal.killSignalId || crypto.randomUUID();
    this.issuedAt = killSignal.issuedAt || new Date().toISOString();
    this.issuedBy = killSignal.issuedBy;
    this.severity = killSignal.severity || KillSeverity.LOCAL;
    this.target = killSignal.target || { scope: null, agentIds: null };
    this.reason = killSignal.reason || { code: 'MANUAL', description: 'Manual kill signal' };
    this.requiresAcknowledgment = killSignal.requiresAcknowledgment !== false;
    this.acknowledgmentDeadline = killSignal.acknowledgmentDeadline ||
      new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min default
    this.shutdownProcedure = killSignal.shutdownProcedure || ShutdownProcedure.GRACEFUL;
    this.state = KillSignalState.PENDING;
    this.acknowledgments = new Map(); // agentId -> { acknowledgedAt, status }
    this.id = this._generateIdempotencyKey();
  }

  /**
   * Generate idempotency key from content hash
   */
  _generateIdempotencyKey() {
    const content = `${this.killSignalId}:${this.issuedBy}:${this.issuedAt}:${this.severity}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Serialize to log entry format
   */
  toLogEntry(term, index) {
    return {
      type: this.type,
      term,
      index,
      killSignalId: this.killSignalId,
      issuedAt: this.issuedAt,
      issuedBy: this.issuedBy,
      severity: this.severity,
      target: this.target,
      reason: this.reason,
      requiresAcknowledgment: this.requiresAcknowledgment,
      acknowledgmentDeadline: this.acknowledgmentDeadline,
      shutdownProcedure: this.shutdownProcedure,
      state: this.state,
      id: this.id,
    };
  }

  /**
   * Check equality for deduplication
   */
  equals(other) {
    return other.id === this.id;
  }

  /**
   * Get target agents based on scope
   * @param {Object} registry - Agent registry to query
   * @returns {string[]} Array of agent IDs
   */
  getTargetAgents(registry) {
    if (this.target.agentIds) {
      return this.target.agentIds;
    }

    if (this.target.scope === 'GLOBAL') {
      return registry.getAllAgentIds();
    }

    if (this.target.scope) {
      return registry.getAgentIdsByTrustDomain(this.target.scope);
    }

    return [];
  }

  /**
   * Check if deadline has passed
   */
  isDeadlinePassed() {
    return Date.now() > new Date(this.acknowledgmentDeadline).getTime();
  }

  /**
   * Get missing acknowledgments
   * @param {string[]} allTargetAgents - All agents that should acknowledge
   * @returns {string[]} Agent IDs that haven't acknowledged
   */
  getMissingAcknowledgments(allTargetAgents) {
    return allTargetAgents.filter(agentId => !this.acknowledgments.has(agentId));
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(allTargetAgents) {
    if (allTargetAgents.length === 0) return 100;
    return (this.acknowledgments.size / allTargetAgents.length) * 100;
  }

  toString() {
    return `KillSignalEntry(id=${this.killSignalId}, severity=${this.severity}, target=${this.target.scope}, state=${this.state})`;
  }
}

/**
 * CancelRequestEntry — represents a kill signal cancellation
 */
class CancelRequestEntry {
  /**
   * @param {Object} cancelRequest - The cancel request data
   */
  constructor(cancelRequest) {
    this.type = 'CANCEL_REQUEST';
    this.killSignalId = cancelRequest.killSignalId;
    this.requestedBy = cancelRequest.requestedBy;
    this.justification = cancelRequest.justification;
    this.approvers = cancelRequest.approvers || []; // { role, approvedAt }
    this.requestedAt = cancelRequest.requestedAt || new Date().toISOString();
    this.id = crypto.randomUUID();
  }

  /**
   * Check if cancel authority is satisfied (F-2)
   * @param {string} severity - Severity level of original kill signal
   * @returns {boolean} Whether cancellation is authorized
   */
  isAuthorized(severity) {
    if (severity !== KillSeverity.GLOBAL) {
      // Non-GLOBAL only needs single admin approval
      return this.approvers.length >= 1;
    }

    // GLOBAL requires 3 C-level approvers
    const eligibleApprovers = this.approvers.filter(
      a => GLOBAL_KILL_CANCEL_AUTHORITY.eligibleRoles.includes(a.role)
    );

    return eligibleApprovers.length >= GLOBAL_KILL_CANCEL_AUTHORITY.requiredApprovers;
  }

  toLogEntry(term, index) {
    return {
      type: this.type,
      term,
      index,
      killSignalId: this.killSignalId,
      requestedBy: this.requestedBy,
      justification: this.justification,
      approvers: this.approvers,
      requestedAt: this.requestedAt,
      id: this.id,
    };
  }
}

module.exports = {
  KillSeverity,
  ShutdownProcedure,
  KillSignalState,
  KILL_SWITCH_TRIGGERS,
  GLOBAL_KILL_CANCEL_AUTHORITY,
  KillSignalEntry,
  CancelRequestEntry,
};
