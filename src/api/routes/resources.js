const express = require('express');
const router = express.Router();

// Middleware to parse JSON bodies
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// Mock distributed system resource data for demonstration purposes
let distributedResources = [
  { id: 1, name: 'Compute Node A', location: 'Datacenter 1', status: 'active', type: 'compute', utilization: 65, capacity: 100 },
  { id: 2, name: 'Storage Node B', location: 'Datacenter 2', status: 'active', type: 'storage', utilization: 80, capacity: 100 },
  { id: 3, name: 'Load Balancer C', location: 'Datacenter 3', status: 'maintenance', type: 'network', utilization: 0, capacity: 200 },
  { id: 4, name: 'Database Node D', location: 'Datacenter 4', status: 'active', type: 'database', utilization: 45, capacity: 50 },
  { id: 5, name: 'Cache Node E', location: 'Datacenter 5', status: 'active', type: 'cache', utilization: 70, capacity: 80 }
];

// Get all available distributed system resources
router.get('/', (req, res) => {
  try {
    res.json({ resources: distributedResources });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// Get a specific resource by ID
router.get('/:id', (req, res) => {
  try {
    const resourceId = parseInt(req.params.id);
    const resource = distributedResources.find(r => r.id === resourceId);
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    res.json({ resource });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch resource' });
  }
});

// Update resource status
router.put('/:id', (req, res) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { status } = req.body;
    
    const resourceIndex = distributedResources.findIndex(r => r.id === resourceId);
    
    if (resourceIndex === -1) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Update the resource status
    distributedResources[resourceIndex] = {
      ...distributedResources[resourceIndex],
      status: status || distributedResources[resourceIndex].status
    };
    
    res.json({ resource: distributedResources[resourceIndex] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update resource' });
  }
});

module.exports = router;