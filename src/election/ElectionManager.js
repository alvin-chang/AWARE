// src/election/ElectionManager.js
// Phase 1.4: Kill Switch — integrated with StateMachine for unified log management

const EventEmitter = require('events');

class ElectionManager extends EventEmitter {
  constructor(nodeId, config = {}) {
    super();
    this.nodeId = nodeId;
    this.nodes = config.nodes || []; // List of node IDs in the cluster
    this.state = 'follower'; // 'follower', 'candidate', 'leader'
    this.currentTerm = 0;
    this.votedFor = null;
    this.leaderId = null;
    this.timeout = null;
    this.electionTimeout = null;
    this.heartbeatInterval = null;
    this.requestVoteTimeout = config.requestVoteTimeout || 200; // ms
    this.heartbeatIntervalMs = config.heartbeatInterval || 100; // ms
    this.electionTimeoutRange = config.electionTimeoutRange || [300, 600]; // ms range
    
    // StateMachine integration — ElectionManager delegates to StateMachine for log management
    // Phase 1.4: This ensures revocation entries go through the same Raft log as command entries
    this.stateMachine = config.stateMachine || null;
    
    // Initialize nextIndex and matchIndex for each node
    if (this.stateMachine) {
      this.nextIndex = {};
      this.matchIndex = {};
      this.nodes.forEach(nodeId => {
        if (nodeId !== this.nodeId) {
          this.nextIndex[nodeId] = this.stateMachine.log.length;
          this.matchIndex[nodeId] = 0;
        }
      });
    }
    
    this.startElectionTimer();
  }

  // Get the shared log from StateMachine (Phase 1.4 integration)
  get log() {
    return this.stateMachine ? this.stateMachine.log : [];
  }

  // Get commitIndex from StateMachine
  get commitIndex() {
    return this.stateMachine ? this.stateMachine.commitIndex : 0;
  }

  // Get lastApplied from StateMachine
  get lastApplied() {
    return this.stateMachine ? this.stateMachine.lastApplied : 0;
  }

  // Get current term from StateMachine
  get currentTerm() {
    return this.stateMachine ? this.stateMachine.term : 0;
  }

  set currentTerm(term) {
    if (this.stateMachine) {
      this.stateMachine.term = term;
    }
  }

  // Start the election timer (randomized timeout to prevent conflicts)
  startElectionTimer() {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }
    
    // Random timeout within configured range
    const [min, max] = this.electionTimeoutRange;
    const timeout = Math.floor(Math.random() * (max - min + 1)) + min;
    
    this.electionTimeout = setTimeout(() => {
      if (this.state !== 'leader') {
        this.startElection();
      }
    }, timeout);
  }

  // Start an election
  async startElection() {
    console.log(`Node ${this.nodeId} starting election for term ${this.currentTerm + 1}`);
    
    this.state = 'candidate';
    this.currentTerm++;
    this.votedFor = this.nodeId;
    let votes = 1; // Vote for self
    
    console.log(`Node ${this.nodeId} requesting votes for term ${this.currentTerm}`);
    
    // Request votes from all other nodes
    const lastLogInfo = this.stateMachine.getLastLogInfo();
    const votePromises = this.nodes
      .filter(nodeId => nodeId !== this.nodeId)
      .map(nodeId => this.requestVote(nodeId, this.currentTerm, lastLogInfo.index, lastLogInfo.term));
    
    try {
      const results = await Promise.allSettled(votePromises);
      
      results.forEach((result, index) => {
        const targetNodeId = this.nodes.filter(id => id !== this.nodeId)[index];
        
        if (result.status === 'fulfilled' && result.value) {
          votes++;
          console.log(`Node ${this.nodeId} received vote from ${targetNodeId}, total: ${votes}`);
        } else {
          console.log(`Node ${this.nodeId} did not receive vote from ${targetNodeId}`);
        }
      });
      
      // Check if we have majority
      const majority = Math.floor(this.nodes.length / 2) + 1;
      if (votes >= majority) {
        this.becomeLeader();
      } else {
        console.log(`Node ${this.nodeId} did not receive majority. Votes: ${votes}, Required: ${majority}`);
      }
    } catch (error) {
      console.error('Error during election:', error);
    }
    
    // Restart election timer regardless of outcome
    this.startElectionTimer();
  }

  // Request vote from another node
  // C-03: FIX — Proper Raft vote granting based on Raft paper
  // Grant vote if: candidateTerm >= currentTerm AND log is up-to-date AND haven't voted else this term
  async requestVote(candidateId, candidateTerm, candidateLastLogIndex, candidateLastLogTerm) {
    console.log(`[RAFT RPC] RequestVote: candidate=${candidateId} term=${candidateTerm} logIndex=${candidateLastLogIndex}/${candidateLastLogTerm}`);
    
    return new Promise((resolve) => {
      // Simulate network RPC call
      setTimeout(() => {
        // C-03 FIX: Proper Raft vote granting logic
        // 1. Reply false if candidateTerm < currentTerm
        if (candidateTerm < this.currentTerm) {
          console.log(`[RAFT RPC] Denied vote to ${candidateId}: stale candidate term ${candidateTerm} < currentTerm ${this.currentTerm}`);
          resolve({ granted: false, term: this.currentTerm });
          return;
        }
        
        // 2. If candidateTerm > currentTerm, update term and step down
        if (candidateTerm > this.currentTerm) {
          this.currentTerm = candidateTerm;
          this.state = 'follower';
          this.votedFor = null;
          console.log(`[RAFT RPC] ${candidateId} has higher term ${candidateTerm}, stepping down`);
        }
        
        // 3. If votedFor is null or candidateId, and log is up-to-date, grant vote
        const lastLogInfo = this.stateMachine.getLastLogInfo();
        const logOk = (candidateLastLogTerm > lastLogInfo.term) ||
                       (candidateLastLogTerm === lastLogInfo.term && candidateLastLogIndex >= lastLogInfo.index);
        
        if (this.votedFor && this.votedFor !== candidateId) {
          console.log(`[RAFT RPC] Denied vote to ${candidateId}: already voted for ${this.votedFor}`);
          resolve({ granted: false, term: this.currentTerm });
          return;
        }
        
        if (!logOk) {
          console.log(`[RAFT RPC] Denied vote to ${candidateId}: candidate log not up-to-date`);
          resolve({ granted: false, term: this.currentTerm });
          return;
        }
        
        // Grant the vote
        this.votedFor = candidateId;
        console.log(`[RAFT RPC] GRANTED vote to ${candidateId} for term ${this.currentTerm}`);
        
        // Reset election timer
        this.startElectionTimer();
        
        resolve({ granted: true, term: this.currentTerm });
      }, Math.random() * this.requestVoteTimeout);
    });
  }

  // Become the leader
  becomeLeader() {
    console.log(`Node ${this.nodeId} becoming leader for term ${this.currentTerm}`);
    
    this.state = 'leader';
    this.leaderId = this.nodeId;
    
    // Initialize nextIndex and matchIndex for each node
    this.nodes.forEach(targetNodeId => {
      if (targetNodeId !== this.nodeId) {
        this.nextIndex[targetNodeId] = this.log.length;
        this.matchIndex[targetNodeId] = 0;
      }
    });
    
    // Start sending heartbeats
    this.sendHeartbeats();
    
    // Emit leader event
    this.emit('leaderElected', this.nodeId, this.currentTerm);
  }

  // Send heartbeats to maintain leadership
  sendHeartbeats() {
    if (this.state !== 'leader') return;
    
    console.log(`Leader ${this.nodeId} sending heartbeat for term ${this.currentTerm}`);
    
    // Send AppendEntries RPCs to all other nodes
    this.nodes.forEach(targetNodeId => {
      if (targetNodeId !== this.nodeId) {
        this.sendHeartbeatToNode(targetNodeId);
      }
    });
    
    // Schedule next heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      if (this.state === 'leader') {
        this.sendHeartbeats();
      } else {
        clearInterval(this.heartbeatInterval);
      }
    }, this.heartbeatIntervalMs);
  }

  // Send heartbeat to a specific node
  // Extended to carry revocation entries (C-01, C-02)
  sendHeartbeatToNode(nodeId, revocationEntries = []) {
    // Simulate sending heartbeat to another node
    // In a real implementation, this would be an RPC call
    console.log(`Sending heartbeat to node ${nodeId}`);
    
    // The heartbeat can now carry revocation entries
    const heartbeat = {
      term: this.currentTerm,
      leaderId: this.nodeId,
      prevLogIndex: this.log.length - 1,
      prevLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
      entries: revocationEntries,
      leaderCommit: this.commitIndex
    };
    
    console.log(`Heartbeat sent to ${nodeId} with ${revocationEntries.length} revocation entries`);
    console.log(`Heartbeat details:`, heartbeat);
  }

  // Propose a revocation entry to be broadcast via heartbeat
  // C-02: Revocation entries are broadcast through the heartbeat protocol
  proposeRevocation(logEntry) {
    if (this.state !== 'leader') {
      throw new Error('Only leader can propose revocations');
    }

    console.log(`[RAFT] Broadcasting revocation entry ${logEntry.id} via heartbeat`);

    // Send heartbeat with the revocation entry to all followers
    this.nodes.forEach(targetNodeId => {
      if (targetNodeId !== this.nodeId) {
        this.sendHeartbeatToNode(targetNodeId, [logEntry]);
      }
    });
  }

  // Propose a kill signal entry to be broadcast via heartbeat (Phase 3.2)
  proposeKillSignal(logEntry) {
    if (this.state !== 'leader') {
      throw new Error('Only leader can propose kill signals');
    }

    console.log(`[RAFT] Broadcasting kill signal entry ${logEntry.killSignalId} via heartbeat`);

    // Send heartbeat with the kill signal entry to all followers
    this.nodes.forEach(targetNodeId => {
      if (targetNodeId !== this.nodeId) {
        this.sendHeartbeatToNode(targetNodeId, [logEntry]);
      }
    });
  }

  // Handle incoming vote requests from other nodes
  handleRequestVote(term, candidateId, lastLogIndex, lastLogTerm) {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.state = 'follower';
      this.leaderId = null;
      this.votedFor = null;
      this.startElectionTimer();
    }
    
    const termOk = term >= this.currentTerm;
    const canVote = this.votedFor === null || this.votedFor === candidateId;
    const logIsUpToDate = this.isLogUpToDate(lastLogIndex, lastLogTerm);
    
    if (termOk && canVote && logIsUpToDate) {
      this.votedFor = candidateId;
      console.log(`Node ${this.nodeId} voted for ${candidateId} in term ${term}`);
      
      // Reset election timer
      this.startElectionTimer();
      
      return true;
    }
    
    return false;
  }

  // Check if candidate's log is at least as up-to-date as receiver's log
  isLogUpToDate(candidateLastLogIndex, candidateLastLogTerm) {
    const lastLogTerm = this.log.length > 0 ? this.log[this.log.length - 1].term : 0;
    const lastLogIndex = this.log.length - 1;
    
    if (lastLogTerm !== candidateLastLogTerm) {
      return candidateLastLogTerm > lastLogTerm;
    }
    
    return candidateLastLogIndex >= lastLogIndex;
  }

  // Handle incoming heartbeat from leader
  // Extended to process revocation entries (C-01, C-02)
  handleAppendEntries(term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit) {
    // Reset election timer
    this.startElectionTimer();
    
    if (term >= this.currentTerm) {
      this.currentTerm = term;
      this.state = 'follower';
      this.leaderId = leaderId;
      this.votedFor = null;
      
      // Process log entries if provided
      if (entries && entries.length > 0) {
        // C-01: Process revocation entries
        for (const entry of entries) {
          if (entry.type === 1) { // RevocationEntry
            console.log(`[RAFT] Follower ${this.nodeId} received revocation entry: ${entry.id} for agent ${entry.agentId}`);
            // Emit event for revocation service to handle
            this.emit('revocationReceived', entry);
          } else if (entry.type === 2) { // ReinstatementEntry
            console.log(`[RAFT] Follower ${this.nodeId} received reinstatement entry: ${entry.id}`);
            this.emit('reinstatementReceived', entry);
          } else {
            console.log(`Follower ${this.nodeId} received entry from leader ${leaderId}:`, entry);
          }
        }
        
        // Append to local log
        this.stateMachine.appendEntries(prevLogIndex, prevLogTerm, entries, leaderCommit);
      }
      
      // Update commit index if leader's commit index is greater
      if (leaderCommit > this.commitIndex) {
        this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
      }
      
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
    this.votedFor = null;
    this.startElectionTimer();
  }
  
  // Stop the election manager
  stop() {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.removeAllListeners();
  }
}

module.exports = ElectionManager;