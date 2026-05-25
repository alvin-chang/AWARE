/**
 * constraints/index.ts — AWARE Constraint Engine
 *
 * T0-T4 constraint enforcement for autonomous AI agents.
 * Exports the main engine and all constraint types.
 */

// Types
export type {
  AgentAction,
  AuditEntry,
  Constraint,
  ConstraintResult,
  ConstraintViolation,
  HumanApproval,
  Tier,
  TierLevel,
  TIER_LEVELS,
  ApprovedChannel,
  CryptoKeyPair,
} from './types.js';

// T0 constraints
export {
  T0ConstraintRegistry,
  NoExfiltrationConstraint,
  HumanGateConstraint,
  CryptoIdConstraint,
  AppendOnlyAuditConstraint,
} from './t0/index.js';

// Engine
export { ConstraintEngine } from './engine.js';
