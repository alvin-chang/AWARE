// src/api/index.js
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const clusterRouter = require('./routes/cluster');
const nodesRouter = require('./routes/nodes');
const alertsRouter = require('./routes/alerts');
const resourcesRouter = require('./routes/resources');
const { authenticateToken, authLimiter } = require('./middleware/auth');
const ClusterService = require('./services/cluster-service');

class APIGateway {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || 3000;
    this.secretKey = config.secretKey || 'default_secret_for_dev';
    this.nodeDiscovery = config.nodeDiscovery;
    this.electionManager = config.electionManager;
    this.server = null;
    
    // Initialize cluster service
    this.clusterService = new ClusterService({
      nodeDiscovery: this.nodeDiscovery,
      electionManager: this.electionManager
    });
    
    // Security middleware
    this.app.use(helmet({  // Security headers
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      }
    }));
    
    // Rate limiting for all requests
    const generalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(generalLimiter);
    
    // CORS middleware
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || [process.env.FRONTEND_URL || 'http://localhost:3001'],
      credentials: true,
      optionsSuccessStatus: 200
    }));
    
    // Body parsing middleware
    this.app.use(express.json({ 
      limit: '10mb'  // Limit request size
    }));
    this.app.use(express.urlencoded({ 
      extended: true,
      limit: '10mb'  // Limit request size
    }));
    
    // Make services available to routes
    this.app.set('nodeDiscovery', this.nodeDiscovery);
    this.app.set('electionManager', this.electionManager);
    this.app.set('clusterService', this.clusterService);
    
    // Public routes (no authentication required)
    this.app.use('/health', (req, res) => {
      res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Login route with rate limiting
    this.app.post('/login', authLimiter, (req, res) => {
      const { username, password } = req.body;
      
      // Import User model locally to avoid circular dependencies
      const User = require('./models/User');
      
      // Validate user credentials against the user database
      const user = User.validateCredentials(username, password);
      
      if (user) {
        const token = jwt.sign(
          { 
            userId: user.id,
            username: user.username, 
            permissions: user.role === 'admin' ? ['read', 'write', 'admin'] : ['read', 'write'],
            role: user.role
          }, 
          this.secretKey, 
          { expiresIn: process.env.TOKEN_EXPIRY || '24h' }
        );
        
        res.json({ 
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email
          }
        });
      } else {
        // Invalid credentials
        res.status(401).json({ 
          error: 'Invalid username or password' 
        });
      }
    });

    // User registration route with rate limiting
    this.app.post('/register', authLimiter, (req, res) => {
      const { username, email, password, role } = req.body;
      
      // Import User model locally to avoid circular dependencies
      const User = require('./models/User');
      
      // Validate input
      if (!username || !email || !password) {
        return res.status(400).json({ 
          error: 'Username, email, and password are required' 
        });
      }
      
      // Check if user already exists
      const existingUser = User.findByUsername(username);
      if (existingUser) {
        return res.status(409).json({ 
          error: 'Username already exists' 
        });
      }
      
      try {
        // Create new user (default role is 'user')
        const newUser = User.create(username, email, password, role || 'user');
        
        // Generate token for the new user
        const token = jwt.sign(
          { 
            userId: newUser.id,
            username: newUser.username, 
            permissions: newUser.role === 'admin' ? ['read', 'write', 'admin'] : ['read', 'write'],
            role: newUser.role
          }, 
          this.secretKey, 
          { expiresIn: process.env.TOKEN_EXPIRY || '24h' }
        );
        
        res.status(201).json({ 
          message: 'User registered successfully',
          token,
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            email: newUser.email
          }
        });
      } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ 
          error: 'Failed to register user' 
        });
      }
    });

    // Protected routes (authentication required)
    this.app.use(authenticateToken);
    
    // API routes
    this.app.use('/api/cluster', clusterRouter);
    this.app.use('/api/nodes', nodesRouter);
    this.app.use('/api/alerts', alertsRouter);
    this.app.use('/api/resources', resourcesRouter);
    
    // Catch-all for undefined routes
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Error handling middleware
    this.app.use((err, req, res, next) => {
      console.error(err.stack);
      
      // Don't expose stack traces in production
      if (process.env.NODE_ENV === 'production') {
        res.status(500).json({ error: 'Internal server error' });
      } else {
        res.status(500).json({ error: 'Something went wrong!', details: err.message });
      }
    });
  }

  // Start the API server
  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`API Gateway listening on port ${this.port}`);
        console.log(`API endpoints available at http://localhost:${this.port}/api/`);
        resolve();
      }).on('error', (err) => {
        console.error('API Gateway error:', err);
        reject(err);
      });
    });
  }

  // Stop the API server
  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = APIGateway;