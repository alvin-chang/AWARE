/**
 * ADR (internal): Phase 3.3 — Decision-Chain Traceability
 * 
 * Hash-chained decision audit logging for tamper-evident traceability.
 * Per ADR (internal) §Tamper-Evident Chaining.
 * 
 * @module audit/decision-logger
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Constants
// ============================================================================

/**
 * Genesis prevHash for first record.
 */
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Audit log directory.
 */
const AUDIT_DIR = process.env.AUDIT_DIR || '/data/audit';

/**
 * Audit log file (JSONL format).
 */
const AUDIT_LOG_FILE = path.join(AUDIT_DIR, 'decision-chain.jsonl');

/**
 * Index file for O(1) lookup by decisionId.
 */
const AUDIT_INDEX_FILE = path.join(AUDIT_DIR, 'decision-chain.idx');

// ============================================================================
// Decision Record Interface
// ============================================================================

/**
 * @typedef {Object} DecisionRecord
 * @property {string} decisionId - UUID v4
 * @property {string|null} parentDecisionId - Parent decision ID (null for root)
 * @property {string} timestamp - ISO 8601
 * @property {Object} actor - { agentId, trustScore }
 * @property {Object} action - { type, target, reason }
 * @property {Object} context - { pheromoneScores, heuristicWeights, policyId, policyVersion }
 * @property {Object} outcome - { success, latencyMs, errorMessage }
 * @property {string} hash - SHA256 of all fields plus prevHash
 * @property {string} prevHash - SHA256 of previous record
 */

// ============================================================================
// Canonical Serialization (ADR (internal) F-2 fix)
// ============================================================================

/**
 * Canonical JSON serialization for deterministic hashing.
 * 
 * Per ADR (internal) F-2 fix: canonical JSON format with sorted keys.
 * 
 * @param {DecisionRecord} record
 * @returns {string}
 */
function canonicalSerialize(record) {
  // Field order per ADR (internal) spec (sorted alphabetically)
  const fieldOrder = [
    'action',
    'actor',
    'context',
    'decisionId',
    'hash',            // excluded from hash computation
    'outcome',
    'parentDecisionId',
    'prevHash',
    'timestamp'
  ];
  
  const ordered = {};
  for (const key of fieldOrder) {
    if (key in record && key !== 'hash') {
      ordered[key] = record[key];
    }
  }
  
  return JSON.stringify(ordered);
}

/**
 * Compute SHA256 hash of record + prevHash.
 * 
 * @param {DecisionRecord} record
 * @param {string} prevHash
 * @returns {string}
 */
function computeRecordHash(record, prevHash) {
  const canonical = canonicalSerialize(record);
  const payload = canonical + prevHash;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ============================================================================
// In-Memory Index
// ============================================================================

/**
 * In-memory index for O(1) decisionId → hash lookup.
 * @type {Map<string, string>}
 */
const index = new Map();

/**
 * Last hash in chain.
 */
let lastHash = GENESIS_HASH;

// ============================================================================
// Storage
// ============================================================================

/**
 * Ensure audit directory exists.
 *
 * Wrapped in try/catch so a read-only filesystem (test environments,
 * misconfigured deploys) doesn't crash the audit module on require.
 * The error is logged once at module load; subsequent operations
 * that need the directory (logDecision, getChain, etc.) will surface
 * their own errors at use time.
 */
function ensureAuditDir() {
  try {
    if (!fs.existsSync(AUDIT_DIR)) {
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[decision-logger] AUDIT_DIR (${AUDIT_DIR}) not writable: ${err.code || err.message}`);
  }
}

/**
 * Load index from disk on startup.
 */
function loadIndex() {
  ensureAuditDir();

  if (!fs.existsSync(AUDIT_INDEX_FILE)) {
    return;
  }
  
  try {
    const data = fs.readFileSync(AUDIT_INDEX_FILE, 'utf8');
    const entries = JSON.parse(data);
    
    for (const [decisionId, hash] of Object.entries(entries)) {
      index.set(decisionId, hash);
    }
    
    // Find last hash by reading last line of log
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n');
      if (lines.length > 0) {
        const lastRecord = JSON.parse(lines[lines.length - 1]);
        lastHash = lastRecord.hash;
      }
    }
    
    console.log(`[decision-logger] Loaded ${index.size} decisions from index`);
  } catch (err) {
    console.error(`[decision-logger] Failed to load index: ${err.message}`);
  }
}

/**
 * Persist index to disk.
 */
function persistIndex() {
  const entries = {};
  for (const [decisionId, hash] of index) {
    entries[decisionId] = hash;
  }
  fs.writeFileSync(AUDIT_INDEX_FILE, JSON.stringify(entries));
}

/**
 * Append record to audit log (JSONL format).
 * 
 * @param {string} line
 */
function appendToLog(line) {
  ensureAuditDir();
  fs.appendFileSync(AUDIT_LOG_FILE, line);
}

/**
 * Read all records from log.
 * 
 * @returns {DecisionRecord[]}
 */
function readAllFromLog() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return [];
  }
  
  const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
  if (!content.trim()) {
    return [];
  }
  
  return content.trim().split('\n').map(line => JSON.parse(line));
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate UUID v4.
 * 
 * @returns {string}
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Get last hash in chain.
 * 
 * @returns {string}
 */
async function getLastHash() {
  return lastHash;
}

/**
 * Index lookup by decisionId.
 * 
 * @param {string} decisionId
 * @returns {string|undefined}
 */
function indexLookup(decisionId) {
  return index.get(decisionId);
}

/**
 * Read record from log by hash.
 * 
 * @param {string} hash
 * @returns {DecisionRecord|undefined}
 */
function readFromLog(hash) {
  const records = readAllFromLog();
  return records.find(r => r.hash === hash);
}

/**
 * Update index with new decision.
 * 
 * @param {string} decisionId
 * @param {string} hash
 */
async function updateIndex(decisionId, hash) {
  index.set(decisionId, hash);
  lastHash = hash;
  persistIndex();
}

/**
 * Log a decision to the audit chain.
 * 
 * Algorithm (ADR (internal) F-1 fix):
 * 1. Validate required fields
 * 2. Get previous hash for chaining
 * 3. Compute record hash
 * 4. Append to log
 * 5. Update index
 * 
 * @param {Omit<DecisionRecord, 'hash' | 'prevHash'>} decision
 * @returns {Promise<string>} Computed hash
 */
async function logDecision(decision) {
  // Step 1: Validate required fields
  const required = ['decisionId', 'parentDecisionId', 'timestamp', 'actor', 'action', 'context', 'outcome'];
  for (const field of required) {
    if (!(field in decision)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Step 2: Get previous hash
  const prevHash = await getLastHash();
  
  // Step 3: Compute hash
  const recordWithHash = {
    ...decision,
    prevHash,
    hash: ''  // Will be computed
  };
  
  const computedHash = computeRecordHash(recordWithHash, prevHash);
  recordWithHash.hash = computedHash;
  
  // Step 4: Append to log
  appendToLog(JSON.stringify(recordWithHash) + '\n');
  
  // Step 5: Update index
  await updateIndex(decision.decisionId, computedHash);
  
  console.log(`[decision-logger] Logged decision: ${decision.decisionId}`);
  
  return computedHash;
}

/**
 * Get full chain from root to specified decision.
 * 
 * Algorithm (ADR (internal) F-1 fix):
 * 1. Look up decision's hash in index
 * 2. Read decision record from log
 * 3. Recursively fetch parent
 * 4. Return chain (root → ... → target)
 * 
 * @param {string} decisionId
 * @returns {Promise<DecisionRecord[]>}
 */
async function getChain(decisionId) {
  const chain = [];

  // Cold-index fallback (C-step finding #16 follow-up): if the in-memory
  // index is empty (e.g., fresh deploy, index file missing, audit module
  // freshly required without a prior logDecision call), build a transient
  // index from the JSONL log file so /api/audit/* works on first hit.
  // This is more expensive than the index lookup but only triggers when
  // the persistent index is cold — production deployments warm the
  // index automatically as new decisions are appended.
  if (index.size === 0 && fs.existsSync(AUDIT_LOG_FILE)) {
    try {
      const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        const rec = JSON.parse(line);
        index.set(rec.decisionId, rec.hash);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[decision-logger] cold-index rebuild failed: ${err.message}`);
    }
  }

  let currentId = decisionId;

  while (currentId !== null) {
    const hash = indexLookup(currentId);
    if (!hash) {
      throw new Error(`Decision ${currentId} not found in index`);
    }

    const record = readFromLog(hash);
    if (!record) {
      throw new Error(`Decision ${currentId} not found in log`);
    }

    chain.unshift(record);  // Prepend (building root-first)
    currentId = record.parentDecisionId;
  }
  
  return chain;
}

/**
 * Get chain between two decision IDs (inclusive).
 * 
 * @param {string} fromId
 * @param {string} toId
 * @returns {Promise<DecisionRecord[]>}
 */
async function getChainBetween(fromId, toId) {
  const toChain = await getChain(toId);
  
  // Find fromId in chain
  const fromIndex = toChain.findIndex(r => r.decisionId === fromId);
  if (fromIndex === -1) {
    throw new Error(`Decision ${fromId} not found in chain to ${toId}`);
  }
  
  return toChain.slice(fromIndex);
}

/**
 * Verify chain integrity.
 * 
 * Algorithm (ADR (internal) F-1 fix):
 * 1. Read all records
 * 2. For each, recompute hash
 * 3. Verify against stored hash
 * 4. Verify prevHash chain
 * 
 * @returns {Promise<{valid: boolean, firstInvalidRecord?: string, error?: string}>}
 */
async function verifyChain() {
  const records = readAllFromLog();
  
  let expectedPrevHash = GENESIS_HASH;
  
  for (const record of records) {
    // Recompute hash
    const recomputedHash = computeRecordHash(record, expectedPrevHash);
    
    // Verify hash
    if (recomputedHash !== record.hash) {
      return {
        valid: false,
        firstInvalidRecord: record.decisionId,
        error: `Hash mismatch: expected ${recomputedHash}, got ${record.hash}`
      };
    }
    
    // Verify prevHash chain
    if (record.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        firstInvalidRecord: record.decisionId,
        error: `Chain broken: expected prevHash ${expectedPrevHash}, got ${record.prevHash}`
      };
    }
    
    expectedPrevHash = record.hash;
  }
  
  return { valid: true };
}

/**
 * Export chain in SIEM-compatible format.
 * 
 * @param {string} fromId
 * @param {string} toId
 * @param {string} format - 'json' | 'csv' | 'cef'
 * @returns {Promise<string>}
 */
async function exportChain(fromId, toId, format = 'json') {
  const chain = await getChainBetween(fromId, toId);
  
  switch (format) {
    case 'json':
      return JSON.stringify(chain, null, 2);
      
    case 'csv':
      // CEF (Common Event Format) compatible CSV
      const headers = ['decisionId', 'parentDecisionId', 'timestamp', 'actor.agentId', 'action.type', 'outcome.success'];
      const rows = chain.map(r => [
        r.decisionId,
        r.parentDecisionId || '',
        r.timestamp,
        r.actor.agentId,
        r.action.type,
        r.outcome.success
      ].join(','));
      return [headers.join(','), ...rows].join('\n');
      
    case 'cef':
      // Common Event Format
      return chain.map(r =>
        `CEF:0|AWARE|Audit|1.0|${r.action.type}|${r.decisionId}|${r.outcome.success ? 'Info' : 'Warn'}|${r.actor.agentId}`
      ).join('\n');

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// ============================================================================
// Bootstrap (C-step finding #16 follow-up)
// ============================================================================
//
// CRITICAL: load the on-disk index on module require so callers don't need
// to remember to call loadIndex() themselves. Without this, a fresh process
// that requires decision-logger.js sees an empty in-memory `index` Map and
// getChain() throws "not found in index" — even though the JSONL on disk
// has the records. The previous behavior silently failed the first time
// getChain was called; this was a latent bug that the audit HTTP API
// (mounted on the v2 gateway) made visible because every /api/audit/*
// request was the "first call" from the gateway's perspective.
//
// loadIndex() is safe to call repeatedly and no-ops when the index file
// is missing (it just creates an empty index). Errors during load are
// logged but don't throw — the module stays usable, just with a cold
// index (callers will see "not found" until they re-load).
loadIndex();

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Constants
  GENESIS_HASH,

  // Core functions
  logDecision,
  getChain,
  getChainBetween,
  verifyChain,
  exportChain,

  // Utilities
  generateUUID,
  canonicalSerialize,
  computeRecordHash,
  loadIndex,
  ensureAuditDir,

  // Index operations
  getLastHash,
  indexLookup,
  readFromLog
};
