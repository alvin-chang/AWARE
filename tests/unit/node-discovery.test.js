// tests/unit/node-discovery.test.js
const NodeDiscovery = require('../../src/node-discovery');

describe('NodeDiscovery', () => {
  let nodeDiscovery;

  beforeEach(() => {
    nodeDiscovery = new NodeDiscovery({
      nodeId: 'test-node-1',
      port: 41236, // Use different port for tests
      broadcastPort: 41237
    });
  });

  afterEach(() => {
    if (nodeDiscovery) {
      nodeDiscovery.stop();
    }
  });

  test('should initialize with correct properties', () => {
    expect(nodeDiscovery.nodeId).toBe('test-node-1');
    expect(nodeDiscovery.port).toBe(41236);
    expect(nodeDiscovery.discoveredNodes).toBeInstanceOf(Map);
  });

  test('should add node to discovered list when handleNodeBroadcast is called', () => {
    const mockNodeInfo = {
      nodeId: 'other-node-1',
      timestamp: Date.now(),
      capabilities: ['compute'],
      status: 'available'
    };
    
    const mockRemote = {
      address: '192.168.1.100',
      port: 41236
    };
    
    nodeDiscovery.handleNodeBroadcast(mockNodeInfo, mockRemote);
    
    const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
    expect(discoveredNodes).toHaveLength(1);
    expect(discoveredNodes[0].nodeId).toBe('other-node-1');
    expect(discoveredNodes[0].address).toBe('192.168.1.100');
  });

  test('should not add self to discovered list', () => {
    const mockNodeInfo = {
      nodeId: 'test-node-1', // Same as this node
      timestamp: Date.now(),
      capabilities: ['compute'],
      status: 'available'
    };
    
    const mockRemote = {
      address: '192.168.1.100',
      port: 41236
    };
    
    nodeDiscovery.handleNodeBroadcast(mockNodeInfo, mockRemote);
    
    const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
    expect(discoveredNodes).toHaveLength(0);
  });
});