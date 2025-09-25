// src/api/middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');

// Validation middleware that checks for validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Validation rules for cluster creation
const validateClusterCreation = [
  body('name')
    .isString().withMessage('Name must be a string')
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 1, max: 100 }).withMessage('Name must be between 1 and 100 characters'),
  body('configuration')
    .optional()
    .isObject().withMessage('Configuration must be an object'),
  body('configuration.maxNodes')
    .optional()
    .isInt({ min: 1, max: 1000 }).withMessage('Max nodes must be an integer between 1 and 1000'),
  handleValidationErrors
];

// Validation rules for node updates
const validateNodeUpdate = [
  param('nodeId')
    .isString().withMessage('Node ID must be a string')
    .notEmpty().withMessage('Node ID is required'),
  body('configuration')
    .isObject().withMessage('Configuration must be an object'),
  handleValidationErrors
];

// Validation rules for user login
const validateLogin = [
  body('username')
    .isString().withMessage('Username must be a string')
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be between 3 and 50 characters'),
  body('password')
    .isString().withMessage('Password must be a string')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
];

// Validation rules for node ID parameter
const validateNodeIdParam = [
  param('nodeId')
    .isString().withMessage('Node ID must be a string')
    .notEmpty().withMessage('Node ID is required'),
  handleValidationErrors
];

// Validation rules for cluster configuration updates
const validateClusterConfig = [
  body('configuration')
    .isObject().withMessage('Configuration must be an object'),
  body('configuration.maxNodes')
    .optional()
    .isInt({ min: 1, max: 1000 }).withMessage('Max nodes must be an integer between 1 and 1000'),
  body('configuration.heartbeatInterval')
    .optional()
    .isInt({ min: 1000 }).withMessage('Heartbeat interval must be at least 1000ms'),
  body('configuration.electionTimeout')
    .optional()
    .isInt({ min: 1000 }).withMessage('Election timeout must be at least 1000ms'),
  handleValidationErrors
];

module.exports = {
  validateClusterCreation,
  validateNodeUpdate,
  validateLogin,
  validateNodeIdParam,
  validateClusterConfig,
  handleValidationErrors
};