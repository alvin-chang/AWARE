/**
 * ADR (internal): Phase 2.4 — Hot-Reload Policy API Routes
 * 
 * REST API for hot-reload policy management.
 * Per ADR (internal) §API Endpoints.
 * 
 * @module api/routes/hot-reload-policies
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

/**
 * POST /api/policies/validate - Validate policy without applying
 * 
 * @param {Object} req.body - Policy content to validate
 * @returns {Object} Validation result
 */
async function validatePolicyRoute(req, res) {
  try {
    const { policyPath, content } = req.body;
    
    if (!policyPath || !content) {
      return res.status(400).json({ 
        success: false, 
        error: 'policyPath and content are required' 
      });
    }
    
    const { validatePolicy } = require('../../routing/policy-watcher');
    const policyKey = policyPath.replace('/aware/policies/', '').replace('.json', '');
    const result = validatePolicy(policyKey, content);
    
    res.json({
      success: result.valid,
      errors: result.errors,
      policyPath
    });
  } catch (error) {
    console.error('[hot-reload-api] Validation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * PUT /api/policies/:category/:name - Update policy (triggers hot-reload)
 * 
 * @param {string} req.params.category - Policy category (routing, security)
 * @param {string} req.params.name - Policy name
 * @param {Object} req.body - New policy content
 * @param {string} req.body.changeReason - Reason for change
 * @returns {Object} Update result
 */
async function updatePolicyRoute(req, res) {
  try {
    const { category, name } = req.params;
    const { content, changeReason } = req.body;
    
    if (!content) {
      return res.status(400).json({ 
        success: false, 
        error: 'content is required' 
      });
    }
    
    const path = `/aware/policies/${category}/${name}.json`;
    
    // Validate first
    const { validatePolicy } = require('../../routing/policy-watcher');
    const policyKey = `${category}/${name}`;
    const validation = validatePolicy(policyKey, content);
    
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        errors: validation.errors 
      });
    }
    
    // TODO: Apply via etcd transaction with CAS
    // const { applyPolicyTransaction } = require('../../routing/policy-store');
    // await applyPolicyTransaction([{ path, content }]);
    
    res.json({
      success: true,
      policy: {
        path,
        version: Date.now(),  // Placeholder
        lastModified: new Date().toISOString(),
        modifiedBy: req.user?.username || 'admin',
        changeReason: changeReason || 'No reason provided'
      },
      affectedComponents: getAffectedComponents(name)
    });
  } catch (error) {
    console.error('[hot-reload-api] Update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/policies - List all policies and their versions
 * 
 * @returns {Object} All policies
 */
async function listPoliciesRoute(req, res) {
  try {
    // TODO: Fetch from etcd
    // const { listPolicies } = require('../../routing/policy-store');
    // const policies = await listPolicies();
    
    // Placeholder response
    res.json({
      policies: [
        {
          path: '/aware/policies/routing/heuristic.json',
          version: 1,
          lastModified: new Date().toISOString()
        },
        {
          path: '/aware/policies/routing/quality-gate.json',
          version: 1,
          lastModified: new Date().toISOString()
        }
      ]
    });
  } catch (error) {
    console.error('[hot-reload-api] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/policies/:category/:name - Get specific policy
 * 
 * @param {string} req.params.category
 * @param {string} req.params.name
 * @returns {Object} Policy content
 */
async function getPolicyRoute(req, res) {
  try {
    const { category, name } = req.params;
    const path = `/aware/policies/${category}/${name}.json`;
    
    // TODO: Fetch from etcd
    // const { getPolicy } = require('../../routing/policy-store');
    // const policy = await getPolicy(path);
    
    res.json({
      path,
      content: {},  // Placeholder
      version: 1,
      lastModified: new Date().toISOString()
    });
  } catch (error) {
    console.error('[hot-reload-api] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/policies/reload - Force manual reload
 * 
 * @param {string} req.body.component - Component to reload
 * @returns {Object} Reload result
 */
async function reloadPolicyRoute(req, res) {
  try {
    const { component } = req.body;
    
    if (!component) {
      return res.status(400).json({ 
        success: false, 
        error: 'component is required' 
      });
    }
    
    // TODO: Trigger reload via PolicyApplicator
    // const { triggerReload } = require('../../routing/policy-applicator');
    // await triggerReload(component);
    
    res.json({
      success: true,
      component,
      reloadedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[hot-reload-api] Reload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/policies/history - Get policy change audit log
 * 
 * @param {number} req.query.limit - Max entries to return
 * @returns {Object} Audit history
 */
async function getPolicyHistoryRoute(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // TODO: Fetch from audit log
    // const { getAuditHistory } = require('../../routing/audit-logger');
    // const history = await getAuditHistory(limit);
    
    res.json({
      history: [],  // Placeholder
      limit,
      count: 0
    });
  } catch (error) {
    console.error('[hot-reload-api] History error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Map policy name to affected components.
 * Per ADR (internal) §Policy Applicator.
 * 
 * @param {string} name
 * @returns {string[]}
 */
function getAffectedComponents(name) {
  const componentMap = {
    'pheromone': ['pheromone-evaluator'],
    'heuristic': ['heuristic-evaluator'],
    'quality-gate': ['quality-evaluator'],
    'blast-radius': ['heuristic-evaluator', 'reinforcement-controller'],
    'blast-radius-matrix': ['heuristic-evaluator'],
    'allowed-tools': ['policy-engine'],
    'data-classification': ['policy-engine']
  };
  
  return componentMap[name] || [];
}

module.exports = {
  validatePolicyRoute,
  updatePolicyRoute,
  listPoliciesRoute,
  getPolicyRoute,
  reloadPolicyRoute,
  getPolicyHistoryRoute
};
