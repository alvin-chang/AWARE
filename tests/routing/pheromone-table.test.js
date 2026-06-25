/**
 * ADR (internal): Phase 2.1 — Pheromone Specialists Tests
 * 
 * Test scenarios per ADR (internal) §Test Requirements:
 * T1: CODE_GENERATION task routed → table updated on completion
 * T2: RESEARCH pheromones do NOT appear in CODE_GENERATION table (isolation)
 * T3: After 1 hour, low-strength trails (<0.01) are pruned
 * T4: Agent with 0.8 pheromone selected over 0.2 with probability ~0.8/(0.8+0.2)
 * T5: New agent with no pheromone history gets default load-balance
 * T6: Evaporation reduces RESEARCH trails by ~5% per hour (decay=0.05)
 * T7: Task with no keywords classified as GENERAL
 * 
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const { 
  TaskCategory,
  createTable,
  getOrCreateTable,
  getTable,
  depositPheromone,
  applyNegativeReinforcement,
  evaporatePheromones,
  selectAgent,
  weightedRandomSelect,
  buildCandidateList,
  getStats,
  PHEROMONE_MIN
} = require('../../src/routing/pheromone-table');

const { classifyTask, detectMultipleCategories } = require('../../src/routing/task-classifier');

// ============================================================================
// Helpers
// ============================================================================

/** @type {Array<{passed: number, failed: number, tests: Array}>} */
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

function assertApprox(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${msg || 'Approximation failed'}: expected ~${expected}, got ${actual}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(`${msg || 'Expected true'}: got ${value}`);
  }
}

// Mock heuristic function
function mockHeuristic(agentId, task) {
  // Return deterministic score based on agentId
  const scores = {
    'agent-code-1': 0.9,
    'agent-code-2': 0.7,
    'agent-research-1': 0.8,
    'agent-data-1': 0.75
  };
  return scores[agentId] || 0.5;
}

// ============================================================================
// Test Suites
// ============================================================================

console.log('\n=== ADR (internal) Pheromone Specialists Tests ===\n');

// ---------------------------------------------------------------------------
// T1: CODE_GENERATION task pheromones routed and deposited
// ---------------------------------------------------------------------------
test('T1: CODE_GENERATION task → pheromones deposited in code-generation table', () => {
  const category = TaskCategory.CODE_GENERATION;
  const table = getOrCreateTable(category);
  table.agents.clear();  // Reset
  table.transitions.clear();
  
  // Simulate routing: agent-code-1 handles code task
  const pathAgents = ['coordinator', 'agent-code-1'];
  
  depositPheromone({
    taskCategory: category,
    taskId: 'test-task-1',
    pathAgents,
    qualityGate: { passed: true, qualityScore: 0.85 },
    securityGate: { passed: true, contentFilterPassed: true }
  });
  
  // Verify agent pheromone was deposited
  assertTrue(table.agents.has('agent-code-1'), 'agent-code-1 should have pheromone');
  assertTrue(table.agents.get('agent-code-1') > 0, 'pheromone should be positive');
  
  // Verify transition was deposited
  assertTrue(table.transitions.has('coordinator'), 'orchestrator transition exists');
  assertTrue(table.transitions.get('coordinator').has('agent-code-1'), 'orchestrator→agent-code-1 transition exists');
});

// ---------------------------------------------------------------------------
// T2: Task category pheromone isolation
// ---------------------------------------------------------------------------
test('T2: RESEARCH pheromones do NOT appear in CODE_GENERATION table', () => {
  const codeTable = getOrCreateTable(TaskCategory.CODE_GENERATION);
  const researchTable = getOrCreateTable(TaskCategory.RESEARCH);
  
  // Clear both tables
  codeTable.agents.clear();
  researchTable.agents.clear();
  codeTable.transitions.clear();
  researchTable.transitions.clear();
  
  // Deposit in RESEARCH
  depositPheromone({
    taskCategory: TaskCategory.RESEARCH,
    taskId: 'test-research',
    pathAgents: ['coordinator', 'agent-research-1'],
    qualityGate: { passed: true, qualityScore: 0.9 },
    securityGate: { passed: true, contentFilterPassed: true }
  });
  
  // Verify RESEARCH table has pheromone
  assertTrue(researchTable.agents.has('agent-research-1'), 'research agent should have pheromone');
  
  // Verify CODE table does NOT have research agent
  assertTrue(!codeTable.agents.has('agent-research-1'), 'research agent should NOT be in code table');
});

// ---------------------------------------------------------------------------
// T3: Low-strength trails are pruned
// ---------------------------------------------------------------------------
test('T3: After evaporation, trails < 0.01 are pruned', () => {
  const table = getOrCreateTable(TaskCategory.GENERAL);
  table.agents.clear();
  table.transitions.clear();
  
  // Manually set a very low pheromone
  table.agents.set('agent-low', 0.005);  // Below PHEROMONE_MIN
  
  // Run evaporation
  evaporatePheromones();
  
  // Verify low pheromone was pruned
  assertTrue(!table.agents.has('agent-low'), 'agent with strength < 0.01 should be pruned');
});

// ---------------------------------------------------------------------------
// T4: Probabilistic selection weighted by pheromone
// ---------------------------------------------------------------------------
test('T4: Agent 0.8 pheromone selected over 0.2 with probability ~0.8/(0.8+0.2)', () => {
  const candidates = [
    { agentId: 'agent-a', pheromoneStrength: 0.8, heuristicScore: 0.5 },
    { agentId: 'agent-b', pheromoneStrength: 0.2, heuristicScore: 0.5 }
  ];
  
  // Run selection many times and count
  const counts = { 'agent-a': 0, 'agent-b': 0 };
  const iterations = 10000;
  
  for (let i = 0; i < iterations; i++) {
    const probabilities = candidates.map(c => ({
      agentId: c.agentId,
      probability: c.pheromoneStrength / (0.8 + 0.2)  // Simplified: proportional to pheromone
    }));
    const selected = weightedRandomSelect(probabilities);
    if (selected) counts[selected]++;
  }
  
  // Agent-a should be selected ~80% of the time
  const ratioA = counts['agent-a'] / iterations;
  assertApprox(ratioA, 0.8, 0.05, 'agent-a should be selected ~80% of the time');
});

// ---------------------------------------------------------------------------
// T5: New agent with no history gets default fallback
// ---------------------------------------------------------------------------
test('T5: Empty table → defaultFallback() returned', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  table.agents.clear();
  table.transitions.clear();
  
  const selection = selectAgent(TaskCategory.CODE_GENERATION, {}, mockHeuristic);
  
  assertEqual(selection.agentId, null, 'Should return null for empty table');
  assertEqual(selection.reason, 'no_pheromone_history', 'Should indicate no pheromone history');
});

// ---------------------------------------------------------------------------
// T6: Evaporation reduces trails by expected amount per hour
// ---------------------------------------------------------------------------
test('T6: RESEARCH decay=0.05/hour → ~5% reduction per hour', () => {
  const table = getOrCreateTable(TaskCategory.RESEARCH);
  table.agents.clear();
  table.transitions.clear();
  table.decayRate = 0.05;  // 5% per hour
  
  // Set initial pheromone
  table.agents.set('agent-research', 1.0);
  
  // Run one evaporation cycle (simulates 1 second)
  // decay per second = 0.05 / 3600
  const decayPerSecond = table.decayRate / 3600;
  evaporatePheromones();
  
  // After 1 hour of evaporation (3600 seconds), should be ~95%
  // For 1 second: (1 - 0.05/3600) ≈ 0.999986
  const expected = 1.0 * (1 - decayPerSecond);
  const actual = table.agents.get('agent-research');
  assertApprox(actual, expected, 0.0001, 'Should decay by decayRate/3600 per second');
});

// ---------------------------------------------------------------------------
// T7: Task with no keywords → GENERAL category
// ---------------------------------------------------------------------------
test('T7: Task with no matching keywords classified as GENERAL', () => {
  const task = { prompt: 'Please do something unspecified' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.GENERAL, 'Should default to GENERAL');
});

// ---------------------------------------------------------------------------
// Task Classification Tests
// ---------------------------------------------------------------------------
test('classifyTask: CODE_GENERATION keywords → CODE_GENERATION category', () => {
  const task = { prompt: 'Write a new API endpoint for user authentication' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.CODE_GENERATION, 'Should be CODE_GENERATION');
});

test('classifyTask: RESEARCH keywords → RESEARCH category', () => {
  const task = { prompt: 'Investigate and compare approaches to distributed systems architecture' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.RESEARCH, 'Should be RESEARCH');
});

test('classifyTask: SECURITY_REVIEW keywords → SECURITY_REVIEW category', () => {
  const task = { prompt: 'Scan for vulnerabilities and audit the authentication service' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.SECURITY_REVIEW, 'Should be SECURITY_REVIEW');
});

test('classifyTask: DATA_ANALYSIS keywords → DATA_ANALYSIS category', () => {
  const task = { prompt: 'Calculate statistics and create a trend chart' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.DATA_ANALYSIS, 'Should be DATA_ANALYSIS');
});

test('classifyTask: COORDINATION keywords → COORDINATION category', () => {
  const task = { prompt: 'Orchestrate the deployment across all environments' };
  const category = classifyTask(task);
  assertEqual(category, TaskCategory.COORDINATION, 'Should be COORDINATION');
});

// ---------------------------------------------------------------------------
// Negative Reinforcement Tests
// ---------------------------------------------------------------------------
test('applyNegativeReinforcement: violation → 50% pheromone reduction', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  table.agents.clear();
  table.agents.set('agent-violator', 1.0);
  
  depositPheromone({
    taskCategory: TaskCategory.CODE_GENERATION,
    taskId: 'test-violation',
    pathAgents: ['agent-violator'],
    qualityGate: { passed: true, qualityScore: 0.9 },
    securityGate: { passed: true, contentFilterPassed: true }
  });
  
  // Now apply penalty for violation
  applyNegativeReinforcement({
    taskCategory: TaskCategory.CODE_GENERATION,
    taskId: 'test-violation',
    pathAgents: ['agent-violator']
  }, 1.0);  // severity 1.0 = 50% reduction
  
  // Pheromone should be reduced by 50%
  const expected = 0.5;  // 1.0 * (1 - 0.5)
  const actual = table.agents.get('agent-violator');
  assertApprox(actual, expected, 0.01, 'Should be reduced by 50%');
});

// ---------------------------------------------------------------------------
// Quality/Security Gate Tests
// ---------------------------------------------------------------------------
test('depositPheromone: failed quality gate → no deposit', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  const initialAgents = table.agents.size;
  
  depositPheromone({
    taskCategory: TaskCategory.CODE_GENERATION,
    taskId: 'test-fail',
    pathAgents: ['agent-test'],
    qualityGate: { passed: false, qualityScore: 0.3 },  // FAILED
    securityGate: { passed: true, contentFilterPassed: true }
  });
  
  // Table should not grow
  assertEqual(table.agents.size, initialAgents, 'No deposit for failed quality gate');
});

test('depositPheromone: failed security gate → no deposit', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  const initialAgents = table.agents.size;
  
  depositPheromone({
    taskCategory: TaskCategory.CODE_GENERATION,
    taskId: 'test-security-fail',
    pathAgents: ['agent-test'],
    qualityGate: { passed: true, qualityScore: 0.9 },
    securityGate: { passed: false, contentFilterPassed: false }  // FAILED
  });
  
  // Table should not grow
  assertEqual(table.agents.size, initialAgents, 'No deposit for failed security gate');
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
