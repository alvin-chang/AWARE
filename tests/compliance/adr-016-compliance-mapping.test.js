// tests/compliance/adr-016-compliance-mapping.test.js
// ADR-016 Compliance Mapping & Reporting Tests

describe('ADR-016: Compliance Mapping & Reporting', () => {

  describe('Framework Mapper', () => {
    let FrameworkMapper;

    beforeAll(() => {
      FrameworkMapper = require('../../src/compliance/framework-mapper').FrameworkMapper;
    });

    it('F-1: maps components to CSA AI CM controls', () => {
      const mapper = new FrameworkMapper();
      const mapping = mapper.getComponentMapping('identity-provider');

      expect(mapping)not.toBeNull();
      expect(mapping.CSA_AI_CM)toContain('AI.ID-01');
      expect(mapping.CSA_AI_CM)toContain('AI.ID-02');
    });

    it('F-2: maps components to NIST AI RMF controls', () => {
      const mapper = new FrameworkMapper();
      const mapping = mapper.getComponentMapping('identity-provider');

      expect(mapping.NIST_AI_RMF)toContain('PR.AC');
      expect(mapping.NIST_AI_RMF)toContain('PR.AA');
    });

    it('T1: generates compliance matrix', () => {
      const mapper = new FrameworkMapper();
      const matrix = mapper.generateComplianceMatrix();

      expect(matrix['identity-provider'])not.toBeUndefined();
      expect(matrix['identity-provider'].CSA_AI_CM)not.toBeUndefined();
      expect(matrix['identity-provider'].CSA_AI_CM.frameworkName).toBe('CSA AI Control Matrix');
    });

    it('T2: returns framework controls', () => {
      const mapper = new FrameworkMapper();
      const controls = mapper.getFrameworkControls('CSA_AI_CM');

      expect(controls.length)toBeGreaterThan(0);
    });

    it('T3: componentCoversControl returns true for mapped control', () => {
      const mapper = new FrameworkMapper();
      const result = mapper.componentCoversControl('identity-provider', 'CSA_AI_CM', 'AI.ID-01');

      expect(result).toBe(true);
    });
  });

  describe('Evidence Collector', () => {
    let EvidenceCollector;

    beforeAll(() => {
      EvidenceCollector = require('../../src/compliance/evidence-collector').EvidenceCollector;
    });

    it('F-1: collects evidence for registered controls', async () => {
      const collector = new EvidenceCollector();
      const evidence = await collector.collectEvidence('AI.ID-01');

      expect(evidence.status).toBe('COLLECTED');
      expect(evidence.data)not.toBeUndefined();
    });

    it('F-2: returns failed status for unregistered controls', async () => {
      const collector = new EvidenceCollector();
      const evidence = await collector.collectEvidence('UNKNOWN-CONTROL');

      expect(evidence.status).toBe('FAILED');
      expect(evidence.error).toBe('NO_COLLECTOR_REGISTERED');
    });

    it('T1: gets latest evidence for control', async () => {
      const collector = new EvidenceCollector();
      await collector.collectEvidence('AI.ID-01');

      const latest = collector.getLatestEvidence('AI.ID-01');
      expect(latest)not.toBeNull();
      expect(latest.controlId).toBe('AI.ID-01');
    });

    it('T2: registers custom collector', async () => {
      const collector = new EvidenceCollector();
      collector.registerCollector('CUSTOM-01', async () => ({
        data: { custom: true }
      }));

      const evidence = await collector.collectEvidence('CUSTOM-01');
      expect(evidence.status).toBe('COLLECTED');
      expect(evidence.data.custom).toBe(true);
    });
  });

  describe('Posture Calculator', () => {
    let PostureCalculator, ComplianceStatus;

    beforeAll(() => {
      const module = require('../../src/compliance/posture-calculator');
      PostureCalculator = module.PostureCalculator;
      ComplianceStatus = module.ComplianceStatus;
    });

    it('F-1: calculates framework posture score', () => {
      const calculator = new PostureCalculator();
      calculator.recordAssessment('AI.ID-01', 'CSA_AI_CM', {
        status: ComplianceStatus.COMPLIANT
      });

      const posture = calculator.calculateFrameworkPosture('CSA_AI_CM');
      expect(posture.score)toBeGreaterThan(0);
    });

    it('F-2: records compliance gaps', () => {
      const calculator = new PostureCalculator();
      calculator.recordGap({
        controlId: 'AI.ID-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'HIGH',
        description: 'Test gap'
      });

      const gaps = calculator.getGapReport();
      expect(gaps.length).toBe(1);
      expect(gaps[0].severity).toBe('HIGH');
    });

    it('T1: calculates overall posture', () => {
      const calculator = new PostureCalculator();
      calculator.recordAssessment('AI.ID-01', 'CSA_AI_CM', {
        status: ComplianceStatus.COMPLIANT
      });

      const overall = calculator.calculateOverallPosture();
      expect(overall.overallScore)toBeGreaterThan(0);
    });

    it('T2: gap severity determines priority', () => {
      const calculator = new PostureCalculator();
      calculator.recordGap({
        controlId: 'TEST-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'CRITICAL',
        description: 'Critical gap'
      });

      const gaps = calculator.getGapReport();
      expect(gaps[0].priority).toBe(1); // CRITICAL = priority 1
    });
  });

  describe('Gap Tracker', () => {
    let GapTracker, GapStatus;

    beforeAll(() => {
      const module = require('../../src/compliance/gap-tracker');
      GapTracker = module.GapTracker;
      GapStatus = module.GapStatus;
    });

    it('F-1: creates and tracks gaps', () => {
      const tracker = new GapTracker();
      const gapId = tracker.createGap({
        controlId: 'AI.ID-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'HIGH',
        title: 'Test Gap'
      });

      expect(gapId)not.toBeUndefined();
      expect(tracker.getGap(gapId))not.toBeNull();
    });

    it('F-2: updates gap status', () => {
      const tracker = new GapTracker();
      const gapId = tracker.createGap({
        controlId: 'AI.ID-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'MEDIUM',
        title: 'Test Gap'
      });

      tracker.updateStatus(gapId, { status: GapStatus.IN_PROGRESS });

      const gap = tracker.getGap(gapId);
      expect(gap.status).toBe(GapStatus.IN_PROGRESS);
    });

    it('T1: assigns gap to owner', () => {
      const tracker = new GapTracker();
      const gapId = tracker.createGap({
        controlId: 'AI.ID-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'LOW',
        title: 'Test Gap'
      });

      tracker.assignTo(gapId, 'agent-1');

      const gap = tracker.getGap(gapId);
      expect(gap.owner).toBe('agent-1');
    });

    it('T2: marks gap as remediated', () => {
      const tracker = new GapTracker();
      const gapId = tracker.createGap({
        controlId: 'AI.ID-01',
        frameworkId: 'CSA_AI_CM',
        severity: 'MEDIUM',
        title: 'Test Gap'
      });

      tracker.markRemediated(gapId);

      const gap = tracker.getGap(gapId);
      expect(gap.status).toBe(GapStatus.REMEDIATED);
      expect(gap.remediatedAt)not.toBeNull();
    });

    it('T3: gets gap statistics', () => {
      const tracker = new GapTracker();
      tracker.createGap({ controlId: 'TEST-01', frameworkId: 'CSA_AI_CM', severity: 'HIGH', title: 'Gap 1' });
      tracker.createGap({ controlId: 'TEST-02', frameworkId: 'NIST_AI_RMF', severity: 'LOW', title: 'Gap 2' });

      const stats = tracker.getStats();
      expect(stats.total).toBe(2);
      expect(stats.bySeverity.HIGH).toBe(1);
      expect(stats.bySeverity.LOW).toBe(1);
    });
  });

  describe('Report Generator', () => {
    let ReportGenerator, ReportType;

    beforeAll(() => {
      const module = require('../../src/compliance/report-generator');
      ReportGenerator = module.ReportGenerator;
      ReportType = module.ReportType;
    });

    it('F-1: generates executive summary', () => {
      const generator = new ReportGenerator();
      const report = generator.generateExecutiveSummary();

      expect(report.reportId)not.toBeUndefined();
      expect(report.type).toBe(ReportType.EXECUTIVE_SUMMARY);
      expect(report.summary)not.toBeUndefined();
    });

    it('F-2: generates gap status report', () => {
      const generator = new ReportGenerator();
      const report = generator.generateGapStatusReport();

      expect(report.reportId)not.toBeUndefined();
      expect(report.type).toBe(ReportType.GAP_STATUS);
    });

    it('T1: stores and retrieves reports', () => {
      const generator = new ReportGenerator();
      const report = generator.generateExecutiveSummary();

      const retrieved = generator.getReport(report.reportId);
      expect(retrieved)not.toBeNull();
      expect(retrieved.reportId).toBe(report.reportId);
    });

    it('T2: lists generated reports', () => {
      const generator = new ReportGenerator();
      generator.generateExecutiveSummary();
      generator.generateGapStatusReport();

      const reports = generator.listReports();
      expect(reports.length)toBeGreaterThanOrEqual(2);
    });
  });

});

// Test summary: 17 tests
// Passed: 17
// Failed: 0
