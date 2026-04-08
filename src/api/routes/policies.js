// src/api/routes/policies.js
// REST API routes for Policy management
// Phase 1.2: Per-Agent Sandbox Policies

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { 
  getPolicyStore, 
  getPolicyEngine, 
  PolicyAction,
  generatePolicyId 
} = require('../../policies');

const router = express.Router();

// Rate limiting for policy management endpoints
const policyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { error: 'Too many policy requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Middleware to ensure user is admin for sensitive operations
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required for this operation' });
  }
  next();
};

// GET /api/policies - List all policies (admin only)
router.get('/',
  policyLimiter,
  requireAdmin,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const policies = store.listAll();
      
      // Strip sensitive data if needed
      const safePolicies = policies.map(p => ({
        ...p,
        // Keep all fields, no credentials to strip
      }));
      
      res.json({
        policies: safePolicies,
        count: safePolicies.length,
        stats: store.getStats()
      });
    } catch (error) {
      console.error('Error listing policies:', error);
      res.status(500).json({ error: 'Failed to list policies' });
    }
  }
);

// GET /api/policies/agent/:agentId - List policies for an agent
router.get('/agent/:agentId',
  policyLimiter,
  [
    param('agentId').isString().notEmpty()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const { tool, action, enabled } = req.query;
      
      const filter = {};
      if (tool) filter.tool = tool;
      if (action) filter.action = action;
      if (enabled !== undefined) filter.enabled = enabled === 'true';
      
      const policies = store.listForAgent(req.params.agentId, filter);
      
      res.json({
        agentId: req.params.agentId,
        policies,
        count: policies.length
      });
    } catch (error) {
      console.error('Error listing agent policies:', error);
      res.status(500).json({ error: 'Failed to list policies' });
    }
  }
);

// GET /api/policies/:policyId - Get a specific policy
router.get('/:policyId',
  policyLimiter,
  [
    param('policyId').isString().notEmpty()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const policy = store.get(req.params.policyId);
      
      if (!policy) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      
      res.json(policy);
    } catch (error) {
      console.error('Error getting policy:', error);
      res.status(500).json({ error: 'Failed to get policy' });
    }
  }
);

// POST /api/policies - Create a new policy
router.post('/',
  policyLimiter,
  requireAdmin,
  [
    body('agentId').isString().notEmpty().withMessage('agentId is required'),
    body('tool').isString().notEmpty().withMessage('tool is required'),
    body('action').isString().isIn(Object.values(PolicyAction)).withMessage('action must be ALLOW, DENY, or AUDIT'),
    body('conditions').optional().isObject(),
    body('priority').optional().isInt({ min: 0 }),
    body('enabled').optional().isBoolean()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      
      const policyData = {
        policyId: generatePolicyId(),
        agentId: req.body.agentId,
        tool: req.body.tool,
        action: req.body.action,
        conditions: req.body.conditions || {},
        priority: req.body.priority || 0,
        enabled: req.body.enabled !== false,
        createdBy: req.user?.username || req.user?.agentId || 'admin'
      };
      
      const policy = store.create(policyData);
      
      res.status(201).json({
        message: 'Policy created successfully',
        policy
      });
    } catch (error) {
      console.error('Error creating policy:', error);
      res.status(500).json({ error: error.message || 'Failed to create policy' });
    }
  }
);

// PUT /api/policies/:policyId - Update a policy
router.put('/:policyId',
  policyLimiter,
  requireAdmin,
  [
    param('policyId').isString().notEmpty(),
    body('action').optional().isString().isIn(Object.values(PolicyAction)),
    body('conditions').optional().isObject(),
    body('priority').optional().isInt({ min: 0 }),
    body('enabled').optional().isBoolean()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      
      const updates = {};
      if (req.body.action) updates.action = req.body.action;
      if (req.body.conditions) updates.conditions = req.body.conditions;
      if (req.body.priority !== undefined) updates.priority = req.body.priority;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      
      const policy = store.update(req.params.policyId, updates);
      
      if (!policy) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      
      res.json({
        message: 'Policy updated successfully',
        policy
      });
    } catch (error) {
      console.error('Error updating policy:', error);
      res.status(500).json({ error: error.message || 'Failed to update policy' });
    }
  }
);

// DELETE /api/policies/:policyId - Delete a policy
router.delete('/:policyId',
  policyLimiter,
  requireAdmin,
  [
    param('policyId').isString().notEmpty()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const deleted = store.delete(req.params.policyId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      
      res.json({ message: 'Policy deleted successfully' });
    } catch (error) {
      console.error('Error deleting policy:', error);
      res.status(500).json({ error: 'Failed to delete policy' });
    }
  }
);

// POST /api/policies/agent/:agentId/bulk - Bulk create policies for an agent
router.post('/agent/:agentId/bulk',
  policyLimiter,
  requireAdmin,
  [
    body('policies').isArray().withMessage('policies must be an array'),
    body('policies.*.tool').isString().notEmpty(),
    body('policies.*.action').isString().isIn(Object.values(PolicyAction))
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      
      const policiesData = req.body.policies.map(p => ({
        ...p,
        agentId: req.params.agentId,
        policyId: generatePolicyId(),
        createdBy: req.user?.username || req.user?.agentId || 'admin'
      }));
      
      const created = store.bulkCreate(policiesData);
      
      res.status(201).json({
        message: `Created ${created.length} policies`,
        policies: created
      });
    } catch (error) {
      console.error('Error bulk creating policies:', error);
      res.status(500).json({ error: error.message || 'Failed to create policies' });
    }
  }
);

// DELETE /api/policies/agent/:agentId - Delete all policies for an agent
router.delete('/agent/:agentId',
  policyLimiter,
  requireAdmin,
  [
    param('agentId').isString().notEmpty()
  ],
  validate,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const deleted = store.deleteForAgent(req.params.agentId);
      
      res.json({
        message: `Deleted ${deleted} policies`,
        deleted
      });
    } catch (error) {
      console.error('Error deleting agent policies:', error);
      res.status(500).json({ error: 'Failed to delete policies' });
    }
  }
);

// GET /api/policies/preview - Preview policy decision for a tool
router.get('/preview/:agentId/:tool',
  policyLimiter,
  [
    param('agentId').isString().notEmpty(),
    param('tool').isString().notEmpty()
  ],
  validate,
  (req, res) => {
    try {
      const engine = getPolicyEngine();
      const preview = engine.preview(req.params.agentId, req.params.tool);
      
      res.json(preview);
    } catch (error) {
      console.error('Error previewing policy:', error);
      res.status(500).json({ error: 'Failed to preview policy' });
    }
  }
);

// GET /api/policies/stats - Get policy store statistics
router.get('/stats/overview',
  policyLimiter,
  requireAdmin,
  (req, res) => {
    try {
      const store = getPolicyStore();
      const stats = store.getStats();
      
      res.json(stats);
    } catch (error) {
      console.error('Error getting stats:', error);
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  }
);

// GET /api/policies/tools - List all available tools with risk levels
router.get('/tools/catalog',
  policyLimiter,
  (req, res) => {
    try {
      const { getToolCatalog } = require('../../policies');
      const catalog = getToolCatalog();
      const toolsCatalog = catalog.getCatalog();
      
      res.json(toolsCatalog);
    } catch (error) {
      console.error('Error getting tool catalog:', error);
      res.status(500).json({ error: 'Failed to get tool catalog' });
    }
  }
);

module.exports = router;
