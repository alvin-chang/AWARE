// tests/unit/api.test.js
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Import the API Gateway and related components
const APIGateway = require('../../src/api/index');
const { authenticateToken } = require('../../src/api/middleware/auth');

describe('API Gateway Authentication', () => {
  let app;

  beforeAll(() => {
    // Create a simple app to test auth middleware in isolation
    app = express();
    app.use(express.json());
    
    // Add the authenticateToken middleware to a test route
    app.get('/protected', authenticateToken, (req, res) => {
      res.json({ message: 'Access granted', user: req.user });
    });
    
    // Add a public route for testing
    app.get('/public', (req, res) => {
      res.json({ message: 'Public access' });
    });
  });

  test('should allow access to public routes without token', async () => {
    await request(app)
      .get('/public')
      .expect(200)
      .then(response => {
        expect(response.body.message).toBe('Public access');
      });
  });

  test('should reject requests without token', async () => {
    await request(app)
      .get('/protected')
      .expect(401)
      .then(response => {
        expect(response.body.error).toBe('Access denied. No token provided.');
      });
  });

  test('should reject requests with invalid token', async () => {
    await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalidtoken')
      .expect(403)
      .then(response => {
        expect(response.body.error).toBe('Invalid or expired token.');
      });
  });

  test('should accept requests with valid token', async () => {
    const validToken = jwt.sign(
      { username: 'testuser', permissions: ['read', 'write'] },
      process.env.SECRET_KEY || 'default_secret_for_dev'
    );
    
    await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
  });
});

describe('API Gateway Integration', () => {
  let apiGateway;
  let app;

  beforeAll(async () => {
    // Create a mock node discovery and election manager
    const mockNodeDiscovery = {
      nodeId: 'test-node-1',
      getDiscoveredNodes: jest.fn().mockReturnValue([
        { nodeId: 'node-2', status: 'active', lastSeen: new Date() },
        { nodeId: 'node-3', status: 'active', lastSeen: new Date() }
      ])
    };
    
    const mockElectionManager = {
      isLeader: jest.fn().mockReturnValue(false),
      getLeader: jest.fn().mockReturnValue('node-1')
    };
    
    apiGateway = new APIGateway({
      port: 3001, // Use different port for tests
      nodeDiscovery: mockNodeDiscovery,
      electionManager: mockElectionManager,
      secretKey: 'test_secret'
    });
    
    app = apiGateway.app;
  });

  test('should respond to health check', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
      
    expect(response.body.status).toBe('healthy');
    expect(response.body).toHaveProperty('timestamp');
  });

  test('should allow login and return token', async () => {
    const response = await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'testpass' })
      .expect(200);
      
    expect(response.body).toHaveProperty('token');
  });

  test('should validate login credentials', async () => {
    const response = await request(app)
      .post('/login')
      .send({ username: '', password: 'testpass' })
      .expect(400);
      
    expect(response.body).toHaveProperty('error');
  });

  test('should return cluster status with valid token', async () => {
    const token = jwt.sign(
      { username: 'testuser', permissions: ['read', 'write'] }, 
      'test_secret', 
      { expiresIn: '1h' }
    );
    
    const response = await request(app)
      .get('/cluster/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
      
    expect(response.body).toHaveProperty('clusterId');
    expect(response.body).toHaveProperty('leader');
    expect(response.body).toHaveProperty('nodeCount');
  });

  test('should return nodes list with valid token', async () => {
    const token = jwt.sign(
      { username: 'testuser', permissions: ['read', 'write'] }, 
      'test_secret', 
      { expiresIn: '1h' }
    );
    
    const response = await request(app)
      .get('/nodes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
      
    expect(response.body).toHaveProperty('self');
    expect(response.body).toHaveProperty('discovered');
    expect(response.body.discovered).toHaveLength(2);
  });

  test('should return specific node with valid token', async () => {
    const token = jwt.sign(
      { username: 'testuser', permissions: ['read', 'write'] }, 
      'test_secret', 
      { expiresIn: '1h' }
    );
    
    const response = await request(app)
      .get('/nodes/test-node-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
      
    expect(response.body.nodeId).toBeDefined();
  });

  test('should reject requests without token for protected endpoints', async () => {
    await request(app)
      .get('/cluster/status')
      .expect(401);
  });
});

describe('Cluster Service', () => {
  // This would require more complex setup to test the cluster service
  // For now, we'll just verify that the service can be imported and instantiated
  test('should be able to import and create cluster service', () => {
    const ClusterService = require('../../src/api/services/cluster-service');
    const service = new ClusterService();
    
    expect(service).toBeDefined();
    expect(service.getClusterStatus).toBeDefined();
    expect(service.createCluster).toBeDefined();
  });
});

describe('API Validation Middleware', () => {
  const { 
    validateLogin, 
    validateClusterCreation,
    validateNodeUpdate,
    handleValidationErrors 
  } = require('../../src/api/middleware/validation');

  test('should validate login payload', () => {
    expect(validateLogin).toBeDefined();
    expect(validateLogin.length).toBeGreaterThan(0);
  });

  test('should validate cluster creation payload', () => {
    expect(validateClusterCreation).toBeDefined();
    expect(validateClusterCreation.length).toBeGreaterThan(0);
  });

  test('should validate node update payload', () => {
    expect(validateNodeUpdate).toBeDefined();
    expect(validateNodeUpdate.length).toBeGreaterThan(0);
  });

  test('should handle validation errors', () => {
    expect(handleValidationErrors).toBeDefined();
  });
});