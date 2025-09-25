// src/api/routes/nodes.js
const express = require('express');
const router = express.Router();

// Get all nodes
router.get('/', (req, res) => {
  try {
    const nodeDiscovery = req.app.get('nodeDiscovery');
    if (!nodeDiscovery) {
      return res.status(500).json({ error: 'Node discovery service not available' });
    }

    const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
    const thisNode = {
      nodeId: nodeDiscovery.nodeId,
      status: 'self',
      lastSeen: new Date().toISOString(),
      address: req.app.get('bindAddress') || '127.0.0.1',
      capabilities: ['compute', 'storage'],
      role: req.app.get('electionManager')?.isLeader() ? 'queen' : 'worker'
    };
    
    res.json({
      self: thisNode,
      discovered: discoveredNodes,
      total: discoveredNodes.length + 1
    });
  } catch (error) {
    console.error('Error getting nodes list:', error);
    res.status(500).json({ error: 'Failed to get nodes list' });
  }
});

// Get a specific node
router.get('/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const nodeDiscovery = req.app.get('nodeDiscovery');
    
    if (!nodeDiscovery) {
      return res.status(500).json({ error: 'Node discovery service not available' });
    }

    const discoveredNodes = nodeDiscovery.getDiscoveredNodes();
    const node = discoveredNodes.find(n => n.nodeId === nodeId);
    
    if (node) {
      res.json(node);
    } else if (nodeId === nodeDiscovery.nodeId) {
      res.json({
        nodeId: nodeId,
        status: 'self',
        lastSeen: new Date().toISOString(),
        capabilities: ['compute', 'storage'],
        role: req.app.get('electionManager')?.isLeader() ? 'queen' : 'worker'
      });
    } else {
      res.status(404).json({ error: 'Node not found' });
    }
  } catch (error) {
    console.error('Error getting node:', error);
    res.status(500).json({ error: 'Failed to get node' });
  }
});

// Update node configuration
router.put('/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { configuration } = req.body;
    
    if (!configuration) {
      return res.status(400).json({ error: 'Configuration object is required' });
    }
    
    // In a real system, this would update the specific node's configuration
    // For now, just return a success response
    res.json({
      message: `Configuration updated for node ${nodeId}`,
      nodeId: nodeId,
      configuration: configuration,
      updated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating node:', error);
    res.status(500).json({ error: 'Failed to update node configuration' });
  }
});

// Trigger node health check
router.post('/:nodeId/health-check', (req, res) => {
  try {
    const { nodeId } = req.params;
    
    // In a real system, this would trigger a health check for the specific node
    // For now, just return a mock health status
    const healthStatus = {
      nodeId: nodeId,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        cpu: 'ok',
        memory: 'ok',
        disk: 'ok',
        network: 'ok'
      }
    };
    
    res.json(healthStatus);
  } catch (error) {
    console.error('Error performing health check:', error);
    res.status(500).json({ error: 'Failed to perform health check' });
  }
});

// Remove node from cluster
router.delete('/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    
    // In a real system, this would properly remove a node from the cluster
    // For now, just return a success response
    res.json({
      message: `Node ${nodeId} removal initiated`,
      nodeId: nodeId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error removing node:', error);
    res.status(500).json({ error: 'Failed to remove node' });
  }
});

module.exports = router;