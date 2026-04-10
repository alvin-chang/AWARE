/**
 * ADR-012: Phase 2.4 — Hot-Reload Policy Controller
 * 
 * Watches etcd for policy changes and applies them atomically.
 * Per ADR-012 §Hot-Reload Watcher.
 * 
 * @module routing/policy-watcher
 * @author Forge (Coder)
 * @license GPL-3.0
 */

'use strict';

// ============================================================================
// Policy Schemas (ADR-012 F-2 fix: added blast-radius-matrix schema)
// ============================================================================

const POLICY_SCHEMAS = {
  'routing/pheromone': {
    type: 'object',
    required: ['learningRate', 'pheromoneMin', 'pheromoneMax', 'decayRate'],
    properties: {
      learningRate: { type: 'number', minimum: 0, maximum: 1 },
      pheromoneMin: { type: 'number', minimum: 0, maximum: 1 },
      pheromoneMax: { type: 'number', minimum: 0, maximum: 1 },
      decayRate: { type: 'number', minimum: 0, maximum: 1 }
    }
  },
  'routing/heuristic': {
    type: 'object',
    required: ['weights'],
    properties: {
      weights: {
        type: 'object',
        required: ['w1', 'w2', 'w3', 'w4', 'w5'],
        properties: {
          w1: { type: 'number', minimum: 0, maximum: 1 },
          w2: { type: 'number', minimum: 0, maximum: 1 },
          w3: { type: 'number', minimum: 0, maximum: 1 },
          w4: { type: 'number', minimum: 0, maximum: 1 },
          w5: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  },
  'quality-gate': {
    type: 'object',
    required: ['thresholds'],
    properties: {
      thresholds: {
        type: 'object',
        required: ['excellent', 'acceptable', 'marginal'],
        properties: {
          excellent: { type: 'number', minimum: 0, maximum: 1 },
          acceptable: { type: 'number', minimum: 0, maximum: 1 },
          marginal: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  },
  // F-2 fix: Added blast-radius-matrix schema (was referenced but not defined)
  'security/blast-radius-matrix': {
    type: 'object',
    required: ['version', 'matrix'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      lastModified: { type: 'string', format: 'date-time' },
      modifiedBy: { type: 'string' },
      matrix: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { type: 'number', minimum: 0, maximum: 1 }
        }
      },
      defaults: {
        type: 'object',
        properties: {
          readOnlyAgent: { type: 'number', minimum: 0, maximum: 1 },
          networkAgent: { type: 'number', minimum: 0, maximum: 1 },
          credentialedAgent: { type: 'number', minimum: 0, maximum: 1 },
          adminAgent: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  }
};

// ============================================================================
// Debounce Queue
// ============================================================================

/**
 * @typedef {Object} DebounceEntry
 * @property {string} key - Policy path
 * @property {Object} content - New policy content
 * @property {number} timestamp - First event timestamp
 */

/**
 * Debounce queue for burst changes.
 * @type {Map<string, DebounceEntry>}
 */
const debounceQueue = new Map();

/**
 * Debounce window in milliseconds.
 */
const DEBOUNCE_WINDOW_MS = 100;

/**
 * Add event to debounce queue.
 * @param {string} key 
 * @param {Object} content 
 * @returns {boolean} True if should fire now
 */
function enqueueDebounce(key, content) {
  const now = Date.now();
  
  if (!debounceQueue.has(key)) {
    debounceQueue.set(key, {
      key,
      content,
      timestamp: now
    });
    return false;  // First event, wait for debounce
  }
  
  // Update existing entry
  debounceQueue.get(key).content = content;
  return false;  // Updated, still waiting
}

/**
 * Process debounce queue and return entries ready to fire.
 * @returns {DebounceEntry[]}
 */
function processDebounceQueue() {
  const now = Date.now();
  const ready = [];
  
  for (const [key, entry] of debounceQueue) {
    if (now - entry.timestamp >= DEBOUNCE_WINDOW_MS) {
      ready.push(entry);
      debounceQueue.delete(key);
    }
  }
  
  return ready;
}

// ============================================================================
// Schema Validation (simplified — no external JSON Schema validator)
// ============================================================================

/**
 * Validate policy content against schema.
 * Per ADR-012 §Schema Validation.
 * 
 * @param {string} policyPath - e.g., 'routing/heuristic'
 * @param {Object} content - Policy content
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePolicy(policyPath, content) {
  const schema = POLICY_SCHEMAS[policyPath];
  
  if (!schema) {
    return { valid: false, errors: [`No schema defined for ${policyPath}`] };
  }
  
  const errors = [];
  
  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in content)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Check property types and constraints
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in content) {
        const value = content[key];
        
        // Type check
        if (prop.type === 'number' && typeof value !== 'number') {
          errors.push(`${key} must be a number, got ${typeof value}`);
        }
        if (prop.type === 'string' && typeof value !== 'string') {
          errors.push(`${key} must be a string, got ${typeof value}`);
        }
        if (prop.type === 'object' && (typeof value !== 'object' || value === null)) {
          errors.push(`${key} must be an object, got ${typeof value}`);
        }
        
        // Constraint checks
        if (typeof value === 'number') {
          if (prop.minimum !== undefined && value < prop.minimum) {
            errors.push(`${key} must be >= ${prop.minimum}, got ${value}`);
          }
          if (prop.maximum !== undefined && value > prop.maximum) {
            errors.push(`${key} must be <= ${prop.maximum}, got ${value}`);
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// Policy Watcher (simulated — no actual etcd)
// ============================================================================

/**
 * @typedef {Object} PolicyWatcher
 * @property {boolean} watching - Whether watcher is active
 * @property {Function} onchange - Callback for policy changes
 */

/**
 * Create a policy watcher.
 * In production, this would subscribe to etcd watch events.
 * 
 * @param {Object} options
 * @param {Function} options.onchange - Callback(path, content)
 * @returns {PolicyWatcher}
 */
function createPolicyWatcher(options = {}) {
  const { onchange } = options;
  
  return {
    watching: false,
    
    /**
     * Start watching for policy changes.
     */
    start() {
      this.watching = true;
      console.log('[policy-watcher] Started');
    },
    
    /**
     * Stop watching.
     */
    stop() {
      this.watching = false;
      console.log('[policy-watcher] Stopped');
    },
    
    /**
     * Simulate receiving a policy change event.
     * In production, this would be called by etcd watch.
     * 
     * @param {string} path - Policy path
     * @param {Object} content - New content
     */
    onPolicyChange(path, content) {
      if (!this.watching) return;
      
      // Enqueue for debouncing
      enqueueDebounce(path, content);
      
      // Process debounce queue
      const ready = processDebounceQueue();
      for (const entry of ready) {
        this._applyPolicy(entry.key, entry.content);
      }
    },
    
    /**
     * Apply validated policy change.
     * @param {string} path 
     * @param {Object} content 
     */
    _applyPolicy(path, content) {
      // Validate
      const policyKey = path.replace('/aware/policies/', '').replace('.json', '');
      const { valid, errors } = validatePolicy(policyKey, content);
      
      if (!valid) {
        console.error(`[policy-watcher] Validation failed for ${path}:`, errors);
        // TODO: Alert on-call
        return { success: false, errors };
      }
      
      // Call onchange callback
      if (onchange) {
        onchange(path, content);
      }
      
      console.log(`[policy-watcher] Policy applied: ${path}`);
      return { success: true };
    }
  };
}

// ============================================================================
// Double-Buffer State Machine (ADR-012 F-1 fix)
// ============================================================================

/**
 * @typedef {Object} PolicyState
 * @property {Object} routing - Routing policies
 * @property {Object} security - Security policies
 * @property {number} version - Policy version
 */

/**
 * @typedef {Object} DoubleBuffer
 * @property {PolicyState} oldState - Old policy state for in-flight requests
 * @property {PolicyState} newState - New policy state
 * @property {number} pendingCount - In-flight request count
 * @property {number} maxInFlightAge - Max age before GC (default 5 min)
 */

/**
 * @type {DoubleBuffer}
 */
const doubleBuffer = {
  oldState: null,
  newState: null,
  pendingCount: 0,
  maxInFlightAge: 5 * 60 * 1000,  // 5 minutes
  lastSwap: null
};

/**
 * Swap to new policy state.
 * @param {PolicyState} newState 
 */
function swapPolicyState(newState) {
  doubleBuffer.oldState = doubleBuffer.newState;
  doubleBuffer.newState = newState;
  doubleBuffer.pendingCount = 0;
  doubleBuffer.lastSwap = Date.now();
}

/**
 * Increment in-flight request counter.
 */
function requestStart() {
  doubleBuffer.pendingCount++;
}

/**
 * Decrement in-flight request counter.
 */
function requestEnd() {
  doubleBuffer.pendingCount--;
  if (doubleBuffer.pendingCount < 0) {
    doubleBuffer.pendingCount = 0;
  }
}

/**
 * Check if old state can be garbage collected.
 * @returns {boolean}
 */
function canGC() {
  if (doubleBuffer.pendingCount === 0) {
    const age = Date.now() - doubleBuffer.lastSwap;
    return age > doubleBuffer.maxInFlightAge;
  }
  return false;
}

/**
 * Get current active policy state for new requests.
 * @returns {PolicyState}
 */
function getActiveState() {
  return doubleBuffer.newState;
}

/**
 * Get old policy state for in-flight requests.
 * @returns {PolicyState}
 */
function getInFlightState() {
  return doubleBuffer.oldState;
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Constants
  POLICY_SCHEMAS,
  DEBOUNCE_WINDOW_MS,
  
  // Functions
  validatePolicy,
  createPolicyWatcher,
  
  // Double-buffer
  swapPolicyState,
  requestStart,
  requestEnd,
  canGC,
  getActiveState,
  getInFlightState,
  
  // Debounce
  enqueueDebounce,
  processDebounceQueue
};
