// src/compliance/framework-mapper.js
// Framework Mapper — Maps AWARE components to compliance framework controls
// ADR (internal): Compliance Mapping & Reporting

const { AICM_V1_DOMAINS, AICM_V1_CONTROL_IDS } = require('./aicm-v1-catalog');

/**
 * Compliance Framework Definitions
 */
const FRAMEWORKS = {
  CSA_AI_CM: {
    id: 'CSA_AI_CM',
    name: 'CSA AI Controls Matrix',
    version: 'v1',
    source: 'https://cloudsecurityalliance.org/artifacts/ai-controls-matrix',
    catalogRef: './aicm-v1-catalog',
    // AICM v1 uses domain-grouped control IDs (e.g. 'IAM-01', 'MDS-03', 'DSP-17').
    // The full 184-control subset lives in aicm-v1-catalog.js; we expose it
    // through `controls` so the existing getFrameworkControls() path works
    // uniformly across CSA_AI_CM, NIST_AI_RMF, ISO_27001, and OWASP_LLM_TOP_10.
    controls: AICM_V1_DOMAINS,
    controlIds: AICM_V1_CONTROL_IDS,
    // Legacy `categories` view preserved for any caller still iterating by
    // domain. Each domain is exposed with its full name and a count of
    // controls so the existing iteration pattern (catId -> cat.name) still
    // works without forcing a refactor of downstream callers.
    categories: Object.fromEntries(
      Object.entries(AICM_V1_DOMAINS).map(([domId, ctrls]) => [
        domId,
        {
          name: domId,
          description: `CSA AICM v1 ${domId} domain — ${Object.keys(ctrls).length} controls`,
        },
      ])
    )
  },
  NIST_AI_RMF: {
    id: 'NIST_AI_RMF',
    name: 'NIST AI Risk Management Framework',
    version: '1.0',
    functions: {
      'GOVERN': { name: 'Govern', description: 'Governance structures' },
      'MAP': { name: 'Map', description: 'Risk assessment' },
      'MEASURE': { name: 'Measure', description: 'Measurement and analysis' },
      'MANAGE': { name: 'Manage', description: 'Risk management' }
    },
    // NOTE: control IDs below use NIST CSF subcategory format (PR.AC, DE.CM,
    // etc.). These are the IDs referenced by AWARE component mappings; the
    // NIST_AI_RMF label is retained for the framework-mapper API. A future
    // ADR should reconcile the CSF vs AI RMF ID scheme. (Pre-existing
    // inconsistency, flagged during OWASP LLM Top 10 mapping PR.)
    controls: {
      'GV.PO': { name: 'Govern — Policies, Processes, and Procedures', description: 'Organisational policies, processes, and procedures for AI risk management are established.' },
      'GV.RM': { name: 'Govern — Risk Management Strategy', description: 'AI risk management strategy is established and integrated.' },
      'PR.AC': { name: 'Protect — Access Control', description: 'Identities, credentials, and access management for AI system components.' },
      'PR.IP': { name: 'Protect — Information Protection', description: 'Information protection processes and procedures for AI systems.' },
      'PR.AA': { name: 'Protect — Awareness and Training', description: 'Personnel are trained on AI security and operational responsibilities.' },
      'DE.CM': { name: 'Detect — Continuous Monitoring', description: 'AI systems and assets are monitored to detect anomalies and events.' },
      'DE.AE': { name: 'Detect — Anomalies and Events', description: 'Anomalous activity on AI systems is detected and the potential impact is understood.' },
      'RS.RP': { name: 'Respond — Response Planning', description: 'Response processes and procedures for AI incidents are executed and maintained.' },
      'RS.MA': { name: 'Respond — Analysis', description: 'Analysis is performed to establish what has taken place during an AI event.' },
      'RS.MI': { name: 'Respond — Mitigation', description: 'Activities are performed to prevent expansion of an AI event and mitigate its effects.' },
      'RA-1': { name: 'Risk Assessment — Asset Vulnerability', description: 'Asset vulnerabilities are identified, validated, and recorded.' },
      'RA-3': { name: 'Risk Assessment — Threat Modelling', description: 'Threats, both internal and external, are identified and recorded.' }
    }
  },
  ISO_27001: {
    id: 'ISO_27001',
    name: 'ISO/IEC 27001:2022',
    version: '2022',
    categories: {
      'A.9': { name: 'Access Control', description: 'User access management' },
      'A.12': { name: 'Operations Security', description: 'Operational procedures' },
      'A.16': { name: 'Incident Management', description: 'Security incident management' }
    }
  },
  DORA: {
    id: 'DORA',
    name: 'Digital Operational Resilience Act',
    version: '2022',
    articles: {
      '12': { name: 'Internal Control Frameworks', description: 'ICT risk management' },
      '26': { name: 'ICT Incidents', description: 'Operational resilience' },
      '27': { name: 'Threat Intelligence', description: 'Cyber threat intelligence' }
    },
    controls: {
      'Art.12': { name: 'Internal Governance and Control', description: 'Financial entities must have an internal governance and control framework for ICT risk management, including roles, responsibilities, and risk tolerance.' },
      'Art.26': { name: 'Major ICT-Related Incident Reporting', description: 'Financial entities must define, document, and implement processes to detect, manage, log, and classify ICT-related incidents.' },
      'Art.27': { name: 'Cyber Threat Intelligence and Penetration Testing', description: 'Financial entities must maintain threat intelligence capabilities and conduct regular threat-led penetration testing.' }
    }
  },
  OWASP_LLM_TOP_10: {
    id: 'OWASP_LLM_TOP_10',
    name: 'OWASP Top 10 for Large Language Model Applications',
    // ADR-050 §2 (Decision 1): the bound spec is OWASP-Top-10-LLM-2025
    // (published 2025-03-12). The framework identity `OWASP_LLM_TOP_10`
    // is stable across AWARE releases; the rebinding from v1.1 (2023)
    // to 2025 happened via ADR-050 §5 GAP-1. Per-control descriptions
    // paraphrase the 2025 spec; the canonical source-of-truth list
    // lives in docs/compliance/llm-top-10.md §"Per-risk coverage" and
    // ADR-050 §1.1 (drift table). The deprecated 2023 (v1.1) ID set
    // is preserved at the framework ID `OWASP_LLM_TOP_10_v1_1` (not
    // wired into AWARE_COMPONENT_MAPPINGS) for traceability.
    version: '2025',
    controls: {
      'LLM01': { name: 'Prompt Injection', description: 'Manipulating LLMs via crafted inputs can lead to unauthorised access, data breaches, and compromised decision-making.' },
      'LLM02': { name: 'Sensitive Information Disclosure', description: 'Failure to protect against disclosure of sensitive information in LLM outputs can result in legal consequences or a loss of competitive advantage.' },
      'LLM03': { name: 'Supply Chain', description: 'Depending upon compromised components, services or datasets undermines system integrity, causing data breaches and system failures.' },
      'LLM04': { name: 'Data and Model Poisoning', description: 'Tampered training data or model weights can impair LLM models leading to responses that may compromise security, accuracy, or ethical behaviour.' },
      'LLM05': { name: 'Improper Output Handling', description: 'Neglecting to validate LLM outputs may lead to downstream security exploits, including code execution that compromises systems and exposes data.' },
      'LLM06': { name: 'Excessive Agency', description: 'Granting LLMs unchecked autonomy to take action can lead to unintended consequences, jeopardising reliability, privacy, and trust.' },
      'LLM07': { name: 'System Prompt Leakage', description: 'Exposing the system prompt to user input or to logs can reveal security policy, role, or allowed tools to parties who should not see them.' },
      'LLM08': { name: 'Vector and Embedding Weaknesses', description: 'Attacks on the RAG / embedding store layer (injection via stored documents, embedding inversion, cross-tenant retrieval contamination) compromise the integrity of retrieved context.' },
      'LLM09': { name: 'Misinformation', description: 'LLM-originated false content AND downstream overreliance on it lead to compromised decision making, security vulnerabilities, and legal liabilities.' },
      'LLM10': { name: 'Unbounded Consumption', description: 'Volumetric (DoS), cost (token spend), and scraping (model theft by sampling) abuse vectors against the LLM application.' }
    }
  },
  // ADR-043 — OWASP Agentic Skills Top 10 (AST10) v1.0-2026.
    // The control list is sourced from src/compliance/ast10-catalog.js (the
    // pinned JSON-style JS module shipped with this AWARE release) so the
    // control claim is reproducible across re-deploys. The risk-class
    // descriptions, severity strings, and IDs MUST match ast10-catalog.js
    // — any divergence is a bug.
    //
    // Rationale for adding this as a fifth supported framework lives in
    // ADR-043 ("Decision") and docs/compliance/ast10.md. AST10 is the only
    // published control catalogue that names the *behaviour-layer* attack
    // surface (skills themselves, not MCP or the model) that AWARE 2.0's
    // hook-based auto-interception sits in front of.
    OWASP_AST10: {
      id: 'OWASP_AST10',
      name: 'OWASP Agentic Skills Top 10',
      version: 'v1.0-2026',
      source: 'https://github.com/OWASP/www-project-agentic-skills-top-10',
      catalogRef: './ast10-catalog',
      // Flat AST01..AST10 control list. Severity is pinned to upstream;
      // descriptions are short — full per-class coverage lives in
      // docs/compliance/ast10.md.
      controls: {
        'AST01': { name: 'Malicious Skills', severity: 'Critical', description: 'Skill whose prose or behaviour instructs the agent to perform an attack (e.g. exfiltrate secrets, drop malware).' },
        'AST02': { name: 'Supply Chain Compromise', severity: 'Critical', description: 'Compromise of a skill, dependency, or publisher upstream of the agent.' },
        'AST03': { name: 'Over-Privileged Skills', severity: 'High', description: 'Skill requests permissions broader than its functionality requires.' },
        'AST04': { name: 'Insecure Metadata', severity: 'High', description: 'Skill manifest metadata parsed by an unsafe loader, allowing deserialization or template injection.' },
        'AST05': { name: 'Untrusted External Instructions', severity: 'High', description: 'Skill fetches and follows instructions from a host not on the agent allowlist.' },
        'AST06': { name: 'Weak Isolation', severity: 'High', description: 'Skill shares memory, FS, or process namespace with the host/agent without a sandbox boundary.' },
        'AST07': { name: 'Update Drift', severity: 'Medium', description: 'Skill installed without a content-hash pin; updates may silently change behaviour.' },
        'AST08': { name: 'Poor Scanning', severity: 'Medium', description: 'No behavioural or content scan before install; static-pattern scanners miss semantic attacks.' },
        'AST09': { name: 'No Governance', severity: 'Medium', description: 'Decisions are not centrally logged with an execution-receipt vector; no human review trail.' },
        'AST10': { name: 'Cross-Platform Reuse', severity: 'Medium', description: 'Skill loaded from one manifest format is reused on another platform with lossy translation.' }
      }
    }
  };

/**
 * AWARE Component to Control Mappings
 *
 * AICM v1 mappings below use real CSA AICM v1 control IDs (e.g. 'IAM-04',
 * 'MDS-08', 'DSP-17'). They were previously placeholders ('AI.ID-01' etc.)
 * that did not exist in the AICM spec. See src/compliance/aicm-v1-catalog.js
 * for the full control universe and scripts/regenerate-aicm-catalog.js for
 * the regeneration source.
 */
const AWARE_COMPONENT_MAPPINGS = {
  // Phase 1.1: Agent Registry — register AI agents, track metadata, lifecycle.
  'agent-registry': {
    'CSA_AI_CM': ['IAM-01', 'GRC-02'],
    'NIST_AI_RMF': ['PR.AC', 'DE.CM'],
    'ISO_27001': ['A.9.2', 'A.9.4'],
    'DORA': ['Art.12'],
    // ADR-050 §3: LLM05 (v1.1 Supply Chain) → LLM03:2025; LLM10 (v1.1 Model Theft) → LLM02:2025.
    'OWASP_LLM_TOP_10': ['LLM03', 'LLM02'],
    // ADR-043: agent-registry covers AST02 (supply-chain, via publisher-key machinery).
    'OWASP_AST10': ['AST02']
  },

  // Phase 1.2: Per-Agent Sandbox Policies — execution isolation, input validation.
  'sandbox-policies': {
    'CSA_AI_CM': ['AIS-08', 'DSP-17', 'UEM-13'],
    'NIST_AI_RMF': ['PR.IP', 'DE.AE'],
    'ISO_27001': ['A.12.1', 'A.12.4'],
    'DORA': ['Art.12'],
    // ADR-050 §3: LLM04 (v1.1 Model DoS) → LLM10:2025; LLM07 (v1.1 Plugin Design) → LLM05:2025; LLM08 (v1.1 Excessive Agency) → LLM06:2025.
    'OWASP_LLM_TOP_10': ['LLM10', 'LLM05', 'LLM06'],
    // ADR-043: sandbox-policies covers AST06 (weak isolation) directly.
    'OWASP_AST10': ['AST06']
  },

  // Phase 1.3: Behavioural Baseline — per-agent behavioural baseline for anomaly scoring.
  'behavioral-baseline': {
    'CSA_AI_CM': ['LOG-03', 'MDS-05'],
    'NIST_AI_RMF': ['DE.CM', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27'],
    // ADR-050 §3: LLM03 (v1.1 Training Data Poisoning) → LLM04:2025 (Data and Model Poisoning); LLM09 stays.
    'OWASP_LLM_TOP_10': ['LLM04', 'LLM09'],
    // ADR-043: behavioral-baseline flags anomalous skill behaviour post-call,
    // which is the AST05 (untrusted external instructions) defence surface.
    'OWASP_AST10': ['AST05']
  },

  // Phase 1.4: Kill Switch — emergency termination of misbehaving agents.
  'kill-switch': {
    'CSA_AI_CM': ['SEF-03', 'LOG-13'],
    'NIST_AI_RMF': ['RS.MI', 'RS.RP'],
    'ISO_27001': ['A.16.1'],
    'DORA': ['Art.26'],
    // ADR-050 §3: LLM04 (v1.1 Model DoS) → LLM10:2025; LLM08 (v1.1 Excessive Agency) → LLM06:2025.
    'OWASP_LLM_TOP_10': ['LLM10', 'LLM06'],
    // ADR-043: kill-switch is the AST06 (weak isolation) blast-radius terminator.
    'OWASP_AST10': ['AST06']
  },

  // Phase 2.1: Pheromone Specialists — specialised detection heuristics (per Good CISO SimuRA).
  // ADR-043 §1 does NOT enumerate an AST10 row for pheromone-specialists
  // (the heuristic scoring it does is captured under anomaly-detection /
  // security-heuristic instead). Per docs/compliance/ast10.md this is
  // explicit: "(none — ADR-043 §1 does not enumerate this row)".
  'pheromone-specialists': {
    'CSA_AI_CM': ['TVM-08', 'MDS-08'],
    'NIST_AI_RMF': ['PR.IP'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM09']
    // No 'OWASP_AST10' key — by design. Cross-checked against
    // docs/compliance/ast10.md §"AWARE component → AST10 coverage".
  },

  // Phase 2.2: Security-Weighted Heuristic — risk-weighted decision routing.
  'security-heuristic': {
    'CSA_AI_CM': ['TVM-01', 'GRC-09'],
    'NIST_AI_RMF': ['RA-1', 'RA-3'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12'],
    // ADR-050 §3: LLM02 (v1.1 Insecure Output Handling) → LLM05:2025 (Improper Output Handling); LLM01 stays.
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM05'],
    // ADR-043: security-heuristic scores behavioural anomalies — the AST08
    // (poor scanning) defence surface, partial coverage.
    'OWASP_AST10': ['AST08']
  },

  // Phase 3.1A: Agent Identity & Authentication — agent identity, authN, authZ.
  'identity-provider': {
    'CSA_AI_CM': ['IAM-04', 'IAM-09', 'CEK-21'],
    'NIST_AI_RMF': ['PR.AC', 'PR.AA'],
    'ISO_27001': ['A.9.2', 'A.9.4'],
    'DORA': ['Art.12'],
    // ADR-050 §3: v1.1 LLM07 (Plugin Design) drops — AST10 covers the plugin provenance
    // class per ADR-043. v1.1 LLM05/06/10 (Supply Chain / Sensitive Disclosure / Model Theft)
    // collapse into LLM02:2025 (Sensitive Information Disclosure, the broader 2025 scope).
    // v1.1 LLM05 also → LLM03:2025 (Supply Chain). Net: [LLM03, LLM02, LLM02, LLM02].
    'OWASP_LLM_TOP_10': ['LLM03', 'LLM02', 'LLM02', 'LLM02'],
    // ADR-043: identity-provider signing-key machinery covers AST01
    // (malicious skills) + AST02 (supply-chain, publisher keys).
    'OWASP_AST10': ['AST01', 'AST02']
  },

  // Phase 3.1B: Behavioural Anomaly Detection — detect anomalous AI agent behaviour.
  'anomaly-detection': {
    'CSA_AI_CM': ['LOG-05', 'MDS-09', 'SEF-06'],
    'NIST_AI_RMF': ['DE.CM', 'DE.AE', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27'],
    // ADR-050 §3: v1.1 LLM03 (Training Data Poisoning) → LLM04:2025 (Data and Model Poisoning);
    // v1.1 LLM06 (Sensitive Disclosure) + LLM10 (Model Theft) → LLM02:2025 (Sensitive Information
    // Disclosure, broader 2025 scope); LLM01/LLM09 stay.
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM04', 'LLM02', 'LLM09', 'LLM02'],
    // ADR-043: anomaly-detection covers AST01/AST05/AST08 (behavioural
    // observations) and AST09 (audit-chain governance).
    'OWASP_AST10': ['AST01', 'AST05', 'AST08', 'AST09']
  },

  // Phase 3.1C: Tool Access Control — fine-grained tool invocation control.
  'tool-access-control': {
    'CSA_AI_CM': ['IAM-08', 'DSP-05', 'AIS-07'],
    'NIST_AI_RMF': ['PR.AC', 'PR.IP'],
    'ISO_27001': ['A.9.4'],
    'DORA': ['Art.12'],
    // ADR-050 §3: v1.1 LLM02 (Insecure Output Handling) → LLM05:2025; v1.1 LLM04 (Model DoS) → LLM10:2025;
    // v1.1 LLM05 (Supply Chain) → LLM03:2025; v1.1 LLM07 (Plugin Design) drops — AST10 covers;
    // v1.1 LLM08 (Excessive Agency) → LLM06:2025; LLM01 stays.
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM05', 'LLM10', 'LLM03', 'LLM03', 'LLM06'],
    // ADR-043: tool-access-control is the central surface for AST01/AST03/AST04/AST07.
    // AST03 (over-privilege) is enforced by permission-model.js; the AST10 mapper's
    // over-privilege-write rule (sensitive target → AST03 H) is fed from here.
    'OWASP_AST10': ['AST01', 'AST03', 'AST04', 'AST07']
  },

  // Phase 3.2: Compliance Mapping — cross-framework mapping + posture reporting.
  'compliance-mapping': {
    'CSA_AI_CM': ['GRC-04', 'A&A-05'],
    'NIST_AI_RMF': ['GV.PO', 'GV.RM'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.12', 'Art.26'],
    'OWASP_LLM_TOP_10': ['LLM09'],
    // ADR-043: compliance-mapping emits the AST09 (no governance) audit
    // surface — the OWASP "execution-receipt" vector that AST09 calls for.
    'OWASP_AST10': ['AST09']
  }
};

/**
 * Framework Mapper class
 */
class FrameworkMapper {
  constructor() {
    this.frameworks = FRAMEWORKS;
    this.mappings = AWARE_COMPONENT_MAPPINGS;
  }

  /**
   * Get all frameworks
   * @returns {Object}
   */
  getFrameworks() {
    return { ...this.frameworks };
  }

  /**
   * Get framework by ID
   * @param {string} frameworkId
   * @returns {Object|null}
   */
  getFramework(frameworkId) {
    return this.frameworks[frameworkId] || null;
  }

  /**
   * Get all component mappings
   * @returns {Object}
   */
  getAllMappings() {
    return { ...this.mappings };
  }

  /**
   * Get mapping for a specific component
   * @param {string} componentId
   * @returns {Object|null}
   */
  getComponentMapping(componentId) {
    return this.mappings[componentId] || null;
  }

  /**
   * Get all controls for a specific framework
   * @param {string} frameworkId
   * @returns {Array}
   */
  getFrameworkControls(frameworkId) {
    const framework = this.frameworks[frameworkId];
    if (!framework) return [];

    const controls = [];

    // CSA AICM v1: iterate the real control universe from aicm-v1-catalog.js.
    // Each control ID is a domain-prefixed code (e.g. 'IAM-01', 'MDS-08', 'DSP-17').
    if (frameworkId === 'CSA_AI_CM') {
      for (const [domId, domainCtrls] of Object.entries(framework.controls || {})) {
        for (const [ctrlId, ctrl] of Object.entries(domainCtrls)) {
          controls.push({
            id: ctrlId,
            category: domId,
            categoryName: domId,
            name: ctrl.name,
            description: ctrl.description,
          });
        }
      }
    }

    // ISO 27001 has Annex A categories
    if (frameworkId === 'ISO_27001') {
      for (const [catId, cat] of Object.entries(framework.categories || {})) {
        controls.push({
          id: `${catId}`,
          category: catId,
          categoryName: cat.name,
          description: cat.description
        });
      }
    }

    // OWASP LLM Top 10 has flat LLM01-LLM10 controls
    if (frameworkId === 'OWASP_LLM_TOP_10') {
      for (const [ctrlId, ctrl] of Object.entries(framework.controls || {})) {
        controls.push({
          id: ctrlId,
          category: ctrlId,
          categoryName: ctrl.name,
          description: ctrl.description
        });
      }
    }

    // OWASP AST10 has flat AST01-AST10 controls (same shape as LLM Top 10).
    // Per ADR-043 — the framework entry here is the structural surface;
    // the per-rule annotations live in src/compliance/ast10-mapper.js.
    if (frameworkId === 'OWASP_AST10') {
      for (const [ctrlId, ctrl] of Object.entries(framework.controls || {})) {
        controls.push({
          id: ctrlId,
          category: ctrlId,
          categoryName: ctrl.name,
          severity: ctrl.severity || null,
          description: ctrl.description
        });
      }
    }

    // DORA uses Art.NN prefixed controls (matches mapping format)
    if (frameworkId === 'DORA') {
      for (const [ctrlId, ctrl] of Object.entries(framework.controls || {})) {
        controls.push({
          id: ctrlId,
          category: ctrlId,
          categoryName: ctrl.name,
          description: ctrl.description
        });
      }
    }

    // NIST AI RMF controls (CSF subcategory format) — see note in FRAMEWORKS
    if (frameworkId === 'NIST_AI_RMF') {
      for (const [ctrlId, ctrl] of Object.entries(framework.controls || {})) {
        controls.push({
          id: ctrlId,
          category: ctrlId,
          categoryName: ctrl.name,
          description: ctrl.description
        });
      }
    }

    return controls;
  }

  /**
   * Map component to all its compliance controls
   * @param {string} componentId
   * @returns {Array}
   */
  mapComponent(componentId) {
    const mapping = this.mappings[componentId];
    if (!mapping) return [];

    const results = [];

    for (const [frameworkId, controlIds] of Object.entries(mapping)) {
      const framework = this.frameworks[frameworkId];
      if (!framework) continue;

      for (const controlId of controlIds) {
        results.push({
          componentId,
          frameworkId,
          frameworkName: framework.name,
          controlId
        });
      }
    }

    return results;
  }

  /**
   * Generate compliance matrix for all components
   * @returns {Object}
   */
  generateComplianceMatrix() {
    const matrix = {};

    for (const [componentId, mapping] of Object.entries(this.mappings)) {
      matrix[componentId] = {};

      for (const [frameworkId, controlIds] of Object.entries(mapping)) {
        const framework = this.frameworks[frameworkId];
        if (!framework) continue;

        matrix[componentId][frameworkId] = {
          frameworkName: framework.name,
          controls: controlIds.map(id => ({
            id,
            status: 'IMPLEMENTED' // Default status
          }))
        };
      }
    }

    return matrix;
  }

  /**
   * Check if a component covers a specific control
   * @param {string} componentId
   * @param {string} frameworkId
   * @param {string} controlId
   * @returns {boolean}
   */
  componentCoversControl(componentId, frameworkId, controlId) {
    const mapping = this.mappings[componentId];
    if (!mapping) return false;

    const frameworkControls = mapping[frameworkId];
    if (!frameworkControls) return false;

    return frameworkControls.includes(controlId);
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create FrameworkMapper singleton
 * @returns {FrameworkMapper}
 */
function getFrameworkMapper() {
  if (!instance) {
    instance = new FrameworkMapper();
  }
  return instance;
}

module.exports = {
  FrameworkMapper,
  getFrameworkMapper,
  FRAMEWORKS,
  AWARE_COMPONENT_MAPPINGS
};
