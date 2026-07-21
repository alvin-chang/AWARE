// SPDX-License-Identifier: Apache-2.0
// src/compliance/ast10-catalog.js
// OWASP AST10 v1.0-2026 — static control catalogue shipped with AWARE.
//
// Per ADR-043, the catalogue is a versioned JSON-style JS module so the
// control claim is reproducible across re-deploys (no live URL fetch).
// The risk-class descriptions and severity strings are pinned to AST10
// v1.0-2026 per the upstream README at
// https://github.com/OWASP/www-project-agentic-skills-top-10.
//
// This file is the source-of-truth for AST10 controls surfaced through:
//   - src/compliance/ast10-mapper.js  (classification rules)
//   - src/compliance/framework-mapper.js  (OWASP_AST10 framework block)
//   - docs/compliance/ast10.md  (coverage claim)
//
// A bump to AST10 v1.1 (or any other minor/patch revision) must be a new
// AWARE release and a new catalogue file (e.g. ast10-catalog-v1.1.js) per
// ADR-043 §"Failure modes" → "AST10 upstream renumbers or rewrites a risk
// class".

'use strict';

/**
 * @typedef {Object} AST10CatalogEntry
 * @property {string} id              - 'AST01' .. 'AST10'
 * @property {string} name            - short risk-class name
 * @property {string} severity        - 'Critical' | 'High' | 'Medium'
 * @property {string} description     - one-sentence upstream description
 * @property {string[]} keywords      - tokens that, when present in tool-call
 *                                      parameters, raise match confidence
 *                                      for this class (lowercase, substring
 *                                      match against parameter keys + values).
 *                                      Used as input to classification rules;
 *                                      they are NOT a substitute for the rule
 *                                      functions in ast10-mapper.js.
 * @property {string[]} denyListGlobs - parameter shapes that are never
 *                                      legitimate for this class (informational;
 *                                      the mapper does not block — fail-open).
 * @property {string} reference       - upstream citation path
 *                                      (relative to the OWASP repo root).
 */

/**
 * AST10 v1.0-2026 — 10 risk classes.
 *
 * Field provenance:
 *   - id / name / severity / description  → upstream README + per-class .md.
 *   - keywords / denyListGlobs             → derived from the per-class
 *                                            mitigations; see ADR-043
 *                                            §"Classification rules" for the
 *                                            rule-specific keyword set
 *                                            (keywords here cover the broader
 *                                            class; rule keywords are a subset).
 *
 * DO NOT invent new control IDs. If a new AST10 release renumbers or adds a
 * class, create a new catalogue version per ADR-043 §"Failure modes".
 *
 * @type {AST10CatalogEntry[]}
 */
const AST10_CATALOG = Object.freeze([
  {
    id: 'AST01',
    name: 'Malicious Skills',
    severity: 'Critical',
    description: 'Skill whose prose or behaviour instructs the agent to perform an attack (e.g. exfiltrate secrets, drop malware).',
    keywords: ['ssh', 'keychain', 'wallet', 'credential', 'phishing', 'dropper'],
    denyListGlobs: [],
    reference: 'ast01.md'
  },
  {
    id: 'AST02',
    name: 'Supply Chain Compromise',
    severity: 'Critical',
    description: 'Compromise of a skill, dependency, or publisher upstream of the agent (signed publisher key, transitive dep hash, etc.).',
    keywords: ['unsigned', 'publisher', 'transitive', 'dependency', 'yanked', 'integrity'],
    denyListGlobs: [],
    reference: 'ast02.md'
  },
  {
    id: 'AST03',
    name: 'Over-Privileged Skills',
    severity: 'High',
    description: 'Skill requests permissions broader than its functionality requires (writes to MEMORY.md/AGENTS.md/SOUL.md, shell exec for read-only work).',
    keywords: ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'exec', 'shell', 'write_file'],
    denyListGlobs: ['*AGENTS.md', '*SOUL.md', '*MEMORY.md'],
    reference: 'ast03.md'
  },
  {
    id: 'AST04',
    name: 'Insecure Metadata',
    severity: 'High',
    description: 'Skill manifest metadata (YAML/JSON) parsed by an unsafe loader, allowing deserialization or template injection.',
    keywords: ['!!python/object', '${', 'yaml.load', 'unsafe_yaml'],
    denyListGlobs: [],
    reference: 'ast04.md'
  },
  {
    id: 'AST05',
    name: 'Untrusted External Instructions',
    severity: 'High',
    description: 'Skill fetches and follows instructions from a host not on the agent allowlist (prompt-injection via fetched content).',
    keywords: ['web_fetch', 'http_get', 'http_post', 'fetch_url', 'allowlist'],
    denyListGlobs: [],
    reference: 'ast05.md'
  },
  {
    id: 'AST06',
    name: 'Weak Isolation',
    severity: 'High',
    description: 'Skill shares memory, FS, or process namespace with the host/agent without a sandbox boundary.',
    keywords: ['sandbox', 'namespace', 'container', 'chroot', 'cgroup'],
    denyListGlobs: [],
    reference: 'ast06.md'
  },
  {
    id: 'AST07',
    name: 'Update Drift',
    severity: 'Medium',
    description: 'Skill installed without a content-hash pin; updates may silently change behaviour.',
    keywords: ['update', 'upgrade', 'install', 'no_pin', 'unsigned_update'],
    denyListGlobs: [],
    reference: 'ast07.md'
  },
  {
    id: 'AST08',
    name: 'Poor Scanning',
    severity: 'Medium',
    description: 'No behavioural or content scan before install; static-pattern scanners miss semantic attacks (Trail of Bits, Snyk evidence).',
    keywords: ['scan', 'heuristic', 'antivirus', 'static_only'],
    denyListGlobs: [],
    reference: 'ast08.md'
  },
  {
    id: 'AST09',
    name: 'No Governance',
    severity: 'Medium',
    description: 'Decisions are not centrally logged with an execution-receipt vector; no human review trail.',
    keywords: ['audit', 'chain', 'receipt', 'denied-before-dispatch', 'AWARE_DENY'],
    denyListGlobs: [],
    reference: 'ast09.md'
  },
  {
    id: 'AST10',
    name: 'Cross-Platform Reuse',
    severity: 'Medium',
    description: 'Skill loaded from one manifest format (SKILL.md / skill.json / manifest.json / package.json) is reused on another platform with lossy translation.',
    keywords: ['cross_platform', 'skill_load', 'manifest_format'],
    denyListGlobs: [],
    reference: 'ast10.md'
  }
]);

/**
 * @type {string[]}
 */
const AST10_CONTROL_IDS = Object.freeze(AST10_CATALOG.map((e) => e.id));

module.exports = {
  AST10_CATALOG,
  AST10_CONTROL_IDS
};
