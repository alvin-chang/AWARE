// src/kill-switch/index.js
// Phase 1.4: Kill Switch — Main module exports

const { EntryType, RevocationEntry, ReinstatementEntry } = require('../election/revocation-entry');
const RevocationService = require('./revocation-service');

module.exports = {
  // Types
  EntryType,
  RevocationEntry,
  ReinstatementEntry,
  
  // Services
  RevocationService,
};
