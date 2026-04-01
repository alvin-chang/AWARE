// src/monitoring/index.js
// Monitoring module exports
// Phase 1.3: Behavioural Baseline & Anomaly Detection

const store = require('./store');
const { MetricsCollector, getCollector, MetricType, Severity } = require('./metrics-collector');
const { BaselineService, getBaselineService, BASELINE_WINDOW_MS, MIN_DATA_POINTS } = require('./baseline-service');
const { AnomalyDetector, getDetector, Severity: AnomalySeverity, Z_SCORE_THRESHOLDS } = require('./anomaly-detector');
const { FingerprintService, getFingerprintService } = require('./fingerprint-service');

module.exports = {
  // Store
  store,
  
  // Metrics Collector
  MetricsCollector,
  getCollector,
  MetricType,
  
  // Baseline Service
  BaselineService,
  getBaselineService,
  BASELINE_WINDOW_MS,
  MIN_DATA_POINTS,
  
  // Anomaly Detector
  AnomalyDetector,
  getDetector,
  AnomalySeverity,
  Z_SCORE_THRESHOLDS,
  
  // Fingerprint Service
  FingerprintService,
  getFingerprintService
};
