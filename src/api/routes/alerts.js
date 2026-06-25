// src/api/routes/alerts.js
const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();

// HO-HIGH-002: alerts route was previously seeded with hardcoded mock
// data ({id: 1..4, level: INFO/WARNING/INFO/ERROR, source: Node-001..005}).
// Real alerts come from anomaly-scorer.js and kill-switch-issuer.js
// (mounted by the application in src/api/index.js or via the v2
// coordinator's alertEmitter). Until a real source is wired in, the
// store starts empty. The POST handler below accepts alerts from any
// trusted internal emitter that posts to this route.
const alerts = [];

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
    const alert = alerts.find(alert => alert.id === id);

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
    const alertIndex = alerts.findIndex(alert => alert.id === id);

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

    // SC-HIGH-005: ID generation via crypto.randomUUID, not Math.max +
    // integer increment (predictable, integer-overflow-prone).
    const newAlert = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      source,
      message,
      resolved: false
    };

    alerts.unshift(newAlert); // Add to the beginning of the array

    // Keep only the most recent 1000 alerts
    if (alerts.length > 1000) {
      alerts.length = 1000;
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