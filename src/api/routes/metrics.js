// src/api/routes/metrics.js
// REST API for monitoring metrics
// Phase 1.3: Behavioural Baseline & Anomaly Detection

const express = require('express');
const router = express.Router();
const { getCollector, MetricType, Severity } = require('../monitoring/metrics-collector');
const { getBaselineService } = require('../monitoring/baseline-service');
const { getDetector } = require('../monitoring/anomaly-detector');
const { FingerprintService, getFingerprintService } = require('../monitoring/fingerprint-service');

// Initialize services
const collector = getCollector();
const baselineService = getBaselineService();
const detector = getDetector();
const fingerprintService = getFingerprintService();

// Start collector flush timer
collector.start();

// ============ METRICS EMIT ============

/**
 * POST /api/metrics/emit
 * Emit one or more metrics for an agent
 */
router.post('/emit', (req, res) => {
  try {
    const { metrics } = req.body;
    
    if (!metrics || !Array.isArray(metrics)) {
      return res.status(400).json({ error: 'metrics must be an array' });
    }
    
    const result = collector.emitBatch(metrics);
    
    res.status(202).json({
      message: 'Metrics accepted',
      ...result
    });
  } catch (error) {
    console.error('Error emitting metrics:', error);
    res.status(500).json({ error: 'Failed to emit metrics' });
  }
});

// ============ CURRENT METRICS ============

/**
 * GET /api/metrics/current/:agentId
 * Get current aggregated metrics for an agent
 */
router.get('/current/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const metrics = collector.getCurrentMetrics(agentId);
    
    res.json(metrics);
  } catch (error) {
    console.error('Error getting current metrics:', error);
    res.status(500).json({ error: 'Failed to get current metrics' });
  }
});

// ============ BASELINES ============

/**
 * GET /api/metrics/baseline/:agentId
 * Get baseline for an agent
 */
router.get('/baseline/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const { recompute } = req.query;
    
    const baseline = baselineService.getBaseline(agentId, recompute === 'true');
    
    res.json(baseline);
  } catch (error) {
    console.error('Error getting baseline:', error);
    res.status(500).json({ error: 'Failed to get baseline' });
  }
});

/**
 * POST /api/metrics/baseline/:agentId/compute
 * Force recompute baseline for an agent
 */
router.post('/baseline/:agentId/compute', (req, res) => {
  try {
    const { agentId } = req.params;
    const baseline = baselineService.computeBaseline(agentId);
    
    res.json(baseline);
  } catch (error) {
    console.error('Error computing baseline:', error);
    res.status(500).json({ error: 'Failed to compute baseline' });
  }
});

/**
 * GET /api/metrics/baselines
 * Get all baselines
 */
router.get('/baselines', (req, res) => {
  try {
    const baselines = baselineService.getAllBaselines();
    
    res.json({
      baselines,
      count: Object.keys(baselines).length
    });
  } catch (error) {
    console.error('Error getting baselines:', error);
    res.status(500).json({ error: 'Failed to get baselines' });
  }
});

// ============ ANOMALIES ============

/**
 * GET /api/metrics/anomalies
 * Get recent anomalies across all agents
 */
router.get('/anomalies', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const anomalies = detector.getRecentAnomalies(parseInt(limit));
    
    res.json({
      anomalies,
      count: anomalies.length
    });
  } catch (error) {
    console.error('Error getting anomalies:', error);
    res.status(500).json({ error: 'Failed to get anomalies' });
  }
});

/**
 * GET /api/metrics/anomalies/:agentId
 * Get anomalies for a specific agent
 */
router.get('/anomalies/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit, startDate, endDate, severity } = req.query;
    
    const options = {
      limit: limit ? parseInt(limit) : undefined,
      startDate,
      endDate,
      severity
    };
    
    const anomalies = detector.getAnomalies(agentId, options);
    
    res.json({
      anomalies,
      count: anomalies.length
    });
  } catch (error) {
    console.error('Error getting anomalies:', error);
    res.status(500).json({ error: 'Failed to get anomalies' });
  }
});

/**
 * GET /api/metrics/anomalies/:agentId/stats
 * Get anomaly statistics for an agent
 */
router.get('/anomalies/:agentId/stats', (req, res) => {
  try {
    const { agentId } = req.params;
    const { days = 7 } = req.query;
    
    const stats = detector.getAnomalyStats(agentId, parseInt(days));
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting anomaly stats:', error);
    res.status(500).json({ error: 'Failed to get anomaly stats' });
  }
});

/**
 * POST /api/metrics/detect
 * Detect anomalies from provided metrics
 */
router.post('/detect', (req, res) => {
  try {
    const { metrics } = req.body;
    
    if (!metrics || !Array.isArray(metrics)) {
      return res.status(400).json({ error: 'metrics must be an array' });
    }
    
    const anomalies = detector.detectBatch(metrics);
    
    res.json({
      detected: anomalies.length,
      anomalies
    });
  } catch (error) {
    console.error('Error detecting anomalies:', error);
    res.status(500).json({ error: 'Failed to detect anomalies' });
  }
});

// ============ FINGERPRINTS ============

/**
 * POST /api/metrics/fingerprint
 * Create a fingerprint for content
 */
router.post('/fingerprint', (req, res) => {
  try {
    const { content, agentId, sessionId, model } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    
    const fingerprint = fingerprintService.fingerprint(content, {
      agentId,
      sessionId,
      model
    });
    
    res.status(201).json(fingerprint);
  } catch (error) {
    console.error('Error creating fingerprint:', error);
    res.status(500).json({ error: 'Failed to create fingerprint' });
  }
});

/**
 * POST /api/metrics/fingerprint/compare
 * Compare content against historical fingerprints
 */
router.post('/fingerprint/compare', (req, res) => {
  try {
    const { content, agentId } = req.body;
    
    if (!content || !agentId) {
      return res.status(400).json({ error: 'content and agentId are required' });
    }
    
    const comparison = fingerprintService.compare(agentId, content);
    
    res.json(comparison);
  } catch (error) {
    console.error('Error comparing fingerprint:', error);
    res.status(500).json({ error: 'Failed to compare fingerprint' });
  }
});

/**
 * GET /api/metrics/fingerprints/:agentId
 * Get fingerprint history for an agent
 */
router.get('/fingerprints/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit = 100 } = req.query;
    
    const history = fingerprintService.getHistory(agentId, parseInt(limit));
    
    res.json({
      fingerprints: history,
      count: history.length
    });
  } catch (error) {
    console.error('Error getting fingerprint history:', error);
    res.status(500).json({ error: 'Failed to get fingerprint history' });
  }
});

module.exports = router;
