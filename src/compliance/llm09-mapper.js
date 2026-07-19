// SPDX-License-Identifier: Apache-2.0
// src/compliance/llm09-mapper.js
//
// LLM09:2025 (Misinformation) — review-loop mapper. Per ADR-050 §5 GAP-6.
//
// This mapper is the WRITE side of the LLM09:2025 review-loop. It:
//   1. Reads a model-output event from the decision chain.
//   2. Optionally runs the output-confidence heuristic
//      (src/policies/output-confidence.js) to flag low-confidence claims.
//   3. Emits a `review_required` annotation event on the chain, with
//      `parentDecisionId` pointing at the source model-output event.
//   4. Provides a `resolveReview()` API that emits a follow-up
//      `review_required_resolved` annotation chained to the original
//      `review_required` decision. The chain topology
//      (review_required -> review_required_resolved) is what the
//      /api/compliance/llm-top-10/misinformation-review route reads to
//      derive `status=open|resolved`.
//
// Contract (mirrors ADR-043 §"Contract"):
//   - READ-ONLY on the input event.
//   - WRITE-ONLY on the annotation chain (via decision-logger.logDecision).
//   - NOT a scanner, NOT a policy decision point.
//   - Per ADR-040 fail-open contract: a logDecision failure MUST NOT
//     block the originating tool call.
//
// Audit chain integrity (per ADR-049 §4):
//   - Each `review_required` annotation chains via `parentDecisionId`
//     back to the source model-output event.
//   - Each `review_required_resolved` annotation chains via
//     `parentDecisionId` back to the `review_required` it resolves.
//   - The mapper does NOT modify existing records.
//
// Gating (per body spec + ADR-050 §5 GAP-6):
//   - AWARE_LLM09_DETECTION_ENABLED controls the heuristic. When false,
//     callers must pass an explicit `forceReview: true` to write a
//     `review_required` event. This lets operators wire the route
//     without enabling auto-detection.
//   - The mapper itself always writes annotations (no writes-side gating)
//     — gating lives on the detection side, per the AST10 mapper pattern.

'use strict';

const crypto = require('crypto');
const {
  isDetectionEnabled,
  evaluate,
  primaryRule,
  confidenceScore,
  HEURISTIC_VERSION
} = require('../policies/output-confidence');

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MAPPER_NAME = 'llm09-mapper';
const MAPPER_VERSION = '0.1.0';
const ACTION_TYPE_REVIEW_REQUIRED = 'review_required';
const ACTION_TYPE_REVIEW_RESOLVED = 'review_required_resolved';

// ----------------------------------------------------------------------------
// Heuristic trigger-source mapping (matches the body spec)
// ----------------------------------------------------------------------------

const TRIGGER_SOURCES = {
  LLM09_2025_FACTUAL_CONFLICT: 'LLM09_2025_FACTUAL_CONFLICT',
  LLM09_2025_CITATION_MISSING: 'LLM09_2025_CITATION_MISSING',
  LLM09_2025_UNSUPPORTED_ENTITY: 'LLM09_2025_UNSUPPORTED_ENTITY',
  LLM09_2025_RELATIVE_DATE: 'LLM09_2025_RELATIVE_DATE',
  LLM09_2025_LOW_CONFIDENCE: 'LLM09_2025_LOW_CONFIDENCE',
  LLM09_2025_MANUAL: 'LLM09_2025_MANUAL'
};

// ----------------------------------------------------------------------------
// generateUUID
// ----------------------------------------------------------------------------

function generateUUID() {
  return crypto.randomUUID();
}

// ----------------------------------------------------------------------------
// JSDoc types
// ----------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewAnnotation
 * @property {string} eventType           - 'review_required'
 * @property {string} sourceDecisionId    - decisionId of the source event
 * @property {string} triggerSource       - TRIGGER_SOURCES[rule] discriminator
 * @property {number} confidenceScore     - 0.0–1.0 (1.0 = highest confidence)
 * @property {string} outputHash          - SHA-256 of the source output text
 * @property {string} agentId             - the agent that produced the output
 * @property {string} decisionId          - the annotation's own decisionId
 * @property {string} [parentDecisionId]  - the source event's decisionId
 * @property {string} timestamp           - ISO 8601
 * @property {Array}  concerns            - raw concerns array from the heuristic
 * @property {string} heuristicVersion    - output-confidence.js version
 */

/**
 * @typedef {Object} ResolvedAnnotation
 * @property {string} eventType           - 'review_required_resolved'
 * @property {string} sourceDecisionId    - decisionId of the review_required
 * @property {string} resolvedBy          - operator agentId / 'system'
 * @property {string} resolution          - free-text resolution note
 * @property {string} decisionId          - the resolution's own decisionId
 * @property {string} parentDecisionId    - review_required decisionId
 * @property {string} timestamp           - ISO 8601
 */

// ----------------------------------------------------------------------------
// computeOutputHash — SHA-256 of the model output text
// ----------------------------------------------------------------------------

function computeOutputHash(text) {
  if (typeof text !== 'string') {
    return null;
  }
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ----------------------------------------------------------------------------
// Build a decision-chain record for a `review_required` annotation.
// ----------------------------------------------------------------------------

function buildReviewRecord({ review, actor }) {
  return {
    decisionId: review.decisionId,
    parentDecisionId: review.parentDecisionId,
    timestamp: review.timestamp,
    actor: actor || {
      agentId: review.agentId || MAPPER_NAME,
      trustScore: 1.0
    },
    action: {
      type: ACTION_TYPE_REVIEW_REQUIRED,
      target: review.triggerSource,
      reason: review.triggerSource,
      annotation: review
    },
    context: {
      pheromoneScores: {},
      heuristicWeights: {},
      policyId: MAPPER_NAME,
      policyVersion: MAPPER_VERSION
    },
    outcome: {
      success: true,
      latencyMs: 0,
      errorMessage: null
    }
  };
}

// ----------------------------------------------------------------------------
// Build a decision-chain record for a `review_required_resolved` annotation.
// ----------------------------------------------------------------------------

function buildResolvedRecord({ resolved, actor }) {
  return {
    decisionId: resolved.decisionId,
    parentDecisionId: resolved.parentDecisionId,
    timestamp: resolved.timestamp,
    actor: actor || {
      agentId: resolved.resolvedBy || 'system',
      trustScore: 1.0
    },
    action: {
      type: ACTION_TYPE_REVIEW_RESOLVED,
      target: resolved.sourceDecisionId,
      reason: resolved.resolution || 'resolved',
      annotation: resolved
    },
    context: {
      pheromoneScores: {},
      heuristicWeights: {},
      policyId: MAPPER_NAME,
      policyVersion: MAPPER_VERSION
    },
    outcome: {
      success: true,
      latencyMs: 0,
      errorMessage: null
    }
  };
}

// ----------------------------------------------------------------------------
// emitReviewRequired — write a `review_required` annotation to the chain.
// ----------------------------------------------------------------------------

/**
 * Emit a `review_required` annotation. Returns the annotation on success;
 * returns null on failure (fail-open).
 *
 * @param {Object} args
 * @param {Object} args.auditLogger       - decision-logger instance (with logDecision)
 * @param {string} args.sourceDecisionId  - source model-output event's decisionId
 * @param {string} args.agentId           - agent that produced the output
 * @param {string} [args.outputText]      - the model output text (used to hash + score)
 * @param {string} [args.outputHash]      - explicit hash (skips computeOutputHash)
 * @param {Array}  [args.concerns]        - pre-computed concerns (skips heuristic)
 * @param {string} [args.triggerSource]   - explicit trigger (skips heuristic)
 * @param {number} [args.confidenceScore] - explicit score (skips heuristic)
 * @param {boolean} [args.forceReview]    - skip env-var gating; required when
 *                                          outputText is not supplied
 * @param {string} [args.timestamp]       - ISO 8601 (defaults to now)
 * @param {Object} [args.actor]           - { agentId, trustScore }
 * @returns {Promise<ReviewAnnotation|null>}
 */
async function emitReviewRequired(args) {
  if (!args || !args.auditLogger || typeof args.auditLogger.logDecision !== 'function') {
    return null;
  }
  const sourceDecisionId = args.sourceDecisionId;
  if (!sourceDecisionId) {
    throw new Error('emitReviewRequired: sourceDecisionId is required');
  }

  const timestamp = args.timestamp || new Date().toISOString();
  let concerns = Array.isArray(args.concerns) ? args.concerns : null;
  let trigger = args.triggerSource || null;
  let score = (typeof args.confidenceScore === 'number') ? args.confidenceScore : null;
  let outputHash = args.outputHash || null;

  if (!concerns || !trigger || score === null || !outputHash) {
    // Need the heuristic to fill missing fields. The heuristic is gated
    // by AWARE_LLM09_DETECTION_ENABLED — when off, callers MUST pass
    // explicit values or forceReview.
    const enabled = isDetectionEnabled();
    if (!enabled && !args.forceReview) {
      return null;
    }
    if (typeof args.outputText !== 'string') {
      // Cannot run heuristic without text; nothing to fill.
      if (!args.forceReview) return null;
      // forceReview path: caller didn't supply all fields. Reject so the
      // caller knows to be explicit.
      throw new Error(
        'emitReviewRequired: outputText missing and concerns/triggerSource/' +
        'confidenceScore/outputHash not all supplied; provide them or use ' +
        'forceReview with explicit values'
      );
    }
    if (!outputHash) outputHash = computeOutputHash(args.outputText);
    if (!concerns) concerns = evaluate({ text: args.outputText });
    if (!trigger) trigger = primaryRule(concerns) || TRIGGER_SOURCES.LLM09_2025_LOW_CONFIDENCE;
    if (score === null) score = confidenceScore(concerns);
  }

  // Normalize the trigger to one of the known values. Caller-provided
  // triggers that aren't in the catalogue get through anyway — the
  // canonical set is a contract for the mapper's own detection, not a
  // whitelist for callers.
  if (!TRIGGER_SOURCES[trigger] && !Object.values(TRIGGER_SOURCES).includes(trigger)) {
    // Unknown caller-provided trigger — keep as-is, but flag with
    // LLM09_2025_MANUAL so downstream readers can see it's not heuristic.
    trigger = args.triggerSource || TRIGGER_SOURCES.LLM09_2025_MANUAL;
  }

  const review = {
    eventType: ACTION_TYPE_REVIEW_REQUIRED,
    sourceDecisionId,
    decisionId: generateUUID(),
    parentDecisionId: sourceDecisionId,
    timestamp,
    triggerSource: trigger,
    confidenceScore: score,
    outputHash,
    agentId: args.agentId || 'unknown',
    concerns: concerns || [],
    heuristicVersion: HEURISTIC_VERSION
  };

  const record = buildReviewRecord({ review, actor: args.actor });

  try {
    await args.auditLogger.logDecision(record);
    // The real decision-logger mutates record.hash in place; read it back.
    return {
      ...review,
      hash: record.hash || null
    };
  } catch (err) {
    // Fail-open: drop the annotation, do not throw.
    // eslint-disable-next-line no-console
    console.warn(`[llm09-mapper] dropped review_required for ${sourceDecisionId}: ${err.message}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// resolveReview — emit a `review_required_resolved` child annotation.
// ----------------------------------------------------------------------------

/**
 * Resolve a previously-emitted `review_required` annotation by writing a
 * child `review_required_resolved` annotation on the chain. The audit chain
 * remains append-only; the resolution is a new record that points back at
 * the review via parentDecisionId. The /api/compliance/llm-top-10/misinformation-review
 * route derives `status=resolved` from this chain topology.
 *
 * @param {Object} args
 * @param {Object} args.auditLogger            - decision-logger instance
 * @param {string} args.reviewDecisionId       - the review_required annotation's decisionId
 * @param {string} [args.resolvedBy]           - operator agentId
 * @param {string} [args.resolution]           - free-text resolution note
 * @param {string} [args.timestamp]            - ISO 8601 (defaults to now)
 * @param {Object} [args.actor]                - { agentId, trustScore }
 * @returns {Promise<ResolvedAnnotation|null>}
 */
async function resolveReview(args) {
  if (!args || !args.auditLogger || typeof args.auditLogger.logDecision !== 'function') {
    return null;
  }
  const reviewDecisionId = args.reviewDecisionId;
  if (!reviewDecisionId) {
    throw new Error('resolveReview: reviewDecisionId is required');
  }

  const resolved = {
    eventType: ACTION_TYPE_REVIEW_RESOLVED,
    sourceDecisionId: reviewDecisionId,
    decisionId: generateUUID(),
    parentDecisionId: reviewDecisionId,
    timestamp: args.timestamp || new Date().toISOString(),
    resolvedBy: args.resolvedBy || 'system',
    resolution: args.resolution || 'resolved'
  };

  const record = buildResolvedRecord({ resolved, actor: args.actor });

  try {
    await args.auditLogger.logDecision(record);
    return {
      ...resolved,
      hash: record.hash || null
    };
  } catch (err) {
    // Fail-open: drop the resolution, do not throw.
    // eslint-disable-next-line no-console
    console.warn(`[llm09-mapper] dropped review_required_resolved for ${reviewDecisionId}: ${err.message}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// classify() — pure helper: evaluate + return a structured review.
// ----------------------------------------------------------------------------

/**
 * Evaluate a model output and (if concerns surface) return a Review
 * annotation payload WITHOUT writing it. Useful for tests and for
 * callers that want to inspect before committing to a write.
 *
 * @param {string} text
 * @param {string} sourceDecisionId
 * @param {Object} [opts]
 * @param {Date}   [opts.now]
 * @param {string[]} [opts.retrievalEntities]
 * @param {string} [opts.agentId]
 * @returns {Object|null} - the review payload, or null if no concerns
 */
function classify(text, sourceDecisionId, opts = {}) {
  if (typeof text !== 'string') return null;
  const concerns = evaluate({
    text,
    now: opts.now,
    retrievalEntities: opts.retrievalEntities
  });
  if (concerns.length === 0) return null;
  const trigger = primaryRule(concerns);
  const score = confidenceScore(concerns);
  return {
    eventType: ACTION_TYPE_REVIEW_REQUIRED,
    sourceDecisionId,
    decisionId: null, // assigned at emit time
    parentDecisionId: sourceDecisionId,
    timestamp: opts.timestamp || new Date().toISOString(),
    triggerSource: trigger,
    confidenceScore: score,
    outputHash: computeOutputHash(text),
    agentId: opts.agentId || 'unknown',
    concerns,
    heuristicVersion: HEURISTIC_VERSION
  };
}

// ----------------------------------------------------------------------------
// classifyAndLog() — convenience: classify + logDecision (fail-open)
// ----------------------------------------------------------------------------

/**
 * @param {string} text
 * @param {string} sourceDecisionId
 * @param {Object} auditLogger
 * @param {Object} [opts]
 * @returns {Promise<ReviewAnnotation|null>}
 */
async function classifyAndLog(text, sourceDecisionId, auditLogger, opts = {}) {
  const review = classify(text, sourceDecisionId, opts);
  if (!review) return null;
  if (!isDetectionEnabled() && !opts.forceReview) return null;
  return emitReviewRequired({
    auditLogger,
    sourceDecisionId,
    agentId: opts.agentId,
    outputText: text,
    forceReview: opts.forceReview,
    actor: opts.actor,
    timestamp: opts.timestamp
  });
}

// ----------------------------------------------------------------------------
// Module exports
// ----------------------------------------------------------------------------

module.exports = {
  // Constants
  MAPPER_NAME,
  MAPPER_VERSION,
  ACTION_TYPE_REVIEW_REQUIRED,
  ACTION_TYPE_REVIEW_RESOLVED,
  TRIGGER_SOURCES,

  // Core API
  emitReviewRequired,
  resolveReview,
  classify,
  classifyAndLog,

  // Lower-level helpers (exposed for testability)
  buildReviewRecord,
  buildResolvedRecord,
  computeOutputHash,
  generateUUID
};
