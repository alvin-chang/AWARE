// src/api/middleware/auth.js
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const SECRET_KEY = process.env.SECRET_KEY || 'default_secret_for_dev';

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication middleware with enhanced security
const authenticateToken = (req, res, next) => {
  // Skip authentication for health checks and login
  if (req.path === '/health' || (req.path === '/login' && req.method === 'POST')) {
    return next();
  }

  // Check for token in header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Verify token with additional security checks
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(403).json({ error: 'Token has expired. Please log in again.' });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(403).json({ error: 'Invalid token. Authentication failed.' });
      }
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    
    // Additional security check: ensure token has required fields
    if (!user.username) {
      return res.status(403).json({ error: 'Invalid token: missing user information.' });
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

// Generate JWT token with security best practices
const generateToken = (payload) => {
  // Validate payload contains required fields
  if (!payload.username) {
    throw new Error('Username is required to generate token');
  }

  return jwt.sign(
    { 
      ...payload,
      iat: Math.floor(Date.now() / 1000), // Issued at time
      jti: require('crypto').randomBytes(16).toString('hex') // JWT ID for potential revocation
    },
    SECRET_KEY,
    { 
      expiresIn: process.env.TOKEN_EXPIRY || '24h',
      algorithm: 'HS256' // Explicitly specify algorithm
    }
  );
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  generateToken,
  authLimiter // Export the rate limiter for use in routes
};