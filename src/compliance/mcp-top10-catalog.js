// SPDX-License-Identifier: Apache-2.0
// src/compliance/mcp-top10-catalog.js
// OWASP MCP Top 10 (2025) — static control catalogue shipped with AWARE.
//
// Per ADR-051, the catalogue is a versioned JSON-style JS module so the
// control claim is reproducible across re-deploys (no live URL fetch).
// The risk-class descriptions and severity strings are pinned to OWASP
// MCP Top 10 (2025) per the upstream project at
// https://github.com/OWASP/www-project-mcp-top-10 (commit
// 1b369f3270be0fc09f8d406537ec9a2195ca2e6a, 2026-07-19 fetch).
//
// This file is the source-of-truth for MCP Top 10 controls surfaced through:
//   - src/compliance/framework-mapper.js  (OWASP_MCP_TOP_10 framework block)
//   - docs/compliance/mcp-top-10.md  (coverage claim)
//
// Per-rule annotations are NOT in this file — they live in
// src/compliance/mcp-top10-classifier.js (separate kanban card).
//
// A bump to MCP Top 10 v.next (or any other minor/patch revision) must be
// a new AWARE release and a new catalogue file (e.g. mcp-top10-catalog-vnext.js)
// per ADR-051 §"Failure modes" → "upstream renumbers or rewrites a risk class".

'use strict';

/**
 * @typedef {Object} MCP10CatalogEntry
 * @property {string} name        - short risk-class name
 * @property {string} severity    - 'Critical' | 'High' | 'Medium'
 * @property {string} description - one-sentence first-party characterization
 *                                  (AWARE voice; not verbatim upstream prose,
 *                                  per AGENTS.md §2).
 */

/**
 * MCP Top 10 (2025) — 10 risk classes.
 *
 * Field provenance:
 *   - name / severity     → upstream README + per-class .md.
 *   - description         → first-party AWARE characterization (per AGENTS.md §2;
 *                           upstream prose is CC-BY-NC-SA 4.0 and not shipped verbatim).
 *
 * DO NOT invent new control IDs. If a new MCP Top 10 release renumbers or
 * adds a class, create a new catalogue version per ADR-051 §"Failure modes".
 *
 * @type {Object<string, MCP10CatalogEntry>}
 */
const MCP_TOP_10_CONTROLS = Object.freeze({
  'MCP01': {
    name: 'Token Mismanagement & Secret Exposure',
    severity: 'Critical',
    description: 'Long-lived bearer tokens, env-var secrets, MCP-config credentials, and prompt-template secrets persist across sessions and tool calls, allowing an attacker with low-privilege model access to escalate by reading the agent\u0027s own credential surface.'
  },
  'MCP02': {
    name: 'Tool / Function Misuse',
    severity: 'High',
    description: 'Tools invoked under legitimate protocol context are used for purposes outside their declared scope (scope creep), either through crafted parameters or by chaining calls across boundaries the tool author did not anticipate.'
  },
  'MCP03': {
    name: 'Excessive Agency & Privilege',
    severity: 'High',
    description: 'An MCP server or tool is granted permissions broader than its function requires (read-write when read-only suffices, host-FS when sandbox-suffices, network-egress when local-suffices), so a compromise of that surface has outsized blast radius.'
  },
  'MCP04': {
    name: 'Indirect Prompt Injection',
    severity: 'Critical',
    description: 'Untrusted content fetched by an MCP tool (resources/read, sampling, web fetches) embeds instructions that the model follows, because the agent does not separate data from instructions at the protocol boundary.'
  },
  'MCP05': {
    name: 'Command Injection & Execution',
    severity: 'High',
    description: 'Tool parameters or MCP resource payloads are evaluated as code (shell, eval, template render) without an isolation boundary, allowing an attacker to break out of the agent\u0027s intended execution surface.'
  },
  'MCP06': {
    name: 'Context Window & Memory Poisoning',
    severity: 'High',
    description: 'MCP resources, sampling messages, or sub-agent context contributions are written into the agent\u0027s working memory without provenance, so a single poisoned read or sampling call can persist across the entire session.'
  },
  'MCP07': {
    name: 'Supply Chain (Servers / Plugins)',
    severity: 'High',
    description: 'MCP servers, plugins, or transport adapters are installed without content-hash pinning, publisher-key verification, or transitive-dependency review, so a compromised upstream becomes a compromised agent surface.'
  },
  'MCP08': {
    name: 'Authentication & Identity',
    severity: 'High',
    description: 'MCP session establishment, capability tokens, or per-call authZ lack mutual authentication, replay protection, or audience-binding, so a stolen or replayed credential is accepted as the legitimate caller.'
  },
  'MCP09': {
    name: 'Shadow MCP Servers',
    severity: 'Medium',
    description: 'Tool calls land on MCP server instances that are not on the registered allowlist — either bypassed entirely or registered under a name diverging from the canonical transport identity.'
  },
  'MCP10': {
    name: 'Untrusted / Cross-Session Context',
    severity: 'Medium',
    description: 'MCP context (resources, sampling, elicitation) is shared across sessions or with other agents without an explicit trust boundary, so a context poisoned in one session is consumed by another as if it were trusted.'
  }
});

/**
 * @type {string[]}
 */
const MCP_TOP_10_CONTROL_IDS = Object.freeze(Object.keys(MCP_TOP_10_CONTROLS));

module.exports = {
  MCP_TOP_10_CONTROLS,
  MCP_TOP_10_CONTROL_IDS
};
