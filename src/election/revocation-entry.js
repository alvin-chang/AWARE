// src/election/revocation-entry.js
// Phase 1.4: Kill Switch — RevocationEntry type for Raft log
// C-01: Define RevocationEntry as a distinct Raft log entry type

const crypto = require('crypto');

/**
 * Entry types for Raft log
 */
const EntryType = {
  COMMAND: 0,
  REVOCATION: 1,
  REINSTATEMENT: 2,
};

/**
 * RevocationEntry — represents an agent revocation in the Raft log
 * C-01: New entry type for distributed revocation via consensus
 */
class RevocationEntry {
  /**
   * @param {string} agentId - Agent to revoke
   * @param {string} reason - 'security_breach' | 'policy_violation' | 'manual'
   * @param {string} issuedBy - Admin identity who issued the revocation
   * @param {string} issuedAt - ISO timestamp
   */
  constructor(agentId, reason, issuedBy, issuedAt = new Date().toISOString()) {
    this.type = EntryType.REVOCATION;
    this.agentId = agentId;
    this.reason = reason;
    this.issuedBy = issuedBy;
    this.issuedAt = issuedAt;
    this.id = this._generateIdempotencyKey();
  }

  /**
   * Generate idempotency key from content hash
   * Prevents duplicate revocations from being applied multiple times
   */
  _generateIdempotencyKey() {
    const content = `${this.agentId}:${this.issuedBy}:${this.issuedAt}:${this.reason}`;
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
      agentId: this.agentId,
      reason: this.reason,
      issuedBy: this.issuedBy,
      issuedAt: this.issuedAt,
      id: this.id,
    };
  }

  /**
   * Check equality for deduplication
   */
  equals(other) {
    return other.id === this.id;
  }

  toString() {
    return `RevocationEntry(agentId=${this.agentId}, reason=${this.reason}, issuedBy=${this.issuedBy}, id=${this.id})`;
  }
}

/**
 * ReinstatementEntry — represents an agent reinstatement (rollback of revocation)
 * M-03: For revocation rollback mechanism
 */
class ReinstatementEntry {
  /**
   * @param {string} agentId - Agent to reinstate
   * @param {string} reason - Reason for reinstatement
   * @param {string} issuedBy - Admin identity
   * @param {string} originalRevocationId - Id of the revocation being rolled back
   */
  constructor(agentId, reason, issuedBy, originalRevocationId) {
    this.type = EntryType.REINSTATEMENT;
    this.agentId = agentId;
    this.reason = reason;
    this.issuedBy = issuedBy;
    this.originalRevocationId = originalRevocationId;
    this.issuedAt = new Date().toISOString();
    this.id = crypto.randomUUID();
  }

  toLogEntry(term, index) {
    return {
      type: this.type,
      term,
      index,
      agentId: this.agentId,
      reason: this.reason,
      issuedBy: this.issuedBy,
      originalRevocationId: this.originalRevocationId,
      issuedAt: this.issuedAt,
      id: this.id,
    };
  }
}

module.exports = {
  EntryType,
  RevocationEntry,
  ReinstatementEntry,
};
