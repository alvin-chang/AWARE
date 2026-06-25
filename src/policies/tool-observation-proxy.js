// src/policies/tool-observation-proxy.js
// Tool Observation Proxy — Gateway-level observation for all tool calls
// ADR (internal): Tool Access Control & Enforcement

const EventEmitter = require('events');

/**
 * ToolObservationProxy — Gateway-level proxy that observes ALL tool calls
 *
 * All tool invocations pass through this proxy, which:
 * 1. Logs the observation BEFORE allow/deny decision
 * 2. Checks if tool is in registry (shadow detection)
 * 3. Checks for anomalous usage patterns
 * 4. Forwards to actual tool executor
 */
class ToolObservationProxy extends EventEmitter {
  /**
   * @param {Object} config - Configuration
   * @param {Object} config.toolRegistry - Tool registry instance
   * @param {Object} config.shadowDetector - Shadow detector instance
   * @param {Object} config.auditLogger - Audit logger instance
   * @param {Function} config.toolExecutor - Actual tool execution function
   */
  constructor(config = {}) {
    super();
    this.registry = config.toolRegistry;
    this.shadowDetector = config.shadowDetector;
    this.auditLogger = config.auditLogger;
    this.executor = config.toolExecutor || this.defaultExecutor;
  }

  /**
   * Default executor (placeholder)
   * @param {string} toolId - Tool ID
   * @param {Object} parameters - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>}
   */
  async defaultExecutor(toolId, parameters, context) {
    return { error: 'NO_EXECUTOR_CONFIGURED', toolId };
  }

  /**
   * Observe a tool call and forward to executor
   * @param {string} toolId - Tool ID
   * @param {Object} parameters - Tool parameters
   * @param {Object} agentContext - Agent context { agentId, sessionId, role, callSource }
   * @returns {Promise<Object>} { allowed: boolean, result?: any, reason?: string }
   */
  async observeAndForward(toolId, parameters, agentContext) {
    const observation = {
      toolId,
      parameters,
      agentId: agentContext.agentId,
      sessionId: agentContext.sessionId,
      role: agentContext.role,
      callSource: agentContext.callSource || 'direct',
      timestamp: Date.now()
    };

    // 1. ALWAYS log the observation first (before allow/deny)
    if (this.auditLogger) {
      await this.auditLogger.logToolObservation(observation);
    }

    // Emit observation event for monitoring
    this.emit('toolObservation', observation);

    // 2. Check if tool is in registry
    let tool = null;
    if (this.registry) {
      tool = await this.registry.getTool(toolId);
    }

    if (!tool) {
      // Unknown tool - record as shadow candidate
      if (this.shadowDetector) {
        await this.shadowDetector.recordUnregisteredCall(observation);
      }

      this.emit('unknownTool', observation);

      return {
        allowed: false,
        reason: 'TOOL_NOT_IN_REGISTRY',
        shadow: true,
        observation
      };
    }

    // 3. Tool exists - check if usage pattern is anomalous
    if (this.shadowDetector) {
      const shadowCheck = await this.shadowDetector.checkAnomalousUsage(
        agentContext.agentId,
        toolId,
        observation
      );

      if (shadowCheck.isShadow || shadowCheck.isAnomalous) {
        // Known tool but unusual usage - alert and log
        await this.shadowDetector.recordAnomalousCall(observation, shadowCheck);

        this.emit('anomalousToolUsage', {
          ...observation,
          shadowCheck
        });

        return {
          allowed: false,
          reason: shadowCheck.isShadow ? 'SHADOW_TOOL_PATTERN' : 'ANOMALOUS_USAGE',
          alert: true,
          shadowCheck,
          observation
        };
      }
    }

    // 4. Check if tool is enabled
    if (tool.enabled === false) {
      return {
        allowed: false,
        reason: 'TOOL_DISABLED',
        tool
      };
    }

    // 5. Forward to actual executor
    try {
      const result = await this.executor(toolId, parameters, {
        ...agentContext,
        tool
      });

      // Log successful execution
      if (this.auditLogger) {
        await this.auditLogger.logToolExecution({
          ...observation,
          success: true,
          result
        });
      }

      return {
        allowed: true,
        result,
        tool
      };
    } catch (error) {
      // Log failed execution
      if (this.auditLogger) {
        await this.auditLogger.logToolExecution({
          ...observation,
          success: false,
          error: error.message
        });
      }

      return {
        allowed: true, // Execution failure doesn't mean denied
        error: error.message,
        tool
      };
    }
  }

  /**
   * Wrap an executor function with observation
   * @param {Function} executor - Tool executor function
   * @returns {Function} Wrapped executor
   */
  wrapExecutor(executor) {
    const proxy = this;
    return async function(toolId, parameters, context) {
      return proxy.observeAndForward(toolId, parameters, context);
    };
  }
}

/**
 * Create a tool observation proxy with standard components
 * @param {Object} config - Configuration
 * @returns {ToolObservationProxy}
 */
function createToolObservationProxy(config = {}) {
  const {
    toolRegistry,
    shadowDetector,
    auditLogger,
    toolExecutor
  } = config;

  return new ToolObservationProxy({
    toolRegistry: toolRegistry || getDefaultToolRegistry(),
    shadowDetector: shadowDetector || getDefaultShadowDetector(),
    auditLogger: auditLogger || getDefaultAuditLogger(),
    toolExecutor
  });
}

// Placeholder defaults - these should be replaced with actual implementations
function getDefaultToolRegistry() {
  return {
    getTool: async (toolId) => null,
    isKnownTool: async (toolId) => false
  };
}

function getDefaultShadowDetector() {
  return {
    recordUnregisteredCall: async () => ({}),
    checkAnomalousUsage: async () => ({ isShadow: false, isAnomalous: false })
  };
}

function getDefaultAuditLogger() {
  return {
    logToolObservation: async () => {},
    logToolExecution: async () => {}
  };
}

module.exports = {
  ToolObservationProxy,
  createToolObservationProxy
};
