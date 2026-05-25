// src/election/network-partition-handler.js
class NetworkPartitionHandler {
  constructor(nodeId, config = {}) {
    this.nodeId = nodeId;
    this.nodes = config.nodes || [];
    this.partitionDetectedAt = null;
    this.partitionResolvedAt = null;
    this.unreachableNodes = new Set();
    this.eventListeners = new Set();
    this.partitionMonitorInterval = null;
    this.heartbeatTimeout = config.heartbeatTimeout || 5000; // 5 seconds
    this.partitionDetectionThreshold = config.partitionDetectionThreshold || 3; // missed heartbeats
    this.lastHeartbeatReceived = new Map(); // nodeId -> timestamp
    this.missedHeartbeats = new Map(); // nodeId -> count
    
    // Initialize heartbeat tracking for all nodes
    this.nodes.forEach(nodeId => {
      if (nodeId !== this.nodeId) {
        this.lastHeartbeatReceived.set(nodeId, Date.now());
        this.missedHeartbeats.set(nodeId, 0);
      }
    });
  }

  startMonitoring() {
    // Begin monitoring for network partitions
    this.partitionMonitorInterval = setInterval(() => {
      this.checkForPartitions();
    }, this.heartbeatTimeout / 2); // Check twice as often as timeout
  }

  stopMonitoring() {
    if (this.partitionMonitorInterval) {
      clearInterval(this.partitionMonitorInterval);
    }
  }

  // Record that we received a heartbeat from a node
  receivedHeartbeat(fromNodeId) {
    if (this.nodes.includes(fromNodeId)) {
      this.lastHeartbeatReceived.set(fromNodeId, Date.now());
      this.missedHeartbeats.set(fromNodeId, 0);
      
      // If we previously marked this node as unreachable and it's now reachable again
      if (this.unreachableNodes.has(fromNodeId)) {
        this.unreachableNodes.delete(fromNodeId);
        this.emit('nodeReachable', fromNodeId);
        
        // Check if partition has been resolved
        if (this.partitionDetectedAt && this.unreachableNodes.size === 0) {
          this.partitionResolvedAt = Date.now();
          this.emit('partitionResolved', {
            duration: this.partitionResolvedAt - this.partitionDetectedAt,
            affectedNodes: Array.from(this.unreachableNodes)
          });
          this.partitionDetectedAt = null;
        }
      }
    }
  }

  // Check for network partitions
  checkForPartitions() {
    const now = Date.now();
    let partitionDetected = false;
    
    // Check each node for missed heartbeats
    for (const nodeId of this.nodes) {
      if (nodeId === this.nodeId) continue;
      
      const lastHeartbeat = this.lastHeartbeatReceived.get(nodeId) || 0;
      const timeSinceHeartbeat = now - lastHeartbeat;
      
      if (timeSinceHeartbeat > this.heartbeatTimeout) {
        // Increment missed heartbeat counter
        const missedCount = (this.missedHeartbeats.get(nodeId) || 0) + 1;
        this.missedHeartbeats.set(nodeId, missedCount);
        
        // If we've missed enough heartbeats, mark node as unreachable
        if (missedCount >= this.partitionDetectionThreshold && !this.unreachableNodes.has(nodeId)) {
          this.unreachableNodes.add(nodeId);
          this.emit('nodeUnreachable', nodeId, {
            timeSinceLastHeartbeat: timeSinceHeartbeat,
            missedCount: missedCount
          });
          
          partitionDetected = true;
        }
      } else {
        // Reset missed heartbeat counter if we received a recent heartbeat
        this.missedHeartbeats.set(nodeId, 0);
      }
    }
    
    // If partition wasn't previously detected but is now
    if (partitionDetected && !this.partitionDetectedAt) {
      this.partitionDetectedAt = Date.now();
      this.emit('partitionDetected', {
        unreachableNodes: Array.from(this.unreachableNodes),
        timestamp: this.partitionDetectedAt
      });
    }
    
    // If partition was previously detected but now all nodes are reachable
    if (this.partitionDetectedAt && this.unreachableNodes.size === 0) {
      this.partitionResolvedAt = Date.now();
      this.emit('partitionResolved', {
        duration: this.partitionResolvedAt - this.partitionDetectedAt,
        affectedNodes: Array.from(this.unreachableNodes)
      });
      this.partitionDetectedAt = null;
    }
  }

  // Get current partition status
  getPartitionStatus() {
    return {
      isPartitioned: this.unreachableNodes.size > 0,
      unreachableNodes: Array.from(this.unreachableNodes),
      partitionDetectedAt: this.partitionDetectedAt,
      partitionResolvedAt: this.partitionResolvedAt,
      lastHeartbeatReceived: Object.fromEntries(this.lastHeartbeatReceived),
      missedHeartbeats: Object.fromEntries(this.missedHeartbeats)
    };
  }

  // Handle a node coming back online
  handleNodeRejoin(nodeId) {
    if (this.unreachableNodes.has(nodeId)) {
      this.unreachableNodes.delete(nodeId);
      this.missedHeartbeats.set(nodeId, 0);
      this.lastHeartbeatReceived.set(nodeId, Date.now());
      
      this.emit('nodeRejoined', nodeId);
      
      // Check if partition has been resolved
      if (this.partitionDetectedAt && this.unreachableNodes.size === 0) {
        this.partitionResolvedAt = Date.now();
        this.emit('partitionResolved', {
          duration: this.partitionResolvedAt - this.partitionDetectedAt,
          affectedNodes: []
        });
        this.partitionDetectedAt = null;
      }
    }
  }

  // Add event listener
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  // Emit event
  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(callback => callback(data));
    }
  }

  // Get unreachable nodes
  getUnreachableNodes() {
    return Array.from(this.unreachableNodes);
  }

  // Check if a specific node is unreachable
  isNodeUnreachable(nodeId) {
    return this.unreachableNodes.has(nodeId);
  }
}

module.exports = NetworkPartitionHandler;