// tests/unit/election.test.js
const ElectionManager = require('../../src/election');

describe('ElectionManager', () => {
  let electionManager;

  beforeEach(() => {
    electionManager = new ElectionManager('node-1', {
      nodes: ['node-1', 'node-2', 'node-3']
    });
  });

  afterEach(() => {
    if (electionManager.electionTimeout) {
      clearTimeout(electionManager.electionTimeout);
    }
  });

  test('should initialize with correct properties', () => {
    expect(electionManager.nodeId).toBe('node-1');
    expect(electionManager.state).toBe('follower');
    expect(electionManager.currentTerm).toBe(0);
    expect(electionManager.nodes).toEqual(['node-1', 'node-2', 'node-3']);
  });

  test('should start as follower', () => {
    expect(electionManager.state).toBe('follower');
  });

  test('should handle request vote correctly', () => {
    // Test when term is higher than current
    let result = electionManager.handleRequestVote(1, 'node-2', 0, 0);
    expect(result).toBe(true);
    expect(electionManager.votedFor).toBe('node-2');
    
    // Test when already voted for same candidate
    result = electionManager.handleRequestVote(1, 'node-2', 0, 0);
    expect(result).toBe(true);
    
    // Test when already voted for different candidate
    electionManager.votedFor = 'node-3';
    result = electionManager.handleRequestVote(1, 'node-2', 0, 0);
    expect(result).toBe(false);
  });

  test('should handle append entries (heartbeat) correctly', () => {
    // Test when term is higher
    const result = electionManager.handleAppendEntries(1, 'node-2');
    expect(result).toBe(true);
    expect(electionManager.state).toBe('follower');
    expect(electionManager.leaderId).toBe('node-2');
  });

  test('should correctly identify if node is leader', () => {
    // Initially not leader
    expect(electionManager.isLeader()).toBe(false);
    
    // After becoming leader (manually set for test)
    electionManager.state = 'leader';
    expect(electionManager.isLeader()).toBe(true);
  });
});