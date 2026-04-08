/**
 * ADR-018: Phase 3.3 — Decision-Chain Traceability API Routes
 * 
 * @module api/routes/audit
 * @author Forge (Coder)
 * @license GPL-3.0
 */

'use strict';

const {
  logDecision,
  getChain,
  getChainBetween,
  verifyChain,
  exportChain,
  generateUUID
} = require('../../audit/decision-logger');

/**
 * POST /api/audit/log — Log a decision to the audit chain
 * 
 * @param {Object} req.body - Decision record
 * @returns {Object} Logged decision with hash
 */
async function logDecisionRoute(req, res) {
  try {
    const decision = req.body;
    
    if (!decision.decisionId) {
      decision.decisionId = generateUUID();
    }
    
    const hash = await logDecision(decision);
    
    res.status(201).json({
      success: true,
      decisionId: decision.decisionId,
      hash
    });
  } catch (error) {
    console.error('[audit-api] logDecision error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/audit/chain/:decisionId — Get full chain to decision
 * 
 * @param {string} req.params.decisionId
 * @returns {Object} Decision chain
 */
async function getChainRoute(req, res) {
  try {
    const { decisionId } = req.params;
    
    const chain = await getChain(decisionId);
    
    res.json({
      success: true,
      decisionId,
      chain,
      length: chain.length
    });
  } catch (error) {
    console.error('[audit-api] getChain error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/audit/verify — Verify chain integrity
 * 
 * @returns {Object} Verification result
 */
async function verifyChainRoute(req, res) {
  try {
    const result = await verifyChain();
    
    res.json({
      success: true,
      ...result,
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[audit-api] verifyChain error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/audit/export — Export chain for compliance
 * 
 * @param {string} req.query.from - Start decisionId
 * @param {string} req.query.to - End decisionId
 * @param {string} [req.query.format=json] - Format: json | csv | cef
 * @returns {string} Exported chain
 */
async function exportChainRoute(req, res) {
  try {
    const { from, to, format = 'json' } = req.query;
    
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'from and to decisionId are required'
      });
    }
    
    const exported = await exportChain(from, to, format);
    
    res.json({
      success: true,
      from,
      to,
      format,
      exported
    });
  } catch (error) {
    console.error('[audit-api] exportChain error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/audit/record/:decisionId — Get single decision record
 * 
 * @param {string} req.params.decisionId
 * @returns {Object} Decision record
 */
async function getRecordRoute(req, res) {
  try {
    const { decisionId } = req.params;
    const chain = await getChain(decisionId);
    const record = chain[chain.length - 1];  // Last one is the target
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Decision not found'
      });
    }
    
    res.json({
      success: true,
      record
    });
  } catch (error) {
    console.error('[audit-api] getRecord error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  logDecisionRoute,
  getChainRoute,
  verifyChainRoute,
  exportChainRoute,
  getRecordRoute
};
