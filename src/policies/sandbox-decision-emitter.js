// SPDX-License-Identifier: Apache-2.0
// src/policies/sandbox-decision-emitter.js
//
// OWASP AST06 — sandbox-policy decision source event emitter.
// Per ADR-048 §4 (AWARE AST10 Coverage and Verification Contract).
//
// ADR-048 §4 says:
//   "Route sandbox policy decisions through `ToolObservationProxy` as
//    first-class source events before execution. ... Add mapper rule
//    `sandbox-boundary-violation` only for a denied boundary crossing
//    or a verified requested/effective isolation mismatch."
//
// The mapper-side rule (Rule 8 in src/compliance/ast10-mapper.js)
// consumes `sandbox_policy_decision` source events. This module is the
// producer side: any sandbox-policy module (Docker seccomp profile,
// Linux namespace gate, gVisor runtime, etc.) calls
// `recordSandboxDecision` with its decision, and we:
//   1. Build the canonical `sandbox_policy_decision` source event.
//   2. Pass it through the AST10 mapper via the proxy's annotation
//      path so the chain carries the source event + the AST06
//      annotation(s).
//
// Two responsibilities live in different places on purpose:
//   - The proxy's existing AST10 hook (line ~184-227 of
//     src/policies/tool-observation-proxy.js) annotates
//     `tool_observation` events produced by the proxy itself. Sandbox
//     policy decisions happen BEFORE execution and from a different
//     caller (the sandbox policy module), so they take a separate path.
//   - The sandbox policy itself retains its configured fail policy. This
//     emitter never blocks a sandbox decision; it only writes the
//     observation + annotation(s) to the chain. If the annotation path
//     fails, the source event is still preserved (the mapper writes the
//     source record first, then the annotation; a failure on annotation
//     drops the annotation, never the source — ADR-040 / ADR-043
//     fail-open contract).

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Source-event builder — the mapper's Rule 8 reads the following fields:
//   action.type                   === 'sandbox_policy_decision'
//   action.toolId                 (optional)
//   action.target                 (optional)
//   action.reason                 (optional; if it starts with
//                                  'AWARE_SANDBOX_DENY:' the rule fires
//                                  even when outcome.success=true)
//   action.parameters             {
//     sandboxProfile,
//     requestedNamespace,
//     effectiveNamespace,
//     allowMismatch:bool,         // if true, mismatch is intentional
//     hostEscapeCapabilities:[],
//     ...anything else the caller wants preserved
//   }
//   outcome.success               bool
//   outcome.errorMessage          string (if denied, starts with
//                                  'AWARE_SANDBOX_DENY:')
// ---------------------------------------------------------------------------

/**
 * Build a sandbox-policy-decision source event. Pure function; no I/O.
 *
 * @param {Object} input
 * @param {string} input.toolId              - tool the sandbox decision gates (or '*' for cross-tool)
 * @param {string} [input.target]            - optional target
 * @param {Object} input.parameters          - sandbox params (profile, namespaces, capabilities)
 * @param {boolean} input.allowed            - the sandbox policy's decision
 * @param {string} [input.reason]            - human-readable reason; if denied, MUST start with 'AWARE_SANDBOX_DENY:'
 * @param {Object} input.actor               - { agentId, role, trustScore }
 * @returns {Object} a DecisionRecord-shaped event with
 *                   action.type === 'sandbox_policy_decision'
 */
function buildSandboxPolicyDecisionEvent(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('buildSandboxPolicyDecisionEvent: input is required');
  }
  if (typeof input.allowed !== 'boolean') {
    throw new Error("buildSandboxPolicyDecisionEvent: input.allowed (boolean) is required");
  }
  if (!input.parameters || typeof input.parameters !== 'object') {
    throw new Error('buildSandboxPolicyDecisionEvent: input.parameters is required');
  }
  if (!input.actor || typeof input.actor.agentId !== 'string') {
    throw new Error("buildSandboxPolicyDecisionEvent: input.actor.agentId is required");
  }

  // The mapper's Rule 8 fires when outcome.errorMessage OR
  // action.reason starts with 'AWARE_SANDBOX_DENY:'. We normalize here
  // so callers can supply either a boolean decision or a prefixed
  // reason — both reach the rule consistently.
  const reasonPrefix = 'AWARE_SANDBOX_DENY:';
  const reason = typeof input.reason === 'string' ? input.reason : '';
  const denied = !input.allowed || reason.startsWith(reasonPrefix);

  return {
    decisionId: 'sbx-' + crypto.randomUUID(),
    parentDecisionId: null,
    timestamp: new Date().toISOString(),
    actor: {
      agentId: input.actor.agentId,
      role: input.actor.role || null,
      trustScore: (typeof input.actor.trustScore === 'number') ? input.actor.trustScore : null
    },
    action: {
      type: 'sandbox_policy_decision',
      toolId: input.toolId || '*',
      target: input.target || null,
      reason: denied ? (reason.startsWith(reasonPrefix) ? reason : reasonPrefix + ' ' + (reason || 'denied by sandbox policy')) : (reason || 'allowed by sandbox policy'),
      parameters: input.parameters
    },
    context: {
      pheromoneScores: {},
      heuristicWeights: {},
      policyId: input.parameters.policyId || 'sandbox-policies',
      policyVersion: input.parameters.policyVersion || '1.0.0'
    },
    outcome: {
      success: !denied,
      latencyMs: 0,
      errorMessage: denied ? (reason.startsWith(reasonPrefix) ? reason : reasonPrefix + ' ' + (reason || 'denied')) : null
    }
  };
}

// ---------------------------------------------------------------------------
// createSandboxDecisionEmitter — wires the producer to the proxy + mapper.
//
// ADR-048 §4: the producer must be reachable from any sandbox policy
// module. We expose a thin object with `record()` so the policy module
// doesn't have to know about the mapper or the audit logger.
//
// @param {Object} opts
// @param {Object} opts.auditLogger           - must implement logDecision
// @param {Object} [opts.ast10Mapper]         - optional pre-built mapper;
//                                               otherwise we lazy-require
//                                               src/compliance/ast10-mapper
// @param {Function} [opts.now]               - optional clock injection
//                                               (tests); default Date.now
// @returns {{ record: (input) => Promise<{sourceEvent, annotations}> }}
// ---------------------------------------------------------------------------

function createSandboxDecisionEmitter(opts = {}) {
  if (!opts.auditLogger || typeof opts.auditLogger.logDecision !== 'function') {
    throw new Error('createSandboxDecisionEmitter: auditLogger with logDecision() is required');
  }
  // The mapper writes annotation records to ITS own audit logger (the
  // one wired at createAST10Mapper time). We MUST pass the same
  // logger through so the source event + annotation land on the same
  // chain and the mapper's writes are observable from this emitter's
  // tests / integration probes. If the caller supplies a pre-built
  // mapper they own the wiring; otherwise we lazy-create one sharing
  // our logger.
  const mapper = opts.ast10Mapper || lazyAST10Mapper(opts.auditLogger);

  async function record(input) {
    const sourceEvent = buildSandboxPolicyDecisionEvent(input);
    // Step 1: write the source event to the chain first so the AST06
    // annotation can reference it as parentDecisionId. If this write
    // fails, the caller learns immediately (the sandbox policy itself
    // may want to surface the error); the mapper's annotation path
    // never gets a chance to fire on a missing source.
    await opts.auditLogger.logDecision(sourceEvent);

    // Step 2: classify + write annotations. The mapper's Rule 8 reads
    // the sourceEvent fields and emits a single AST06 annotation when
    // the rule fires. classifyAndLog is fail-open (ADR-040); a write
    // failure drops the annotation but never throws to the caller.
    const { classifyAndLog } = require('../compliance/ast10-mapper');
    const annotations = await classifyAndLog(mapper, sourceEvent);
    return { sourceEvent, annotations };
  }

  return { record };
}

function lazyAST10Mapper(auditLogger) {
  // We can't require the mapper at module load — the mapper's
  // createAST10Mapper pulls in the bundled catalogue synchronously,
  // which would break any test that imports this emitter in isolation.
  // Lazy-create on first use instead. Pass the audit logger so the
  // mapper's writes land on the same chain as the source events we
  // emit.
  const { createAST10Mapper } = require('../compliance/ast10-mapper');
  return createAST10Mapper({ enableWrites: true, auditLogger });
}

module.exports = {
  buildSandboxPolicyDecisionEvent,
  createSandboxDecisionEmitter
};