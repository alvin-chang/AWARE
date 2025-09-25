// src/api/index.js
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');

class APIGateway {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || 3000;
    this.secretKey = config.secretKey || 'default_secret_for_dev';
    this.nodeDiscovery = config.nodeDiscovery;
    this.electionManager = config.electionManager;
    this.server = null;
    
    // Middleware
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Authentication middleware
    this.app.use(this.authenticationMiddleware.bind(this));
    
    // Routes
    this.setupRoutes();
  }

  // Authentication middleware
  authenticationMiddleware(req, res, next) {
    // Skip authentication for health checks and login
    if (req.path === '/health' || (req.path === '/login' && req.method === 'POST')) {
      return next();
    }

    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
      const decoded = jwt.verify(token, this.secretKey);
      req.user = decoded;
      next();
    } catch (ex) {
      res.status(400).json({ error: 'Invalid token.' });
    }
  }

  // Setup API routes
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Login endpoint (for obtaining token)
    this.app.post('/login', (req, res) => {
      const { username, password } = req.body;
      
      // In a real implementation, you would verify credentials
      if (username && password) { // Simplified for example
        const token = jwt.sign(
          { username, permissions: ['read', 'write'] }, 
          this.secretKey, 
          { expiresIn: '1h' }
        );
        
        res.json({ token });
      } else {
        res.status(400).json({ error: 'Username and password required.' });
      }
    });

    // Cluster status endpoint
    this.app.get('/cluster/status', (req, res) => {
      try {
        const status = {
          clusterId: 'aware-cluster-1',
          leader: this.electionManager?.getLeader() || 'unknown',
          isLeader: this.electionManager?.isLeader() || false,
          nodeCount: this.nodeDiscovery ? this.nodeDiscovery.getDiscoveredNodes().length + 1 : 1, // +1 for this node
          status: 'active',
          timestamp: new Date().toISOString()
        };
        
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get cluster status' });
      }
    });

    // List all nodes
    this.app.get('/nodes', (req, res) => {
      try {
        if (!this.nodeDiscovery) {
          return res.status(500).json({ error: 'Node discovery service not available' });
        }

        const discoveredNodes = this.nodeDiscovery.getDiscoveredNodes();
        const thisNode = {
          nodeId: this.nodeDiscovery.nodeId,
          status: 'self',
          lastSeen: new Date().toISOString(),
          address: '127.0.0.1',
          capabilities: ['compute', 'storage']
        };
        
        res.json({
          self: thisNode,
          discovered: discoveredNodes,
          total: discoveredNodes.length + 1
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get nodes list' });
      }
    });

    // Get specific node status
    this.app.get('/nodes/:nodeId', (req, res) => {
      try {
        const { nodeId } = req.params;
        
        if (!this.nodeDiscovery) {
          return res.status(500).json({ error: 'Node discovery service not available' });
        }

        const discoveredNodes = this.nodeDiscovery.getDiscoveredNodes();
        const node = discoveredNodes.find(n => n.nodeId === nodeId);
        
        if (node) {
          res.json(node);
        } else if (nodeId === this.nodeDiscovery.nodeId) {
          res.json({
            nodeId: nodeId,
            status: 'self',
            lastSeen: new Date().toISOString(),
            capabilities: ['compute', 'storage']
          });
        } else {
          res.status(404).json({ error: 'Node not found' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to get node status' });
      }
    });

    // Create a new cluster
    this.app.post('/cluster', (req, res) => {
      try {
        const { name, configuration } = req.body;
        
        // In a real implementation, this would create a new cluster
        res.status(201).json({
          message: 'Cluster creation initiated',
          clusterId: `cluster-${Date.now()}`,
          name,
          status: 'initializing'
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to create cluster' });
      }
    });

    // Error handling middleware
    this.app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something went wrong!' });
    });
  }

  // Start the API server
  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`API Gateway listening on port ${this.port}`);
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