// src/rlm/errors.js — RlmError hierarchy
//
// All errors specific to the rlm() primitive. Every RlmError carries
// `partial_tree` so callers can inspect what completed before the throw.
//
// References:
//   - SPEC.md §3.5 (error class hierarchy)
//   - ARCHITECTURE.md §8 (failure modes & recovery)

/**
 * Base class for all rlm()-specific errors.
 *
 * @property {Object|null} partial_tree - The recursion tree as it stood at throw time.
 * @property {string} run_id - UUID of the invocation that produced this error.
 */
export class RlmError extends Error {
  constructor(message, partial_tree = null, run_id = null) {
    super(message);
    this.name = 'RlmError';
    this.partial_tree = partial_tree;
    this.run_id = run_id;
  }
}

/**
 * Cost cap was hit before any usable answer was produced.
 * SPEC §3.5: caller can inspect partial_tree.
 */
export class RlmBudgetExceededError extends RlmError {
  constructor(message, partial_tree, run_id) {
    super(message, partial_tree, run_id);
    this.name = 'RlmBudgetExceededError';
  }
}

/**
 * Wall-clock cap was hit.
 * SPEC §3.5.
 */
export class RlmTimeoutError extends RlmError {
  constructor(message, partial_tree, run_id) {
    super(message, partial_tree, run_id);
    this.name = 'RlmTimeoutError';
  }
}

/**
 * REPL sandbox violation (subprocess killed for forbidden op).
 * Carries the attempted op and audit_id so the caller can cross-reference
 * ~/.openclaw/audit/rlm/security.jsonl.
 *
 * SPEC §3.5, §8.3, ARCHITECTURE.md §8 F3.
 */
export class RlmSecurityError extends RlmError {
  constructor(message, attempted_op, audit_id, partial_tree, run_id) {
    super(message, partial_tree, run_id);
    this.name = 'RlmSecurityError';
    this.attempted_op = attempted_op;
    this.audit_id = audit_id;
  }
}

/**
 * REPL subprocess crashed for a non-security reason twice in a row.
 * SPEC §3.5, ARCHITECTURE.md §8 F6-adjacent.
 */
export class RlmEnvironmentError extends RlmError {
  constructor(message, partial_tree, run_id) {
    super(message, partial_tree, run_id);
    this.name = 'RlmEnvironmentError';
  }
}

/**
 * Caller passed bad config (e.g. branching=10, missing problem).
 * Programmer error — NOT an RlmError. Do not catch with RlmError.
 * SPEC §3.5.
 */
export class RlmConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RlmConfigError';
  }
}
