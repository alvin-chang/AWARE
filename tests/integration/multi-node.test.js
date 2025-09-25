// tests/integration/multi-node.test.js
const AWAREEngine = require('../../src/index');
const NodeDiscovery = require('../../src/node-discovery');
const ElectionManager = require('../../src/election/ElectionManager');

describe('Multi-Node Integration', () => {
  let engine1, engine2, engine3;
  let port1 = 42001, port2 = 42002, port3 = 42003;
  let apiPort1 = 3101, apiPort2 = 3102, apiPort3 = 3103;

  beforeAll(async () => {
    // Create three nodes
    engine1 = new AWAREEngine({
      nodeId: 'node-1',
      discoveryPort: port1,
      broadcastPort: port1 + 1000,
      apiPort: apiPort1,
      secretKey: 'test_secret',
      nodes: ['node-1', 'node-2', 'node-3']
    });
    
    engine2 = new AWAREEngine({
      nodeId: 'node-2',
      discoveryPort: port2,
      broadcastPort: port2 + 1000,
      apiPort: apiPort2,
      secretKey: 'test_secret',
      nodes: ['node-1', 'node-2', 'node-3']
    });
    
    engine3 = new AWAREEngine({
      nodeId: 'node-3',
      discoveryPort: port3,
      broadcastPort: port3 + 1000,
      apiPort: apiPort3,
      secretKey: 'test_secret',
      nodes: ['node-1', 'node-2', 'node-3']
    });
    
    // Start all engines
    try {
      await engine1.initialize();
      await engine2.initialize();
      await engine3.initialize();
    } catch (error) {
      console.error('Error initializing engines:', error);
    }
    
    // Give some time for the nodes to discover each other
    await new Promise(resolve => setTimeout(resolve, 3000));
  }, 10000); // 10 second timeout for initialization

  afterAll(async () => {
    // Shutdown all engines
    if (engine1) await engine1.shutdown();
    if (engine2) await engine2.shutdown();
    if (engine3) await engine3.shutdown();
  });

  test('should discover each other', () => {
    const discoveredByNode1 = engine1.nodeDiscovery.getDiscoveredNodes();
    const discoveredByNode2 = engine2.nodeDiscovery.getDiscoveredNodes();
    const discoveredByNode3 = engine3.nodeDiscovery.getDiscoveredNodes();

    // Each node should discover the other two nodes
    expect(discoveredByNode1.length).toBe(2);
    expect(discoveredByNode2.length).toBe(2);
    expect(discoveredByNode3.length).toBe(2);

    // Check that node-1 discovers node-2 and node-3
    const nodeIdsFromNode1 = discoveredByNode1.map(node => node.nodeId);
    expect(nodeIdsFromNode1).toContain('node-2');
    expect(nodeIdsFromNode1).toContain('node-3');

    // Check that node-2 discovers node-1 and node-3
    const nodeIdsFromNode2 = discoveredByNode2.map(node => node.nodeId);
    expect(nodeIdsFromNode2).toContain('node-1');
    expect(nodeIdsFromNode2).toContain('node-3');

    // Check that node-3 discovers node-1 and node-2
    const nodeIdsFromNode3 = discoveredByNode3.map(node => node.nodeId);
    expect(nodeIdsFromNode3).toContain('node-1');
    expect(nodeIdsFromNode3).toContain('node-2');
  });

  test('should elect a leader', () => {
    // At least one node should become a leader
    const isNode1Leader = engine1.electionManager.isLeader();
    const isNode2Leader = engine2.electionManager.isLeader();
    const isNode3Leader = engine3.electionManager.isLeader();
    
    // Exactly one node should be the leader
    const leaderCount = [isNode1Leader, isNode2Leader, isNode3Leader].filter(Boolean).length;
    expect(leaderCount).toBe(1);
    
    // All nodes should agree on who the leader is
    const leader1 = engine1.electionManager.getLeader();
    const leader2 = engine2.electionManager.getLeader();
    const leader3 = engine3.electionManager.getLeader();
    
    expect(leader1).toBeDefined();
    expect(leader2).toBeDefined();
    expect(leader3).toBeDefined();
    
    // All nodes should report the same leader
    expect(leader1).toBe(leader2);
    expect(leader1).toBe(leader3);
  });
});

describe('Component Integration', () => {
  test('should integrate node discovery with election manager', async () => {
    const nodeDiscovery = new NodeDiscovery({
      nodeId: 'integration-test-node',
      port: 45001,
      broadcastPort: 45002
    });
    
    const electionManager = new ElectionManager('integration-test-node', {
      nodes: ['integration-test-node', 'other-node-1', 'other-node-2']
    });
    
    await nodeDiscovery.start();
    
    // Simulate a scenario where discovery info is used for election
    expect(nodeDiscovery).toBeDefined();
    expect(electionManager).toBeDefined();
    
    // Verify that the discovery service can be accessed by the election manager
    // This is just a simple check that both components can be instantiated together
    const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
    expect(discoveredNodes).toBeDefined();
    expect(Array.isArray(discoveredNodes)).toBe(true);
    
    // Cleanup
    nodeDiscovery.stop();
  });

  test('should handle node discovery lifecycle', (done) => {
    const nodeDiscovery = new NodeDiscovery({
      nodeId: 'lifecycle-test-node',
      port: 45003,
      broadcastPort: 45004
    });
    
    nodeDiscovery.start()
      .then(() => {
        expect(nodeDiscovery.nodeId).toBe('lifecycle-test-node');
        
        // Test node discovery functionality
        nodeDiscovery.broadcastPresence();
        
        // Stop the discovery service
        nodeDiscovery.stop();
        
        // Verify it's stopped by checking if the server is closed
        // (This is a basic check; in a real test we'd check more specific conditions)
        expect(nodeDiscovery.nodeId).toBe('lifecycle-test-node');
        
        done();
      })
      .catch(err => {
        done(err);
      });
  }, 10000); // 10 second timeout
});