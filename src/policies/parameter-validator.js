// src/policies/parameter-validator.js
// Parameter Validator — Validates tool parameters against schema
// ADR-015 F-1 FIX: Parameter Schema Validation

/**
 * Type validators
 */
const PARAMETER_VALIDATORS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && !isNaN(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  integer: (value) => Number.isInteger(value),
  null: (value) => value === null,
  undefined: (value) => value === undefined
};

/**
 * Validate tool parameters against parameter schema
 * @param {string} toolId - Tool ID (for error messages)
 * @param {Object} parameters - Actual parameters provided
 * @param {Object} schema - Parameter schema { parameters: { paramName: { type, required, ... } } }
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateParameters(toolId, parameters, schema) {
  const errors = [];

  if (!schema || !schema.parameters) {
    return { valid: true }; // No schema = no validation
  }

  const providedParams = parameters || {};

  for (const [paramName, paramSchema] of Object.entries(schema.parameters)) {
    const value = providedParams[paramName];

    // Check required
    if (paramSchema.required && (value === undefined || value === null)) {
      errors.push({
        param: paramName,
        error: 'REQUIRED',
        message: `Parameter '${paramName}' is required for tool '${toolId}'`
      });
      continue;
    }

    // Skip validation if not provided and not required
    if (value === undefined || value === null) continue;

    // Type validation
    if (paramSchema.type) {
      const validator = PARAMETER_VALIDATORS[paramSchema.type];
      if (!validator) {
        errors.push({
          param: paramName,
          error: 'INVALID_TYPE_DEFINITION',
          message: `Unknown type '${paramSchema.type}' in schema for '${paramName}'`
        });
        continue;
      }

      if (!validator(value)) {
        errors.push({
          param: paramName,
          error: 'INVALID_TYPE',
          message: `Parameter '${paramName}' must be of type '${paramSchema.type}', got '${typeof value}'`,
          expected: paramSchema.type,
          actual: typeof value
        });
        continue;
      }
    }

    // String constraints
    if (paramSchema.type === 'string') {
      if (paramSchema.minLength !== undefined && value.length < paramSchema.minLength) {
        errors.push({
          param: paramName,
          error: 'MIN_LENGTH_EXCEEDED',
          message: `Parameter '${paramName}' must be at least ${paramSchema.minLength} characters`,
          expected: paramSchema.minLength,
          actual: value.length
        });
      }

      if (paramSchema.maxLength !== undefined && value.length > paramSchema.maxLength) {
        errors.push({
          param: paramName,
          error: 'MAX_LENGTH_EXCEEDED',
          message: `Parameter '${paramName}' must be at most ${paramSchema.maxLength} characters`,
          expected: paramSchema.maxLength,
          actual: value.length
        });
      }

      if (paramSchema.pattern) {
        const regex = new RegExp(paramSchema.pattern);
        if (!regex.test(value)) {
          errors.push({
            param: paramName,
            error: 'PATTERN_MISMATCH',
            message: `Parameter '${paramName}' does not match required pattern`,
            pattern: paramSchema.pattern
          });
        }
      }
    }

    // Number constraints
    if (paramSchema.type === 'number' || paramSchema.type === 'integer') {
      if (paramSchema.min !== undefined && value < paramSchema.min) {
        errors.push({
          param: paramName,
          error: 'MIN_VALUE_EXCEEDED',
          message: `Parameter '${paramName}' must be at least ${paramSchema.min}`,
          expected: paramSchema.min,
          actual: value
        });
      }

      if (paramSchema.max !== undefined && value > paramSchema.max) {
        errors.push({
          param: paramName,
          error: 'MAX_VALUE_EXCEEDED',
          message: `Parameter '${paramName}' must be at most ${paramSchema.max}`,
          expected: paramSchema.max,
          actual: value
        });
      }
    }

    // Array constraints
    if (paramSchema.type === 'array') {
      if (paramSchema.minItems !== undefined && value.length < paramSchema.minItems) {
        errors.push({
          param: paramName,
          error: 'MIN_ITEMS_EXCEEDED',
          message: `Parameter '${paramName}' must have at least ${paramSchema.minItems} items`,
          expected: paramSchema.minItems,
          actual: value.length
        });
      }

      if (paramSchema.maxItems !== undefined && value.length > paramSchema.maxItems) {
        errors.push({
          param: paramName,
          error: 'MAX_ITEMS_EXCEEDED',
          message: `Parameter '${paramName}' must have at most ${paramSchema.maxItems} items`,
          expected: paramSchema.maxItems,
          actual: value.length
        });
      }

      if (paramSchema.items) {
        // Validate each item
        for (let i = 0; i < value.length; i++) {
          const itemValidator = PARAMETER_VALIDATORS[paramSchema.items.type];
          if (itemValidator && !itemValidator(value[i])) {
            errors.push({
              param: paramName,
              error: 'INVALID_ARRAY_ITEM_TYPE',
              message: `Item at index ${i} in '${paramName}' must be of type '${paramSchema.items.type}'`,
              index: i,
              actualType: typeof value[i]
            });
          }
        }
      }
    }

    // Enum validation (works for string, number, integer)
    if (paramSchema.enum && !paramSchema.enum.includes(value)) {
      errors.push({
        param: paramName,
        error: 'INVALID_ENUM',
        message: `Parameter '${paramName}' must be one of: [${paramSchema.enum.join(', ')}]`,
        expected: paramSchema.enum,
        actual: value
      });
    }

    // Custom validator function
    if (paramSchema.validate && typeof paramSchema.validate === 'function') {
      try {
        const customResult = paramSchema.validate(value);
        if (customResult !== true) {
          errors.push({
            param: paramName,
            error: 'CUSTOM_VALIDATION_FAILED',
            message: customResult || 'Custom validation failed',
            customError: customResult
          });
        }
      } catch (e) {
        errors.push({
          param: paramName,
          error: 'CUSTOM_VALIDATION_ERROR',
          message: `Custom validation threw error: ${e.message}`,
          exception: e.message
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a parameter schema builder
 * @returns {Object} Schema builder
 */
function createSchemaBuilder() {
  const schema = {
    parameters: {}
  };

  return {
    /**
     * Add a string parameter
     * @param {string} name - Parameter name
     * @param {Object} config - Parameter config
     */
    string(name, config = {}) {
      schema.parameters[name] = {
        type: 'string',
        required: config.required || false,
        minLength: config.minLength,
        maxLength: config.maxLength,
        pattern: config.pattern,
        enum: config.enum,
        validate: config.validate
      };
      return this;
    },

    /**
     * Add a number parameter
     * @param {string} name - Parameter name
     * @param {Object} config - Parameter config
     */
    number(name, config = {}) {
      schema.parameters[name] = {
        type: 'number',
        required: config.required || false,
        min: config.min,
        max: config.max,
        enum: config.enum,
        validate: config.validate
      };
      return this;
    },

    /**
     * Add an integer parameter
     * @param {string} name - Parameter name
     * @param {Object} config - Parameter config
     */
    integer(name, config = {}) {
      schema.parameters[name] = {
        type: 'integer',
        required: config.required || false,
        min: config.min,
        max: config.max,
        enum: config.enum,
        validate: config.validate
      };
      return this;
    },

    /**
     * Add a boolean parameter
     * @param {string} name - Parameter name
     */
    boolean(name, config = {}) {
      schema.parameters[name] = {
        type: 'boolean',
        required: config.required || false
      };
      return this;
    },

    /**
     * Add an array parameter
     * @param {string} name - Parameter name
     * @param {Object} config - Parameter config
     */
    array(name, config = {}) {
      schema.parameters[name] = {
        type: 'array',
        required: config.required || false,
        minItems: config.minItems,
        maxItems: config.maxItems,
        items: config.items
      };
      return this;
    },

    /**
     * Add an object parameter
     * @param {string} name - Parameter name
     * @param {Object} config - Parameter config
     */
    object(name, config = {}) {
      schema.parameters[name] = {
        type: 'object',
        required: config.required || false,
        validate: config.validate
      };
      return this;
    },

    /**
     * Build the schema
     */
    build() {
      return { ...schema };
    }
  };
}

module.exports = {
  validateParameters,
  createSchemaBuilder,
  PARAMETER_VALIDATORS
};
