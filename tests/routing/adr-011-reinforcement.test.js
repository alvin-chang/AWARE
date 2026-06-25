/**
 * ADR-011: Phase 2.3 — Quality-Gated Reinforcement Tests
 * 
 * @author Coder (Coder)
 * @license GPL-3.0
 */

'use strict';

const {
  computeQualityScore,
  getQualityRating,
  evaluateQuality,
  QUALITY_THRESHOLDS,
  createMetricsFromTestResults
} = require('../../src/routing/quality-evaluator');

const {
  checkPolicyCompliance,
  VIOLATION_SEVERITY,
  VIOLATION_TYPES
} = require('../../src/routing/policy-checker');

const {
  processTaskCompletion,
  EVENT_TYPES
} = require('../../src/routing/reinforcement-controller');

const {
  TaskCategory,
  getOrCreateTable,
  PHEROMONE_MIN
} = require('../../src/routing/pheromone-table');

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

// ============================================================================
// ADR-011 Tests
// ============================================================================

console.log('\n=== ADR-011 Quality-Gated Reinforcement Tests ===\n');

// ---------------------------------------------------------------------------
// Quality Evaluator Tests
// ---------------------------------------------------------------------------

test('computeQualityScore: EXCELLENT metrics → score ≥ 0.9', () => {
  const metrics = {
    correctness: 1.0,
    completeness: 1.0,
    efficiency: 1.0,
    timeliness: 1.0
  };
  const score = computeQualityScore(metrics, {});
  assertApprox(score, 1.0, 0.001, 'Perfect score');
});

test('computeQualityScore: ACCEPTABLE metrics → 0.6 ≤ score < 0.9', () => {
  const metrics = {
    correctness: 0.7,
    completeness: 0.6,
    efficiency: 0.6,
    timeliness: 0.5
  };
  const score = computeQualityScore(metrics, {});
  assertTrue(score >= 0.6 && score < 0.9, `Score ${score} should be in [0.6, 0.9)`);
});

test('computeQualityScore: FAIL metrics → score < 0.4', () => {
  const metrics = {
    correctness: 0.2,
    completeness: 0.3,
    efficiency: 0.2,
    timeliness: 0.1
  };
  const score = computeQualityScore(metrics, {});
  assertTrue(score < 0.4, `Score ${score} should be < 0.4`);
});

test('computeQualityScore: weighted combination works correctly', () => {
  // correctness=1.0 (40%), completeness=0 (30%), efficiency=0 (15%), timeliness=0 (15%)
  // Expected = 1.0 * 0.4 + 0 * 0.3 + 0 * 0.15 + 0 * 0.15 = 0.4
  const metrics = {
    correctness: 1.0,
    completeness: 0.0,
    efficiency: 0.0,
    timeliness: 0.0
  };
  const score = computeQualityScore(metrics, {});
  assertApprox(score, 0.4, 0.001, 'Weighted score');
});

test('getQualityRating: score ≥ 0.9 → EXCELLENT', () => {
  const rating = getQualityRating(0.95);
  assertTrue(rating === 'EXCELLENT', `Rating should be EXCELLENT, got ${rating}`);
});

test('getQualityRating: 0.6 ≤ score < 0.9 → ACCEPTABLE', () => {
  const rating = getQualityRating(0.75);
  assertTrue(rating === 'ACCEPTABLE', `Rating should be ACCEPTABLE, got ${rating}`);
});

test('getQualityRating: 0.4 ≤ score < 0.6 → MARGINAL', () => {
  const rating = getQualityRating(0.5);
  assertTrue(rating === 'MARGINAL', `Rating should be MARGINAL, got ${rating}`);
});

test('getQualityRating: score < 0.4 → FAIL', () => {
  const rating = getQualityRating(0.3);
  assertTrue(rating === 'FAIL', `Rating should be FAIL, got ${rating}`);
});

test('evaluateQuality: excellent quality → passed=true', () => {
  const metrics = {
    correctness: 0.95,
    completeness: 0.9,
    efficiency: 0.85,
    timeliness: 0.9
  };
  const result = evaluateQuality(metrics);
  assertTrue(result.passed, 'Excellent quality should pass');
  assertTrue(result.rating === 'EXCELLENT', `Rating should be EXCELLENT`);
  assertApprox(result.multiplier, 1.5, 0.01, 'Multiplier should be 1.5 for EXCELLENT');
});

test('evaluateQuality: failed quality → passed=false', () => {
  const metrics = {
    correctness: 0.3,
    completeness: 0.2,
    efficiency: 0.3,
    timeliness: 0.2
  };
  const result = evaluateQuality(metrics);
  assertTrue(!result.passed, 'Failed quality should not pass');
  assertTrue(result.rating === 'FAIL', `Rating should be FAIL`);
});

test('createMetricsFromTestResults: 80/100 tests passed, 8/10 subtasks, on-time', () => {
  const metrics = createMetricsFromTestResults({
    totalTests: 100,
    passedTests: 80,
    completedSubtasks: 8,
    totalSubtasks: 10,
    actualDurationMs: 5000,
    slaDurationMs: 10000
  });
  
  assertApprox(metrics.correctness, 0.8, 0.001, 'Correctness');
  assertApprox(metrics.completeness, 0.8, 0.001, 'Completeness');
  assertApprox(metrics.timeliness, 1.0, 0.001, 'Timeliness (within SLA)');
});

// ---------------------------------------------------------------------------
// Policy Checker Tests
// ---------------------------------------------------------------------------

test('checkPolicyCompliance: no violations → passed=true', () => {
  const result = checkPolicyCompliance({
    taskId: 'test-1',
    agentId: 'agent-1'
  });
  assertTrue(result.passed, 'No violations should pass');
  assertTrue(result.contentFilterPassed, 'Content filter should pass');
  assertTrue(result.toolAuthPassed, 'Tool auth should pass');
  assertTrue(!result.dataLeakageDetected, 'No data leakage');
  assertTrue(result.policyViolations.length === 0, 'No violations');
});

test('checkPolicyCompliance: data leakage → passed=false', () => {
  // Mock data leakage by passing resource usage with leakage indicator
  const result = checkPolicyCompliance({
    taskId: 'test-2',
    agentId: 'agent-1',
    resourceUsage: { dataLeakage: true }
  });
  assertTrue(!result.passed, 'Data leakage should fail');
});

// ---------------------------------------------------------------------------
// Reinforcement Controller Tests
// ---------------------------------------------------------------------------

test('processTaskCompletion: excellent quality + no violations → positive reinforcement', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  table.agents.clear();
  
  const metrics = {
    correctness: 0.95,
    completeness: 0.9,
    efficiency: 0.85,
    timeliness: 0.9
  };
  
  const result = processTaskCompletion({
    taskId: 'test-success',
    category: TaskCategory.CODE_GENERATION,
    pathAgents: ['orchestrator', 'agent-code'],
    outcomeMetrics: metrics
  });
  
  assertTrue(result.reinforced, 'Should be reinforced');
  assertTrue(result.eventType === EVENT_TYPES.TASK_SUCCESS, 'Should be TASK_SUCCESS');
  assertTrue(result.multiplier > 1.0, 'Multiplier should be > 1.0 for excellent');
  
  // Verify pheromone was deposited
  assertTrue(table.agents.has('agent-code'), 'Agent should have pheromone');
});

test('processTaskCompletion: failed quality → negative reinforcement', () => {
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  const initialStrength = 1.0;
  table.agents.set('agent-fail', initialStrength);
  
  const metrics = {
    correctness: 0.2,
    completeness: 0.2,
    efficiency: 0.2,
    timeliness: 0.2
  };
  
  const result = processTaskCompletion({
    taskId: 'test-fail',
    category: TaskCategory.CODE_GENERATION,
    pathAgents: ['agent-fail'],
    outcomeMetrics: metrics
  });
  
  assertTrue(result.reinforced, 'Should be reinforced (negative)');
  assertTrue(result.eventType === EVENT_TYPES.TASK_FAILURE, 'Should be TASK_FAILURE');
  
  // Verify pheromone was reduced
  const newStrength = table.agents.get('agent-fail');
  assertTrue(newStrength < initialStrength, `Strength should decrease: ${newStrength} < ${initialStrength}`);
});

test('processTaskCompletion: marginal quality → fails gate, negative reinforcement', () => {
  // MARGINAL (0.4-0.6) fails quality gate (threshold=0.6)
  // So it triggers TASK_FAILURE with negative reinforcement
  const table = getOrCreateTable(TaskCategory.CODE_GENERATION);
  const initialStrength = 0.5;
  table.agents.set('agent-marginal', initialStrength);
  
  const metrics = {
    correctness: 0.5,   // = 0.5 × 0.4 = 0.20
    completeness: 0.45, // = 0.45 × 0.3 = 0.135
    efficiency: 0.4,    // = 0.4 × 0.15 = 0.06
    timeliness: 0.4     // = 0.4 × 0.15 = 0.06
    // Total: 0.455 → MARGINAL, fails gate (threshold 0.6)
  };
  
  const result = processTaskCompletion({
    taskId: 'test-marginal',
    category: TaskCategory.CODE_GENERATION,
    pathAgents: ['agent-marginal'],
    outcomeMetrics: metrics
  });
  
  // MARGINAL fails the quality gate (0.6 threshold)
  assertTrue(!result.qualityGate.passed, 'MARGINAL should fail quality gate');
  assertTrue(result.reinforced, 'Should be reinforced (negative)');
  assertTrue(result.eventType === EVENT_TYPES.TASK_FAILURE, 'Should be TASK_FAILURE');
  
  // Verify pheromone was reduced
  const newStrength = table.agents.get('agent-marginal');
  assertTrue(newStrength < initialStrength, `Strength should decrease: ${newStrength} < ${initialStrength}`);
});

test('processTaskCompletion: quality + security pass → bonus multiplier', () => {
  const table = getOrCreateTable(TaskCategory.RESEARCH);
  table.agents.clear();
  
  const metrics = {
    correctness: 0.95,
    completeness: 0.95,
    efficiency: 0.9,
    timeliness: 0.9
  };
  
  const result = processTaskCompletion({
    taskId: 'test-excellent',
    category: TaskCategory.RESEARCH,
    pathAgents: ['orchestrator', 'agent-research'],
    outcomeMetrics: metrics
  });
  
  assertTrue(result.reinforced, 'Should be reinforced');
  assertTrue(result.qualityGate.rating === 'EXCELLENT', 'Should be EXCELLENT');
  assertApprox(result.qualityGate.multiplier, 1.5, 0.01, 'EXCELLENT multiplier should be 1.5');
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
