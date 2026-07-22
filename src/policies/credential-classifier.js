// SPDX-License-Identifier: Apache-2.0
// src/policies/credential-classifier.js
//
// CREDENTIAL-CLASSIFIER PLACEHOLDER
// =================================
//
// This file is a placeholder that exists ONLY to unblock the coordinator
// shell (`src/coordinator/index.js`) which re-exports the credential
// classifier's public surface (`classify`, `redact`, `buildDecisionRecord`,
// `CLASSIFIER_VERSION`) per APTS-MR-019 / ADR-049 §5.
//
// Per the original coder run's commit message (ef4730e) and the
// coordinator `tool-observation-proxy.js` at line 525, the real
// implementation is owned by a separate kanban card and was not
// landed alongside the MCP adapter work. Until that card ships:
//
//   - The stub functions return identity-shaped values (no-op classify,
//     pass-through redact, no-op buildDecisionRecord, version
//     "0.0.0-stub"). The coordinator shell can be imported without
//     triggering `ERR_MODULE_NOT_FOUND` for downstream tooling (tests,
//     MCP adapter wiring, the rebrand + AST10 features that import
//     from src/coordinator/index.js).
//   - The stub is clearly marked (see CLASSIFIER_VERSION) so any tool
//     that ingests classifier output can detect the placeholder state.
//   - When the real credential-classifier lands, this file should be
//     REPLACED (not patched) — the public-API contract is fixed by
//     tool-observation-proxy.js line 525 (`require('./credential-classifier').CLASSIFIER_VERSION`).
//
// This stub is local to the MCP adapter wiring work; it does NOT
// belong in any production release. The companion comment on the MCP
// adapter card (t_cc0b54c2) surfaces this as a follow-up.

'use strict';

// NOTE: this module is consumed by the ESM coordinator at
// src/coordinator/index.js (named imports: `classify`, `redact`,
// `buildDecisionRecord`, `CLASSIFIER_VERSION`). Per the prior coder
// run (83d40f4) the host dynamic-import test passed because Node
// treats `.js` as ESM under the project's `"type": "module"` package
// boundary — but the *in-image* load failed because the runtime
// package.json (`{"type":"module","name":"aware-coordinator",...}`,
// written by Dockerfile line 196) re-classifies the module as ESM,
// rejecting `module.exports = {...}`. Use ESM `export` syntax so the
// same source satisfies both load paths.

export const CLASSIFIER_VERSION = '0.0.0-stub';

/**
 * Classify a tool-output payload for credential-bearing content.
 *
 * @param {*} _payload
 * @returns {{ classifications: Array<{ kind: string, span: [number, number] }>, version: string }}
 */
export function classify(_payload) {
  return { classifications: [], version: CLASSIFIER_VERSION };
}

/**
 * Redact credential-bearing spans from a payload. Pass-through in the
 * stub.
 *
 * @param {*} payload
 * @returns {*}
 */
export function redact(payload) {
  return payload;
}

/**
 * Build a DecisionRecord for a classifier finding. No-op in the stub.
 *
 * @param {Object} _finding
 * @param {Object} _actor
 * @returns {Object|null}
 */
export function buildDecisionRecord(_finding, _actor) {
  return null;
}