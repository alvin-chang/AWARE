const NodeDiscovery = require('../index');
const dgram = require('dgram');

jest.mock('dgram');

describe('NodeDiscovery', () => {
  let discovery;

  beforeEach(() => {
    discovery = new NodeDiscovery({
      nodeId: 'test-node',
      port: 41234,
      broadcastPort: 41235
    });
  });

  afterEach(() => {
    discovery.stop();
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(discovery.nodeId).toBe('test-node');
      expect(discovery.port).toBe(41234);
      expect(discovery.broadcastPort).toBe(41235);
      expect(discovery.discoveredNodes).toBeInstanceOf(Map);
      expect(discovery.discoveredNodes.size).toBe(0);
    });
  });

  describe('handleNodeBroadcast', () => {
    it('should add new node to discoveredNodes', () => {
      const mockNodeInfo = {
        nodeId: 'other-node',
        timestamp: Date.now(),
        capabilities: ['compute'],
        status: 'available'
      };
      const mockRemote = { address: '192.168.1.100', port: 41234 };

      discovery.handleNodeBroadcast(mockNodeInfo, mockRemote);

      expect(discovery.discoveredNodes.size).toBe(1);
      const discovered = discovery.discoveredNodes.get('other-node');
      expect(discovered.nodeId).toBe('other-node');
      expect(discovered.address).toBe('192.168.1.100');
      expect(discovered.lastSeen).toBeInstanceOf(Date);
    });

    it('should ignore own node broadcast', () => {
      const mockNodeInfo = {
        nodeId: 'test-node', // Same as self
        timestamp: Date.now()
      };
      const mockRemote = { address: '127.0.0.1', port: 41234 };

      discovery.handleNodeBroadcast(mockNodeInfo, mockRemote);

      expect(discovery.discoveredNodes.size).toBe(0);
    });

    it('should update existing node with new lastSeen', () => {
      const mockNodeInfo = { nodeId: 'other-node', timestamp: Date.now() };
      const mockRemote = { address: '192.168.1.100', port: 41234 };

      // First broadcast
      discovery.handleNodeBroadcast(mockNodeInfo, mockRemote);
      const firstLastSeen = discovery.discoveredNodes.get('other-node').lastSeen;

      // Second broadcast
      setTimeout(() => {
        discovery.handleNodeBroadcast(mockNodeInfo, mockRemote);
        const secondLastSeen = discovery.discoveredNodes.get('other-node').lastSeen;
        expect(secondLastSeen > firstLastSeen).toBe(true);
      }, 0);
    });
  });

  describe('getDiscoveredNodes', () => {
    it('should return array of discovered nodes', () => {
      const mockNodeInfo = { nodeId: 'other-node', timestamp: Date.now() };
      const mockRemote = { address: '192.168.1.100', port: 41234 };
      discovery.handleNodeBroadcast(mockNodeInfo, mockRemote);

      const nodes = discovery.getDiscoveredNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].nodeId).toBe('other-node');
    });

    it('should return empty array when no nodes discovered', () => {
      const nodes = discovery.getDiscoveredNodes();
      expect(nodes).toHaveLength(0);
    });
  });

  describe('broadcastPresence', () => {
    it('should create valid nodeInfo object', () => {
      const originalSend = dgram.createSocket().send;
      const mockSend = jest.fn();
      dgram.createSocket.mockReturnValue({ send: mockSend, close: jest.fn(), setBroadcast: jest.fn(), bind: jest.fn() });

      discovery.broadcastPresence();

      expect(mockSend).toHaveBeenCalled();
      const message = JSON.parse(mockSend.mock.calls[0][0].toString());
      expect(message.nodeId).toBe('test-node');
      expect(message.capabilities).toEqual(expect.arrayContaining(['compute', 'storage']));
      expect(message.status).toBe('available');
    });
  });

  // Note: Full start() test would require more complex mocking of UDP socket
  describe('start', () => {
    it('should bind server and start broadcasting', () => {
      const mockServer = {
        on: jest.fn(),
        bind: jest.fn(),
        close: jest.fn(),
        setBroadcast: jest.fn(),
        address: jest.fn().mockReturnValue({ address: '0.0.0.0', port: 41234 })
      };
      dgram.createSocket.mockReturnValue(mockServer);

      discovery.start();

      expect(mockServer.bind).toHaveBeenCalledWith(41234);
      expect(mockServer.on).toHaveBeenCalledWith('listening', expect.any(Function));
      expect(mockServer.setBroadcast).toHaveBeenCalledWith(true);
    });
  });
});
