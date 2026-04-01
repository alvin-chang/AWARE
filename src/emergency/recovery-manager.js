// src/emergency/recovery-manager.js
// Phase 3.2: Kill Switch Propagation — Handle re-onboarding after emergency

const EventEmitter = require('events');

/**
 * RecoveryManager — handles re-onboarding of killed agents
 * Post-emergency recovery procedure
 */
class RecoveryManager extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.agentRegistry - Agent registry
   * @param {Object} deps.credentialRotator - Credential rotator (ADR-013)
   * @param {Object} deps.sessionManager - Session manager (ADR-013)
   * @param {Object} deps.baselineStore - Behavioral baseline store (ADR-014)
   * @param {Object} deps.pheromoneStore - Pheromone store (ADR-011)
   * @param {Object} deps.permissionStore - Permission store (ADR-015)
   * @param {Object} deps.auditLogger - Audit logger
   * @param {Object} deps.config
   */
  constructor(deps) {
    super();
    this.agentRegistry = deps.agentRegistry;
    this.credentialRotator = deps.credentialRotator;
    this.sessionManager = deps.sessionManager;
    this.baselineStore = deps.baselineStore;
    this.pheromoneStore = deps.pheromoneStore;
    this.permissionStore = deps.permissionStore;
    this.auditLogger = deps.auditLogger;
    this.config = deps.config || {};

    // Recovery states
    this.recoveryStates = {
      PENDING: 'PENDING',     // Awaiting admin approval
      APPROVED: 'APPROVED',   // Admin approved, in progress
      REJECTED: 'REJECTED',   // Admin rejected
      COMPLETED: 'COMPLETED', // Successfully re-onboarded
    };

    // Track recovery requests
    this.recoveryRequests = new Map(); // agentId -> recoveryData
  }

  /**
   * Request re-onboarding for a killed agent
   * @param {string} agentId - Agent to re-onboard
   * @param {string} requestedBy - Who is requesting
   * @param {string} justification - Why re-onboarding is needed
   * @returns {Promise<{success: boolean, recoveryId: string}>}
   */
  async requestReOnboarding(agentId, requestedBy, justification) {
    // Check if agent is actually killed
    const status = await this.agentRegistry.getRevocationStatus(agentId);
    if (!status.revoked) {
      return {
        success: false,
        error: 'AGENT_NOT_REVOKED',
        message: `Agent ${agentId} is not currently revoked`,
      };
    }

    const recoveryId = `recovery-${Date.now()}-${agentId}`;

    const recoveryData = {
      recoveryId,
      agentId,
      requestedBy,
      justification,
      requestedAt: Date.now(),
      state: this.recoveryStates.PENDING,
      previousKillSignalId: status.revocationId,
    };

    this.recoveryRequests.set(agentId, recoveryData);

    this.emit('reOnboardingRequested', recoveryData);

    return {
      success: true,
      recoveryId,
      state: this.recoveryStates.PENDING,
    };
  }

  /**
   * Approve re-onboarding (admin action)
   * @param {string} agentId
   * @param {string} approvedBy
   * @param {Object} [options] - Additional approval options
   * @returns {Promise<{success: boolean}>}
   */
  async approveReOnboarding(agentId, approvedBy, options = {}) {
    const recoveryData = this.recoveryRequests.get(agentId);

    if (!recoveryData) {
      return {
        success: false,
        error: 'RECOVERY_NOT_FOUND',
        message: `No recovery request found for agent ${agentId}`,
      };
    }

    if (recoveryData.state !== this.recoveryStates.PENDING) {
      return {
        success: false,
        error: 'INVALID_STATE',
        message: `Recovery is in ${recoveryData.state} state`,
      };
    }

    // Update state
    recoveryData.state = this.recoveryStates.APPROVED;
    recoveryData.approvedBy = approvedBy;
    recoveryData.approvedAt = Date.now();

    this.emit('reOnboardingApproved', recoveryData);

    // Execute re-onboarding
    try {
      await this._executeReOnboarding(agentId);
      return { success: true };
    } catch (error) {
      console.error(`[RECOVERY] Re-onboarding failed for ${agentId}:`, error.message);
      return {
        success: false,
        error: 'REONBOARDING_FAILED',
        message: error.message,
      };
    }
  }

  /**
   * Reject re-onboarding (admin action)
   * @param {string} agentId
   * @param {string} rejectedBy
   * @param {string} reason
   */
  rejectReOnboarding(agentId, rejectedBy, reason) {
    const recoveryData = this.recoveryRequests.get(agentId);

    if (!recoveryData) {
      return {
        success: false,
        error: 'RECOVERY_NOT_FOUND',
      };
    }

    recoveryData.state = this.recoveryStates.REJECTED;
    recoveryData.rejectedBy = rejectedBy;
    recoveryData.rejectedAt = Date.now();
    recoveryData.rejectionReason = reason;

    this.emit('reOnboardingRejected', recoveryData);

    return { success: true };
  }

  /**
   * Execute the re-onboarding procedure
   */
  async _executeReOnboarding(agentId) {
    const recoveryData = this.recoveryRequests.get(agentId);

    console.log(`[RECOVERY] Executing re-onboarding for ${agentId}`);

    // 1. Generate new credentials
    if (this.credentialRotator) {
      await this.credentialRotator.rotateAll(agentId);
      console.log(`[RECOVERY] Credentials rotated for ${agentId}`);
    }

    // 2. Create new session
    if (this.sessionManager) {
      await this.sessionManager.createSession(agentId, { forceNew: true });
      console.log(`[RECOVERY] New session created for ${agentId}`);
    }

    // 3. Reset behavioural baseline
    if (this.baselineStore) {
      await this.baselineStore.resetBaseline(agentId);
      console.log(`[RECOVERY] Behavioural baseline reset for ${agentId}`);
    }

    // 4. Reset pheromone trails (start from 0)
    if (this.pheromoneStore) {
      await this.pheromoneStore.resetAgentTrails(agentId);
      console.log(`[RECOVERY] Pheromone trails reset for ${agentId}`);
    }

    // 5. Reset permissions
    if (this.permissionStore) {
      await this.permissionStore.resetPermissions(agentId);
      console.log(`[RECOVERY] Permissions reset for ${agentId}`);
    }

    // 6. Update agent state to ACTIVE
    await this.agentRegistry.updateState(agentId, 'ACTIVE');

    // 7. Log audit event
    if (this.auditLogger) {
      await this.auditLogger.log({
        event: 'AGENT_REONBOARDED',
        agentId,
        approvedBy: recoveryData.approvedBy,
        previousKillSignalId: recoveryData.previousKillSignalId,
        recoveryId: recoveryData.recoveryId,
        timestamp: Date.now(),
      });
    }

    // Update state
    recoveryData.state = this.recoveryStates.COMPLETED;
    recoveryData.completedAt = Date.now();

    this.emit('reOnboardingCompleted', recoveryData);

    console.log(`[RECOVERY] Re-onboarding completed for ${agentId}`);
  }

  /**
   * Get recovery status for an agent
   */
  getRecoveryStatus(agentId) {
    return this.recoveryRequests.get(agentId) || null;
  }

  /**
   * Get all pending recovery requests
   */
  getPendingRecoveryRequests() {
    return Array.from(this.recoveryRequests.values()).filter(
      r => r.state === this.recoveryStates.PENDING
    );
  }

  /**
   * Get all recovery requests
   */
  getAllRecoveryRequests() {
    return Array.from(this.recoveryRequests.values());
  }
}

module.exports = RecoveryManager;
