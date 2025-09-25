// src/election/state-machine.js
class StateMachine {
  constructor() {
    this.state = 'follower';
    this.term = 0;
    this.votedFor = null;
    this.log = [];
    this.commitIndex = 0;
    this.lastApplied = 0;
  }

  // Transition to follower state
  toFollower(term, leaderId = null) {
    if (term > this.term) {
      this.term = term;
    }
    this.state = 'follower';
    this.votedFor = null;
    return {
      state: 'follower',
      term: this.term,
      leaderId: leaderId
    };
  }

  // Transition to candidate state
  toCandidate() {
    this.state = 'candidate';
    this.term += 1;
    this.votedFor = this.getNodeId(); // Vote for self
    return {
      state: 'candidate',
      term: this.term
    };
  }

  // Transition to leader state
  toLeader() {
    if (this.state !== 'candidate') {
      throw new Error('Can only transition to leader from candidate state');
    }
    
    this.state = 'leader';
    // Initialize nextIndex and matchIndex for all nodes
    return {
      state: 'leader',
      term: this.term
    };
  }

  // Get current state information
  getState() {
    return {
      state: this.state,
      term: this.term,
      votedFor: this.votedFor,
      log: this.log,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied
    };
  }

  // Append entries to the log
  appendEntries(prevLogIndex, prevLogTerm, entries, leaderCommit) {
    // Check if prevLogIndex/prevLogTerm match our log
    if (prevLogIndex >= this.log.length) {
      // Previous log doesn't exist
      return { success: false, conflictIndex: this.log.length };
    }

    if (prevLogIndex >= 0 && this.log[prevLogIndex].term !== prevLogTerm) {
      // Conflict in log
      // Find the first index with the conflicting term
      let conflictIndex = prevLogIndex;
      const conflictTerm = this.log[prevLogIndex].term;
      
      while (conflictIndex > 0 && this.log[conflictIndex - 1].term === conflictTerm) {
        conflictIndex--;
      }
      
      return { success: false, conflictIndex, conflictTerm };
    }

    // Delete any conflicting entries
    this.log = this.log.slice(0, prevLogIndex + 1);

    // Append new entries
    for (const entry of entries) {
      this.log.push(entry);
    }

    // Update commit index
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
    }

    return { success: true, log: this.log };
  }

  // Add an entry to the log (for leader)
  addEntry(entry) {
    if (this.state !== 'leader') {
      throw new Error('Only leaders can add entries to the log');
    }

    const logEntry = {
      term: this.term,
      command: entry,
      index: this.log.length
    };

    this.log.push(logEntry);
    return logEntry;
  }

  // Get log entries from a specific index
  getLogEntries(fromIndex = 0) {
    return this.log.slice(fromIndex);
  }

  // Get a specific log entry
  getLogEntry(index) {
    if (index < 0 || index >= this.log.length) {
      return null;
    }
    return this.log[index];
  }

  // Get the last log entry info
  getLastLogInfo() {
    if (this.log.length === 0) {
      return { index: -1, term: 0 };
    }
    const lastEntry = this.log[this.log.length - 1];
    return { index: lastEntry.index, term: lastEntry.term };
  }

  // Apply committed entries to the state machine
  applyCommittedEntries() {
    const entriesToApply = this.log.slice(this.lastApplied + 1, this.commitIndex + 1);
    
    for (const entry of entriesToApply) {
      this.applyEntry(entry);
    }
    
    this.lastApplied = this.commitIndex;
    return entriesToApply.length;
  }

  // Apply a single entry to the state machine
  applyEntry(entry) {
    // In a real implementation, this would apply the command to the actual state machine
    // For example, updating cluster configuration, node status, etc.
    console.log(`Applying entry at index ${entry.index}:`, entry.command);
    return true;
  }

  // Get the current node ID (to be implemented by extending classes)
  getNodeId() {
    throw new Error('getNodeId must be implemented by extending class');
  }
}

module.exports = StateMachine;