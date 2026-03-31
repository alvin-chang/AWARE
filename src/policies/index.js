// src/policies/index.js
// Policy Module — Public API for Phase 1.2 Per-Agent Sandbox Policies

const { 
  PolicyAction, 
  PolicyVersion, 
  ConditionType, 
  ToolRiskLevel, 
  DataTier,
  createPolicy,
  validatePolicy,
  generatePolicyId,
  parseFrequency
} = require('./model');

const {
  ToolCatalog,
  getToolCatalog,
  DEFAULT_TOOLS
} = require('./tool-catalog');

const {
  PolicyStore,
  getPolicyStore
} = require('./store');

const {
  PolicyEngine,
  getPolicyEngine,
  Decision,
  DEFAULT_DECISION
} = require('./engine');

module.exports = {
  // Model
  PolicyAction,
  PolicyVersion,
  ConditionType,
  ToolRiskLevel,
  DataTier,
  createPolicy,
  validatePolicy,
  generatePolicyId,
  parseFrequency,
  
  // Tool Catalog
  ToolCatalog,
  getToolCatalog,
  DEFAULT_TOOLS,
  
  // Policy Store
  PolicyStore,
  getPolicyStore,
  
  // Policy Engine
  PolicyEngine,
  getPolicyEngine,
  Decision,
  DEFAULT_DECISION
};
