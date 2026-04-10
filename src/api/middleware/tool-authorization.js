// src/api/middleware/tool-authorization.js
// Tool Authorization Middleware — Pre-invocation authorization
// ADR-015: Tool Access Control & Enforcement

const { evaluatePermission } = require('../../policies/permission-model');
const { validateParameters } = require('../../policies/parameter-validator');
const { ShadowDetector } = require('../../policies/shadow-detector');

/**
 * Create tool authorization middleware
 * @param {Object} config - Configuration
 * @returns {Function} Express middleware
 */
function createToolAuthorizationMiddleware(config = {}) {
  const {
    toolRegistry,
    sessionManager,
    attestationService,
    anomalyMonitor,
    securityLogger,
    shadowDetector
  } = config;

  /**
   * Authorization middleware
   */
  return async function authorizeToolInvocation(req, res, next) {
    const { agentId, sessionId, toolId, parameters } = req.body;

    try {
      // 1. Verify agent identity (ADR-013)
      const authHeader = req.headers.authorization;
      let agent = null;

      if (attestationService) {
        agent = await attestationService.verify(authHeader);
      }

      if (!agent) {
        return res.status(401).json({
          error: 'UNAUTHENTICATED',
          message: 'Invalid or missing authentication'
        });
      }

      // Verify agent matches request
      if (agentId && agent.agentId !== agentId) {
        return res.status(403).json({
          error: 'AGENT_MISMATCH',
          message: 'Agent ID does not match authenticated agent'
        });
      }

      // 2. Verify session (ADR-013)
      let session = null;
      if (sessionManager) {
        session = await sessionManager.getSession(sessionId);
      }

      if (!session) {
        return res.status(401).json({
          error: 'INVALID_SESSION',
          message: 'Session not found or expired'
        });
      }

      if (session.agentId !== agent.agentId) {
        return res.status(401).json({
          error: 'SESSION_AGENT_MISMATCH',
          message: 'Session does not belong to this agent'
        });
      }

      // 3. Check tool exists in registry
      let tool = null;
      if (toolRegistry) {
        tool = await toolRegistry.getTool(toolId);
      }

      if (!tool) {
        // Log security event
        if (securityLogger) {
          await securityLogger.logSecurityEvent({
            type: 'TOOL_NOT_FOUND',
            agentId: agent.agentId,
            sessionId,
            toolId,
            reason: 'TOOL_NOT_IN_REGISTRY'
          });
        }

        return res.status(404).json({
          error: 'TOOL_NOT_FOUND',
          message: `Tool '${toolId}' is not in the registry`
        });
      }

      // 4. Check tool is enabled
      if (tool.enabled === false) {
        return res.status(403).json({
          error: 'TOOL_DISABLED',
          message: `Tool '${toolId}' is currently disabled`
        });
      }

      // 5. Evaluate permissions (RBAC)
      const permission = evaluatePermission(agent.role, toolId, parameters);

      if (!permission.allowed) {
        // Log security event
        if (securityLogger) {
          await securityLogger.logSecurityEvent({
            type: 'TOOL_ACCESS_DENIED',
            agentId: agent.agentId,
            sessionId,
            toolId,
            reason: permission.reason,
            rule: permission.rule
          });
        }

        // Check if this is anomalous (ADR-014)
        if (anomalyMonitor) {
          await anomalyMonitor.recordDeniedAccess(agent.agentId, toolId);
        }

        return res.status(403).json({
          error: 'TOOL_ACCESS_DENIED',
          reason: permission.reason,
          rule: permission.rule
        });
      }

      // 6. Check execution context constraints (ADR-013)
      const context = session.executionContext || {};

      if (context.deniedTools?.includes(toolId)) {
        return res.status(403).json({
          error: 'TOOL_DENIED_BY_CONTEXT',
          message: 'Tool is denied by session execution context'
        });
      }

      const allowedTools = context.allowedTools;
      if (allowedTools &&
          !allowedTools.includes('*') &&
          !allowedTools.includes(toolId)) {
        return res.status(403).json({
          error: 'TOOL_NOT_IN_CONTEXT',
          message: 'Tool is not in session allowed tools list'
        });
      }

      // 7. Validate tool parameters against schema (F-1 FIX)
      if (tool.parameters) {
        const paramValidation = validateParameters(toolId, parameters, tool.parameters);

        if (!paramValidation.valid) {
          // Log validation failure
          if (securityLogger) {
            await securityLogger.logValidationFailure({
              agentId: agent.agentId,
              sessionId,
              toolId,
              errors: paramValidation.errors
            });
          }

          return res.status(400).json({
            error: 'INVALID_PARAMETERS',
            message: 'Parameter validation failed',
            details: paramValidation.errors
          });
        }
      }

      // Authorized - attach authorization context to request
      req.authorization = {
        agent,
        session,
        tool,
        permission,
        toolRegistry,
        shadowDetector
      };

      next();

    } catch (error) {
      console.error('Tool authorization error:', error);

      return res.status(500).json({
        error: 'AUTHORIZATION_ERROR',
        message: 'Internal authorization error'
      });
    }
  };
}

/**
 * Create middleware with default dependencies
 * @returns {Function} Express middleware
 */
function createDefaultToolAuthorizationMiddleware() {
  return createToolAuthorizationMiddleware({
    // Dependencies should be injected here
    // For now, returns a middleware that checks basic auth
  });
}

module.exports = {
  createToolAuthorizationMiddleware,
  createDefaultToolAuthorizationMiddleware
};
