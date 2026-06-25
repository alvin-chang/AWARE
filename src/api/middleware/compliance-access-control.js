// src/api/middleware/compliance-access-control.js
// Compliance Access Control Middleware — RBAC for compliance API
// ADR-016 F-1 FIX: Compliance API Access Control

/**
 * Compliance Roles
 */
const COMPLIANCE_ROLES = {
  'compliance-admin': {
    name: 'Compliance Administrator',
    permissions: [
      'compliance:read',
      'compliance:write',
      'compliance:admin',
      'reports:read',
      'reports:write',
      'reports:approve',
      'gaps:read',
      'gaps:write',
      'gaps:admin'
    ]
  },
  'compliance-officer': {
    name: 'Compliance Officer',
    permissions: [
      'compliance:read',
      'compliance:write',
      'reports:read',
      'reports:write',
      'gaps:read',
      'gaps:write'
    ]
  },
  'auditor': {
    name: 'External Auditor',
    permissions: [
      'compliance:read',
      'reports:read'
    ]
  },
  'executive': {
    name: 'Executive',
    permissions: [
      'compliance:read',
      'reports:read'
    ]
  },
  'security-team': {
    name: 'Security Team',
    permissions: [
      'compliance:read',
      'reports:read',
      'gaps:read'
    ]
  }
};

/**
 * Permission check result
 */
function checkPermission(role, permission) {
  const roleDef = COMPLIANCE_ROLES[role];
  if (!roleDef) {
    return { allowed: false, reason: 'ROLE_NOT_FOUND' };
  }

  // Admin has all permissions
  if (role === 'compliance-admin') {
    return { allowed: true, role };
  }

  if (roleDef.permissions.includes(permission)) {
    return { allowed: true, role };
  }

  return { allowed: false, reason: 'PERMISSION_DENIED' };
}

/**
 * Create compliance access control middleware
 * @param {string} requiredPermission - Permission required to access
 * @returns {Function} Express middleware
 */
function createComplianceAccessControl(requiredPermission) {
  return function complianceAccessControl(req, res, next) {
    // SC-HIGH-008: Role MUST come from the authenticated principal
    // (req.user.complianceRole, populated by the upstream JWT/session
    // middleware in src/api/middleware/auth.js). Never trust
    // x-compliance-role — it is a request header and trivially
    // spoofable. Default to the lowest-privilege role, not the highest.
    const userRole = req.user?.complianceRole || 'auditor';

    const userAgentId = req.user?.agentId || 'anonymous';

    // Check permission
    const result = checkPermission(userRole, requiredPermission);

    if (!result.allowed) {
      console.warn(`Compliance access denied for ${userAgentId} (role: ${userRole}) to ${requiredPermission}`);

      return res.status(403).json({
        error: 'ACCESS_DENIED',
        reason: result.reason,
        requiredPermission,
        userRole
      });
    }

    // Attach compliance auth info to request
    req.complianceAuth = {
      agentId: userAgentId,
      role: userRole,
      permissions: COMPLIANCE_ROLES[userRole]?.permissions || []
    };

    next();
  };
}

/**
 * Middleware that requires compliance:read permission
 */
const complianceRead = createComplianceAccessControl('compliance:read');

/**
 * Middleware that requires compliance:write permission
 */
const complianceWrite = createComplianceAccessControl('compliance:write');

/**
 * Middleware that requires compliance:admin permission
 */
const complianceAdmin = createComplianceAccessControl('compliance:admin');

/**
 * Middleware that requires reports:read permission
 */
const reportsRead = createComplianceAccessControl('reports:read');

/**
 * Middleware that requires reports:write permission
 */
const reportsWrite = createComplianceAccessControl('reports:write');

/**
 * Middleware that requires reports:approve permission
 */
const reportsApprove = createComplianceAccessControl('reports:approve');

/**
 * Middleware that requires gaps:read permission
 */
const gapsRead = createComplianceAccessControl('gaps:read');

/**
 * Middleware that requires gaps:write permission
 */
const gapsWrite = createComplianceAccessControl('gaps:write');

/**
 * Middleware that requires gaps:admin permission
 */
const gapsAdmin = createComplianceAccessControl('gaps:admin');

/**
 * Get all available compliance roles
 * @returns {Object}
 */
function getComplianceRoles() {
  return Object.entries(COMPLIANCE_ROLES).reduce((acc, [id, role]) => {
    acc[id] = {
      id,
      name: role.name,
      permissions: role.permissions
    };
    return acc;
  }, {});
}

/**
 * Get permissions for a role
 * @param {string} role
 * @returns {Array|null}
 */
function getRolePermissions(role) {
  return COMPLIANCE_ROLES[role]?.permissions || null;
}

module.exports = {
  COMPLIANCE_ROLES,
  checkPermission,
  createComplianceAccessControl,
  getComplianceRoles,
  getRolePermissions,
  // Pre-configured middleware
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
