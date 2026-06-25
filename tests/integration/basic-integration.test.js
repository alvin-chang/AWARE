// tests/integration/basic-integration.test.js
// SEC-001: the AWAREEngine
// constructor now throws if SECRET_KEY is missing or shorter than 32 chars.
// The previous fail-open `|| 'default_secret'` allowed forged JWTs. We
// use a deterministic 32+ char test key here (not the production one).
const TEST_SECRET_KEY = 'a'.repeat(48);
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
        nodes: ['node-1', 'node-2'],
        secretKey: TEST_SECRET_KEY,
      });
    }).not.toThrow();
  });

  test('should have correct initial properties', async () => {
    engine = new AWAREEngine({
      nodeId: 'test-node',
      discoveryPort: 41238,
      broadcastPort: 41239,
      apiPort: 3002,
      nodes: ['node-1', 'node-2'],
      secretKey: TEST_SECRET_KEY,
    });

    expect(engine.config.nodeId).toBe('test-node');
    expect(engine.config.discoveryPort).toBe(41238);
    expect(engine.config.apiPort).toBe(3002);
  });

  // SEC-001 regression: constructor must throw when no secret.
  test('SEC-001: throws when secretKey is missing', () => {
    expect(() => new AWAREEngine({ nodeId: 'x' })).toThrow(/SECRET_KEY is required/);
  });

  // SEC-001 regression: constructor must throw when secret too short.
  test('SEC-001: throws when secretKey is shorter than 32 chars', () => {
    expect(() => new AWAREEngine({ nodeId: 'x', secretKey: 'short' }))
      .toThrow(/at least 32 characters/);
  });
});
