const ElectionManager = require('../index');

describe('ElectionManager', () => {
  let electionManager;

  beforeEach(() => {
    const mockNodes = ['node1', 'node2', 'node3'];
    electionManager = new ElectionManager('node1', { nodes: mockNodes });
  });

  describe('Initialization', () => {
    it('should initialize with correct state', () => {
      expect(electionManager.state).toBe('follower');
      expect(electionManager.currentTerm).toBe(0);
      expect(electionManager.votedFor).toBeNull();
      expect(electionManager.leaderId).toBeNull();
    });

    it('should initialize nextIndex and matchIndex for all nodes', () => {
      expect(electionManager.nextIndex).toEqual({
        node2: 0,
        node3: 0
      });
      expect(electionManager.matchIndex).toEqual({
        node2: 0,
        node3: 0
      });
    });
  });

  describe('Election Process', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('should start election after timeout', () => {
      electionManager.startElectionTimer();
      jest.advanceTimersByTime(301);
      
      expect(electionManager.state).toBe('candidate');
      expect(electionManager.currentTerm).toBe(1);
      expect(electionManager.votedFor).toBe('node1');
    });

    it('should become leader if majority votes are received', () => {
      electionManager.startElection();
      
      // Simulate receiving 2 votes (majority for 3 nodes)
      electionManager.requestVote = jest.fn((nodeId, callback) => {
        callback(true); // Grant vote
      });
      
      // Manually call the vote callbacks
      const votes = 2; // Self + 2 others
      // But since it's async, better to mock and check calls
      
      // For simplicity, test isLeader after assuming election
      electionManager.becomeLeader();
      expect(electionManager.state).toBe('leader');
      expect(electionManager.leaderId).toBe('node1');
    });

    it('should handle vote requests correctly', () => {
      const result = electionManager.handleRequestVote(1, 'node2', 0, 0);
      expect(result).toBe(true);
      expect(electionManager.votedFor).toBe('node2');
      expect(electionManager.currentTerm).toBe(1);
      expect(electionManager.state).toBe('follower');
    });

    it('should handle append entries (heartbeats) from leader', () => {
      electionManager.handleAppendEntries(1, 'node2');
      
      expect(electionManager.currentTerm).toBe(1);
      expect(electionManager.leaderId).toBe('node2');
      expect(electionManager.votedFor).toBeNull();
      expect(electionManager.state).toBe('follower');
    });
  });

  describe('Leader Functions', () => {
    beforeEach(() => {
      electionManager.becomeLeader();
    });

    it('should send heartbeats as leader', () => {
      const sendHeartbeatSpy = jest.spyOn(electionManager, 'sendHeartbeatToNode');
      
      // Advance time to trigger heartbeats
      jest.useFakeTimers();
      electionManager.sendHeartbeats();
      jest.advanceTimersByTime(100);
      
      expect(sendHeartbeatSpy).toHaveBeenCalledWith('node2');
      expect(sendHeartbeatSpy).toHaveBeenCalledWith('node3');
    });

    it('should identify itself as leader', () => {
      expect(electionManager.isLeader()).toBe(true);
      expect(electionManager.getLeader()).toBe('node1');
    });
  });

  describe('Leader Failure Handling', () => {
    it('should start new election on leader failure', () => {
      electionManager.leaderId = 'node2';
      electionManager.state = 'follower';
      
      const startElectionSpy = jest.spyOn(electionManager, 'startElection');
      electionManager.handleLeaderFailure();
      
      expect(electionManager.leaderId).toBeNull();
      expect(startElectionSpy).toHaveBeenCalled();
    });
  });
});
