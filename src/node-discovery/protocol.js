// src/node-discovery/protocol.js
const MESSAGE_TYPES = {
  PRESENCE_BROADCAST: 'presence_broadcast',
  NODE_DISCOVERY: 'node_discovery',
  NODE_RESPONSE: 'node_response',
  HEARTBEAT: 'heartbeat',
  NODE_LEAVE: 'node_leave'
};

class DiscoveryProtocol {
  static createPresenceBroadcast(nodeId, capabilities, status, metadata = {}) {
    return {
      type: MESSAGE_TYPES.PRESENCE_BROADCAST,
      nodeId,
      timestamp: Date.now(),
      capabilities,
      status,
      metadata,
      version: '1.0'
    };
  }

  static createNodeDiscovery(nodeId) {
    return {
      type: MESSAGE_TYPES.NODE_DISCOVERY,
      nodeId,
      timestamp: Date.now(),
      version: '1.0'
    };
  }

  static createNodeResponse(nodeInfo) {
    return {
      type: MESSAGE_TYPES.NODE_RESPONSE,
      nodeInfo,
      timestamp: Date.now(),
      version: '1.0'
    };
  }

  static createHeartbeat(nodeId) {
    return {
      type: MESSAGE_TYPES.HEARTBEAT,
      nodeId,
      timestamp: Date.now(),
      version: '1.0'
    };
  }

  static createNodeLeave(nodeId) {
    return {
      type: MESSAGE_TYPES.NODE_LEAVE,
      nodeId,
      timestamp: Date.now(),
      reason: 'shutdown',
      version: '1.0'
    };
  }

  static parseMessage(messageBuffer) {
    try {
      const message = JSON.parse(messageBuffer.toString());
      
      // Validate message structure
      if (!message.type || !message.nodeId || !message.timestamp) {
        throw new Error('Invalid message format');
      }

      // Validate message type
      if (!Object.values(MESSAGE_TYPES).includes(message.type)) {
        throw new Error(`Unknown message type: ${message.type}`);
      }

      return message;
    } catch (e) {
      throw new Error(`Failed to parse message: ${e.message}`);
    }
  }

  static isValidMessage(message) {
    if (!message || !message.type || !message.nodeId || !message.timestamp) {
      return false;
    }

    // Additional validation based on message type
    switch (message.type) {
      case MESSAGE_TYPES.PRESENCE_BROADCAST:
        return Array.isArray(message.capabilities) && typeof message.status === 'string';
      case MESSAGE_TYPES.NODE_DISCOVERY:
        return true; // Only requires basic fields
      case MESSAGE_TYPES.NODE_RESPONSE:
        return message.nodeInfo && message.nodeInfo.id;
      case MESSAGE_TYPES.HEARTBEAT:
        return true; // Only requires basic fields
      case MESSAGE_TYPES.NODE_LEAVE:
        return typeof message.reason === 'string';
      default:
        return false;
    }
  }

  static MESSAGE_TYPES = MESSAGE_TYPES;
}

module.exports = DiscoveryProtocol;