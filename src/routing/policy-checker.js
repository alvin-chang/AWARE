/**
 * ADR-011: Phase 2.3 — Policy Compliance Checker
 * 
 * Checks for policy violations before pheromone reinforcement.
 * Per ADR-011 §Security Gate Specification.
 * 
 * @module routing/policy-checker
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

// ============================================================================
// Constants
// ============================================================================

/**
 * Violation severity levels per ADR-011 §Violation Severity Levels.
 */
const VIOLATION_SEVERITY = {
  CRITICAL: 1.0,  // Security breach, data theft — τ → τ_min, immediate revocation
  HIGH: 0.8,       // Policy violation, unauthorized access — τ → τ × 0.1
  MEDIUM: 0.5,    // Minor policy deviation — τ → τ × 0.5
  LOW: 0.0         // Technical violation (no harm) — warning only
};

/**
 * Violation type descriptions.
 */
const VIOLATION_TYPES = {
  UNAUTHORISED_TOOL_ACCESS: 'unauthorised_tool_access',
  DATA_EXFILTRATION: 'data_exfiltration',
  PROMPT_INJECTION: 'prompt_injection',
  PRIVILEGE_ESCALATION: 'privilege_escalation',
  RATE_LIMIT_VIOLATION: 'rate_limit_violation',
  POLICY_BYPASS: 'policy_bypass',
  UNKNOWN: 'unknown'
};

// ============================================================================
// Security Gate Result
// ============================================================================

/**
 * @typedef {Object} SecurityGateResult
 * @property {boolean} passed - Whether security gate passed
 * @property {string[]} reasons - Reasons if failed
 * @property {boolean} contentFilterPassed - Content filter check
 * @property {string[]} policyViolations - List of violation types
 * @property {boolean} dataLeakageDetected - Data leakage check
 * @property {boolean} toolAuthPassed - Tool authorisation check
 * @property {number} maxSeverity - Maximum severity level of violations
 */

// ============================================================================
// Policy Compliance Checker
// ============================================================================

/**
 * Check for policy violations.
 * 
 * @param {Object} params
 * @param {string} params.taskId - Task identifier
 * @param {string} params.agentId - Agent identifier
 * @param {Object[]} [params.toolCalls] - Tool calls made during task
 * @param {Object[]} [params.resourceUsage] - Resource usage metrics
 * @param {Object} [params.policyEngine] - Policy engine (if available)
 * @returns {SecurityGateResult}
 */
function checkPolicyCompliance(params) {
  const { taskId, agentId, toolCalls = [], resourceUsage = {} } = params;
  
  const violations = [];
  const reasons = [];
  let maxSeverity = 0;
  
  // Check 1: Content filter
  const contentFilterPassed = checkContentFilter(params);
  if (!contentFilterPassed) {
    violations.push(VIOLATION_TYPES.PROMPT_INJECTION);
    reasons.push('Content filter detected policy violation');
  }
  
  // Check 2: Tool authorisation
  const toolAuthPassed = checkToolAuthorisation(params);
  if (!toolAuthPassed) {
    violations.push(VIOLATION_TYPES.UNAUTHORISED_TOOL_ACCESS);
    reasons.push('Unauthorized tool access detected');
    maxSeverity = Math.max(maxSeverity, VIOLATION_SEVERITY.HIGH);
  }
  
  // Check 3: Data leakage
  const dataLeakageDetected = checkDataLeakage(params);
  if (dataLeakageDetected) {
    violations.push(VIOLATION_TYPES.DATA_EXFILTRATION);
    reasons.push('Data exfiltration attempt detected');
    maxSeverity = Math.max(maxSeverity, VIOLATION_SEVERITY.CRITICAL);
  }
  
  // Check 4: Rate limiting
  const rateLimitPassed = checkRateLimiting(params);
  if (!rateLimitPassed) {
    violations.push(VIOLATION_TYPES.RATE_LIMIT_VIOLATION);
    reasons.push('Rate limit exceeded');
    maxSeverity = Math.max(maxSeverity, VIOLATION_SEVERITY.MEDIUM);
  }
  
  // Check 5: Privilege escalation
  const privilegePassed = checkPrivilegeEscalation(params);
  if (!privilegePassed) {
    violations.push(VIOLATION_TYPES.PRIVILEGE_ESCALATION);
    reasons.push('Privilege escalation detected');
    maxSeverity = Math.max(maxSeverity, VIOLATION_SEVERITY.CRITICAL);
  }
  
  // Determine overall pass/fail
  const passed = violations.length === 0;
  
  return {
    passed,
    reasons,
    contentFilterPassed,
    policyViolations: violations,
    dataLeakageDetected,
    toolAuthPassed,
    maxSeverity
  };
}

/**
 * Check content filter / prompt injection.
 * 
 * @param {Object} params
 * @returns {boolean}
 */
function checkContentFilter(params) {
  // Placeholder: integrate with content filter service
  // For now, always pass unless data leakage detected
  return true;
}

/**
 * Check tool authorisation.
 * 
 * @param {Object} params
 * @param {Object[]} [params.toolCalls]
 * @returns {boolean}
 */
function checkToolAuthorisation(params) {
  // Placeholder: integrate with policy engine
  // For now, check if tool calls are from allowlist
  const { toolCalls = [], agentId } = params;
  
  // If no tool calls, always pass
  if (toolCalls.length === 0) {
    return true;
  }
  
  // TODO: Integrate with actual policy engine
  // For now, allow all tool calls
  return true;
}

/**
 * Check for data leakage / exfiltration.
 * 
 * @param {Object} params
 * @returns {boolean}
 */
function checkDataLeakage(params) {
  // Placeholder: integrate with DLP service
  // Check for large outbound data transfers, sensitive data in responses, etc.
  const { resourceUsage = {} } = params;
  
  // Check for explicit data leakage indicator
  if (resourceUsage.dataLeakage === true) {
    return true;
  }
  
  // TODO: Add more sophisticated checks:
  // - Large outbound data transfers (> threshold)
  // - Sensitive data patterns in responses
  // - Unauthorized data exfiltration attempts
  
  return false;
}

/**
 * Check rate limiting.
 * 
 * @param {Object} params
 * @param {Object} [params.resourceUsage]
 * @returns {boolean}
 */
function checkRateLimiting(params) {
  // Placeholder: check rate limit counters
  const { resourceUsage = {} } = params;
  
  // If no rate limiting data, pass
  if (!resourceUsage.rateLimitHits) {
    return true;
  }
  
  return resourceUsage.rateLimitHits < 3;
}

/**
 * Check privilege escalation.
 * 
 * @param {Object} params
 * @returns {boolean}
 */
function checkPrivilegeEscalation(params) {
  // Placeholder: check for elevation attempts
  return true;
}

// ============================================================================
// Violation Severity Mapping
// ============================================================================

/**
 * Map violation type to severity level.
 * 
 * @param {string} violationType
 * @returns {number}
 */
function getViolationSeverity(violationType) {
  return VIOLATION_SEVERITY[violationType.toUpperCase()] ?? VIOLATION_SEVERITY.LOW;
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Constants
  VIOLATION_SEVERITY,
  VIOLATION_TYPES,
  
  // Core functions
  checkPolicyCompliance,
  getViolationSeverity,
  
  // Individual checks (for testing)
  checkContentFilter,
  checkToolAuthorisation,
  checkDataLeakage,
  checkRateLimiting,
  checkPrivilegeEscalation
};
