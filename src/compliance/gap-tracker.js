// src/compliance/gap-tracker.js
// Gap Tracker — Manages remediation lifecycle for compliance gaps
// ADR (internal): Compliance Mapping & Reporting

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Gap Status
 */
const GapStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  REMEDIATED: 'REMEDIATED',
  ACCEPTED: 'ACCEPTED',  // Risk accepted
  FALSE_POSITIVE: 'FALSE_POSITIVE'
};

/**
 * Gap Tracker — Manages compliance gap lifecycle
 */
class GapTracker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.gaps = new Map(); // gapId -> gap
    this.history = []; // Audit trail
  }

  /**
   * Create a new gap
   * @param {Object} gapData - Gap data
   * @returns {string} gapId
   */
  createGap(gapData) {
    const id = gapData.id || `gap-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

    const gap = {
      id,
      controlId: gapData.controlId,
      frameworkId: gapData.frameworkId,
      severity: gapData.severity || 'MEDIUM',
      title: gapData.title || `Gap in ${gapData.controlId}`,
      description: gapData.description || '',
      evidence: gapData.evidence || [],
      remediation: gapData.remediation || '',
      owner: gapData.owner || null,
      status: GapStatus.OPEN,
      priority: gapData.priority || this.severityToPriority(gapData.severity),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      remediatedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      acceptanceReason: null,
      notes: []
    };

    this.gaps.set(id, gap);
    this.addHistoryEntry('CREATED', gap);

    this.emit('gapCreated', gap);

    return id;
  }

  /**
   * Convert severity to priority number
   * @param {string} severity
   * @returns {number}
   */
  severityToPriority(severity) {
    const priorities = {
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 3,
      LOW: 4
    };
    return priorities[severity] ?? 5;
  }

  /**
   * Get gap by ID
   * @param {string} gapId
   * @returns {Object|null}
   */
  getGap(gapId) {
    return this.gaps.get(gapId) || null;
  }

  /**
   * Get all gaps
   * @param {Object} filters - Optional filters
   * @returns {Array}
   */
  getAllGaps(filters = {}) {
    let gaps = Array.from(this.gaps.values());

    if (filters.frameworkId) {
      gaps = gaps.filter(g => g.frameworkId === filters.frameworkId);
    }

    if (filters.status) {
      gaps = gaps.filter(g => g.status === filters.status);
    }

    if (filters.severity) {
      gaps = gaps.filter(g => g.severity === filters.severity);
    }

    if (filters.owner) {
      gaps = gaps.filter(g => g.owner === filters.owner);
    }

    // Sort by priority, then by creation date
    return gaps.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Update gap status
   * @param {string} gapId
   * @param {Object} update
   * @returns {boolean}
   */
  updateStatus(gapId, update) {
    const gap = this.gaps.get(gapId);
    if (!gap) return false;

    const oldStatus = gap.status;

    if (update.status) {
      gap.status = update.status;
    }

    if (update.owner) {
      gap.owner = update.owner;
    }

    if (update.notes) {
      gap.notes.push({
        text: update.notes,
        addedBy: update.updatedBy || 'system',
        addedAt: Date.now()
      });
    }

    gap.updatedAt = Date.now();

    // Handle status-specific updates
    if (update.status === GapStatus.REMEDIATED) {
      gap.remediatedAt = Date.now();
    }

    if (update.status === GapStatus.ACCEPTED) {
      gap.acceptedAt = Date.now();
      gap.acceptedBy = update.acceptedBy || 'system';
      gap.acceptanceReason = update.acceptanceReason || '';
    }

    if (update.remediation) {
      gap.remediation = update.remediation;
    }

    this.addHistoryEntry('STATUS_CHANGED', gap, { oldStatus, newStatus: update.status });

    this.emit('gapUpdated', gap);

    return true;
  }

  /**
   * Add note to gap
   * @param {string} gapId
   * @param {string} note
   * @param {string} addedBy
   * @returns {boolean}
   */
  addNote(gapId, note, addedBy = 'system') {
    const gap = this.gaps.get(gapId);
    if (!gap) return false;

    gap.notes.push({
      text: note,
      addedBy,
      addedAt: Date.now()
    });

    gap.updatedAt = Date.now();

    this.addHistoryEntry('NOTE_ADDED', gap, { note });

    this.emit('noteAdded', gap);

    return true;
  }

  /**
   * Assign gap to owner
   * @param {string} gapId
   * @param {string} owner
   * @returns {boolean}
   */
  assignTo(gapId, owner) {
    return this.updateStatus(gapId, { owner });
  }

  /**
   * Start remediation
   * @param {string} gapId
   * @param {string} owner
   * @returns {boolean}
   */
  startRemediation(gapId, owner) {
    return this.updateStatus(gapId, {
      status: GapStatus.IN_PROGRESS,
      owner
    });
  }

  /**
   * Mark as remediated
   * @param {string} gapId
   * @param {string} remediatedBy
   * @returns {boolean}
   */
  markRemediated(gapId, remediatedBy = 'system') {
    return this.updateStatus(gapId, {
      status: GapStatus.REMEDIATED
    });
  }

  /**
   * Accept risk
   * @param {string} gapId
   * @param {string} acceptedBy
   * @param {string} reason
   * @returns {boolean}
   */
  acceptRisk(gapId, acceptedBy, reason) {
    return this.updateStatus(gapId, {
      status: GapStatus.ACCEPTED,
      acceptedBy,
      acceptanceReason: reason
    });
  }

  /**
   * Mark as false positive
   * @param {string} gapId
   * @param {string} markedBy
   * @param {string} reason
   * @returns {boolean}
   */
  markFalsePositive(gapId, markedBy, reason) {
    return this.updateStatus(gapId, {
      status: GapStatus.FALSE_POSITIVE,
      notes: `False positive: ${reason}`
    });
  }

  /**
   * Delete gap
   * @param {string} gapId
   * @returns {boolean}
   */
  deleteGap(gapId) {
    const gap = this.gaps.get(gapId);
    if (!gap) return false;

    this.gaps.delete(gapId);
    this.addHistoryEntry('DELETED', gap);

    this.emit('gapDeleted', gap);

    return true;
  }

  /**
   * Add history entry
   * @param {string} action
   * @param {Object} gap
   * @param {Object} details
   */
  addHistoryEntry(action, gap, details = {}) {
    this.history.push({
      action,
      gapId: gap.id,
      controlId: gap.controlId,
      frameworkId: gap.frameworkId,
      details,
      timestamp: Date.now()
    });
  }

  /**
   * Get history for a gap
   * @param {string} gapId
   * @returns {Array}
   */
  getGapHistory(gapId) {
    return this.history.filter(h => h.gapId === gapId);
  }

  /**
   * Get full audit history
   * @returns {Array}
   */
  getFullHistory() {
    return [...this.history];
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const gaps = Array.from(this.gaps.values());

    return {
      total: gaps.length,
      byStatus: {
        OPEN: gaps.filter(g => g.status === GapStatus.OPEN).length,
        IN_PROGRESS: gaps.filter(g => g.status === GapStatus.IN_PROGRESS).length,
        REMEDIATED: gaps.filter(g => g.status === GapStatus.REMEDIATED).length,
        ACCEPTED: gaps.filter(g => g.status === GapStatus.ACCEPTED).length,
        FALSE_POSITIVE: gaps.filter(g => g.status === GapStatus.FALSE_POSITIVE).length
      },
      bySeverity: {
        CRITICAL: gaps.filter(g => g.severity === 'CRITICAL').length,
        HIGH: gaps.filter(g => g.severity === 'HIGH').length,
        MEDIUM: gaps.filter(g => g.severity === 'MEDIUM').length,
        LOW: gaps.filter(g => g.severity === 'LOW').length
      },
      byFramework: gaps.reduce((acc, g) => {
        acc[g.frameworkId] = (acc[g.frameworkId] || 0) + 1;
        return acc;
      }, {}),
      unassigned: gaps.filter(g => !g.owner && g.status === GapStatus.OPEN).length,
      overdueRemediation: gaps.filter(g => {
        if (g.status !== GapStatus.OPEN && g.status !== GapStatus.IN_PROGRESS) return false;
        if (g.severity === 'CRITICAL') {
          // Revieweral should be remediated within 7 days
          const age = Date.now() - g.createdAt;
          return age > 7 * 24 * 60 * 60 * 1000;
        }
        return false;
      }).length
    };
  }

  /**
   * Get gaps due for review
   * @param {number} days - Days since update
   * @returns {Array}
   */
  getGapsDueForReview(days = 30) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    return Array.from(this.gaps.values()).filter(g =>
      g.status === GapStatus.OPEN || g.status === GapStatus.IN_PROGRESS
    ).filter(g => g.updatedAt < cutoff);
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create GapTracker singleton
 * @returns {GapTracker}
 */
function getGapTracker() {
  if (!instance) {
    instance = new GapTracker();
  }
  return instance;
}

module.exports = {
  GapTracker,
  getGapTracker,
  GapStatus
};
