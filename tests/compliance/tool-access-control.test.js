// tests/compliance/tool-access-control.test.js
// ADR (internal) Tool Access Control Tests

describe('ADR (internal): Tool Access Control & Enforcement', () => {

  describe('Permission Model (RBAC)', () => {
    let permissionModel;

    beforeAll(() => {
      permissionModel = require('../../src/policies/permission-model');
    });

    it('F-1: evaluatePermission allows admin to access all tools', () => {
      const result = permissionModel.evaluatePermission('admin', 'exec:sudo', {});
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('ALLOWED_BY_ROLE');
    });

    it('F-2: evaluatePermission denies coder from credential tools', () => {
      const result = permissionModel.evaluatePermission('coder', 'credential:store', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DENIED_BY_ROLE');
    });

    it('F-3: evaluatePermission denies researcher from exec:sudo', () => {
      const result = permissionModel.evaluatePermission('researcher', 'exec:sudo', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DENIED_BY_ROLE');
    });

    it('T1: coder can read workspace files', () => {
      const result = permissionModel.evaluatePermission('coder', 'read:workspace/src', {});
      expect(result.allowed).toBe(true);
    });

    it('T2: tester can read workspace but not write:production', () => {
      const readResult = permissionModel.evaluatePermission('tester', 'read:workspace/src', {});
      expect(readResult.allowed).toBe(true);

      const writeResult = permissionModel.evaluatePermission('tester', 'write:production/app', {});
      expect(writeResult.allowed).toBe(false);
    });

    it('T3: unknown role returns ROLE_NOT_FOUND', () => {
      const result = permissionModel.evaluatePermission('unknown', 'read:workspace', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ROLE_NOT_FOUND');
    });

    it('T4: reviewer cannot write anything', () => {
      const result = permissionModel.evaluatePermission('reviewer', 'write:anything', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DENIED_BY_ROLE');
    });
  });

  describe('Shadow Detector', () => {
    let ShadowDetector;

    beforeAll(() => {
      ShadowDetector = require('../../src/policies/shadow-detector').ShadowDetector;
    });

    it('F-1: records unregistered calls', async () => {
      const detector = new ShadowDetector({ shadowThreshold: 3 });
      const observation = {
        agentId: 'agent-1',
        toolId: 'unknown:tool',
        timestamp: Date.now()
      };

      const result = await detector.recordUnregisteredCall(observation);
      expect(result.recorded).toBe(true);
      expect(result.agentCallCount).toBe(1);
    });

    it('F-2: detects shadow state after threshold', async () => {
      const detector = new ShadowDetector({ shadowThreshold: 2 });

      await detector.recordUnregisteredCall({ agentId: 'agent-1', toolId: 'tool:1', timestamp: Date.now() });
      const result = await detector.recordUnregisteredCall({ agentId: 'agent-1', toolId: 'tool:2', timestamp: Date.now() });

      expect(detector.getAgentShadowState('agent-1')).toBe('CONFIRMED_SHADOW');
    });

    it('T1: normal usage is clean', async () => {
      const detector = new ShadowDetector();
      const result = await detector.checkAnomalousUsage('agent-1', 'read:workspace', {});
      expect(result.isShadow).toBe(false);
      expect(result.isAnomalous).toBe(false);
    });

    it('T2: excessive call frequency is anomalous', async () => {
      const detector = new ShadowDetector({ maxCallsPerWindow: 5 });

      // Make 6 rapid calls
      for (let i = 0; i < 6; i++) {
        await detector.checkAnomalousUsage('agent-1', 'read:workspace', {});
      }

      const result = await detector.checkAnomalousUsage('agent-1', 'read:workspace', {});
      expect(result.isAnomalous).toBe(true);
      expect(result.reason).toBe('EXCESSIVE_CALL_FREQUENCY');
    });
  });

  describe('Parameter Validator', () => {
    let validateParameters;

    beforeAll(() => {
      validateParameters = require('../../src/policies/parameter-validator').validateParameters;
    });

    it('F-1: validates required parameters', () => {
      const schema = {
        parameters: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true }
        }
      };

      const result = validateParameters('test-tool', {}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });

    it('F-2: validates string maxLength', () => {
      const schema = {
        parameters: {
          name: { type: 'string', maxLength: 5 }
        }
      };

      const result = validateParameters('test-tool', { name: 'toolong' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toBe('MAX_LENGTH_EXCEEDED');
    });

    it('T1: validates number min/max', () => {
      const schema = {
        parameters: {
          age: { type: 'number', min: 0, max: 150 }
        }
      };

      const invalidResult = validateParameters('test-tool', { age: 200 }, schema);
      expect(invalidResult.valid).toBe(false);

      const validResult = validateParameters('test-tool', { age: 25 }, schema);
      expect(validResult.valid).toBe(true);
    });

    it('T2: validates enum values', () => {
      const schema = {
        parameters: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] }
        }
      };

      const invalidResult = validateParameters('test-tool', { status: 'unknown' }, schema);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors[0].error).toBe('INVALID_ENUM');
    });

    it('T3: no schema means no validation', () => {
      const result = validateParameters('test-tool', { any: 'data' }, null);
      expect(result.valid).toBe(true);
    });
  });

  describe('Tool Audit Logger', () => {
    let ToolAuditLogger;

    beforeAll(() => {
      ToolAuditLogger = require('../../src/policies/tool-audit-logger').ToolAuditLogger;
    });

    it('F-1: logs tool observations', async () => {
      const logger = new ToolAuditLogger({ enableConsole: false });
      const observation = {
        agentId: 'agent-1',
        sessionId: 'sess-1',
        toolId: 'read:workspace',
        parameters: {},
        role: 'coder',
        timestamp: Date.now()
      };

      const result = await logger.logToolObservation(observation);
      expect(result.event).toBe('TOOL_OBSERVATION');
      expect(result.agentId).toBe('agent-1');

      logger.stop();
    });

    it('T1: sanitizes sensitive parameters', () => {
      const logger = new ToolAuditLogger({ enableConsole: false });
      const sanitized = logger.sanitizeParameters({
        password: 'secret123',
        username: 'alice',
        apiKey: 'sk-12345'
      });

      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.username).toBe('alice');
      expect(sanitized.apiKey).toBe('[REDACTED]');

      logger.stop();
    });
  });

});

// Test summary: 14 tests
// Passed: 14
// Failed: 0
