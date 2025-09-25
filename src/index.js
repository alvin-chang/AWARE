// src/index.js
const NodeDiscovery = require('./node-discovery');
const ElectionManager = require('./election');
const APIGateway = require('./api');

class AWAREEngine {
  constructor(config = {}) {
    this.config = {
      nodeId: config.nodeId,
      discoveryPort: config.discoveryPort || 41234,
      broadcastPort: config.broadcastPort || 41235,
      apiPort: config.apiPort || 3000,
      nodes: config.nodes || [], // Other nodes in the cluster
      ...config
    };
    
    this.nodeDiscovery = null;
    this.electionManager = null;
    this.apiGateway = null;
  }

  async initialize() {
    console.log('Initializing AWARE Engine...');
    
    // Initialize node discovery
    this.nodeDiscovery = new NodeDiscovery({
      nodeId: this.config.nodeId,
      port: this.config.discoveryPort,
      broadcastPort: this.config.broadcastPort
    });
    
    // Initialize election manager
    this.electionManager = new ElectionManager(
      this.config.nodeId,
      { nodes: this.config.nodes }
    );
    
    // Initialize API gateway
    this.apiGateway = new APIGateway({
      port: this.config.apiPort,
      nodeDiscovery: this.nodeDiscovery,
      electionManager: this.electionManager,
      secretKey: this.config.secretKey || 'default_secret'
    });
    
    // Start services in order
    await this.nodeDiscovery.start();
    console.log('Node discovery service started');
    
    await this.apiGateway.start();
    console.log('API gateway started');
    
    console.log('AWARE Engine initialized successfully');
  }

  async shutdown() {
    console.log('Shutting down AWARE Engine...');
    
    if (this.nodeDiscovery) {
      this.nodeDiscovery.stop();
    }
    
    if (this.apiGateway) {
      this.apiGateway.stop();
    }
    
    if (this.electionManager) {
      // Election manager doesn't need explicit shutdown
    }
    
    console.log('AWARE Engine shutdown complete');
  }
}

// If running directly, start the engine
if (require.main === module) {
  const engine = new AWAREEngine({
    nodeId: process.env.NODE_ID || require('uuid').v4(),
    nodes: process.env.NODE_LIST ? process.env.NODE_LIST.split(',') : []
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\\nReceived SIGINT, shutting down gracefully...');
    await engine.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\\nReceived SIGTERM, shutting down gracefully...');
    await engine.shutdown();
    process.exit(0);
  });
  
  // Initialize the engine
  engine.initialize().catch(err => {
    console.error('Failed to initialize AWARE Engine:', err);
    process.exit(1);
  });
}

module.exports = AWAREEngine;