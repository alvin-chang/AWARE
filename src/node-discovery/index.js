// src/node-discovery/index.js
const dgram = require('dgram');
const { v4: uuidv4 } = require('uuid');

class NodeDiscovery {
  constructor(config = {}) {
    this.nodeId = config.nodeId || uuidv4();
    this.port = config.port || 41234;
    this.broadcastPort = config.broadcastPort || 41235;
    this.broadcastAddress = config.broadcastAddress || '255.255.255.255';
    this.server = null;
    this.client = null;
    this.discoveredNodes = new Map();
    this.heartbeatInterval = null;
  }

  // Start the node discovery service
  async start() {
    // Create UDP server for receiving broadcasts
    this.server = dgram.createSocket('udp4');
    
    this.server.on('error', (err) => {
      console.error('Discovery server error:', err);
      this.server.close();
    });

    this.server.on('message', (message, remote) => {
      try {
        const nodeInfo = JSON.parse(message);
        this.handleNodeBroadcast(nodeInfo, remote);
      } catch (e) {
        console.error('Error parsing node broadcast:', e);
      }
    });

    this.server.on('listening', () => {
      const address = this.server.address();
      console.log(`Discovery server listening on ${address.address}:${address.port}`);
      this.server.setBroadcast(true);
    });

    this.server.bind(this.port);

    // Start broadcasting this node's presence
    this.startBroadcasting();
    
    // Set up heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000); // Every 30 seconds
  }

  // Handle incoming node broadcasts
  handleNodeBroadcast(nodeInfo, remote) {
    if (nodeInfo.nodeId !== this.nodeId) {
      // Update or add the discovered node
      this.discoveredNodes.set(nodeInfo.nodeId, {
        ...nodeInfo,
        lastSeen: new Date(),
        address: remote.address,
        port: remote.port
      });
      
      console.log(`Discovered node: ${nodeInfo.nodeId} at ${remote.address}`);
    }
  }

  // Start broadcasting this node's presence
  startBroadcasting() {
    this.broadcastPresence();
    // Broadcast every 10 seconds
    setInterval(() => {
      this.broadcastPresence();
    }, 10000);
  }

  // Broadcast this node's presence
  broadcastPresence() {
    if (!this.server) return;
    
    const nodeInfo = {
      nodeId: this.nodeId,
      timestamp: Date.now(),
      capabilities: ['compute', 'storage'],
      status: 'available'
    };

    const message = Buffer.from(JSON.stringify(nodeInfo));
    const client = dgram.createSocket('udp4');
    
    client.bind(() => {
      client.setBroadcast(true);
      client.send(message, 0, message.length, this.broadcastPort, this.broadcastAddress, (err) => {
        if (err) {
          console.error('Error broadcasting presence:', err);
        } else {
          console.log(`Broadcasted presence: ${this.nodeId}`);
        }
        client.close();
      });
    });
  }

  // Send heartbeat to maintain node presence
  sendHeartbeat() {
    // Implementation would send heartbeat to known nodes
    console.log(`Heartbeat from node: ${this.nodeId}`);
  }

  // Get list of discovered nodes
  getDiscoveredNodes() {
    return Array.from(this.discoveredNodes.values());
  }

  // Stop the discovery service
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = NodeDiscovery;