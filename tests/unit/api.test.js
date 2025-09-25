// tests/unit/api.test.js
const request = require('supertest');
const APIGateway = require('../../src/api');
const ElectionManager = require('../../src/election');
const NodeDiscovery = require('../../src/node-discovery');

describe('APIGateway', () => {
  let apiGateway;
  let app;
  let mockNodeDiscovery;
  let mockElectionManager;

  beforeEach(() => {
    mockNodeDiscovery = {
      nodeId: 'test-node-1',
      getDiscoveredNodes: jest.fn().mockReturnValue([
        { nodeId: 'node-2', status: 'active', lastSeen: new Date() },
        { nodeId: 'node-3', status: 'active', lastSeen: new Date() }
      ])
    };
    
    mockElectionManager = {
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

  test('should return cluster status', async () => {
    // For this test, we need to bypass authentication or create a valid token
    // In a real test, we would handle authentication properly
    const token = require('jsonwebtoken').sign(
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

  test('should return nodes list', async () => {
    const token = require('jsonwebtoken').sign(
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
});