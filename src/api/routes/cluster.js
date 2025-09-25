// src/api/routes/cluster.js
const express = require('express');
const router = express.Router();

// Mock cluster state (in a real system, this would be stored in etcd or similar)
let clusterState = {
  clusterId: 'aware-cluster-1',
  name: 'Default Cluster',
  status: 'active',
  nodes: [],
  configuration: {
    maxNodes: 100,
    heartbeatInterval: 30000,
    electionTimeout: 5000
  }
};

// Get cluster status
router.get('/status', (req, res) => {
  try {
    const status = {
      ...clusterState,
      leader: req.app.get('electionManager')?.getLeader() || 'unknown',
      isLeader: req.app.get('electionManager')?.isLeader() || false,
      nodeCount: req.app.get('nodeDiscovery') 
        ? req.app.get('nodeDiscovery').getDiscoveredNodes().length + 1  // +1 for self
        : 1,
      timestamp: new Date().toISOString()
    };
    
    res.json(status);
  } catch (error) {
    console.error('Error getting cluster status:', error);
    res.status(500).json({ error: 'Failed to get cluster status' });
  }
});

// Get cluster configuration
router.get('/config', (req, res) => {
  try {
    res.json(clusterState.configuration);
  } catch (error) {
    console.error('Error getting cluster config:', error);
    res.status(500).json({ error: 'Failed to get cluster configuration' });
  }
});

// Update cluster configuration
router.put('/config', (req, res) => {
  try {
    const { configuration } = req.body;
    
    if (!configuration) {
      return res.status(400).json({ error: 'Configuration object is required' });
    }
    
    // Update configuration with provided values
    clusterState.configuration = { ...clusterState.configuration, ...configuration };
    
    res.json({
      message: 'Cluster configuration updated successfully',
      configuration: clusterState.configuration
    });
  } catch (error) {
    console.error('Error updating cluster config:', error);
    res.status(500).json({ error: 'Failed to update cluster configuration' });
  }
});

// Create a new cluster
router.post('/', (req, res) => {
  try {
    const { name, configuration } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Cluster name is required' });
    }
    
    // Set up new cluster
    clusterState = {
      clusterId: `cluster-${Date.now()}`,
      name: name,
      status: 'initializing',
      nodes: [],
      configuration: {
        maxNodes: 100,
        heartbeatInterval: 30000,
        electionTimeout: 5000,
        ...(configuration || {})
      }
    };
    
    // Update status to active after initialization
    setTimeout(() => {
      clusterState.status = 'active';
    }, 1000);
    
    res.status(201).json({
      message: 'Cluster created successfully',
      cluster: {
        ...clusterState,
        leader: req.app.get('electionManager')?.getLeader() || 'electing',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating cluster:', error);
    res.status(500).json({ error: 'Failed to create cluster' });
  }
});

// Get cluster metrics
router.get('/metrics', (req, res) => {
  try {
    // In a real implementation, this would gather metrics from all nodes
    const metrics = {
      cpu: {
        average: 45.2,
        nodes: {}
      },
      memory: {
        average: 60.1,
        nodes: {}
      },
      network: {
        throughput: '1.2GB',
        latency: '2.3ms'
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(metrics);
  } catch (error) {
    console.error('Error getting cluster metrics:', error);
    res.status(500).json({ error: 'Failed to get cluster metrics' });
  }
});

module.exports = router;