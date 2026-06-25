// src/policies/tool-catalog.js
// Tool Catalog — Registry of available tools and their risk levels
// Phase 1.2: Per-Agent Sandbox Policies

const fs = require('fs');
const path = require('path');
const { ToolRiskLevel } = require('./model');

/**
 * Default tool definitions
 */
const DEFAULT_TOOLS = {
  // Read operations (LOW risk)
  'http_request:GET': {
    riskLevel: ToolRiskLevel.LOW,
    category: 'network',
    description: 'HTTP GET requests for data retrieval',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '1000/hour'
  },
  'http_request:HEAD': {
    riskLevel: ToolRiskLevel.LOW,
    category: 'network',
    description: 'HTTP HEAD requests for resource checking',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL'],
    rateLimit: '500/hour'
  },

  // Write operations (MEDIUM risk)
  'http_request:POST': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'network',
    description: 'HTTP POST requests for data submission',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL'],
    rateLimit: '100/hour'
  },
  'http_request:PUT': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'network',
    description: 'HTTP PUT requests for resource updates',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '50/hour'
  },
  'http_request:PATCH': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'network',
    description: 'HTTP PATCH requests for partial updates',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '50/hour'
  },

  // Delete operations (HIGH risk)
  'http_request:DELETE': {
    riskLevel: ToolRiskLevel.HIGH,
    category: 'network',
    description: 'HTTP DELETE requests for resource removal',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '10/hour'
  },

  // Agent operations (MEDIUM-HIGH risk)
  'sessions_send': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'agent',
    description: 'Send message to another agent',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '200/hour'
  },
  'sessions_spawn': {
    riskLevel: ToolRiskLevel.HIGH,
    category: 'agent',
    description: 'Spawn a new agent sub-process',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '20/hour'
  },
  'subagents:kill': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'agent',
    description: 'Terminate a spawned sub-agent',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '10/hour'
  },

  // File operations (HIGH-CRITICAL risk)
  'file:read': {
    riskLevel: ToolRiskLevel.HIGH,
    category: 'filesystem',
    description: 'Read contents of a file',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '500/hour',
    pathRestrictions: ['<host-config>/workspace-coder/', './']
  },
  'file:write': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'filesystem',
    description: 'Write or create a file',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '50/hour',
    pathRestrictions: ['./', '<host-config>/workspace-coder/']
  },
  'file:delete': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'filesystem',
    description: 'Delete a file',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '5/hour',
    pathRestrictions: ['./', '<host-config>/workspace-coder/']
  },
  'exec:run': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'system',
    description: 'Execute shell commands',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL'],
    rateLimit: '20/hour',
    allowedCommands: ['git', 'npm', 'node', 'ls', 'cat', 'grep']
  },
  'exec:bash': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'system',
    description: 'Execute bash shell commands',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '10/hour',
    allowedCommands: ['git', 'npm', 'node', 'ls', 'cat', 'grep', 'find']
  },

  // Credential operations (CRITICAL risk)
  'credential:read': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'security',
    description: 'Read stored credentials',
    requiresApproval: true,
    allowedDataTiers: ['RESTRICTED'],
    rateLimit: '5/hour'
  },
  'credential:write': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'security',
    description: 'Store new credentials',
    requiresApproval: true,
    allowedDataTiers: ['RESTRICTED'],
    rateLimit: '2/hour'
  },

  // Search operations (LOW risk)
  'web_search': {
    riskLevel: ToolRiskLevel.LOW,
    category: 'search',
    description: 'Perform web searches',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL'],
    rateLimit: '50/hour'
  },
  'browser:navigate': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'browser',
    description: 'Navigate browser to URL',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL'],
    rateLimit: '100/hour'
  },

  // Database operations (HIGH risk)
  'database:query': {
    riskLevel: ToolRiskLevel.HIGH,
    category: 'database',
    description: 'Execute database queries',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '100/hour'
  },
  'database:write': {
    riskLevel: ToolRiskLevel.CRITICAL,
    category: 'database',
    description: 'Execute database write operations',
    requiresApproval: true,
    allowedDataTiers: ['CONFIDENTIAL', 'RESTRICTED'],
    rateLimit: '20/hour'
  },

  // Communication operations (MEDIUM risk)
  'message:send': {
    riskLevel: ToolRiskLevel.MEDIUM,
    category: 'communication',
    description: 'Send message to external channels',
    requiresApproval: false,
    allowedDataTiers: ['PUBLIC', 'INTERNAL'],
    rateLimit: '50/hour'
  },
  'message:email': {
    riskLevel: ToolRiskLevel.HIGH,
    category: 'communication',
    description: 'Send emails',
    requiresApproval: true,
    allowedDataTiers: ['INTERNAL', 'CONFIDENTIAL'],
    rateLimit: '20/hour'
  }
};

/**
 * Default risk level for unknown tools
 */
const DEFAULT_RISK_LEVEL = ToolRiskLevel.HIGH;
const DEFAULT_REQUIRES_APPROVAL = true;

class ToolCatalog {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.catalogPath - Path to tools.json file
   */
  constructor(config = {}) {
    this.catalogPath = config.catalogPath || path.join(__dirname, '../../data/tools.json');
    this.tools = { ...DEFAULT_TOOLS };
    this.customTools = {};
    
    // Load custom tools if file exists
    this._loadCatalog();
  }

  /**
   * Load catalog from file
   * @private
   */
  _loadCatalog() {
    try {
      if (fs.existsSync(this.catalogPath)) {
        const data = fs.readFileSync(this.catalogPath, 'utf8');
        const parsed = JSON.parse(data);
        this.customTools = parsed.tools || {};
        // Merge custom tools (custom takes precedence)
        this.tools = { ...DEFAULT_TOOLS, ...this.customTools };
      }
    } catch (error) {
      console.error(`[TOOL_CATALOG] Failed to load catalog: ${error.message}`);
    }
  }

  /**
   * Save catalog to file
   * @private
   */
  _saveCatalog() {
    try {
      const dir = path.dirname(this.catalogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        tools: this.customTools
      };
      fs.writeFileSync(this.catalogPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[TOOL_CATALOG] Failed to save catalog: ${error.message}`);
    }
  }

  /**
   * Get tool definition
   * @param {string} toolName - Tool name
   * @returns {Object} Tool definition
   */
  getTool(toolName) {
    return this.tools[toolName] || null;
  }

  /**
   * Get risk level for a tool
   * @param {string} toolName - Tool name
   * @returns {string} Risk level
   */
  getRiskLevel(toolName) {
    const tool = this.tools[toolName];
    return tool ? tool.riskLevel : DEFAULT_RISK_LEVEL;
  }

  /**
   * Check if tool requires approval
   * @param {string} toolName - Tool name
   * @returns {boolean}
   */
  requiresApproval(toolName) {
    const tool = this.tools[toolName];
    return tool ? tool.requiresApproval : DEFAULT_REQUIRES_APPROVAL;
  }

  /**
   * Check if a tool is allowed for a given data tier
   * @param {string} toolName - Tool name
   * @param {string} dataTier - Data tier
   * @returns {boolean}
   */
  isAllowedForDataTier(toolName, dataTier) {
    const tool = this.tools[toolName];
    if (!tool) return false;
    if (!tool.allowedDataTiers) return true;
    return tool.allowedDataTiers.includes(dataTier);
  }

  /**
   * Get rate limit for a tool
   * @param {string} toolName - Tool name
   * @returns {string} Rate limit string
   */
  getRateLimit(toolName) {
    const tool = this.tools[toolName];
    return tool ? tool.rateLimit : '10/hour';
  }

  /**
   * Get all tools in a category
   * @param {string} category - Category name
   * @returns {Array} Array of tool definitions
   */
  getToolsByCategory(category) {
    return Object.entries(this.tools)
      .filter(([_, tool]) => tool.category === category)
      .map(([name, tool]) => ({ name, ...tool }));
  }

  /**
   * Get all tools with a specific risk level
   * @param {string} riskLevel - Risk level
   * @returns {Array} Array of tool definitions
   */
  getToolsByRiskLevel(riskLevel) {
    return Object.entries(this.tools)
      .filter(([_, tool]) => tool.riskLevel === riskLevel)
      .map(([name, tool]) => ({ name, ...tool }));
  }

  /**
   * Register a custom tool
   * @param {string} toolName - Tool name
   * @param {Object} toolDef - Tool definition
   */
  registerTool(toolName, toolDef) {
    if (!toolDef.riskLevel) {
      toolDef.riskLevel = DEFAULT_RISK_LEVEL;
    }
    if (toolDef.requiresApproval === undefined) {
      toolDef.requiresApproval = DEFAULT_REQUIRES_APPROVAL;
    }
    this.customTools[toolName] = toolDef;
    this.tools[toolName] = toolDef;
    this._saveCatalog();
  }

  /**
   * Unregister a custom tool (restores default if exists)
   * @param {string} toolName - Tool name
   */
  unregisterTool(toolName) {
    delete this.customTools[toolName];
    if (DEFAULT_TOOLS[toolName]) {
      this.tools[toolName] = DEFAULT_TOOLS[toolName];
    } else {
      delete this.tools[toolName];
    }
    this._saveCatalog();
  }

  /**
   * List all registered tools
   * @returns {Array} Array of tool names
   */
  listTools() {
    return Object.keys(this.tools);
  }

  /**
   * Get full catalog (for API responses)
   * @returns {Object} Full catalog
   */
  getCatalog() {
    return {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      toolCount: Object.keys(this.tools).length,
      tools: this.tools,
      riskLevels: {
        LOW: this.getToolsByRiskLevel(ToolRiskLevel.LOW).length,
        MEDIUM: this.getToolsByRiskLevel(ToolRiskLevel.MEDIUM).length,
        HIGH: this.getToolsByRiskLevel(ToolRiskLevel.HIGH).length,
        CRITICAL: this.getToolsByRiskLevel(ToolRiskLevel.CRITICAL).length
      }
    };
  }

  /**
   * Check if a tool is known (registered)
   * @param {string} toolName - Tool name
   * @returns {boolean}
   */
  isKnownTool(toolName) {
    return toolName in this.tools;
  }
}

// Singleton instance
let toolCatalogInstance = null;

/**
 * Get or create the tool catalog singleton
 * @param {Object} config - Configuration
 * @returns {ToolCatalog}
 */
function getToolCatalog(config = {}) {
  if (!toolCatalogInstance) {
    toolCatalogInstance = new ToolCatalog(config);
  }
  return toolCatalogInstance;
}

module.exports = {
  ToolCatalog,
  getToolCatalog,
  DEFAULT_TOOLS,
  ToolRiskLevel,
  DEFAULT_RISK_LEVEL,
  DEFAULT_REQUIRES_APPROVAL
};
