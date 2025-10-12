// src/api/routes/alerts.js
const express = require('express');
const router = express.Router();

// In-memory alerts store (in a real system, this would be in a database)
let alerts = [
  {
    id: 1,
    timestamp: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    level: 'INFO',
    source: 'Node-001',
    message: 'Node joined cluster successfully',
    resolved: true
  },
  {
    id: 2,
    timestamp: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
    level: 'WARNING',
    source: 'Node-003',
    message: 'High memory usage detected',
    resolved: false
  },
  {
    id: 3,
    timestamp: new Date(Date.now() - 1200000).toISOString(), // 20 minutes ago
    level: 'INFO',
    source: 'Queen-001',
    message: 'New cluster formation initiated',
    resolved: true
  },
  {
    id: 4,
    timestamp: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    level: 'ERROR',
    source: 'Node-005',
    message: 'Connection timeout to queen node',
    resolved: false
  }
];

// Get all alerts
router.get('/', (req, res) => {
  try {
    const { level, source, resolved, limit = 50, offset = 0 } = req.query;
    
    let filteredAlerts = [...alerts];
    
    // Apply filters
    if (level) {
      filteredAlerts = filteredAlerts.filter(alert => 
        alert.level.toLowerCase() === level.toLowerCase()
      );
    }
    
    if (source) {
      filteredAlerts = filteredAlerts.filter(alert => 
        alert.source.toLowerCase().includes(source.toLowerCase())
      );
    }
    
    if (resolved !== undefined) {
      const resolvedBool = resolved === 'true';
      filteredAlerts = filteredAlerts.filter(alert => alert.resolved === resolvedBool);
    }
    
    // Apply pagination
    const paginatedAlerts = filteredAlerts.slice(offset, offset + parseInt(limit));
    
    res.json({
      alerts: paginatedAlerts,
      total: filteredAlerts.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// Get a specific alert
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const alertId = parseInt(id);
    
    const alert = alerts.find(alert => alert.id === alertId);
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    res.json(alert);
  } catch (error) {
    console.error('Error getting alert:', error);
    res.status(500).json({ error: 'Failed to get alert' });
  }
});

// Update an alert (e.g., mark as resolved)
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { resolved, message } = req.body;
    const alertId = parseInt(id);
    
    const alertIndex = alerts.findIndex(alert => alert.id === alertId);
    
    if (alertIndex === -1) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    // Update the alert
    if (resolved !== undefined) {
      alerts[alertIndex].resolved = resolved;
    }
    
    if (message) {
      alerts[alertIndex].message = message;
    }
    
    res.json({
      message: 'Alert updated successfully',
      alert: alerts[alertIndex]
    });
  } catch (error) {
    console.error('Error updating alert:', error);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// Create a new alert (for external systems to report issues)
router.post('/', (req, res) => {
  try {
    const { level, source, message } = req.body;
    
    if (!level || !source || !message) {
      return res.status(400).json({ 
        error: 'Alert must include level, source, and message' 
      });
    }
    
    const newAlert = {
      id: Math.max(...alerts.map(a => a.id), 0) + 1,
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      source,
      message,
      resolved: false
    };
    
    alerts.unshift(newAlert); // Add to the beginning of the array
    
    // Keep only the most recent 1000 alerts
    if (alerts.length > 1000) {
      alerts = alerts.slice(0, 1000);
    }
    
    res.status(201).json({
      message: 'Alert created successfully',
      alert: newAlert
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

module.exports = router;