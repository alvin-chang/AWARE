// src/election/index.js
// Simple implementation of leader election using Raft-inspired algorithm

class ElectionManager {
  constructor(nodeId, config = {}) {
    this.nodeId = nodeId;
    this.nodes = config.nodes || []; // List of node IDs in the cluster
    this.state = 'follower'; // 'follower', 'candidate', 'leader'
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = [];
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.nextIndex = {};
    this.matchIndex = {};
    this.leaderId = null;
    this.timeout = null;
    this.electionTimeout = null;
    
    // Initialize nextIndex and matchIndex for each node
    this.nodes.forEach(nodeId => {
      this.nextIndex[nodeId] = 0;
      this.matchIndex[nodeId] = 0;
    });
    
    this.startElectionTimer();
  }

  // Start the election timer (randomized timeout to prevent conflicts)
  startElectionTimer() {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }
    
    // Random timeout between 300-600ms for testing, normally 150-300ms
    const timeout = Math.floor(Math.random() * 300) + 300;
    
    this.electionTimeout = setTimeout(() => {
      if (this.state !== 'leader') {
        this.startElection();
      }
    }, timeout);
  }

  // Start an election
  startElection() {
    console.log(`Node ${this.nodeId} starting election for term ${this.currentTerm + 1}`);
    
    this.state = 'candidate';
    this.currentTerm++;
    this.votedFor = this.nodeId;
    let votes = 1; // Vote for self
    
    console.log(`Node ${this.nodeId} requesting votes for term ${this.currentTerm}`);
    
    // Request votes from all other nodes
    this.nodes.forEach(nodeId => {
      if (nodeId !== this.nodeId) {
        this.requestVote(nodeId, (result) => {
          if (result && this.state === 'candidate') {
            votes++;
            console.log(`Node ${this.nodeId} received vote, total: ${votes}`);
            
            // Check if we have majority
            if (votes > Math.floor(this.nodes.length / 2)) {
              this.becomeLeader();
            }
          }
        });
      }
    });
    
    // Restart election timer
    this.startElectionTimer();
  }

  // Request vote from another node
  requestVote(nodeId, callback) {
    // Simulate network request to other node
    // In a real implementation, this would be an RPC call
    console.log(`Requesting vote from node ${nodeId}`);
    
    // Simulate a simple response - in reality, this would be more complex
    setTimeout(() => {
      const granted = Math.random() > 0.3; // 70% chance of getting vote
      callback(granted);
    }, Math.random() * 100); // Random delay
  }

  // Become the leader
  becomeLeader() {
    console.log(`Node ${this.nodeId} becoming leader for term ${this.currentTerm}`);
    
    this.state = 'leader';
    this.leaderId = this.nodeId;
    
    // Initialize nextIndex and matchIndex for each node
    this.nodes.forEach(nodeId => {
      if (nodeId !== this.nodeId) {
        this.nextIndex[nodeId] = this.log.length;
        this.matchIndex[nodeId] = 0;
      }
    });
    
    // Start sending heartbeats
    this.sendHeartbeats();
  }

  // Send heartbeats to maintain leadership
  sendHeartbeats() {
    if (this.state !== 'leader') return;
    
    console.log(`Leader ${this.nodeId} sending heartbeat`);
    
    // Send AppendEntries RPCs to all other nodes
    this.nodes.forEach(nodeId => {
      if (nodeId !== this.nodeId) {
        this.sendHeartbeatToNode(nodeId);
      }
    });
    
    // Schedule next heartbeat in 100ms
    setTimeout(() => {
      this.sendHeartbeats();
    }, 100);
  }

  // Send heartbeat to a specific node
  sendHeartbeatToNode(nodeId) {
    // Simulate sending heartbeat to another node
    console.log(`Sending heartbeat to node ${nodeId}`);
    
    // In a real implementation, this would be an RPC call
  }

  // Handle incoming vote requests from other nodes
  handleRequestVote(term, candidateId, lastLogIndex, lastLogTerm) {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.state = 'follower';
      this.leaderId = null;
      this.startElectionTimer();
    }
    
    if (this.state !== 'leader' && 
        (this.votedFor === null || this.votedFor === candidateId) && 
        this.isLogUpToDate(lastLogIndex, lastLogTerm)) {
      this.votedFor = candidateId;
      console.log(`Node ${this.nodeId} voted for ${candidateId}`);
      return true;
    }
    
    return false;
  }

  // Check if log is up to date (simplified)
  isLogUpToDate(lastLogIndex, lastLogTerm) {
    // Simplified log comparison - in reality, this would be more complex
    return true;
  }

  // Handle incoming heartbeat from leader
  handleAppendEntries(term, leaderId) {
    if (term >= this.currentTerm) {
      this.currentTerm = term;
      this.state = 'follower';
      this.leaderId = leaderId;
      this.votedFor = null;
      
      // Reset election timer
      this.startElectionTimer();
      
      return true;
    }
    
    return false;
  }

  // Check if this node is the leader
  isLeader() {
    return this.state === 'leader';
  }

  // Get the current leader
  getLeader() {
    return this.leaderId;
  }

  // Handle leader failure
  handleLeaderFailure() {
    console.log(`Handling leader failure, node ${this.nodeId} starting new election`);
    this.state = 'follower';
    this.leaderId = null;
    this.startElectionTimer();
  }
}

module.exports = ElectionManager;