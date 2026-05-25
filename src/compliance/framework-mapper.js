// src/compliance/framework-mapper.js
// Framework Mapper — Maps AWARE components to compliance framework controls
// ADR-016: Compliance Mapping & Reporting

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
    'DORA': ['Art.12']
  },

  // Phase 1.2: Per-Agent Sandbox Policies
  'sandbox-policies': {
    'CSA_AI_CM': ['AI.OPS-04', 'AI.OPS-05'],
    'NIST_AI_RMF': ['PR.IP', 'DE.AE'],
    'ISO_27001': ['A.12.1', 'A.12.4'],
    'DORA': ['Art.12']
  },

  // Phase 1.3: Behavioural Baseline
  'behavioral-baseline': {
    'CSA_AI_CM': ['AI.MT-01'],
    'NIST_AI_RMF': ['DE.CM', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27']
  },

  // Phase 1.4: Kill Switch
  'kill-switch': {
    'CSA_AI_CM': ['AI.OPS-02', 'AI.OPS-03'],
    'NIST_AI_RMF': ['RS.MI', 'RS.RP'],
    'ISO_27001': ['A.16.1'],
    'DORA': ['Art.26']
  },

  // Phase 2.1: Pheromone Specialists
  'pheromone-specialists': {
    'CSA_AI_CM': ['AI.OT-02'],
    'NIST_AI_RMF': ['PR.IP'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12']
  },

  // Phase 2.2: Security-Weighted Heuristic
  'security-heuristic': {
    'CSA_AI_CM': ['AI.OT-01', 'AI.OT-02'],
    'NIST_AI_RMF': ['RA-1', 'RA-3'],
    'ISO_27001': ['A.12.1'],
    'DORA': ['Art.12']
  },

  // Phase 3.1A: Agent Identity & Authentication
  'identity-provider': {
    'CSA_AI_CM': ['AI.ID-01', 'AI.ID-02'],
    'NIST_AI_RMF': ['PR.AC', 'PR.AA'],
    'ISO_27001': ['A.9.2', 'A.9.4'],
    'DORA': ['Art.12']
  },

  // Phase 3.1B: Behavioural Anomaly Detection
  'anomaly-detection': {
    'CSA_AI_CM': ['AI.MT-01', 'AI.OPS-01'],
    'NIST_AI_RMF': ['DE.CM', 'DE.AE', 'RS.MA'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.26', 'Art.27']
  },

  // Phase 3.1C: Tool Access Control
  'tool-access-control': {
    'CSA_AI_CM': ['AI.OPS-04', 'AI.OPS-05'],
    'NIST_AI_RMF': ['PR.AC', 'PR.IP'],
    'ISO_27001': ['A.9.4'],
    'DORA': ['Art.12']
  },

  // Phase 3.2: Compliance Mapping
  'compliance-mapping': {
    'CSA_AI_CM': ['AI.ID-01', 'AI.MT-01'],
    'NIST_AI_RMF': ['GV.PO', 'GV.RM'],
    'ISO_27001': ['A.12.4'],
    'DORA': ['Art.12', 'Art.26']
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
