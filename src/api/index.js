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
const agentsRouter = require('./routes/agents');
const policiesRouter = require('./routes/policies');
const metricsRouter = require('./routes/metrics');
// SC-MOD-015: previously-orphaned routes — see mounting block below.
const complianceRouter = require('./routes/compliance');
const toolsRouter = require('./routes/tools');
const { authenticateToken, authLimiter } = require('./middleware/auth');
const ClusterService = require('./services/cluster-service');

// Phase 1.4: Import kill-switch components
const killSwitchRouter = require('../kill-switch/api/kill-switch-routes');
const { RevocationService } = require('../kill-switch');

class APIGateway {
  constructor(config = {}) {
    // CRITICAL: Secret key is required - no defaults allowed
    if (!config.secretKey) {
      throw new Error('FATAL: API Gateway requires config.secretKey. No default value allowed.');
    }
    this.app = express();
    this.port = config.port || 3000;
    this.secretKey = config.secretKey;
    this.nodeDiscovery = config.nodeDiscovery;
    this.electionManager = config.electionManager;
    this.server = null;

    // Initialize cluster service
    this.clusterService = new ClusterService({
      nodeDiscovery: this.nodeDiscovery,
      electionManager: this.electionManager
    });
    
    // Phase 1.4: Initialize RevocationService
    // Note: Full Raft infrastructure (ElectionManager, StateMachine) required for proper operation
    // For now, initialize with undefined — routes will return 503 until properly wired
    this.revocationService = new RevocationService({
      electionManager: this.electionManager,
      stateMachine: undefined,
      registry: undefined
    });
    console.log('[KillSwitch] RevocationService initialized (pending Raft setup)');

    // H-01 FIX: Enforce HTTPS in production
    if (process.env.NODE_ENV === 'production') {
      this.app.use((req, res, next) => {
        if (!req.secure && req.get('X-Forwarded-Proto') !== 'https') {
          return res.status(403).json({ error: 'HTTPS required for agent operations' });
        }
        next();
      });
    }

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
    this.app.set('revocationService', this.revocationService);

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
    this.app.use('/api/agents', agentsRouter);
    this.app.use('/api/policies', policiesRouter);
    this.app.use('/api/metrics', metricsRouter);

    // Phase 1.4: Kill Switch routes
    this.app.use('/api/kill-switch', killSwitchRouter);

    // SC-MOD-015: Mount the previously-orphaned route files. Two of the
    // five (compliance.js, tools.js) export Express routers directly
    // and mount as-is. The other three (identity-v2.js, audit.js,
    // hot-reload-policies.js) export collections of route handlers
    // and need a small adapter — see src/api/routes/identity-v2.js,
    // audit.js, hot-reload-policies.js for the adapter wrappers.
    this.app.use('/api/compliance', complianceRouter);
    this.app.use('/api/tools', toolsRouter);

    // SC-MOD-015: lazy-require identity-v2 because its module-load
    // chain (auth.js + Agent.js) calls process.exit(1) if SECRET_KEY
    // is missing or <32 chars. Defer to first request so the gateway
    // can boot with config.secretKey but still surface clear errors
    // if the env validation fails at runtime.
    this.app.use('/api/identity-v2', (req, res, next) => {
      if (!this._identityV2Router) {
        try {
          const { router } = require('./routes/identity-v2');
          this._identityV2Router = router;
        } catch (err) {
          return res.status(503).json({
            success: false,
            error: 'identity-v2 routes unavailable: ' + err.message,
          });
        }
      }
      this._identityV2Router(req, res, next);
    });

    // SC-MOD-015: audit.js exports 5 route handlers (not a router).
    // Wrap them in a router with the canonical /api/audit paths
    // matching the inline comments in src/api/routes/audit.js.
    const auditHandlers = require('./routes/audit');
    const auditAdapter = require('express').Router();
    auditAdapter.post('/log', auditHandlers.logDecisionRoute);
    auditAdapter.get('/chain/:decisionId', auditHandlers.getChainRoute);
    auditAdapter.get('/verify', auditHandlers.verifyChainRoute);
    auditAdapter.get('/export', auditHandlers.exportChainRoute);
    auditAdapter.get('/records/:decisionId', auditHandlers.getRecordRoute);
    this.app.use('/api/audit', auditAdapter);

    // SC-MOD-015: hot-reload-policies.js exports 6 route handlers.
    // Wrap them with canonical /api/policies/* paths.
    const policyHandlers = require('./routes/hot-reload-policies');
    const policyAdapter = require('express').Router();
    policyAdapter.post('/validate', policyHandlers.validatePolicyRoute);
    policyAdapter.put('/:policyId', policyHandlers.updatePolicyRoute);
    policyAdapter.get('/', policyHandlers.listPoliciesRoute);
    policyAdapter.get('/:policyId', policyHandlers.getPolicyRoute);
    policyAdapter.post('/:policyId/reload', policyHandlers.reloadPolicyRoute);
    policyAdapter.get('/:policyId/history', policyHandlers.getPolicyHistoryRoute);
    this.app.use('/api/policies/hot', policyAdapter);

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