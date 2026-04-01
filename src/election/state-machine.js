// src/election/state-machine.js
// Phase 1.4: Kill Switch — extended with revocation entry types

const EventEmitter = require('events');
const { EntryType } = require('./revocation-entry');

class StateMachine extends EventEmitter {
  constructor(nodeId = 'node-1') {
    super();
    this.nodeId = nodeId;
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

  // Add a revocation entry to the log (C-01: new entry type)
  addRevocationEntry(revocationEntry) {
    if (this.state !== 'leader') {
      throw new Error('Only leaders can add revocation entries');
    }

    const logEntry = revocationEntry.toLogEntry(this.term, this.log.length);
    this.log.push(logEntry);
    console.log(`[STATE-MACHINE] Added revocation entry: ${logEntry.id} for agent ${logEntry.agentId}`);
    return logEntry;
  }

  // Add a reinstatement entry to the log (M-03: rollback mechanism)
  addReinstatementEntry(reinstatementEntry) {
    if (this.state !== 'leader') {
      throw new Error('Only leaders can add reinstatement entries');
    }

    const logEntry = reinstatementEntry.toLogEntry(this.term, this.log.length);
    this.log.push(logEntry);
    console.log(`[STATE-MACHINE] Added reinstatement entry: ${logEntry.id} for agent ${logEntry.agentId}`);
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
  // C-01: Extended to handle RevocationEntry and ReinstatementEntry types
  applyEntry(entry) {
    // Handle revocation entries
    if (entry.type === EntryType.REVOCATION) {
      console.log(`[STATE-MACHINE] Applying REVOCATION entry: ${entry.id} for agent ${entry.agentId}`);
      // Emit event for listeners to handle actual revocation
      this.emit('applyRevocation', entry);
      return true;
    }
    
    // Handle reinstatement entries
    if (entry.type === EntryType.REINSTATEMENT) {
      console.log(`[STATE-MACHINE] Applying REINSTATEMENT entry: ${entry.id} for agent ${entry.agentId}`);
      this.emit('applyReinstatement', entry);
      return true;
    }
    
    // Original command entry handling
    console.log(`Applying entry at index ${entry.index}:`, entry.command);
    return true;
  }

  // Get the current node ID
  getNodeId() {
    return this.nodeId;
  }
}

module.exports = StateMachine;