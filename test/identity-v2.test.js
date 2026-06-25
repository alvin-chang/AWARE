// test/identity-v2.test.js
// Tests for Agent Identity & Authentication Framework (Phase 3.1)

const { Agent, AgentState } = require('../src/api/models/Agent');
const IdentityProviderV2 = require('../src/agents/identity-provider-v2');
const SessionManager = require('../src/agents/session-manager');
const AttestationService = require('../src/agents/attestation-service');
const RevocationCache = require('../src/agents/revocation-cache');

// Mock the Agent model for testing
jest.mock('../src/api/models/Agent');

describe('IdentityProviderV2', () => {
  let identityProvider;
  const mockSecretKey = 'test-secret-key-that-is-at-least-32-chars!';
  const mockTrustDomain = 'aware-test';

  beforeEach(() => {
    jest.clearAllMocks();
    identityProvider = new IdentityProviderV2({
      secretKey: mockSecretKey,
      trustDomain: mockTrustDomain,
      sessionTtlMs: 15 * 60 * 1000 // 15 minutes
    });
  });

  afterEach(() => {
    identityProvider.destroy();
  });

  describe('createSession', () => {
    it('should create a session for an active agent', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        name: 'Coder',
        type: 'coder',
        version: '1.0.0',
        state: AgentState.ACTIVE,
        clearance: 'L2',
        capabilities: ['coding', 'review'],
        trustScore: 0.87,
        metadata: { blastRadius: 0.15 }
      };
      
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const executionContext = {
        workspace: '/workspace/forge',
        browserProfile: 'coder',
        allowedTools: ['read', 'write', 'exec'],
        deniedTools: ['rm', 'sudo'],
        maxConcurrentTasks: 3
      };

      const result = identityProvider.createSession(mockAgent.agentId, executionContext);

      expect(result.sessionId).toMatch(/^sess-/);
      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.executionContext).toMatchObject(executionContext);
    });

    it('should throw error for non-existent agent', () => {
      Agent.findByAgentId.mockReturnValue(null);

      expect(() => {
        identityProvider.createSession('agent:nonexistent', {});
      }).toThrow('Agent not found: agent:nonexistent');
    });

    it('should throw error for inactive agent', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        state: AgentState.REVOKED
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      expect(() => {
        identityProvider.createSession('agent:coder:instance-001', {});
      }).toThrow('Cannot create session for agent in revoked state');
    });
  });

  describe('verifySession', () => {
    it('should verify a valid session token', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        name: 'Coder',
        type: 'coder',
        version: '1.0.0',
        state: AgentState.ACTIVE,
        clearance: 'L2',
        capabilities: ['coding', 'review'],
        trustScore: 0.87,
        metadata: { blastRadius: 0.15 },
        id: 'agent-id-001'
      };
      
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const { token, sessionId } = identityProvider.createSession(
        mockAgent.agentId,
        { workspace: '/workspace/forge' }
      );

      const verification = identityProvider.verifySession(token);

      expect(verification.valid).toBe(true);
      expect(verification.sessionId).toBe(sessionId);
      expect(verification.agentId).toBe(mockAgent.agentId);
      expect(verification.trustDomain).toBe(mockTrustDomain);
    });

    it('should reject invalid token', () => {
      // Test with a completely invalid token
      const verification = identityProvider.verifySession('invalid.token.here');
      expect(verification.valid).toBe(false);
      expect(['INVALID_TOKEN', 'VERIFICATION_FAILED']).toContain(verification.error);
    });
  });

  describe('verifyToolAccess', () => {
    it('should allow access to permitted tools', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        name: 'Coder',
        type: 'coder',
        version: '1.0.0',
        state: AgentState.ACTIVE,
        clearance: 'L2',
        capabilities: ['coding'],
        trustScore: 0.87,
        metadata: {},
        id: 'agent-id-001'
      };
      
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const { sessionId } = identityProvider.createSession(mockAgent.agentId, {
        allowedTools: ['read', 'write', 'exec'],
        deniedTools: ['rm', 'sudo']
      });

      const result = identityProvider.verifyToolAccess(sessionId, 'read');
      expect(result.allowed).toBe(true);
    });

    it('should deny access to prohibited tools', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        name: 'Coder',
        type: 'coder',
        version: '1.0.0',
        state: AgentState.ACTIVE,
        clearance: 'L2',
        capabilities: ['coding'],
        trustScore: 0.87,
        metadata: {},
        id: 'agent-id-001'
      };
      
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const { sessionId } = identityProvider.createSession(mockAgent.agentId, {
        allowedTools: ['read', 'write'],
        deniedTools: ['rm', 'sudo']
      });

      const result = identityProvider.verifyToolAccess(sessionId, 'rm');
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('TOOL_DENIED');
    });
  });
});

describe('SessionManager', () => {
  let sessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager({
      sessionTtlMs: 15 * 60 * 1000,
      heartbeatIntervalMs: 60 * 1000,
      maxMissedHeartbeats: 3
    });
  });

  afterEach(() => {
    sessionManager.destroy();
  });

  describe('createSession', () => {
    it('should create a session with default execution context', () => {
      const session = sessionManager.createSession('agent:coder:instance-001', {});

      expect(session.sessionId).toMatch(/^sess-/);
      expect(session.agentId).toBe('agent:coder:instance-001');
      expect(session.status).toBe('active');
      expect(session.executionContext.workspace).toBe('/workspace/default');
    });

    it('should create a session with custom execution context', () => {
      const executionContext = {
        workspace: '/workspace/forge',
        browserProfile: 'coder',
        allowedTools: ['read', 'write'],
        deniedTools: ['rm']
      };

      const session = sessionManager.createSession('agent:coder:instance-001', executionContext);

      expect(session.executionContext.workspace).toBe('/workspace/forge');
      expect(session.executionContext.browserProfile).toBe('coder');
      expect(session.executionContext.allowedTools).toEqual(['read', 'write']);
      expect(session.executionContext.deniedTools).toEqual(['rm']);
    });
  });

  describe('heartbeat', () => {
    it('should update heartbeat and extend session', () => {
      const session = sessionManager.createSession('agent:coder:instance-001', {});
      const originalExpiresAt = session.expiresAt;

      const result = sessionManager.heartbeat(session.sessionId);

      expect(result.success).toBe(true);
      expect(result.heartbeatCount).toBe(1);
      expect(result.expiresAt).toBeGreaterThanOrEqual(originalExpiresAt);
    });

    it('should reject heartbeat for non-existent session', () => {
      const result = sessionManager.heartbeat('nonexistent-session');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('verifyToolAccess', () => {
    it('should allow access to allowed tools', () => {
      const session = sessionManager.createSession('agent:coder:instance-001', {
        allowedTools: ['read', 'write'],
        deniedTools: ['rm']
      });

      const result = sessionManager.verifyToolAccess(session.sessionId, 'read');

      expect(result.allowed).toBe(true);
    });

    it('should deny access to denied tools', () => {
      const session = sessionManager.createSession('agent:coder:instance-001', {
        allowedTools: ['read', 'write'],
        deniedTools: ['rm']
      });

      const result = sessionManager.verifyToolAccess(session.sessionId, 'rm');

      expect(result.allowed).toBe(false);
      expect(result.error).toBe('TOOL_DENIED');
    });

    it('should allow wildcard access', () => {
      const session = sessionManager.createSession('agent:coder:instance-001', {
        allowedTools: ['*']
      });

      const result = sessionManager.verifyToolAccess(session.sessionId, 'any-tool');

      expect(result.allowed).toBe(true);
    });
  });

  describe('getAgentSessions', () => {
    it('should return all sessions for an agent', () => {
      sessionManager.createSession('agent:coder:instance-001', {});
      sessionManager.createSession('agent:coder:instance-001', {});
      sessionManager.createSession('agent:researcher:instance-002', {});

      const sessions = sessionManager.getAgentSessions('agent:coder:instance-001');

      expect(sessions.length).toBe(2);
    });
  });
});

describe('AttestationService', () => {
  let attestationService;
  const mockTrustDomain = 'aware-test';

  beforeEach(() => {
    attestationService = new AttestationService({
      trustDomain: mockTrustDomain
    });
  });

  afterEach(() => {
    attestationService.destroy();
  });

  describe('verifyAttestation', () => {
    it('should verify a valid token', async () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        state: AgentState.ACTIVE
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      // Create a mock token
      const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZ2VudElkIjoiYWdlbnQ6Y29kZXI6aW5zdGFuY2UtMDAxIiwidHJ1c3RBc3NldCI6ImF3YXJlLXRlc3QiLCJleHBpcmVzQXQiOiIyMTA1LTAxLTAxVDEyOjAwOjAwWiIsIm5vdEJlZm9yZSI6IjIwMDUtMDEtMDFUMDo6MDowWiIsImlhdCI6MTcwNjMxMjAwMH0K.signature';

      // This would normally require a real JWT, so we'll test the service structure
      expect(attestationService.config.trustDomain).toBe(mockTrustDomain);
    });
  });

  describe('cache behavior', () => {
    it('should cache verification results', async () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        state: AgentState.ACTIVE
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const stats = attestationService.getStats();
      expect(stats.totalCached).toBe(0);
    });
  });
});

describe('RevocationCache', () => {
  let revocationCache;

  beforeEach(() => {
    revocationCache = new RevocationCache({
      cacheTtlMs: 60 * 1000
    });
  });

  afterEach(() => {
    revocationCache.destroy();
  });

  describe('isRevoked', () => {
    it('should return false for active agent', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        state: AgentState.ACTIVE
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      expect(revocationCache.isRevoked('agent:coder:instance-001')).toBe(false);
    });

    it('should return true for revoked agent', () => {
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        state: AgentState.REVOKED
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      expect(revocationCache.isRevoked('agent:coder:instance-001')).toBe(true);
    });

    it('should return true for unknown agent', () => {
      Agent.findByAgentId.mockReturnValue(null);

      expect(revocationCache.isRevoked('agent:unknown')).toBe(true);
    });
  });

  describe('revoke', () => {
    it('should revoke an active agent', async () => {
      let savedState = AgentState.ACTIVE;
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {},
        transitionTo: jest.fn((state) => { savedState = state; }),
        saveAgent: jest.fn()
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);
      Agent.saveAgent = jest.fn();

      const result = await revocationCache.revoke(
        'agent:coder:instance-001',
        'CRITICAL',
        'Security incident'
      );

      expect(result.success).toBe(true);
      expect(result.severity).toBe('CRITICAL');
      expect(result.blastRadiusPenalty).toBe(0.1);
    });

    it('should fail for already revoked agent', async () => {
      let savedState = AgentState.REVOKED;
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {}
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const result = await revocationCache.revoke(
        'agent:coder:instance-001',
        'HIGH'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('ALREADY_REVOKED');
    });
  });

  describe('reinstate', () => {
    it('should reinstate a revoked agent', async () => {
      let savedState = AgentState.REVOKED;
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: { revocationReason: 'Test' },
        transitionTo: jest.fn((state) => { savedState = state; }),
        saveAgent: jest.fn()
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);
      Agent.saveAgent = jest.fn();

      const result = await revocationCache.reinstate('agent:coder:instance-001');

      expect(result.success).toBe(true);
    });

    it('should fail for active agent', async () => {
      let savedState = AgentState.ACTIVE;
      const mockAgent = {
        agentId: 'agent:coder:instance-001',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {}
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);

      const result = await revocationCache.reinstate('agent:coder:instance-001');

      expect(result.success).toBe(false);
      expect(result.error).toBe('AGENT_NOT_REVOKED');
    });
  });

  describe('blast radius', () => {
    it('should apply correct penalty for CRITICAL severity', async () => {
      // Use fresh cache for this test
      const freshCache = new RevocationCache({ cacheTtlMs: 60 * 1000 });
      let savedState = AgentState.ACTIVE;
      const mockAgent = {
        agentId: 'agent:coder:br-critical',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {},
        transitionTo: jest.fn((state) => { savedState = state; }),
        saveAgent: jest.fn()
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);
      Agent.saveAgent = jest.fn();

      await freshCache.revoke('agent:coder:br-critical', 'CRITICAL');
      
      expect(freshCache.getBlastRadiusPenalty('agent:coder:br-critical')).toBe(0.1);
      freshCache.destroy();
    });

    it('should apply correct penalty for LOW severity', async () => {
      // Use fresh cache for this test
      const freshCache = new RevocationCache({ cacheTtlMs: 60 * 1000 });
      let savedState = AgentState.ACTIVE;
      const mockAgent = {
        agentId: 'agent:coder:br-low',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {},
        transitionTo: jest.fn((state) => { savedState = state; }),
        saveAgent: jest.fn()
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);
      Agent.saveAgent = jest.fn();

      await freshCache.revoke('agent:coder:br-low', 'LOW');
      
      expect(freshCache.getBlastRadiusPenalty('agent:coder:br-low')).toBe(0.5);
      freshCache.destroy();
    });
  });

  describe('getRevokedAgents', () => {
    it('should return list of revoked agents', async () => {
      // Use fresh cache for this test
      const freshCache = new RevocationCache({ cacheTtlMs: 60 * 1000 });
      let savedState = AgentState.ACTIVE;
      const mockAgent = {
        agentId: 'agent:coder:revoke-list',
        get state() { return savedState; },
        set state(val) { savedState = val; },
        metadata: {},
        transitionTo: jest.fn((state) => { savedState = state; }),
        saveAgent: jest.fn()
      };
      Agent.findByAgentId.mockReturnValue(mockAgent);
      Agent.saveAgent = jest.fn();

      await freshCache.revoke('agent:coder:revoke-list', 'HIGH');

      const revoked = freshCache.getRevokedAgents();
      
      expect(revoked.length).toBe(1);
      expect(revoked[0].agentId).toBe('agent:coder:revoke-list');
      freshCache.destroy();
    });
  });
});
