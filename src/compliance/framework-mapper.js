// src/compliance/framework-mapper.js
// Framework Mapper — Maps AWARE components to compliance framework controls
// ADR (internal): Compliance Mapping & Reporting

/**
 * Compliance Framework Definitions
 */
const FRAMEWORKS = {
  CSA_AI_CM: {
    id: 'CSA_AI_CM',
    name: 'CSA AI Control Matrix',
    version: '2026',
    categories: {
      'AI.ID': { name: 'AI Identity', description: 'Identity management for AI systems' },
      'AI.OT': { name: 'AI Operations', description: 'Operational technology controls' },
      'AI.OPS': { name: 'AI Operations', description: 'AI operational procedures' },
      'AI.MT': { name: 'AI Maintenance', description: 'Model and system maintenance' }
    }
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
    version: 'v1.1',
    controls: {
      'LLM01': { name: 'Prompt Injection', description: 'Manipulating LLMs via crafted inputs can lead to unauthorised access, data breaches, and compromised decision-making.' },
      'LLM02': { name: 'Insecure Output Handling', description: 'Neglecting to validate LLM outputs may lead to downstream security exploits, including code execution that compromises systems and exposes data.' },
      'LLM03': { name: 'Training Data Poisoning', description: 'Tampered training data can impair LLM models leading to responses that may compromise security, accuracy, or ethical behaviour.' },
      'LLM04': { name: 'Model Denial of Service', description: 'Overloading LLMs with resource-heavy operations can cause service disruptions and increased costs.' },
      'LLM05': { name: 'Supply Chain Vulnerabilities', description: 'Depending upon compromised components, services or datasets undermines system integrity, causing data breaches and system failures.' },
      'LLM06': { name: 'Sensitive Information Disclosure', description: 'Failure to protect against disclosure of sensitive information in LLM outputs can result in legal consequences or a loss of competitive advantage.' },
      'LLM07': { name: 'Insecure Plugin Design', description: 'LLM plugins processing untrusted inputs and having insufficient access control risk severe exploits like remote code execution.' },
      'LLM08': { name: 'Excessive Agency', description: 'Granting LLMs unchecked autonomy to take action can lead to unintended consequences, jeopardising reliability, privacy, and trust.' },
      'LLM09': { name: 'Overreliance', description: 'Failing to critically assess LLM outputs can lead to compromised decision making, security vulnerabilities, and legal liabilities.' },
      'LLM10': { name: 'Model Theft', description: 'Unauthorised access to proprietary large language models risks theft, competitive advantage, and dissemination of sensitive information.' }
    }
  }
};

/**
 * AWARE Component to Control Mappings
 */
const AWARE_COMPONENT_MAPPINGS = {
  // Phase 1.1: Agent Registry
  'agent-registry': {
    'CSA_AI_CM': ['AI.ID-01', 'AI.ID-02'],
    'NIST_AI_RMF': ['PR.AC', 'DE.CM'],
    'ISO_27001': ['A.9.2', 'A.9.4'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM05', 'LLM10']
  },

  // Phase 1.2: Per-Agent Sandbox Policies
  'sandbox-policies': {
    'CSA_AI_CM': ['AI.OPS-04', 'AI.OPS-05'],
    'NIST_AI_RMF': ['PR.IP', 'DE.AE'],
    'ISO_27001': ['A.12.1', 'A.12.4'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM04', 'LLM07', 'LLM08']
  },

  // Phase 1.3: Behavioural Baseline
  'behavioral-baseline': {
    'CSA_AI_CM': ['AI.MT-01'],
    'NIST_AI_RMF': ['DE.CM', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27'],
    'OWASP_LLM_TOP_10': ['LLM03', 'LLM09']
  },

  // Phase 1.4: Kill Switch
  'kill-switch': {
    'CSA_AI_CM': ['AI.OPS-02', 'AI.OPS-03'],
    'NIST_AI_RMF': ['RS.MI', 'RS.RP'],
    'ISO_27001': ['A.16.1'],
    'DORA': ['Art.26'],
    'OWASP_LLM_TOP_10': ['LLM04', 'LLM08']
  },

  // Phase 2.1: Pheromone Specialists
  'pheromone-specialists': {
    'CSA_AI_CM': ['AI.OT-02'],
    'NIST_AI_RMF': ['PR.IP'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM09']
  },

  // Phase 2.2: Security-Weighted Heuristic
  'security-heuristic': {
    'CSA_AI_CM': ['AI.OT-01', 'AI.OT-02'],
    'NIST_AI_RMF': ['RA-1', 'RA-3'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM02']
  },

  // Phase 3.1A: Agent Identity & Authentication
  'identity-provider': {
    'CSA_AI_CM': ['AI.ID-01', 'AI.ID-02'],
    'NIST_AI_RMF': ['PR.AC', 'PR.AA'],
    'ISO_27001': ['A.9.2', 'A.9.4'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM05', 'LLM06', 'LLM07', 'LLM10']
  },

  // Phase 3.1B: Behavioural Anomaly Detection
  'anomaly-detection': {
    'CSA_AI_CM': ['AI.MT-01', 'AI.OPS-01'],
    'NIST_AI_RMF': ['DE.CM', 'DE.AE', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27'],
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM03', 'LLM06', 'LLM09', 'LLM10']
  },

  // Phase 3.1C: Tool Access Control
  'tool-access-control': {
    'CSA_AI_CM': ['AI.OPS-04', 'AI.OPS-05'],
    'NIST_AI_RMF': ['PR.AC', 'PR.IP'],
    'ISO_27001': ['A.9.4'],
    'DORA': ['Art.12'],
    'OWASP_LLM_TOP_10': ['LLM01', 'LLM02', 'LLM04', 'LLM05', 'LLM07', 'LLM08']
  },

  // Phase 3.2: Compliance Mapping
  'compliance-mapping': {
    'CSA_AI_CM': ['AI.ID-01', 'AI.MT-01'],
    'NIST_AI_RMF': ['GV.PO', 'GV.RM'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.12', 'Art.26'],
    'OWASP_LLM_TOP_10': ['LLM09']
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

    // CSA AI CM has categories with controls
    if (frameworkId === 'CSA_AI_CM') {
      for (const [catId, cat] of Object.entries(framework.categories || {})) {
        // Add AI.ID-01, AI.ID-02 style controls
        controls.push({
          id: `${catId}-01`,
          category: catId,
          categoryName: cat.name,
          description: cat.description
        });
        controls.push({
          id: `${catId}-02`,
          category: catId,
          categoryName: cat.name,
          description: cat.description
        });
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
