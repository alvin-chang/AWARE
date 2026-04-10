/**
 * AWARE-SAMARITAN Implementation
 *
 * T0-T4 constraint enforcement with failsafe heartbeat network.
 *
 * Design: Archimedes A1 (aware-samaritan)
 * Implementation: Forge C2 (aware-evolution-2)
 *
 * This module provides:
 * - ConstraintRegistry: T0-T4 tier hierarchy enforcement
 * - DriftCalculator: 5-indicator drift score calculation
 * - KillSwitchHub: Failsafe heartbeat coordinator
 * - SelfAwarenessLoop: Observer self-awareness cycle
 */

// Re-export all public types and classes
export {
  ConstraintTier,
  ConstraintStrength,
  type Constraint,
  type ConstraintContext,
  type Action,
  type ConstraintResult,
  T0_LAWS,
  T1_OBLIGATIONS,
  ConstraintRegistry,
  getConstraintRegistry,
} from "./constraint-registry.js";

export {
  type DriftIndicators,
  type DriftScore,
  DriftRecommendation,
  DriftCalculator,
  getDriftCalculator,
} from "./drift-calculator.js";

export {
  KillSwitchState,
  KillSwitchAction,
  type HeartbeatMessage,
  type KillSwitchStatus,
  type KillSwitchConfig,
  KillSwitchHub,
  getKillSwitchHub,
} from "./kill-switch-hub.js";

export {
  type SelfAwarenessConfig,
  type AgentTelemetry,
  type SelfAwarenessCycle,
  type CorrectionAction,
  SelfAwarenessLoop,
  getSelfAwarenessLoop,
} from "./self-awareness-loop.js";
