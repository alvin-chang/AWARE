// src/policies/permission-model.js
// Permission Model — RBAC-based tool access control
// ADR-015: Tool Access Control & Enforcement

/**
 * RBAC Roles and Permissions
 */
const ROLES = {
  'admin': {
    inherits: [],
    allows: ['*'],  // All tools
    denies: []
  },
  'coder': {
    inherits: [],
    allows: [
      'read:workspace/*',
      'write:workspace/*',
      'exec:workspace/*',
      'read:git',
      'write:git',
      'read:api',
      'network:developer-api'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'exec:sudo'
    ]
  },
  'researcher': {
    inherits: [],
    allows: [
      'read:*',
      'network:search-api',
      'network:web-fetch',
      'write:research/*'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'exec:sudo',
      'exec:rm'
    ]
  },
  'tester': {
    inherits: [],
    allows: [
      'read:workspace/*',
      'exec:test-runner',
      'network:test-api'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'write:production/*'
    ]
  },
  'reviewer': {
    inherits: [],
    allows: [
      'read:workspace/*',
      'read:git',
      'read:api',
      'network:review-api'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'write:*',
      'exec:*'
    ]
  },
  'orchestrator': {
    inherits: [],
    allows: [
      'read:*',
      'write:*',
      'exec:workspace/*',
      'network:internal-api'
    ],
    denies: [
      'credential:*',
      'admin:*'
    ]
  }
};

/**
 * Pre-compiled patterns for performance and ReDoS prevention
 */
const ROLE_PATTERNS = {};

/**
 * Initialize pre-compiled patterns at startup
 */
function initializeRolePatterns() {
  for (const [roleName, role] of Object.entries(ROLES)) {
    ROLE_PATTERNS[roleName] = {
      allows: compilePatterns(role.allows || []),
      denies: compilePatterns(role.denies || [])
    };
  }
}

/**
 * Compile wildcard patterns to regex objects
 * @param {string[]} patterns - Array of wildcard patterns
 * @returns {Array} Array of { original, regex } objects
 */
function compilePatterns(patterns) {
  return patterns.map(p => {
    // Pre-compilation for trusted sources only
    const regex = new RegExp(`^${p.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return { original: p, regex };
  });
}

/**
 * Safe pattern compilation with character validation
 * @param {string} pattern - Pattern to compile
 * @returns {RegExp} Compiled regex
 */
function safeCompilePattern(pattern) {
  // F-3 FIX: Validate against allowlist of known-safe pattern characters
  if (!/^[\w\/\:\*\?\-\.]+$/.test(pattern)) {
    throw new Error(`INVALID_PATTERN: potentially malicious characters in "${pattern}"`);
  }
  return new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/**
 * Evaluate permission for agent role and tool
 * @param {string} agentRole - Agent's role
 * @param {string} requestedTool - Requested tool ID
 * @param {Object} requestedParams - Request parameters (for future use)
 * @returns {Object} { allowed: boolean, reason: string, rule: string }
 */
function evaluatePermission(agentRole, requestedTool, requestedParams = {}) {
  // Initialize patterns if not done
  if (Object.keys(ROLE_PATTERNS).length === 0) {
    initializeRolePatterns();
  }

  const role = ROLE_PATTERNS[agentRole];

  if (!role) {
    return { allowed: false, reason: 'ROLE_NOT_FOUND', rule: null };
  }

  // Check denies first (whitelist approach)
  for (const { original, regex } of role.denies) {
    if (regex.test(requestedTool)) {
      return { allowed: false, reason: 'DENIED_BY_ROLE', rule: original };
    }
  }

  // Check allows
  for (const { original, regex } of role.allows) {
    if (regex.test(requestedTool)) {
      return { allowed: true, reason: 'ALLOWED_BY_ROLE', rule: original };
    }
  }

  return { allowed: false, reason: 'NOT_IN_ALLOW_LIST', rule: null };
}

/**
 * Check if agent role exists
 * @param {string} role - Role name
 * @returns {boolean}
 */
function roleExists(role) {
  return ROLES.hasOwnProperty(role);
}

/**
 * Get role definition
 * @param {string} role - Role name
 * @returns {Object|null}
 */
function getRole(role) {
  return ROLES[role] || null;
}

/**
 * Get all roles
 * @returns {Object}
 */
function getAllRoles() {
  return { ...ROLES };
}

// Initialize patterns on module load
initializeRolePatterns();

module.exports = {
  ROLES,
  ROLE_PATTERNS,
  evaluatePermission,
  roleExists,
  getRole,
  getAllRoles,
  initializeRolePatterns,
  compilePatterns,
  safeCompilePattern
};
