// src/monitoring/baseline-service.js
// Rolling 7-day baseline statistics for agent metrics
// Phase 1.3: Behavioural Baseline & Anomaly Detection

const store = require('./store');

/**
 * Baseline window in milliseconds (7 days)
 */
const BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum data points required to compute baseline
 */
const MIN_DATA_POINTS = 10;

/**
 * BaselineService - computes and maintains rolling baselines for agent metrics
 */
class BaselineService {
  /**
   * Compute baseline for an agent from historical metrics
   * @param {string} agentId
   * @returns {Object} baseline statistics
   */
  computeBaseline(agentId) {
    const cutoff = new Date(Date.now() - BASELINE_WINDOW_MS);
    const metrics = store.getMetricsRange(agentId, cutoff, new Date());
    
    if (metrics.length < MIN_DATA_POINTS) {
      return {
        agentId,
        status: 'insufficient_data',
        dataPoints: metrics.length,
        required: MIN_DATA_POINTS,
        message: `Need ${MIN_DATA_POINTS - metrics.length} more data points`
      };
    }
    
    // Group by metric type
    const byType = {};
    for (const m of metrics) {
      if (!byType[m.type]) {
        byType[m.type] = [];
      }
      byType[m.type].push(m.value);
    }
    
    // Compute statistics for each type
    const baselines = {};
    for (const [type, values] of Object.entries(byType)) {
      if (values.length < MIN_DATA_POINTS) continue;
      
      const stats = this.computeStatistics(values);
      baselines[type] = stats;
    }
    
    const baseline = {
      agentId,
      status: 'computed',
      dataPoints: metrics.length,
      computedAt: new Date().toISOString(),
      windowStart: cutoff.toISOString(),
      windowEnd: new Date().toISOString(),
      baselines
    };
    
    // Store the baseline
    store.storeBaseline(agentId, baseline);
    
    return baseline;
  }

  /**
   * Compute statistics for a set of values
   * @param {Array} values
   * @returns {Object}
   */
  computeStatistics(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    
    // Variance and stddev
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const stddev = Math.sqrt(variance);
    
    // Percentiles
    const p50 = sorted[Math.floor(n * 0.5)];
    const p75 = sorted[Math.floor(n * 0.75)];
    const p90 = sorted[Math.floor(n * 0.9)];
    const p95 = sorted[Math.floor(n * 0.95)];
    const p99 = sorted[Math.floor(n * 0.99)];
    
    // Range
    const range = sorted[n - 1] - sorted[0];
    
    // Coefficient of variation (relative stddev)
    const cv = mean !== 0 ? (stddev / Math.abs(mean)) : 0;
    
    return {
      mean: Math.round(mean * 1000) / 1000,
      stddev: Math.round(stddev * 1000) / 1000,
      min: sorted[0],
      max: sorted[n - 1],
      range: Math.round(range * 1000) / 1000,
      cv: Math.round(cv * 1000) / 1000, // coefficient of variation
      p50,
      p75,
      p90,
      p95,
      p99,
      sampleCount: n
    };
  }

  /**
   * Get baseline for an agent (from store, compute if missing)
   * @param {string} agentId
   * @param {boolean} recompute - Force recompute
   * @returns {Object}
   */
  getBaseline(agentId, recompute = false) {
    const existing = store.getBaseline(agentId);
    
    if (existing && !recompute) {
      // Check if baseline is stale (>1 day old)
      const age = Date.now() - new Date(existing.computedAt).getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      
      if (age < oneDay) {
        return existing;
      }
    }
    
    // Recompute
    return this.computeBaseline(agentId);
  }

  /**
   * Get all baselines
   * @returns {Object}
   */
  getAllBaselines() {
    return store.getAllBaselines();
  }

  /**
   * Compare current value against baseline
   * @param {string} agentId
   * @param {string} metricType
   * @param {number} value
   * @returns {Object} comparison result
   */
  compareToBaseline(agentId, metricType, value) {
    const baseline = this.getBaseline(agentId);
    
    if (baseline.status !== 'computed') {
      return {
        hasBaseline: false,
        status: baseline.status,
        message: baseline.message
      };
    }
    
    const metricBaseline = baseline.baselines[metricType];
    if (!metricBaseline) {
      return {
        hasBaseline: false,
        status: 'no_baseline_for_type',
        message: `No baseline computed for metric type: ${metricType}`
      };
    }
    
    // Calculate z-score
    const zScore = metricBaseline.stddev !== 0
      ? (value - metricBaseline.mean) / metricBaseline.stddev
      : 0;
    
    // Determine if anomalous (>3 stddev)
    const isAnomalous = Math.abs(zScore) > 3;
    
    // Calculate percentile
    let percentile = 0;
    if (value <= metricBaseline.p50) {
      percentile = (value / metricBaseline.p50) * 50;
    } else if (value <= metricBaseline.p95) {
      percentile = 50 + ((value - metricBaseline.p50) / (metricBaseline.p95 - metricBaseline.p50)) * 45;
    } else {
      percentile = 95 + ((value - metricBaseline.p95) / (metricBaseline.p99 - metricBaseline.p95)) * 5;
    }
    percentile = Math.min(99.9, Math.max(0.1, percentile));
    
    return {
      hasBaseline: true,
      current: value,
      baseline: {
        mean: metricBaseline.mean,
        stddev: metricBaseline.stddev,
        p50: metricBaseline.p50,
        p95: metricBaseline.p95,
        p99: metricBaseline.p99
      },
      zScore: Math.round(zScore * 100) / 100,
      isAnomalous,
      percentile: Math.round(percentile * 10) / 10,
      direction: value > metricBaseline.mean ? 'above' : 'below'
    };
  }
}

// Singleton
let baselineServiceInstance = null;

function getBaselineService() {
  if (!baselineServiceInstance) {
    baselineServiceInstance = new BaselineService();
  }
  return baselineServiceInstance;
}

module.exports = {
  BaselineService,
  getBaselineService,
  BASELINE_WINDOW_MS,
  MIN_DATA_POINTS
};
