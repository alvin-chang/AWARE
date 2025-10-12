// src/api/routes/cluster.js
const express = require('express');
const router = express.Router();
const { validateClusterCreation, validateClusterConfig } = require('../middleware/validation');

// Get cluster status
router.get('/status', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const status = clusterService.getClusterStatus();
    
    res.json(status);
  } catch (error) {
    console.error('Error getting cluster status:', error);
    res.status(500).json({ error: 'Failed to get cluster status' });
  }
});

// Get cluster configuration
router.get('/config', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const status = clusterService.getClusterStatus();
    
    res.json(status.configuration);
  } catch (error) {
    console.error('Error getting cluster config:', error);
    res.status(500).json({ error: 'Failed to get cluster configuration' });
  }
});

// Update cluster configuration
router.put('/config', validateClusterConfig, (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const { configuration } = req.body;
    
    if (!configuration) {
      return res.status(400).json({ error: 'Configuration object is required' });
    }
    
    const updatedConfig = clusterService.updateConfiguration(configuration);
    
    res.json({
      message: 'Cluster configuration updated successfully',
      configuration: updatedConfig
    });
  } catch (error) {
    console.error('Error updating cluster config:', error);
    res.status(500).json({ error: 'Failed to update cluster configuration' });
  }
});

// Create a new cluster
router.post('/', validateClusterCreation, async (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const { name, configuration } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Cluster name is required' });
    }
    
    const cluster = await clusterService.createCluster(name, configuration);
    
    res.status(201).json({
      message: 'Cluster created successfully',
      cluster: cluster
    });
  } catch (error) {
    console.error('Error creating cluster:', error);
    res.status(500).json({ error: error.message || 'Failed to create cluster' });
  }
});

// Get cluster metrics
router.get('/metrics', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const metrics = clusterService.getMetrics();
    
    res.json(metrics);
  } catch (error) {
    console.error('Error getting cluster metrics:', error);
    res.status(500).json({ error: 'Failed to get cluster metrics' });
  }
});

// Scale cluster up (add nodes)
router.post('/scale-up', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const { count } = req.body;
    
    if (!count || count <= 0) {
      return res.status(400).json({ error: 'Count must be a positive integer' });
    }
    
    const result = clusterService.scaleUp(count);
    
    res.json(result);
  } catch (error) {
    console.error('Error scaling cluster up:', error);
    res.status(500).json({ error: error.message || 'Failed to scale cluster up' });
  }
});

// Scale cluster down (remove nodes)
router.post('/scale-down', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const { count } = req.body;
    
    if (!count || count <= 0) {
      return res.status(400).json({ error: 'Count must be a positive integer' });
    }
    
    const result = clusterService.scaleDown(count);
    
    res.json(result);
  } catch (error) {
    console.error('Error scaling cluster down:', error);
    res.status(500).json({ error: error.message || 'Failed to scale cluster down' });
  }
});

// Get cluster events/history
router.get('/events', (req, res) => {
  try {
    const clusterService = req.app.get('clusterService');
    const { limit = 50 } = req.query;
    
    const events = clusterService.getEvents(parseInt(limit));
    
    res.json(events);
  } catch (error) {
    console.error('Error getting cluster events:', error);
    res.status(500).json({ error: 'Failed to get cluster events' });
  }
});

module.exports = router;