// src/policies/shadow-detector.js
// Shadow Tool Detector — Gateway-level observation for unauthorized tool usage
// ADR (internal): Tool Access Control & Enforcement

const EventEmitter = require('events');

/**
 * Shadow Tool Detection States
 */
const ShadowState = {
  CLEAN: 'CLEAN',
  SHADOW_CANDIDATE: 'SHADOW_CANDIDATE',
  ANOMALOUS: 'ANOMALOUS',
  CONFIRMED_SHADOW: 'CONFIRMED_SHADOW'
};

/**
 * ShadowDetector — Detects "shadow tools" (unauthorized usage patterns)
 *
 * A shadow tool is:
 * 1. A tool called but NOT in the tool registry
 * 2. A legitimate tool used in an unexpected way
 * 3. An attempt to bypass tool controls
 */
class ShadowDetector extends EventEmitter {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.shadowThreshold - Number of unregistered calls before confirmed shadow
   * @param {number} config.anomalyWindowMs - Time window for anomalous pattern detection
   * @param {number} config.maxCallsPerWindow - Max calls per agent before anomalous
   */
  constructor(config = {}) {
    super();
    this.shadowThreshold = config.shadowThreshold || 3;
    this.anomalyWindowMs = config.anomalyWindowMs || 5 * 60 * 1000; // 5 minutes
    this.maxCallsPerWindow = config.maxCallsPerWindow || 100;

    // Track unregistered calls per agent (shadow candidates)
    this.unregisteredCalls = new Map(); // agentId -> { count, firstSeen, tools: Set }

    // Track all calls per agent for anomaly detection
    this.callHistory = new Map(); // agentId -> { calls: [], windowStart }

    // Shadow alerts
    this.alerts = new Map(); // alertId -> alert
  }

  /**
   * Record a call to an unregistered/unknown tool
   * @param {Object} observation - Tool observation
   */
  async recordUnregisteredCall(observation) {
    const { agentId, toolId, timestamp = Date.now() } = observation;

    if (!this.unregisteredCalls.has(agentId)) {
      this.unregisteredCalls.set(agentId, {
        count: 0,
        firstSeen: timestamp,
        tools: new Set(),
        confirmedShadow: false
      });
    }

    const agentData = this.unregisteredCalls.get(agentId);
    agentData.count++;
    agentData.tools.add(toolId);

    // Check if threshold exceeded
    if (agentData.count >= this.shadowThreshold) {
      const alert = {
        id: `shadow-${agentId}-${Date.now()}`,
        type: 'CONFIRMED_SHADOW',
        agentId,
        tools: Array.from(agentData.tools),
        callCount: agentData.count,
        firstSeen: agentData.firstSeen,
        timestamp,
        state: ShadowState.CONFIRMED_SHADOW
      };

      this.alerts.set(alert.id, alert);
      this.emit('shadowAlert', alert);

      // Mark as confirmed shadow - don't reset until explicitly cleared
      agentData.confirmedShadow = true;
    }

    return {
      recorded: true,
      agentCallCount: agentData.count,
      threshold: this.shadowThreshold,
      state: agentData.confirmedShadow ? ShadowState.CONFIRMED_SHADOW : null
    };
  }

  /**
   * Check if tool usage is anomalous
   * @param {string} agentId - Agent ID
   * @param {string} toolId - Tool ID
   * @param {Object} observation - Tool observation
   * @returns {Object} { isShadow: boolean, isAnomalous: boolean, reason: string }
   */
  async checkAnomalousUsage(agentId, toolId, observation = {}) {
    // Initialize call history for agent
    if (!this.callHistory.has(agentId)) {
      this.callHistory.set(agentId, {
        calls: [],
        windowStart: Date.now()
      });
    }

    const agentHistory = this.callHistory.get(agentId);
    const now = Date.now();

    // Reset window if expired
    if (now - agentHistory.windowStart > this.anomalyWindowMs) {
      agentHistory.calls = [];
      agentHistory.windowStart = now;
    }

    // Check call frequency
    agentHistory.calls.push({ toolId, timestamp: now });

    // Filter to window
    agentHistory.calls = agentHistory.calls.filter(
      c => now - c.timestamp <= this.anomalyWindowMs
    );

    const callCount = agentHistory.calls.length;

    // Check if exceeding max calls
    if (callCount > this.maxCallsPerWindow) {
      return {
        isShadow: false,
        isAnomalous: true,
        reason: 'EXCESSIVE_CALL_FREQUENCY',
        callCount,
        maxAllowed: this.maxCallsPerWindow
      };
    }

    // Check for unusual tool diversity (many different tools in short time)
    const uniqueTools = new Set(agentHistory.calls.map(c => c.toolId));
    if (uniqueTools.size > 20 && callCount / uniqueTools.size < 2) {
      return {
        isShadow: false,
        isAnomalous: true,
        reason: 'HIGH_TOOL_DIVERSITY',
        uniqueTools: uniqueTools.size,
        totalCalls: callCount
      };
    }

    return {
      isShadow: false,
      isAnomalous: false,
      reason: null,
      callCount,
      maxAllowed: this.maxCallsPerWindow
    };
  }

  /**
   * Record an anomalous call
   * @param {Object} observation - Tool observation
   * @param {Object} shadowCheck - Result from checkAnomalousUsage
   */
  async recordAnomalousCall(observation, shadowCheck) {
    const alert = {
      id: `anomaly-${observation.agentId}-${Date.now()}`,
      type: 'ANOMALOUS_USAGE',
      agentId: observation.agentId,
      toolId: observation.toolId,
      sessionId: observation.sessionId,
      timestamp: observation.timestamp || Date.now(),
      state: ShadowState.ANOMALOUS,
      reason: shadowCheck.reason,
      details: shadowCheck
    };

    this.alerts.set(alert.id, alert);
    this.emit('anomalyAlert', alert);

    return alert;
  }

  /**
   * Get all active alerts
   * @param {string} agentId - Optional filter by agent
   * @returns {Array}
   */
  getAlerts(agentId = null) {
    const alerts = Array.from(this.alerts.values());

    if (agentId) {
      return alerts.filter(a => a.agentId === agentId);
    }

    return alerts;
  }

  /**
   * Clear resolved alerts
   * @param {string} alertId - Alert ID to clear
   */
  clearAlert(alertId) {
    this.alerts.delete(alertId);
  }

  /**
   * Get shadow state for an agent
   * @param {string} agentId - Agent ID
   * @returns {string} ShadowState
   */
  getAgentShadowState(agentId) {
    const unregistered = this.unregisteredCalls.get(agentId);

    if (unregistered && unregistered.confirmedShadow) {
      return ShadowState.CONFIRMED_SHADOW;
    }

    if (unregistered && unregistered.count >= this.shadowThreshold) {
      return ShadowState.CONFIRMED_SHADOW;
    }

    if (unregistered && unregistered.count > 0) {
      return ShadowState.SHADOW_CANDIDATE;
    }

    return ShadowState.CLEAN;
  }

  /**
   * Reset agent state
   * @param {string} agentId - Agent ID
   */
  resetAgentState(agentId) {
    this.unregisteredCalls.delete(agentId);
    this.callHistory.delete(agentId);
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      trackedAgents: this.unregisteredCalls.size,
      activeAlerts: this.alerts.size,
      shadowCandidates: Array.from(this.unregisteredCalls.entries())
        .filter(([, data]) => data.count > 0)
        .map(([agentId, data]) => ({
          agentId,
          count: data.count,
          tools: Array.from(data.tools)
        }))
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create ShadowDetector singleton
 * @param {Object} config - Configuration
 * @returns {ShadowDetector}
 */
function getShadowDetector(config = {}) {
  if (!instance) {
    instance = new ShadowDetector(config);
  }
  return instance;
}

module.exports = {
  ShadowDetector,
  ShadowState,
  getShadowDetector
};
