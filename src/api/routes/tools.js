// src/api/routes/tools.js
// Tool Access Control API Routes
// ADR-015: Tool Access Control & Enforcement

const express = require('express');
const router = express.Router();
const {
  getToolCatalog,
  getShadowDetector,
  getToolAuditLogger,
  evaluatePermission,
  roleExists,
  getAllRoles,
  ShadowState
} = require('../../policies');

/**
 * GET /api/tools
 * List all registered tools
 */
router.get('/', async (req, res) => {
  try {
    const catalog = getToolCatalog();
    const tools = catalog.getAllTools();

    // Return tool metadata (not internal details)
    const toolList = tools.map(t => ({
      toolId: t.toolId,
      name: t.name,
      description: t.description,
      category: t.category,
      riskLevel: t.riskLevel,
      dangerous: t.dangerous,
      enabled: t.enabled,
      parameters: t.parameters ? Object.keys(t.parameters) : []
    }));

    res.json({
      tools: toolList,
      total: toolList.length
    });
  } catch (error) {
    console.error('Failed to list tools:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/:toolId
 * Get tool details
 */
router.get('/:toolId', async (req, res) => {
  try {
    const { toolId } = req.params;
    const catalog = getToolCatalog();
    const tool = catalog.getTool(toolId);

    if (!tool) {
      return res.status(404).json({
        error: 'TOOL_NOT_FOUND',
        message: `Tool '${toolId}' not found`
      });
    }

    res.json({ tool });
  } catch (error) {
    console.error('Failed to get tool:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/:toolId/shadow-status
 * Get shadow detection status for a tool
 */
router.get('/:toolId/shadow-status', async (req, res) => {
  try {
    const { toolId } = req.params;
    const shadowDetector = getShadowDetector();

    // This would need agentId to be passed in query
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({
        error: 'AGENT_ID_REQUIRED',
        message: 'agentId query parameter required'
      });
    }

    const state = shadowDetector.getAgentShadowState(agentId);

    res.json({
      toolId,
      agentId,
      state,
      alerts: shadowDetector.getAlerts(agentId)
    });
  } catch (error) {
    console.error('Failed to get shadow status:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/roles
 * List all available roles
 */
router.get('/roles', (req, res) => {
  try {
    const roles = getAllRoles();

    // Return role summaries (not internal patterns)
    const roleList = Object.entries(roles).map(([name, role]) => ({
      name,
      allowsCount: role.allows?.length || 0,
      deniesCount: role.denies?.length || 0,
      inherits: role.inherits || []
    }));

    res.json({ roles: roleList });
  } catch (error) {
    console.error('Failed to list roles:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/tools/evaluate
 * Evaluate if an agent can use a tool (without executing)
 */
router.post('/evaluate', (req, res) => {
  try {
    const { agentRole, toolId, parameters } = req.body;

    if (!agentRole) {
      return res.status(400).json({
        error: 'AGENT_ROLE_REQUIRED',
        message: 'agentRole is required'
      });
    }

    if (!toolId) {
      return res.status(400).json({
        error: 'TOOL_ID_REQUIRED',
        message: 'toolId is required'
      });
    }

    if (!roleExists(agentRole)) {
      return res.status(400).json({
        error: 'ROLE_NOT_FOUND',
        message: `Role '${agentRole}' not found`
      });
    }

    const permission = evaluatePermission(agentRole, toolId, parameters);

    res.json({
      agentRole,
      toolId,
      ...permission
    });
  } catch (error) {
    console.error('Failed to evaluate permission:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/shadow-stats
 * Get shadow detection statistics
 */
router.get('/shadow/stats', async (req, res) => {
  try {
    const shadowDetector = getShadowDetector();
    const stats = shadowDetector.getStats();

    res.json(stats);
  } catch (error) {
    console.error('Failed to get shadow stats:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/shadow-alerts
 * Get active shadow alerts
 */
router.get('/shadow/alerts', async (req, res) => {
  try {
    const { agentId } = req.query;
    const shadowDetector = getShadowDetector();

    const alerts = shadowDetector.getAlerts(agentId);

    res.json({
      alerts,
      total: alerts.length
    });
  } catch (error) {
    console.error('Failed to get shadow alerts:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/tools/shadow-alerts/:alertId
 * Clear a shadow alert
 */
router.delete('/shadow/alerts/:alertId', async (req, res) => {
  try {
    const { alertId } = req.params;
    const shadowDetector = getShadowDetector();

    shadowDetector.clearAlert(alertId);

    res.json({ success: true, alertId });
  } catch (error) {
    console.error('Failed to clear alert:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/audit/query
 * Query audit logs
 */
router.get('/audit/query', async (req, res) => {
  try {
    const {
      eventType,
      agentId,
      toolId,
      startTime,
      endTime,
      limit
    } = req.query;

    const auditLogger = getToolAuditLogger();

    const results = await auditLogger.query({
      eventType,
      agentId,
      toolId,
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      limit: limit ? parseInt(limit) : 1000
    });

    res.json({
      results,
      total: results.length
    });
  } catch (error) {
    console.error('Failed to query audit logs:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/tools/audit/evidence
 * Get compliance evidence for a time period
 */
router.get('/audit/evidence', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({
        error: 'START_TIME_AND_END_TIME_REQUIRED',
        message: 'startTime and endTime query parameters required (Unix timestamp)'
      });
    }

    const auditLogger = getToolAuditLogger();

    const evidence = await auditLogger.getComplianceEvidence(
      parseInt(startTime),
      parseInt(endTime)
    );

    res.json(evidence);
  } catch (error) {
    console.error('Failed to get compliance evidence:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
