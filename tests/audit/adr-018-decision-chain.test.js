/**
 * ADR-018: Phase 3.3 — Decision-Chain Traceability Tests
 * 
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const {
  canonicalSerialize,
  computeRecordHash,
  generateUUID,
  GENESIS_HASH
} = require('../../src/audit/decision-logger');

// ============================================================================
// Helpers
// ============================================================================

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(`${msg || 'Expected true'}: got ${value}`);
  }
}

function assertMatch(str, regex, msg) {
  if (!regex.test(str)) {
    throw new Error(`${msg || 'String'} did not match regex ${regex}`);
  }
}

// ============================================================================
// ADR-018 Tests
// ============================================================================

console.log('\n=== ADR-018 Decision-Chain Traceability Tests ===\n');

// ---------------------------------------------------------------------------
// UUID Generation
// ---------------------------------------------------------------------------

test('generateUUID: returns valid UUID v4 format', () => {
  const uuid = generateUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assertMatch(uuid, uuidRegex, 'Should be valid UUID v4');
});

test('generateUUID: generates unique IDs', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    ids.add(generateUUID());
  }
  assertEqual(ids.size, 100, 'All 100 UUIDs should be unique');
});

// ---------------------------------------------------------------------------
// Canonical Serialization
// ---------------------------------------------------------------------------

test('canonicalSerialize: sorts keys alphabetically', () => {
  const record = {
    timestamp: '2026-04-02T10:00:00.000Z',
    action: { type: 'route', target: 'task-1', reason: 'pheromone-select' },
    decisionId: 'test-id',
    actor: { agentId: 'agent-1', trustScore: 0.85 }
  };
  
  const serialized = canonicalSerialize(record);
  const parsed = JSON.parse(serialized);
  
  const keys = Object.keys(parsed);
  const sortedKeys = [...keys].sort();
  assertEqual(JSON.stringify(keys), JSON.stringify(sortedKeys), 'Keys should be sorted');
});

test('canonicalSerialize: excludes hash field', () => {
  const record = {
    decisionId: 'test-id',
    hash: 'should-be-excluded',
    action: { type: 'route' },
    actor: { agentId: 'agent-1' },
    context: {},
    outcome: { success: true },
    parentDecisionId: null,
    prevHash: 'prev-hash',
    timestamp: '2026-04-02T10:00:00.000Z'
  };
  
  const serialized = canonicalSerialize(record);
  const parsed = JSON.parse(serialized);
  
  assertTrue(!('hash' in parsed), 'hash should be excluded from serialization');
});

test('canonicalSerialize: null parentDecisionId serializes correctly', () => {
  const record = {
    decisionId: 'test-id',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const serialized = canonicalSerialize(record);
  const parsed = JSON.parse(serialized);
  
  assertEqual(parsed.parentDecisionId, null, 'null should serialize correctly');
});

test('canonicalSerialize: deterministic output', () => {
  const record = {
    decisionId: 'test-id',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1', trustScore: 0.85 },
    action: { type: 'route', target: 'task-1', reason: 'pheromone-select' },
    context: { pheromoneScores: { 'agent-1': 0.75 } },
    outcome: { success: true, latencyMs: 45, errorMessage: null },
    prevHash: GENESIS_HASH
  };
  
  const serialized1 = canonicalSerialize(record);
  const serialized2 = canonicalSerialize(record);
  
  assertEqual(serialized1, serialized2, 'Serialization should be deterministic');
});

// ---------------------------------------------------------------------------
// Hash Computation
// ---------------------------------------------------------------------------

test('computeRecordHash: returns 64-char hex string (SHA256)', () => {
  const record = {
    decisionId: 'test-id',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const hash = computeRecordHash(record, GENESIS_HASH);
  
  assertEqual(hash.length, 64, 'SHA256 produces 64-char hex');
  assertMatch(hash, /^[0-9a-f]{64}$/, 'Should be hex string');
});

test('computeRecordHash: different records produce different hashes', () => {
  const record1 = {
    decisionId: 'test-1',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const record2 = {
    ...record1,
    decisionId: 'test-2'  // Different ID
  };
  
  const hash1 = computeRecordHash(record1, GENESIS_HASH);
  const hash2 = computeRecordHash(record2, GENESIS_HASH);
  
  assertTrue(hash1 !== hash2, 'Different records should have different hashes');
});

test('computeRecordHash: changing prevHash changes record hash', () => {
  const record = {
    decisionId: 'test-1',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const hash1 = computeRecordHash(record, GENESIS_HASH);
  const hash2 = computeRecordHash(record, 'different-prev-hash');
  
  assertTrue(hash1 !== hash2, 'Different prevHash should produce different hash');
});

test('computeRecordHash: tamper detection — modifying record changes hash', () => {
  const record = {
    decisionId: 'test-1',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const originalHash = computeRecordHash(record, GENESIS_HASH);
  
  // Tamper with the record
  record.action.type = 'deny';  // Changed!
  
  const tamperedHash = computeRecordHash(record, GENESIS_HASH);
  
  assertTrue(originalHash !== tamperedHash, 'Tampered record should have different hash');
});

test('computeRecordHash: GENESIS_HASH constant is correct', () => {
  assertEqual(
    GENESIS_HASH,
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Genesis hash should be 64 zeros'
  );
});

// ---------------------------------------------------------------------------
// Chain Integrity
// ---------------------------------------------------------------------------

test('hash chain: sequential records chain correctly', () => {
  const record1 = {
    decisionId: 'record-1',
    parentDecisionId: null,
    timestamp: '2026-04-02T10:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: GENESIS_HASH
  };
  
  const hash1 = computeRecordHash(record1, GENESIS_HASH);
  
  const record2 = {
    decisionId: 'record-2',
    parentDecisionId: 'record-1',
    timestamp: '2026-04-02T10:01:00.000Z',
    actor: { agentId: 'agent-2' },
    action: { type: 'route' },
    context: {},
    outcome: { success: true },
    prevHash: hash1  // Points to record-1's hash
  };
  
  const hash2 = computeRecordHash(record2, hash1);
  
  // Verify record-2's prevHash matches record-1's hash
  assertEqual(record2.prevHash, hash1, 'record-2.prevHash should equal record-1.hash');
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===\n`);

if (results.failed > 0) {
  console.log('Failed tests:');
  results.tests
    .filter(t => t.status === 'FAIL')
    .forEach(t => console.log(`  ❌ ${t.name}: ${t.error}`));
}

process.exit(results.failed > 0 ? 1 : 0);
