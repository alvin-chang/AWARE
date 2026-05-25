// src/compliance/report-generator.js
// Report Generator — Generates compliance reports
// ADR-016: Compliance Mapping & Reporting

const { getFrameworkMapper } = require('./framework-mapper');
const { getPostureCalculator } = require('./posture-calculator');
const { getGapTracker } = require('./gap-tracker');

/**
 * Report Types
 */
const ReportType = {
  EXECUTIVE_SUMMARY: 'executive-summary',
  DETAILED_COMPLIANCE: 'detailed-compliance',
  GAP_STATUS: 'gap-status',
  INCIDENT: 'incident'
};

/**
 * Report Generator — Generates compliance reports
 */
class ReportGenerator {
  constructor(config = {}) {
    this.frameworkMapper = getFrameworkMapper();
    this.postureCalculator = getPostureCalculator();
    this.gapTracker = getGapTracker();
    this.generatedReports = new Map();
  }

  /**
   * Generate executive summary report
   * @param {Object} options
   * @returns {Object}
   */
  generateExecutiveSummary(options = {}) {
    const period = options.period || this.getCurrentPeriod();
    const overallPosture = this.postureCalculator.calculateOverallPosture();

    const report = {
      reportId: `rpt-exec-${Date.now()}`,
      type: ReportType.EXECUTIVE_SUMMARY,
      generatedAt: new Date().toISOString(),
      generatedBy: 'compliance-reporter',
      period,
      summary: {
        overallPosture: overallPosture.overallScore,
        postureTrend: 'STABLE', // Would be calculated from historical data
        totalGaps: overallPosture.totalGaps,
        openGaps: overallPosture.openGaps,
        criticalGaps: overallPosture.criticalGaps,
        frameworksAssessed: overallPosture.frameworks.length,
        compliancePercentage: overallPosture.overallPercentage
      },
      frameworkScores: overallPosture.frameworks.map(f => ({
        frameworkId: f.frameworkId,
        frameworkName: f.frameworkName,
        score: f.score,
        percentage: f.percentage,
        status: f.overallStatus
      })),
      keyMetrics: this.getKeyMetrics(),
      topGaps: this.getTopGaps(5),
      recommendations: this.getRecommendations(overallPosture),
      nextReviewDate: this.getNextReviewDate()
    };

    this.storeReport(report);

    return report;
  }

  /**
   * Generate detailed compliance report
   * @param {Object} options
   * @returns {Object}
   */
  generateDetailedComplianceReport(options = {}) {
    const { frameworkId } = options;
    const period = options.period || this.getCurrentPeriod();

    const frameworks = frameworkId
      ? [this.frameworkMapper.getFramework(frameworkId)]
      : Object.values(this.frameworkMapper.getFrameworks());

    const frameworkReports = [];

    for (const framework of frameworks) {
      if (!framework) continue;

      const posture = this.postureCalculator.calculateFrameworkPosture(framework.id);
      const controls = this.frameworkMapper.getFrameworkControls(framework.id);

      frameworkReports.push({
        frameworkId: framework.id,
        frameworkName: framework.name,
        posture,
        controls: controls.map(c => ({
          ...c,
          assessment: this.postureCalculator.assessments.get(`${framework.id}:${c.id}`)
        })),
        gaps: this.gapTracker.getAllGaps({ frameworkId: framework.id })
      });
    }

    const report = {
      reportId: `rpt-detailed-${Date.now()}`,
      type: ReportType.DETAILED_COMPLIANCE,
      generatedAt: new Date().toISOString(),
      generatedBy: 'compliance-reporter',
      period,
      frameworks: frameworkReports,
      totalControls: frameworkReports.reduce((sum, f) => sum + f.controls.length, 0),
      gapSummary: this.gapTracker.getStats()
    };

    this.storeReport(report);

    return report;
  }

  /**
   * Generate gap status report
   * @param {Object} options
   * @returns {Object}
   */
  generateGapStatusReport(options = {}) {
    const { frameworkId, status } = options;

    const gaps = this.gapTracker.getAllGaps({ frameworkId, status });

    const report = {
      reportId: `rpt-gaps-${Date.now()}`,
      type: ReportType.GAP_STATUS,
      generatedAt: new Date().toISOString(),
      generatedBy: 'compliance-reporter',
      filters: { frameworkId, status },
      summary: this.gapTracker.getStats(),
      gaps: gaps.map(g => ({
        id: g.id,
        controlId: g.controlId,
        frameworkId: g.frameworkId,
        severity: g.severity,
        title: g.title,
        status: g.status,
        owner: g.owner,
        age: Math.round((Date.now() - g.createdAt) / (24 * 60 * 60 * 1000)),
        notes: g.notes.length
      })),
      bySeverity: {
        CRITICAL: gaps.filter(g => g.severity === 'CRITICAL').length,
        HIGH: gaps.filter(g => g.severity === 'HIGH').length,
        MEDIUM: gaps.filter(g => g.severity === 'MEDIUM').length,
        LOW: gaps.filter(g => g.severity === 'LOW').length
      },
      byStatus: {
        OPEN: gaps.filter(g => g.status === 'OPEN').length,
        IN_PROGRESS: gaps.filter(g => g.status === 'IN_PROGRESS').length,
        REMEDIATED: gaps.filter(g => g.status === 'REMEDIATED').length
      }
    };

    this.storeReport(report);

    return report;
  }

  /**
   * Generate incident report
   * @param {Object} incidentData
   * @returns {Object}
   */
  generateIncidentReport(incidentData) {
    const report = {
      reportId: `rpt-incident-${Date.now()}`,
      type: ReportType.INCIDENT,
      generatedAt: new Date().toISOString(),
      generatedBy: 'compliance-reporter',
      incident: {
        id: incidentData.id || `inc-${Date.now()}`,
        title: incidentData.title,
        severity: incidentData.severity,
        description: incidentData.description,
        detectedAt: incidentData.detectedAt || new Date().toISOString(),
        reportedBy: incidentData.reportedBy
      },
      relatedGaps: incidentData.relatedGapIds || [],
      affectedControls: incidentData.affectedControls || [],
      immediateActions: incidentData.immediateActions || [],
      rootCause: incidentData.rootCause || null,
      remediationPlan: incidentData.remediationPlan || null,
      timeline: incidentData.timeline || []
    };

    this.storeReport(report);

    return report;
  }

  /**
   * Get current reporting period
   * @returns {Object}
   */
  getCurrentPeriod() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      from: startOfMonth.toISOString(),
      to: endOfMonth.toISOString()
    };
  }

  /**
   * Get key metrics
   * @returns {Array}
   */
  getKeyMetrics() {
    const stats = this.gapTracker.getStats();

    return [
      { name: 'Total Gaps', value: stats.total, change: null },
      { name: 'Open Gaps', value: stats.byStatus.OPEN, change: null },
      { name: 'Critical Gaps', value: stats.bySeverity.CRITICAL, change: null },
      { name: 'Remediated Gaps', value: stats.byStatus.REMEDIATED, change: null }
    ];
  }

  /**
   * Get top gaps
   * @param {number} limit
   * @returns {Array}
   */
  getTopGaps(limit = 5) {
    const openGaps = this.gapTracker.getAllGaps({ status: 'OPEN' });

    return openGaps
      .sort((a, b) => a.priority - b.priority)
      .slice(0, limit)
      .map(g => ({
        id: g.id,
        controlId: g.controlId,
        frameworkId: g.frameworkId,
        severity: g.severity,
        title: g.title,
        owner: g.owner
      }));
  }

  /**
   * Get recommendations based on posture
   * @param {Object} overallPosture
   * @returns {Array}
   */
  getRecommendations(overallPosture) {
    const recommendations = [];

    if (overallPosture.overallScore < 0.7) {
      recommendations.push({
        priority: 'HIGH',
        recommendation: 'Overall compliance posture is below target. Immediate action required.',
        area: 'Overall'
      });
    }

    // Check framework-specific issues
    for (const framework of overallPosture.frameworks) {
      if (framework.score < 0.6) {
        recommendations.push({
          priority: 'HIGH',
          recommendation: `${framework.frameworkName} compliance needs attention. Score: ${framework.percentage}%`,
          area: framework.frameworkName
        });
      }
    }

    // Check for critical gaps
    if (overallPosture.criticalGaps > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        recommendation: `${overallPosture.criticalGaps} critical gap(s) require immediate remediation.`,
        area: 'Gap Remediation'
      });
    }

    return recommendations;
  }

  /**
   * Get next review date
   * @returns {string}
   */
  getNextReviewDate() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  /**
   * Store report
   * @param {Object} report
   */
  storeReport(report) {
    this.generatedReports.set(report.reportId, report);
  }

  /**
   * Get stored report
   * @param {string} reportId
   * @returns {Object|null}
   */
  getReport(reportId) {
    return this.generatedReports.get(reportId) || null;
  }

  /**
   * List all generated reports
   * @param {Object} filters
   * @returns {Array}
   */
  listReports(filters = {}) {
    let reports = Array.from(this.generatedReports.values());

    if (filters.type) {
      reports = reports.filter(r => r.type === filters.type);
    }

    return reports.sort((a, b) =>
      new Date(b.generatedAt) - new Date(a.generatedAt)
    );
  }

  /**
   * Export report as JSON
   * @param {string} reportId
   * @returns {string}
   */
  exportReportAsJSON(reportId) {
    const report = this.getReport(reportId);
    if (!report) return null;

    return JSON.stringify(report, null, 2);
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create ReportGenerator singleton
 * @returns {ReportGenerator}
 */
function getReportGenerator() {
  if (!instance) {
    instance = new ReportGenerator();
  }
  return instance;
}

module.exports = {
  ReportGenerator,
  getReportGenerator,
  ReportType
};
