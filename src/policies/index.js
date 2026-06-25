// src/policies/index.js
// Policy Module — Public API for Phase 1.2 Per-Agent Sandbox Policies + ADR (internal)

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

// ADR (internal): Tool Access Control
const {
  ROLES,
  evaluatePermission,
  roleExists,
  getRole,
  getAllRoles,
  initializeRolePatterns
} = require('./permission-model');

const {
  ShadowDetector,
  ShadowState,
  getShadowDetector
} = require('./shadow-detector');

const {
  ToolObservationProxy,
  createToolObservationProxy
} = require('./tool-observation-proxy');

const {
  validateParameters,
  createSchemaBuilder,
  PARAMETER_VALIDATORS
} = require('./parameter-validator');

const {
  ToolAuditLogger,
  getToolAuditLogger
} = require('./tool-audit-logger');

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
  DEFAULT_DECISION,

  // ADR (internal): Tool Access Control
  // Permission Model (RBAC)
  ROLES,
  evaluatePermission,
  roleExists,
  getRole,
  getAllRoles,
  initializeRolePatterns,

  // Shadow Detection
  ShadowDetector,
  ShadowState,
  getShadowDetector,

  // Tool Observation Proxy
  ToolObservationProxy,
  createToolObservationProxy,

  // Parameter Validation
  validateParameters,
  createSchemaBuilder,
  PARAMETER_VALIDATORS,

  // Audit Logging
  ToolAuditLogger,
  getToolAuditLogger
};
