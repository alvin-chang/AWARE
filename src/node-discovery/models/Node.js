// src/node-discovery/models/Node.js
class Node {
  constructor(id, config = {}) {
    this.id = id;
    this.status = config.status || 'unknown'; // unknown, available, busy, offline
    this.capabilities = config.capabilities || [];
    this.address = config.address || null;
    this.port = config.port || null;
    this.lastSeen = config.lastSeen || new Date();
    this.metadata = config.metadata || {};
    this.role = config.role || 'worker'; // worker, queen, potential-queen
  }

  updateStatus(status) {
    this.status = status;
    this.lastSeen = new Date();
  }

  updateAddress(address, port) {
    this.address = address;
    this.port = port;
  }

  addCapability(capability) {
    if (!this.capabilities.includes(capability)) {
      this.capabilities.push(capability);
    }
  }

  removeCapability(capability) {
    this.capabilities = this.capabilities.filter(c => c !== capability);
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      capabilities: this.capabilities,
      address: this.address,
      port: this.port,
      lastSeen: this.lastSeen,
      metadata: this.metadata,
      role: this.role
    };
  }

  static fromJSON(json) {
    const node = new Node(json.id, {
      status: json.status,
      capabilities: json.capabilities,
      address: json.address,
      port: json.port,
      lastSeen: json.lastSeen,
      metadata: json.metadata,
      role: json.role
    });
    return node;
  }
}

module.exports = Node;