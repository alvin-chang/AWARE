// src/node-discovery/services/broadcast.js
const dgram = require('dgram');

class BroadcastService {
  constructor(config = {}) {
    this.port = config.broadcastPort || 41235;
    this.address = config.broadcastAddress || '255.255.255.255';
    this.nodeId = config.nodeId;
    this.capabilities = config.capabilities || [];
    this.status = config.status || 'available';
    this.metadata = config.metadata || {};
    this.heartbeatInterval = null;
  }

  async start() {
    this.socket = dgram.createSocket('udp4');
    
    this.socket.bind(() => {
      this.socket.setBroadcast(true);
    });
    
    // Start broadcasting presence
    this.broadcastPresence();
    
    // Set up regular broadcasting
    this.heartbeatInterval = setInterval(() => {
      this.broadcastPresence();
    }, 10000); // Every 10 seconds
  }

  broadcastPresence() {
    if (!this.socket) return;
    
    const message = JSON.stringify({
      nodeId: this.nodeId,
      timestamp: Date.now(),
      capabilities: this.capabilities,
      status: this.status,
      metadata: this.metadata
    });

    const buffer = Buffer.from(message);
    
    this.socket.send(buffer, 0, buffer.length, this.port, this.address, (err) => {
      if (err) {
        console.error('Error broadcasting presence:', err);
      }
    });
  }

  updateCapabilities(capabilities) {
    this.capabilities = capabilities;
  }

  updateStatus(status) {
    this.status = status;
  }

  updateMetadata(metadata) {
    this.metadata = { ...this.metadata, ...metadata };
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.socket) {
      this.socket.close();
    }
  }
}

module.exports = BroadcastService;