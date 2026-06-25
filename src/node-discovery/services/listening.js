// src/node-discovery/services/listening.js
const dgram = require('dgram');
const EventEmitter = require('events');

class ListeningService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.port = config.listenPort || 41234;
    this.discoveredNodes = new Map(); // nodeId -> nodeInfo
    this.socket = null;
    this.nodeTimeout = config.nodeTimeout || 120000; // 2 minutes
    this.cleanupInterval = null;
  }

  async start() {
    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err) => {
      console.error('Discovery server error:', err);
      this.socket.close();
    });

    this.socket.on('message', (message, remote) => {
      try {
        const nodeInfo = JSON.parse(message);
        this.handleNodeBroadcast(nodeInfo, remote);
      } catch (e) {
        console.error('Error parsing node broadcast:', e);
      }
    });

    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log(`Discovery server listening on ${address.address}:${address.port}`);
      this.socket.setBroadcast(true);
    });

    this.socket.bind(this.port);

    // Start periodic cleanup of old nodes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldNodes();
    }, 60000); // Every minute
  }

  handleNodeBroadcast(nodeInfo, remote) {
    if (nodeInfo.nodeId) {
      // Update or add the discovered node
      this.discoveredNodes.set(nodeInfo.nodeId, {
        ...nodeInfo,
        lastSeen: new Date(),
        address: remote.address,
        port: remote.port
      });
      
      // Emit event for other components to handle
      this.emit('nodeDiscovered', nodeInfo, remote);
      console.log(`Discovered node: ${nodeInfo.nodeId} at ${remote.address}`);
    }
  }

  getDiscoveredNodes() {
    return Array.from(this.discoveredNodes.values());
  }

  getNode(nodeId) {
    return this.discoveredNodes.get(nodeId);
  }

  cleanupOldNodes() {
    const now = Date.now();
    for (const [nodeId, nodeInfo] of this.discoveredNodes) {
      if (now - new Date(nodeInfo.lastSeen).getTime() > this.nodeTimeout) {
        this.discoveredNodes.delete(nodeId);
        this.emit('nodeExpired', nodeId);
      }
    }
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.socket) {
      this.socket.close();
    }
  }
}

module.exports = ListeningService;