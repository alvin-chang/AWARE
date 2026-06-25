// src/api/routes/compliance.js
// Compliance API Routes
// ADR (internal): Compliance Mapping & Reporting

const express = require('express');
const router = express.Router();

const {
  getFrameworkMapper,
  FRAMEWORKS
} = require('../../compliance/framework-mapper');

const {
  getEvidenceCollector,
  EvidenceStatus
} = require('../../compliance/evidence-collector');

const {
  getPostureCalculator,
  ComplianceStatus,
  GapSeverity
} = require('../../compliance/posture-calculator');

const {
  getGapTracker,
  GapStatus
} = require('../../compliance/gap-tracker');

const {
  getReportGenerator,
  ReportType
} = require('../../compliance/report-generator');

/**
 * GET /api/compliance/frameworks
 * List all supported frameworks
 */
router.get('/frameworks', (req, res) => {
  try {
    const mapper = getFrameworkMapper();
    const frameworks = mapper.getFrameworks();

    res.json({
      frameworks: Object.values(frameworks).map(f => ({
        id: f.id,
        name: f.name,
        version: f.version
      }))
    });
  } catch (error) {
    console.error('Failed to list frameworks:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/frameworks/:frameworkId
 * Get framework details with controls
 */
router.get('/frameworks/:frameworkId', (req, res) => {
  try {
    const { frameworkId } = req.params;
    const mapper = getFrameworkMapper();
    const framework = mapper.getFramework(frameworkId);

    if (!framework) {
      return res.status(404).json({
        error: 'FRAMEWORK_NOT_FOUND',
        message: `Framework '${frameworkId}' not found`
      });
    }

    const controls = mapper.getFrameworkControls(frameworkId);
    const postureCalc = getPostureCalculator();

    // Get posture for each control
    const controlsWithPosture = controls.map(c => {
      const key = `${frameworkId}:${c.id}`;
      const assessment = postureCalc.assessments.get(key);
      return {
        ...c,
        status: assessment?.status || ComplianceStatus.NOT_ASSESSED,
        lastAssessed: assessment?.assessedAt || null
      };
    });

    const posture = postureCalc.calculateFrameworkPosture(frameworkId);

    res.json({
      framework,
      posture,
      controls: controlsWithPosture
    });
  } catch (error) {
    console.error('Failed to get framework:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/matrix
 * Get compliance matrix for all components
 */
router.get('/matrix', (req, res) => {
  try {
    const mapper = getFrameworkMapper();
    const matrix = mapper.generateComplianceMatrix();

    res.json({ matrix });
  } catch (error) {
    console.error('Failed to get matrix:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/posture
 * Get overall compliance posture
 */
router.get('/posture', (req, res) => {
  try {
    const postureCalc = getPostureCalculator();
    const posture = postureCalc.calculateOverallPosture();

    res.json(posture);
  } catch (error) {
    console.error('Failed to get posture:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/compliance/assessments
 * Record assessment for a control
 */
router.post('/assessments', (req, res) => {
  try {
    const { controlId, frameworkId, status, evidence, notes } = req.body;

    if (!controlId || !frameworkId) {
      return res.status(400).json({
        error: 'CONTROL_ID_AND_FRAMEWORK_ID_REQUIRED',
        message: 'controlId and frameworkId are required'
      });
    }

    const postureCalc = getPostureCalculator();
    postureCalc.recordAssessment(controlId, frameworkId, {
      status: status || ComplianceStatus.NOT_ASSESSED,
      evidence: evidence || [],
      notes: notes || '',
      assessedBy: req.user?.agentId || 'system'
    });

    res.json({ success: true, controlId, frameworkId });
  } catch (error) {
    console.error('Failed to record assessment:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/evidence
 * Get evidence summary
 */
router.get('/evidence', async (req, res) => {
  try {
    const collector = getEvidenceCollector();
    const summary = collector.getSummary();

    res.json(summary);
  } catch (error) {
    console.error('Failed to get evidence:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/compliance/evidence/collect
 * Trigger evidence collection
 */
router.post('/evidence/collect', async (req, res) => {
  try {
    const { controlId } = req.body;
    const collector = getEvidenceCollector();

    let results;
    if (controlId) {
      results = [await collector.collectEvidence(controlId)];
    } else {
      results = await collector.collectAll();
    }

    res.json({ results });
  } catch (error) {
    console.error('Failed to collect evidence:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/gaps
 * List all compliance gaps
 */
router.get('/gaps', (req, res) => {
  try {
    const { frameworkId, status, severity } = req.query;

    const tracker = getGapTracker();
    const gaps = tracker.getAllGaps({
      frameworkId,
      status,
      severity
    });

    res.json({
      gaps,
      total: gaps.length
    });
  } catch (error) {
    console.error('Failed to list gaps:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/compliance/gaps
 * Create a new gap
 */
router.post('/gaps', (req, res) => {
  try {
    const { controlId, frameworkId, severity, title, description, remediation } = req.body;

    if (!controlId || !frameworkId) {
      return res.status(400).json({
        error: 'CONTROL_ID_AND_FRAMEWORK_ID_REQUIRED',
        message: 'controlId and frameworkId are required'
      });
    }

    const tracker = getGapTracker();
    const gapId = tracker.createGap({
      controlId,
      frameworkId,
      severity: severity || GapSeverity.MEDIUM,
      title: title || `Gap in ${controlId}`,
      description,
      remediation
    });

    res.json({ success: true, gapId });
  } catch (error) {
    console.error('Failed to create gap:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * PATCH /api/compliance/gaps/:gapId
 * Update gap status
 */
router.patch('/gaps/:gapId', (req, res) => {
  try {
    const { gapId } = req.params;
    const { status, owner, notes } = req.body;

    const tracker = getGapTracker();
    const updated = tracker.updateStatus(gapId, {
      status,
      owner,
      notes,
      updatedBy: req.user?.agentId || 'system'
    });

    if (!updated) {
      return res.status(404).json({
        error: 'GAP_NOT_FOUND',
        message: `Gap '${gapId}' not found`
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update gap:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/gaps/stats
 * Get gap statistics
 */
router.get('/gaps/stats', (req, res) => {
  try {
    const tracker = getGapTracker();
    const stats = tracker.getStats();

    res.json(stats);
  } catch (error) {
    console.error('Failed to get gap stats:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/reports
 * List generated reports
 */
router.get('/reports', (req, res) => {
  try {
    const { type } = req.query;

    const generator = getReportGenerator();
    const reports = generator.listReports({ type });

    res.json({
      reports: reports.map(r => ({
        reportId: r.reportId,
        type: r.type,
        generatedAt: r.generatedAt,
        period: r.period
      })),
      total: reports.length
    });
  } catch (error) {
    console.error('Failed to list reports:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/compliance/reports
 * Generate a new report
 */
router.post('/reports', (req, res) => {
  try {
    const { type, frameworkId, period } = req.body;

    const generator = getReportGenerator();

    let report;
    switch (type) {
      case ReportType.EXECUTIVE_SUMMARY:
        report = generator.generateExecutiveSummary({ period });
        break;
      case ReportType.DETAILED_COMPLIANCE:
        report = generator.generateDetailedComplianceReport({ frameworkId, period });
        break;
      case ReportType.GAP_STATUS:
        report = generator.generateGapStatusReport({ frameworkId, status: 'OPEN' });
        break;
      default:
        return res.status(400).json({
          error: 'INVALID_REPORT_TYPE',
          message: `Type must be one of: ${Object.values(ReportType).join(', ')}`
        });
    }

    res.json({ report });
  } catch (error) {
    console.error('Failed to generate report:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/compliance/reports/:reportId
 * Get report details
 */
router.get('/reports/:reportId', (req, res) => {
  try {
    const { reportId } = req.params;

    const generator = getReportGenerator();
    const report = generator.getReport(reportId);

    if (!report) {
      return res.status(404).json({
        error: 'REPORT_NOT_FOUND',
        message: `Report '${reportId}' not found`
      });
    }

    res.json({ report });
  } catch (error) {
    console.error('Failed to get report:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
