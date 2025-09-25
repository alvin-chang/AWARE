// tests/integration/basic-integration.test.js
const AWAREEngine = require('../../src/index');

describe('AWARE Engine Integration', () => {
  let engine;

  test('should initialize without throwing an error', async () => {
    // We won't actually start the full engine in tests to avoid port conflicts
    // But we can test the initialization logic
    
    expect(() => {
      engine = new AWAREEngine({
        nodeId: 'test-node',
        discoveryPort: 41238,
        broadcastPort: 41239,
        apiPort: 3002,
        nodes: ['node-1', 'node-2']
      });
    }).not.toThrow();
  });

  test('should have correct initial properties', async () => {
    engine = new AWAREEngine({
      nodeId: 'test-node',
      discoveryPort: 41238,
      broadcastPort: 41239,
      apiPort: 3002,
      nodes: ['node-1', 'node-2']
    });

    expect(engine.config.nodeId).toBe('test-node');
    expect(engine.config.discoveryPort).toBe(41238);
    expect(engine.config.apiPort).toBe(3002);
  });
});