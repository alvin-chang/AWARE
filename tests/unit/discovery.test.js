// tests/unit/discovery.test.js
const Node = require('../../src/node-discovery/models/Node');
const BroadcastService = require('../../src/node-discovery/services/broadcast');
const ListeningService = require('../../src/node-discovery/services/listening');
const DiscoveryProtocol = require('../../src/node-discovery/protocol');

describe('Node Model', () => {
  test('should create a new node with default values', () => {
    const node = new Node('node-1');
    
    expect(node.id).toBe('node-1');
    expect(node.status).toBe('unknown');
    expect(node.capabilities).toEqual([]);
    expect(node.role).toBe('worker');
  });

  test('should create a new node with provided config', () => {
    const config = {
      status: 'available',
      capabilities: ['compute', 'storage'],
      address: '192.168.1.100',
      port: 3000,
      role: 'queen'
    };
    
    const node = new Node('node-2', config);
    
    expect(node.id).toBe('node-2');
    expect(node.status).toBe('available');
    expect(node.capabilities).toEqual(['compute', 'storage']);
    expect(node.address).toBe('192.168.1.100');
    expect(node.port).toBe(3000);
    expect(node.role).toBe('queen');
  });

  test('should update node status', () => {
    const node = new Node('node-1');
    const oldLastSeen = new Date();
    // Set an initial time before the update
    node.lastSeen = oldLastSeen;
    
    node.updateStatus('available');
    
    expect(node.status).toBe('available');
    // The lastSeen should be updated to a time after the old one
    expect(node.lastSeen.getTime()).toBeGreaterThanOrEqual(oldLastSeen.getTime());
  });

  test('should add and remove capabilities', () => {
    const node = new Node('node-1');
    
    node.addCapability('compute');
    expect(node.capabilities).toEqual(['compute']);
    
    node.addCapability('storage');
    expect(node.capabilities).toEqual(['compute', 'storage']);
    
    node.removeCapability('compute');
    expect(node.capabilities).toEqual(['storage']);
  });

  test('should convert to and from JSON', () => {
    const originalNode = new Node('node-1', {
      status: 'active',
      capabilities: ['compute', 'storage'],
      role: 'worker'
    });
    
    const json = originalNode.toJSON();
    const newNode = Node.fromJSON(json);
    
    expect(newNode.id).toBe(originalNode.id);
    expect(newNode.status).toBe(originalNode.status);
    expect(newNode.capabilities).toEqual(originalNode.capabilities);
    expect(newNode.role).toBe(originalNode.role);
  });
});

describe('Broadcast Service', () => {
  let broadcastService;

  beforeEach(() => {
    broadcastService = new BroadcastService({
      nodeId: 'test-node',
      broadcastPort: 41236, // Use different port to avoid conflicts
      capabilities: ['compute'],
      status: 'available'
    });
  });

  afterEach(() => {
    if (broadcastService.socket) {
      broadcastService.socket.close();
    }
    if (broadcastService.heartbeatInterval) {
      clearInterval(broadcastService.heartbeatInterval);
    }
  });

  test('should initialize with correct properties', () => {
    expect(broadcastService.nodeId).toBe('test-node');
    expect(broadcastService.capabilities).toEqual(['compute']);
    expect(broadcastService.status).toBe('available');
  });

  test('should update capabilities', () => {
    broadcastService.updateCapabilities(['storage', 'network']);
    expect(broadcastService.capabilities).toEqual(['storage', 'network']);
  });

  test('should update status', () => {
    broadcastService.updateStatus('busy');
    expect(broadcastService.status).toBe('busy');
  });
});

describe('Listening Service', () => {
  let listeningService;

  beforeEach(() => {
    listeningService = new ListeningService({
      listenPort: 41237, // Use different port to avoid conflicts
      nodeTimeout: 1000 // 1 second for testing
    });
  });

  afterEach(() => {
    listeningService.stop();
    if (listeningService.cleanupInterval) {
      clearInterval(listeningService.cleanupInterval);
    }
  });

  test('should initialize with correct properties', () => {
    expect(listeningService.port).toBe(41237);
    expect(listeningService.discoveredNodes).toBeInstanceOf(Map);
  });

  test('should handle node broadcast', () => {
    const mockNodeInfo = {
      nodeId: 'test-node-2',
      capabilities: ['compute'],
      status: 'available'
    };
    
    const mockRemote = {
      address: '192.168.1.101',
      port: 41236
    };
    
    listeningService.handleNodeBroadcast(mockNodeInfo, mockRemote);
    
    const discovered = listeningService.getDiscoveredNodes();
    expect(discovered).toHaveLength(1);
    expect(discovered[0].nodeId).toBe('test-node-2');
    expect(discovered[0].address).toBe('192.168.1.101');
  });

  test('should get specific node', () => {
    const mockNodeInfo = {
      nodeId: 'test-node-3',
      capabilities: ['storage'],
      status: 'available'
    };
    
    const mockRemote = {
      address: '192.168.1.102',
      port: 41236
    };
    
    listeningService.handleNodeBroadcast(mockNodeInfo, mockRemote);
    
    const node = listeningService.getNode('test-node-3');
    expect(node).toBeDefined();
    expect(node.nodeId).toBe('test-node-3');
  });
});

describe('Discovery Protocol', () => {
  test('should create presence broadcast message', () => {
    const msg = DiscoveryProtocol.createPresenceBroadcast(
      'node-1', 
      ['compute', 'storage'], 
      'available',
      { region: 'us-east-1' }
    );
    
    expect(msg.type).toBe(DiscoveryProtocol.MESSAGE_TYPES.PRESENCE_BROADCAST);
    expect(msg.nodeId).toBe('node-1');
    expect(msg.capabilities).toEqual(['compute', 'storage']);
    expect(msg.status).toBe('available');
    expect(msg.metadata).toEqual({ region: 'us-east-1' });
    expect(msg.timestamp).toBeDefined();
  });

  test('should validate message correctly', () => {
    const validMsg = DiscoveryProtocol.createPresenceBroadcast('node-1', [], 'active');
    expect(DiscoveryProtocol.isValidMessage(validMsg)).toBe(true);
    
    const invalidMsg = { foo: 'bar' };
    expect(DiscoveryProtocol.isValidMessage(invalidMsg)).toBe(false);
  });

  test('should parse message buffer', () => {
    const msg = DiscoveryProtocol.createPresenceBroadcast('node-1', [], 'active');
    const buffer = Buffer.from(JSON.stringify(msg));
    
    const parsed = DiscoveryProtocol.parseMessage(buffer);
    expect(parsed.nodeId).toBe('node-1');
    expect(parsed.type).toBe(DiscoveryProtocol.MESSAGE_TYPES.PRESENCE_BROADCAST);
  });
});