// SPDX-License-Identifier: Apache-2.0
// src/compliance/atlas-catalog.js
// MITRE ATLAS v2026.06 — static technique/mitigation/case-study catalogue.
//
// Per ADR-047. Pinned to:
//   content  v2026.06   (release tag v2026.06, 2026-06-30)
//   format   v6.0.0     (format-version key on the YAML artifact)
//
// Subset only — the techniques + mitigations + case studies AWARE has a
// control claim for (~30 techniques + ~10 mitigations + 6 new case studies
// as fixtures per ADR-047 §"Acceptance criteria" / §"1:1 mapping"). Full
// corpus expansion (170 techniques / 69 sub / 35 mitigations / 63 case
// studies at v2026.06) is a future ADR.
//
// Field provenance:
//   - id / name / maturity / platforms    → upstream dist/v6/ATLAS-2026.06.yaml
//   - subtechniques / mitigations          → derived from the centralised
//     relationships map at the v6.0.0 schema; ADR-047 §"1:1 mapping" prescribes
//     the subset; do NOT invent IDs
//   - reference                            → upstream path under the data repo
//     (techniques/AML.Tnnnn)
//
// Pin discipline (ADR-047 §"Failure modes"):
//   - The snapshot script (scripts/snapshot-atlas-catalog.js) MUST fetch
//     from dist/v6/ATLAS-2026.06.yaml. The deprecated dist/ATLAS.yaml at
//     the v2026.06 tag is verified to be missing T0113, T0114 (max id at
//     that file is AML.T0112). An accidental fetch from the deprecated
//     path silently drops the v2026.06 delta.
//   - A future ATLAS release (v2026.07, v2026.08, ...) is a NEW AWARE
//     release and a NEW catalogue file (e.g. atlas-catalog-v2026.07.js).
//     The format-version split means a format bump can happen independently
//     of content — track BOTH in the header comment.
//
// Source-of-truth consumers:
//   - src/compliance/atlas-mapper.js           (classification rules)
//   - src/compliance/framework-mapper.js       (MITRE_ATLAS framework block)
//   - docs/compliance/atlas.md                 (coverage claim)

'use strict';

/**
 * @typedef {Object} ATLASCatalogEntry
 * @property {string} id              - 'AML.T0051' (parent) or 'AML.T0051.001' (sub-technique)
 * @property {string} name            - upstream name
 * @property {string[]} platforms     - required by format v6.0.0; enum
 *                                      { 'Predictive AI', 'Generative AI',
 *                                        'Agentic AI', 'Enterprise' }
 * @property {string} maturity        - 'Realized' | 'Demonstrated' | 'Experiment'
 * @property {string[]} [subtechniques] - child technique IDs (parent only)
 * @property {string[]} [mitigations]  - applicable mitigation IDs (e.g. AML.M0020)
 * @property {string[]} [caseStudies]  - upstream case-study IDs that employ this technique
 * @property {string}   reference     - upstream citation path
 */

/**
 * @typedef {Object} ATLASMitigationEntry
 * @property {string} id              - 'AML.M0020'
 * @property {string} name            - upstream name
 * @property {string[]} [mitigates]   - technique IDs this mitigation applies to
 * @property {string}   reference     - upstream citation path
 */

/**
 * @typedef {Object} ATLASCaseStudyEntry
 * @property {string} id              - 'AML.CS0059'
 * @property {string} name            - upstream name
 * @property {string} type            - 'Incident' | 'Exercise'
 * @property {string[]} [techniques]  - technique IDs this case study employs
 * @property {string}   reference     - upstream citation path
 */

/**
 * MITRE ATLAS v2026.06 — AWARE coverage subset.
 *
 * Subset (per ADR-047 §"1:1 mapping"):
 *   - 11 techniques + 3 sub-techniques: AML.T0051, AML.T0051.001, AML.T0051.002,
 *     AML.T0054, AML.T0053, AML.T0113, AML.T0091.001, AML.T0114, AML.T0108
 *     (the 11 entries below; 3 of them are sub-techniques of T0051/T0091).
 *   - 3 mitigations: AML.M0020, AML.M0021, AML.M0024
 *   - 6 case studies: AML.CS0057..AML.CS0062 (the 6 new v2026.06 fixtures)
 *
 * IDs and field values were cross-referenced against
 * https://raw.githubusercontent.com/mitre-atlas/atlas-data/v2026.06/dist/v6/ATLAS-2026.06.yaml
 * on 2026-07-13. Maturity values are upstream values:
 *   T0051=Realized, T0051.000=Realized, T0051.001=Demonstrated, T0051.002=Demonstrated,
 *   T0054=Realized, T0053=Demonstrated, T0113=Demonstrated, T0091.001=Demonstrated,
 *   T0114=Demonstrated, T0108=Demonstrated.
 *
 * @type {ATLASCatalogEntry[]}
 */
const ATLAS_CATALOG = Object.freeze([
  // AML.T0051 — LLM Prompt Injection (parent). Sub-techniques + mitigations
  // come from the v6.0.0 centralised relationships map.
  {
    id: 'AML.T0051',
    name: 'LLM Prompt Injection',
    platforms: ['Generative AI', 'Agentic AI'],
    maturity: 'Realized',
    subtechniques: ['AML.T0051.000', 'AML.T0051.001', 'AML.T0051.002'],
    mitigations: ['AML.M0020', 'AML.M0021', 'AML.M0024'],
    reference: 'techniques/AML.T0051'
  },
  // AML.T0051.000 — Direct. AWARE documents as GAP (hook observes tool
  // calls, not prompt content).
  {
    id: 'AML.T0051.000',
    name: 'Direct',
    platforms: ['Generative AI', 'Agentic AI'],
    maturity: 'Realized',
    mitigations: ['AML.M0024'],
    reference: 'techniques/AML.T0051/000'
  },
  // AML.T0051.001 — Indirect. New ATLAS annotation alongside AST05.
  {
    id: 'AML.T0051.001',
    name: 'Indirect',
    platforms: ['Generative AI', 'Agentic AI'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0020', 'AML.M0021', 'AML.M0024'],
    reference: 'techniques/AML.T0051/001'
  },
  // AML.T0051.002 — Triggered. AWARE documents as GAP (event-driven, not
  // request-driven; AWARE never sees the embedded payload).
  {
    id: 'AML.T0051.002',
    name: 'Triggered',
    platforms: ['Agentic AI'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0024'],
    reference: 'techniques/AML.T0051/002'
  },
  // AML.T0054 — LLM Jailbreak (incl. v2026.06 Crescendo addition).
  {
    id: 'AML.T0054',
    name: 'LLM Jailbreak',
    platforms: ['Generative AI', 'Agentic AI'],
    maturity: 'Realized',
    mitigations: ['AML.M0020', 'AML.M0021'],
    reference: 'techniques/AML.T0054'
  },
  // AML.T0053 — AI Agent Tool Invocation. Direct fit with tool-access-control.
  {
    id: 'AML.T0053',
    name: 'AI Agent Tool Invocation',
    platforms: ['Agentic AI'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0020', 'AML.M0021', 'AML.M0024'],
    reference: 'techniques/AML.T0053'
  },
  // AML.T0113 — Steal Web Session Cookie (NEW in v2026.06). Cites ATT&CK
  // T1539; appears in case study CS0061.
  {
    id: 'AML.T0113',
    name: 'Steal Web Session Cookie',
    platforms: ['Enterprise'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0024'],
    caseStudies: ['AML.CS0061'],
    reference: 'techniques/AML.T0113'
  },
  // AML.T0091.001 — Web Session Cookie (NEW sub-technique in v2026.06).
  // Parent AML.T0091 (Use Alternate Authentication Material) is not in the
  // AWARE subset; the sub-technique is the AWARE-detectable form.
  {
    id: 'AML.T0091.001',
    name: 'Use Alternate Authentication Material: Web Session Cookie',
    platforms: ['Predictive AI'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0024'],
    reference: 'techniques/AML.T0091/001'
  },
  // AML.T0114 — AI Service Web Interface (NEW in v2026.06). C2 relay via
  // public AI web UIs (no API key required).
  {
    id: 'AML.T0114',
    name: 'AI Service Web Interface',
    platforms: ['Enterprise'],
    maturity: 'Demonstrated',
    mitigations: ['AML.M0024'],
    caseStudies: ['AML.CS0061'],
    reference: 'techniques/AML.T0114'
  },
  // AML.T0108 — AI Agent (C2 channel). Direct fit with tool-catalog
  // known-bad destination check.
  {
    id: 'AML.T0108',
    name: 'AI Agent',
    platforms: ['Agentic AI'],
    maturity: 'Demonstrated',
    reference: 'techniques/AML.T0108'
  }
]);

/**
 * MITRE ATLAS v2026.06 — mitigation subset (per ADR-047 §"1:1 mapping").
 * Three updated mitigations ship in the AWARE subset. Each entry carries
 * the `mitigates` array from the upstream centralised relationships map.
 *
 * @type {ATLASMitigationEntry[]}
 */
const ATLAS_MITIGATIONS = Object.freeze([
  {
    id: 'AML.M0020',
    name: 'Generative AI Guardrails',
    mitigates: ['AML.T0010', 'AML.T0051', 'AML.T0053', 'AML.T0054', 'AML.T0056', 'AML.T0057', 'AML.T0061', 'AML.T0062'],
    reference: 'mitigations/AML.M0020'
  },
  {
    id: 'AML.M0021',
    name: 'Generative AI Guidelines',
    mitigates: ['AML.T0051', 'AML.T0053', 'AML.T0054', 'AML.T0056', 'AML.T0057', 'AML.T0061', 'AML.T0062'],
    reference: 'mitigations/AML.M0021'
  },
  {
    id: 'AML.M0024',
    name: 'AI Telemetry Logging',
    mitigates: [
      'AML.T0005.001', 'AML.T0024', 'AML.T0024.000', 'AML.T0024.001', 'AML.T0024.002',
      'AML.T0040', 'AML.T0047',
      'AML.T0051', 'AML.T0051.000', 'AML.T0051.001', 'AML.T0051.002',
      'AML.T0053',
      'AML.T0085', 'AML.T0085.000', 'AML.T0085.001',
      'AML.T0086', 'AML.T0101', 'AML.T0114'
    ],
    reference: 'mitigations/AML.M0024'
  }
]);

/**
 * MITRE ATLAS v2026.06 — six new case studies (CS0057–CS0062) used as
 * test-vector fixtures. The `employs` edges below are sourced from the
 * v6.0.0 centralised relationships map; case study CS0059 (EchoLeak) is
 * the M365 Copilot zero-click prompt-injection that motivated several
 * v2026.06 changes per the upstream CHANGELOG.
 *
 * @type {ATLASCaseStudyEntry[]}
 */
const ATLAS_CASE_STUDIES = Object.freeze([
  {
    id: 'AML.CS0057',
    name: 'Storm-2139 Azure OpenAI Guardrail Bypass',
    type: 'Incident',
    techniques: ['AML.T0025', 'AML.T0056'],
    reference: 'case-studies/AML.CS0057'
  },
  {
    id: 'AML.CS0058',
    name: 'Google Photos AI Model Extraction',
    type: 'Exercise',
    techniques: ['AML.T0025', 'AML.T0048'],
    reference: 'case-studies/AML.CS0058'
  },
  {
    id: 'AML.CS0059',
    name: 'EchoLeak: Zero-Click Prompt Injection Targeting M365 Copilot for Data Exfiltration',
    type: 'Exercise',
    techniques: ['AML.T0025', 'AML.T0048', 'AML.T0051.002', 'AML.T0065', 'AML.T0066', 'AML.T0067', 'AML.T0068', 'AML.T0070', 'AML.T0077', 'AML.T0079', 'AML.T0085.000', 'AML.T0093'],
    reference: 'case-studies/AML.CS0059'
  },
  {
    id: 'AML.CS0060',
    name: 'Cross-Site Scripting via Prompt Manipulation in Lenovo AI Chatbot',
    type: 'Exercise',
    techniques: ['AML.T0051.002', 'AML.T0079'],
    reference: 'case-studies/AML.CS0060'
  },
  {
    id: 'AML.CS0061',
    name: 'AI in the Middle: Web-Based AI Services as C2 Relays',
    type: 'Exercise',
    techniques: ['AML.T0008.002', 'AML.T0037', 'AML.T0047', 'AML.T0050', 'AML.T0065', 'AML.T0068', 'AML.T0079', 'AML.T0086', 'AML.T0095', 'AML.T0114'],
    reference: 'case-studies/AML.CS0061'
  },
  {
    id: 'AML.CS0062',
    name: 'RCE Vulnerability in Semantic Kernel Search Plugin',
    type: 'Exercise',
    techniques: ['AML.T0047', 'AML.T0050', 'AML.T0051.000', 'AML.T0053', 'AML.T0065', 'AML.T0112'],
    reference: 'case-studies/AML.CS0062'
  }
]);

/**
 * Flat technique ID list (parents + sub-techniques, deduplicated).
 *
 * @type {string[]}
 */
const ATLAS_TECHNIQUE_IDS = Object.freeze(ATLAS_CATALOG.map((e) => e.id));

/**
 * Public-AI-host default list (per ADR-047 §"Initial classification rules"
 * → `web-ai-c2-relay`). Operators override via
 * `src/policies/atlas-host-policy.js` (a follow-up that ships with v1.1;
 * the default list is the v1 surface).
 *
 * @type {string[]}
 */
const ATLAS_DEFAULT_PUBLIC_AI_HOSTS = Object.freeze([
  'chat.openai.com',
  'gemini.google.com',
  'claude.ai',
  'copilot.microsoft.com',
  'perplexity.ai',
  'you.com'
]);

module.exports = {
  ATLAS_CATALOG,
  ATLAS_MITIGATIONS,
  ATLAS_CASE_STUDIES,
  ATLAS_TECHNIQUE_IDS,
  ATLAS_DEFAULT_PUBLIC_AI_HOSTS
};