// src/compliance/index.js
// Compliance Module — Public API for ADR (internal) Compliance Mapping & Reporting

const {
  FrameworkMapper,
  getFrameworkMapper,
  FRAMEWORKS,
  AWARE_COMPONENT_MAPPINGS
} = require('./framework-mapper');

const {
  EvidenceCollector,
  getEvidenceCollector,
  EvidenceSourceType,
  EvidenceStatus
} = require('./evidence-collector');

const {
  PostureCalculator,
  getPostureCalculator,
  ComplianceStatus,
  GapSeverity
} = require('./posture-calculator');

const {
  GapTracker,
  getGapTracker,
  GapStatus
} = require('./gap-tracker');

const {
  ReportGenerator,
  getReportGenerator,
  ReportType
} = require('./report-generator');

const {
  COMPLIANCE_ROLES,
  checkPermission,
  createComplianceAccessControl,
  getComplianceRoles,
  getRolePermissions,
  complianceRead,
  complianceWrite,
  complianceAdmin,
  reportsRead,
  reportsWrite,
  reportsApprove,
  gapsRead,
  gapsWrite,
  gapsAdmin
} = require('../api/middleware/compliance-access-control');

module.exports = {
  // Framework Mapping
  FrameworkMapper,
  getFrameworkMapper,
  FRAMEWORKS,
  AWARE_COMPONENT_MAPPINGS,

  // Evidence Collection
  EvidenceCollector,
  getEvidenceCollector,
  EvidenceSourceType,
  EvidenceStatus,

  // Posture Calculation
  PostureCalculator,
  getPostureCalculator,
  ComplianceStatus,
  GapSeverity,

  // Gap Tracking
  GapTracker,
  getGapTracker,
  GapStatus,

  // Report Generation
  ReportGenerator,
  getReportGenerator,
  ReportType,

  // Access Control
  COMPLIANCE_ROLES,
  checkPermission,
  createComplianceAccessControl,
  getComplianceRoles,
  getRolePermissions,
  complianceRead,
  complianceWrite,
  complianceAdmin,
  reportsRead,
  reportsWrite,
  reportsApprove,
  gapsRead,
  gapsWrite,
  gapsAdmin
};
