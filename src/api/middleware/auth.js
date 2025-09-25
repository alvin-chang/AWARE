// src/api/middleware/auth.js
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.SECRET_KEY || 'default_secret_for_dev';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  // Skip authentication for health checks and login
  if (req.path === '/health' || (req.path === '/login' && req.method === 'POST')) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    
    req.user = user;
    next();
  });
};

// Authorization middleware (for role-based access)
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userRole = req.user.role || 'user';
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

// Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(
    { 
      ...payload,
      iat: Math.floor(Date.now() / 1000)
    },
    SECRET_KEY,
    { expiresIn: process.env.TOKEN_EXPIRY || '24h' }
  );
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  generateToken
};