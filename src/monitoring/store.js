// src/monitoring/store.js
// JSON-based persistence for monitoring metrics
// Phase 1.3: Behavioural Baseline & Anomaly Detection

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'monitoring');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');
const BASELINES_FILE = path.join(DATA_DIR, 'baselines.json');
const ANOMALIES_FILE = path.join(DATA_DIR, 'anomalies.json');
const FINGERPRINTS_FILE = path.join(DATA_DIR, 'fingerprints.json');

/**
 * Ensure directory exists
 */
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read JSON file, return default if not exists or invalid
 */
function readJson(filepath, defaultValue = {}) {
  try {
    ensureDirSync(path.dirname(filepath));
    if (!fs.existsSync(filepath)) {
      return defaultValue;
    }
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filepath}:`, error.message);
    return defaultValue;
  }
}

/**
 * Write JSON file atomically
 */
function writeJson(filepath, data) {
  try {
    ensureDirSync(path.dirname(filepath));
    const tempPath = `${filepath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filepath);
    return true;
  } catch (error) {
    console.error(`Error writing ${filepath}:`, error.message);
    return false;
  }
}

// ============ Metrics Store ============

/**
 * Get all metrics for an agent
 * @param {string} agentId
 * @returns {Array}
 */
function getMetrics(agentId) {
  const all = readJson(METRICS_FILE, { metrics: [] });
  return all.metrics.filter(m => m.agentId === agentId);
}

/**
 * Get metrics for agent within time range
 * @param {string} agentId
 * @param {Date} start
 * @param {Date} end
 * @returns {Array}
 */
function getMetricsRange(agentId, start, end) {
  const metrics = getMetrics(agentId);
  const startTime = start.getTime();
  const endTime = end.getTime();
  return metrics.filter(m => {
    const t = new Date(m.timestamp).getTime();
    return t >= startTime && t <= endTime;
  });
}

/**
 * Store a metric entry
 * @param {Object} metric
 * @returns {boolean}
 */
function storeMetric(metric) {
  const all = readJson(METRICS_FILE, { metrics: [] });
  all.metrics.push({
    ...metric,
    id: `${metric.agentId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  });
  
  // Keep only last 30 days of metrics
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  all.metrics = all.metrics.filter(m => new Date(m.timestamp).getTime() > cutoff);
  
  return writeJson(METRICS_FILE, all);
}

/**
 * Store multiple metrics at once
 * @param {Array} metrics
 * @returns {boolean}
 */
function storeMetrics(metrics) {
  const all = readJson(METRICS_FILE, { metrics: [] });
  const entries = metrics.map(m => ({
    ...m,
    id: `${m.agentId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  }));
  all.metrics.push(...entries);
  
  // Keep only last 30 days
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  all.metrics = all.metrics.filter(m => new Date(m.timestamp).getTime() > cutoff);
  
  return writeJson(METRICS_FILE, all);
}

// ============ Baseline Store ============

/**
 * Get baseline for an agent
 * @param {string} agentId
 * @returns {Object|null}
 */
function getBaseline(agentId) {
  const all = readJson(BASELINES_FILE, { baselines: {} });
  return all.baselines[agentId] || null;
}

/**
 * Store baseline for an agent
 * @param {string} agentId
 * @param {Object} baseline
 * @returns {boolean}
 */
function storeBaseline(agentId, baseline) {
  const all = readJson(BASELINES_FILE, { baselines: {} });
  all.baselines[agentId] = {
    ...baseline,
    updatedAt: new Date().toISOString()
  };
  return writeJson(BASELINES_FILE, all);
}

/**
 * Get all baselines
 * @returns {Object}
 */
function getAllBaselines() {
  const all = readJson(BASELINES_FILE, { baselines: {} });
  return all.baselines;
}

// ============ Anomaly Store ============

/**
 * Get anomalies for an agent
 * @param {string} agentId
 * @param {Object} options - { limit, startDate, endDate, severity }
 * @returns {Array}
 */
function getAnomalies(agentId, options = {}) {
  const all = readJson(ANOMALIES_FILE, { anomalies: [] });
  let results = all.anomalies.filter(a => a.agentId === agentId);
  
  if (options.startDate) {
    const start = new Date(options.startDate).getTime();
    results = results.filter(a => new Date(a.detectedAt).getTime() >= start);
  }
  if (options.endDate) {
    const end = new Date(options.endDate).getTime();
    results = results.filter(a => new Date(a.detectedAt).getTime() <= end);
  }
  if (options.severity) {
    results = results.filter(a => a.severity === options.severity);
  }
  
  results.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
  
  if (options.limit) {
    results = results.slice(0, options.limit);
  }
  
  return results;
}

/**
 * Store an anomaly
 * @param {Object} anomaly
 * @returns {boolean}
 */
function storeAnomaly(anomaly) {
  const all = readJson(ANOMALIES_FILE, { anomalies: [] });
  all.anomalies.push({
    ...anomaly,
    id: `anomaly-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  });
  
  // Keep only last 90 days of anomalies
  const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
  all.anomalies = all.anomalies.filter(a => new Date(a.detectedAt).getTime() > cutoff);
  
  return writeJson(ANOMALIES_FILE, all);
}

/**
 * Get recent anomalies across all agents
 * @param {number} limit
 * @returns {Array}
 */
function getRecentAnomalies(limit = 50) {
  const all = readJson(ANOMALIES_FILE, { anomalies: [] });
  return all.anomalies
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
    .slice(0, limit);
}

// ============ Fingerprint Store ============

/**
 * Get fingerprint history for an agent
 * @param {string} agentId
 * @param {number} limit
 * @returns {Array}
 */
function getFingerprints(agentId, limit = 100) {
  const all = readJson(FINGERPRINTS_FILE, { fingerprints: [] });
  return all.fingerprints
    .filter(f => f.agentId === agentId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

/**
 * Store a fingerprint entry
 * @param {Object} fingerprint
 * @returns {boolean}
 */
function storeFingerprint(fingerprint) {
  const all = readJson(FINGERPRINTS_FILE, { fingerprints: [] });
  all.fingerprints.push({
    ...fingerprint,
    id: `fp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  });
  
  // Keep only last 1000 fingerprints per agent
  const byAgent = new Map();
  all.fingerprints.forEach(f => {
    const list = byAgent.get(f.agentId) || [];
    list.push(f);
    byAgent.set(f.agentId, list);
  });
  
  const trimmed = [];
  for (const [agentId, list] of byAgent) {
    trimmed.push(...list.slice(0, 1000));
  }
  all.fingerprints = trimmed;
  
  return writeJson(FINGERPRINTS_FILE, all);
}

/**
 * Check if a fingerprint exists for an agent
 * @param {string} agentId
 * @param {string} hash
 * @returns {boolean}
 */
function fingerprintExists(agentId, hash) {
  const fingerprints = getFingerprints(agentId, 10000);
  return fingerprints.some(f => f.hash === hash);
}

module.exports = {
  // Metrics
  getMetrics,
  getMetricsRange,
  storeMetric,
  storeMetrics,
  
  // Baselines
  getBaseline,
  storeBaseline,
  getAllBaselines,
  
  // Anomalies
  getAnomalies,
  storeAnomaly,
  getRecentAnomalies,
  
  // Fingerprints
  getFingerprints,
  storeFingerprint,
  fingerprintExists
};
