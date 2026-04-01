// src/emergency/index.js
// Phase 3.2: Kill Switch Propagation — Main module exports

const {
  KillSeverity,
  ShutdownProcedure,
  KillSignalState,
  KILL_SWITCH_TRIGGERS,
  GLOBAL_KILL_CANCEL_AUTHORITY,
  KillSignalEntry,
  CancelRequestEntry,
} = require('./kill-signal-entry');

const KillSwitchIssuer = require('./kill-switch-issuer');
const KillSwitchPropagator = require('./kill-switch-propagator');
const ShutdownController = require('./shutdown-controller');
const AcknowledgmentTracker = require('./ack-tracker');
const RecoveryManager = require('./recovery-manager');
const BlastRadiusEstimator = require('./blast-radius-estimator');

module.exports = {
  // Types and constants
  KillSeverity,
  ShutdownProcedure,
  KillSignalState,
  KILL_SWITCH_TRIGGERS,
  GLOBAL_KILL_CANCEL_AUTHORITY,
  KillSignalEntry,
  CancelRequestEntry,

  // Core components
  KillSwitchIssuer,
  KillSwitchPropagator,
  ShutdownController,
  AcknowledgmentTracker,
  RecoveryManager,
  BlastRadiusEstimator,
};
