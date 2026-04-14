// src/api/middleware/tool-authorization.js
// Tool Authorization Middleware — Pre-invocation authorization
// ADR-015: Tool Access Control & Enforcement
// C1 Integration: T0 Constraint Engine (circuit breaker)

const { evaluatePermission } = require('../../policies/permission-model');
const { validateParameters } = require('../../policies/parameter-validator');
const { ShadowDetector } = require('../../policies/shadow-detector');

// ── C1: T0 Constraint Engine (lazy-loaded singleton) ──────────────────────────
/** @type {import('../../../../AWARE/backend/dist/engine.js').ConstraintEngine|null} */
let _constraintEngine = null;
/** @type {Promise<import('../../../../AWARE/backend/dist/engine.js').ConstraintEngine>|null} */
let _engineInitPromise = null;

/**
 * Lazily initialize the T0 constraint engine singleton.
 * Engine is shared across all requests — initialized once on first use.
 * @returns {Promise<ConstraintEngine>}
 */
async function getConstraintEngine() {
  if (_constraintEngine) return _constraintEngine;
  if (_engineInitPromise) return _engineInitPromise;

  _engineInitPromise = (async () => {
    try {
      // Dynamic import — backend/ is ESM, this file is CommonJS
      const { ConstraintEngine } = await import('../../../../AWARE/backend/dist/engine.js');
      const { T0ConstraintRegistry, ApprovedChannel } = await import('../../../../AWARE/backend/dist/constraints/index.js');

      // Default approved outbound channels (ADR-009 T0-1)
      // These are the only outbound destinations T0 agents may contact
      const approvedChannels = /** @type {ApprovedChannel[]} */ ([
        { channel: 'github.com', reason: 'GitOps — code push to private repo' },
        { channel: 'api.github.com', reason: 'GitHub API — PRs, issues, releases' },
        { channel: 'openclaw.local:3000', reason: 'Gitea — internal artifact push' },
        { channel: 'localhost:3000', reason: 'Gitea — internal artifact push' },
      ]);

      const t0 = new T0ConstraintRegistry({ approvedChannels });
      _constraintEngine = new ConstraintEngine({ blockOnTierViolation: false });
      _constraintEngine.t0Registry = t0;
      console.log('[tool-auth] T0 constraint engine initialized — circuit breaker ACTIVE');
      return _constraintEngine;
    } catch (err) {
      console.error('[tool-auth] Failed to initialize T0 constraint engine:', err.message);
      // Don't block all requests if the circuit breaker fails to init
      // — fail-open is a known trade-off here (gateway-level kill switch is the net)
      _engineInitPromise = null;
      return null;
    }
  })();

  return _engineInitPromise;
}

/**
 * Build an AgentAction from the current request context.
 * @param {string} actionId - Unique action ID
 * @param {string} agentId - Authenticated agent ID
 * @param {string} toolId - Tool being invoked
 * @param {Object} parameters - Tool parameters
 * @param {boolean} privileged - Whether agent has elevated privileges
 * @returns {Object}
 */
function buildAgentAction(actionId, agentId, toolId, parameters, privileged) {
  return {
    id: actionId,
    agentId,
    action: toolId,
    params: parameters || {},
    timestamp: new Date().toISOString(),
    privileged: privileged || false,
    metadata: {
      // Capture outbound URLs from params for T0-1 exfiltration check
      outboundUrls: extractOutboundUrls(parameters),
    },
  };
}

/**
 * Extract potential outbound URLs from tool parameters (recursive scan).
 * T0-1 checks these against the approved channel whitelist.
 * @param {any} obj
 * @returns {string[]}
 */
function extractOutboundUrls(obj) {
  if (!obj) return [];
  if (typeof obj === 'string') {
    try {
      const url = new URL(obj);
      if (url.protocol === 'http:' || url.protocol === 'https:') return [url.hostname];
    } catch { /* not a URL */ }
    return [];
  }
  if (Array.isArray(obj)) return obj.flatMap(extractOutboundUrls);
  if (typeof obj === 'object') {
    return Object.values(obj).flatMap(extractOutboundUrls);
  }
  return [];
}

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

      // ── C1: T0 Circuit Breaker ──────────────────────────────────────────────
      // Evaluate ALL T0 constraints BEFORE tool execution.
      // T0 violations are hard blocks — no override, no bypass.
      // This is the last line of defense before the tool fires.
      const engine = await getConstraintEngine();
      if (engine) {
        const action = buildAgentAction(
          `tool-${toolId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          agent.agentId,
          toolId,
          parameters,
          agent.privileged || false
        );

        try {
          const result = await engine.evaluateT0(action);

          if (!result.allowed) {
            const violation = result.violated || {};
            console.warn(
              `[tool-auth] T0 BLOCKED — agent=${agent.agentId} tool=${toolId} ` +
              `constraint=${violation.constraint || 'unknown'} reason=${violation.message || 'denied'}`
            );

            // Log to security logger
            if (securityLogger) {
              await securityLogger.logSecurityEvent({
                type: 'T0_CONSTRAINT_VIOLATION',
                agentId: agent.agentId,
                sessionId,
                toolId,
                constraint: violation.constraint || 'unknown',
                reason: violation.message || 'T0 hard block',
              });
            }

            return res.status(403).json({
              error: 'T0_CONSTRAINT_VIOLATION',
              constraint: violation.constraint || 'unknown',
              reason: violation.message || 'T0 constraint violated — tool blocked',
            });
          }
        } catch (evalErr) {
          // Circuit breaker threw — fail-open with warning (net safety via gateway kill switch)
          console.error('[tool-auth] T0 evaluation threw:', evalErr.message);
        }
      }
      // ── End C1 circuit breaker ──────────────────────────────────────────────

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
