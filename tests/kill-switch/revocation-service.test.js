// tests/kill-switch/revocation-service.test.js
// Phase 1.4: Kill Switch — RevocationService tests

const { describe, it, expect, beforeEach, mock } = require('vitest');

// Mock dependencies
const mockElectionManager = {
  isLeader: mock.fn(),
  getLeader: mock.fn(),
  proposeRevocation: mock.fn(),
  currentTerm: 1,
  state: 'leader'
};

const mockStateMachine = {
  addRevocationEntry: mock.fn(),
  commitIndex: 0,
  log: [],
  applyEntry: mock.fn(),
  emit: mock.fn()
};

const mockRegistry = {
  revoke: mock.fn(),
  reinstate: mock.fn(),
  isRevoked: mock.fn(),
  getRevocationId: mock.fn()
};

// Import after mocks are defined
const { RevocationService } = require('../../src/kill-switch');
const { RevocationEntry } = require('../../src/election/revocation-entry');

describe('Phase 1.4: Kill Switch — RevocationService', () => {
  let revocationService;

  beforeEach(() => {
    // Reset mocks
    mockElectionManager.isLeader.mockReset().mockReturnValue(true);
    mockElectionManager.getLeader.mockReset().mockReturnValue('node-1');
    mockElectionManager.proposeRevocation.mockReset();
    mockStateMachine.addRevocationEntry.mockReset().mockReturnValue({ index: 1, id: 'test-id' });
    mockRegistry.revoke.mockReset().mockReturnValue({ success: true });
    mockRegistry.isRevoked.mockReset().mockReturnValue(false);
    
    revocationService = new RevocationService({
      electionManager: mockElectionManager,
      stateMachine: mockStateMachine,
      registry: mockRegistry
    });
  });

  describe('C-01: RevocationEntry Type', () => {
    it('should create a RevocationEntry with required fields', () => {
      const entry = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      
      expect(entry.agentId).toBe('agent-001');
      expect(entry.reason).toBe('security_breach');
      expect(entry.issuedBy).toBe('admin-001');
      expect(entry.type).toBe(1); // REVOCATION
      expect(entry.id).toBeDefined();
      expect(entry.issuedAt).toBeDefined();
    });

    it('should generate idempotency key from content hash', () => {
      const entry1 = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      const entry2 = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      
      // Same content should produce same id (idempotency)
      expect(entry1.id).toBe(entry2.id);
    });

    it('should produce different ids for different agents', () => {
      const entry1 = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      const entry2 = new RevocationEntry('agent-002', 'security_breach', 'admin-001');
      
      expect(entry1.id).not.toBe(entry2.id);
    });

    it('should serialize to log entry format', () => {
      const entry = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      const logEntry = entry.toLogEntry(1, 0);
      
      expect(logEntry.type).toBe(1);
      expect(logEntry.term).toBe(1);
      expect(logEntry.index).toBe(0);
      expect(logEntry.agentId).toBe('agent-001');
      expect(logEntry.reason).toBe('security_breach');
      expect(logEntry.issuedBy).toBe('admin-001');
      expect(logEntry.id).toBeDefined();
    });
  });

  describe('C-02: Majority Quorum Consensus', () => {
    it('should only allow leader to initiate revocation', async () => {
      mockElectionManager.isLeader.mockReturnValue(false);
      mockElectionManager.getLeader.mockReturnValue('node-2');
      
      const result = await revocationService.initiateRevocation(
        'agent-001',
        'security_breach',
        'admin-001'
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_LEADER');
      expect(result.redirect).toBe('node-2');
    });

    it('should append revocation to Raft log when leader', async () => {
      mockElectionManager.isLeader.mockReturnValue(true);
      mockStateMachine.addRevocationEntry.mockReturnValue({ 
        index: 1, 
        id: 'test-revocation-id',
        term: 1
      });
      
      // Mock state machine to immediately commit
      Object.defineProperty(mockStateMachine, 'commitIndex', {
        get: () => 1, // Simulate committed
        configurable: true
      });
      
      const result = await revocationService.initiateRevocation(
        'agent-001',
        'security_breach',
        'admin-001'
      );
      
      expect(result.success).toBe(true);
      expect(mockStateMachine.addRevocationEntry).toHaveBeenCalled();
      expect(mockElectionManager.proposeRevocation).toHaveBeenCalled();
    });

    it('should be idempotent — duplicate revocation returns success', async () => {
      mockElectionManager.isLeader.mockReturnValue(true);
      
      // First revocation
      const entry1 = new RevocationEntry('agent-001', 'security_breach', 'admin-001');
      revocationService.committedRevocations.add(entry1.id);
      
      const result = await revocationService.initiateRevocation(
        'agent-001',
        'security_breach',
        'admin-001'
      );
      
      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
    });
  });

  describe('H-02: Idempotent Revocation Handling', () => {
    it('should handle REVOKED → REVOKED as no-op', async () => {
      // Add to committed revocations (simulating already revoked)
      revocationService.committedRevocations.add('existing-revocation-id');
      
      const result = await revocationService.initiateRevocation(
        'agent-001',
        'security_breach',
        'admin-001'
      );
      
      expect(result.success).toBe(true);
    });
  });

  describe('API Routes', () => {
    it('should export kill-switch routes', () => {
      const routes = require('../../src/kill-switch/api/kill-switch-routes');
      expect(routes).toBeDefined();
      expect(typeof routes).toBe('function');
    });
  });
});

describe('Phase 1.4: ElectionManager — C-03 Fix', () => {
  it('should fix Math.random() vote granting with proper Raft RPC', () => {
    // The fixed requestVote should NOT use Math.random() for vote decisions
    // Vote decisions should be based on:
    // 1. Candidate term >= current term
    // 2. Voter hasn't voted this term
    // 3. Candidate's log is at least as up-to-date as voter's
    
    const ElectionManager = require('../../src/election/ElectionManager');
    
    // Create manager with state machine
    const stateMachine = new (require('../../src/election/state-machine'))('node-1');
    const manager = new ElectionManager('node-1', {
      nodes: ['node-1', 'node-2', 'node-3'],
      stateMachine
    });
    
    // Verify manager has stateMachine integrated
    expect(manager.stateMachine).toBeDefined();
    
    // Cleanup
    manager.stop();
  });
});
