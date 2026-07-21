// SPDX-License-Identifier: Apache-2.0
// test/unit/policies/tool-observation-proxy-ast06-ast08.test.js
//
// ADR-048 §4 / §5 — verify that ToolObservationProxy wires the new
// AST06 source events (sandbox_policy_decision) and AST08 source
// events (skill_scan_result) through the audit chain AND the AST10
// mapper, behind the staged-rollout toggles.
//
// The proxy never ENFORCES — enforcement is the sandbox policy's job
// (AST06) and the SkillActivationGate's job (AST08). These tests
// verify that the proxy correctly:
//   (1) Honours the enableAST06Annotation / enableAST08Annotation
//       toggles (default OFF — staged rollout per ADR-048 §7).
//   (2) Writes source events to the audit logger when the toggle is ON.
//   (3) Routes source events through the AST10 mapper when AST10
//       annotation is also enabled.
//   (4) Does NOT block the caller when logDecision fails (fail-open
//       per ADR-040).
//   (5) For AST08, applies defaultActivationPolicy (fail-closed for
//       new/untrusted skills when scanner unavailable) and returns
//       the policy decision to the caller.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  ToolObservationProxy
} = require('../../../src/policies/tool-observation-proxy');
const { classify } = require('../../../src/compliance/ast10-mapper');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function capturingAuditLogger() {
  const decisions = [];
  return {
    decisions,
    logDecision: async (decision) => {
      decisions.push(JSON.parse(JSON.stringify(decision)));
      return 'hash-' + decisions.length;
    }
  };
}

function buildProxy(config = {}) {
  const auditLogger = config.auditLogger || capturingAuditLogger();
  return {
    proxy: new ToolObservationProxy({
      auditLogger,
      enableAST06Annotation: false,
      enableAST08Annotation: false,
      enableAST10Annotation: false,
      ...config
    }),
    auditLogger
  };
}

// ============================================================================
// (1) Default toggle state — both new toggles default OFF (ADR-048 §7)
// ============================================================================

test('proxy: enableAST06Annotation defaults to false (no source event written)', async () => {
  const { proxy, auditLogger } = buildProxy();
  assert.equal(proxy.enableAST06Annotation, false);
  await proxy.observeSandboxDecision({
    toolId: 'exec',
    target: '/etc/shadow',
    sandboxProfile: 'agent-default',
    requestedNamespace: 'agent-ns-1',
    effectiveNamespace: 'host', // mismatch → would normally fire AST06
    outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: blocked' }
  });
  assert.equal(auditLogger.decisions.length, 0,
    'audit chain must NOT receive a sandbox_policy_decision source event when toggle is OFF');
});

test('proxy: enableAST08Annotation defaults to false (no scan, no source event)', async () => {
  const { proxy, auditLogger } = buildProxy();
  assert.equal(proxy.enableAST08Annotation, false);
  const result = await proxy.observeSkillActivation({
    skillId: 'malicious/skill',
    artifactPath: '/tmp/skill.skill',
    artifactHash: 'a'.repeat(64),
    manifest: {}
  });
  assert.equal(result.allowed, true);
  assert.equal(result.annotationSkipped, true);
  assert.equal(auditLogger.decisions.length, 0,
    'audit chain must NOT receive a skill_scan_result source event when toggle is OFF');
});

// ============================================================================
// (2) AST06 source event — written when enableAST06Annotation=true
// ============================================================================

test('proxy: enableAST06Annotation=true writes a sandbox_policy_decision source event with the expected shape', async () => {
  const { proxy, auditLogger } = buildProxy({ enableAST06Annotation: true });
  await proxy.observeSandboxDecision({
    toolId: 'exec',
    target: '/etc/shadow',
    sandboxProfile: 'agent-default',
    requestedNamespace: 'agent-ns-1',
    effectiveNamespace: 'host',
    hostEscapeCapabilities: ['filesystem', 'network'],
    outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: namespace escape detected' }
  });
  assert.equal(auditLogger.decisions.length, 1);
  const source = auditLogger.decisions[0];
  assert.equal(source.action.type, 'sandbox_policy_decision');
  assert.equal(source.action.toolId, 'exec');
  assert.equal(source.action.target, '/etc/shadow');
  assert.equal(source.outcome.success, false);
  assert.ok(source.outcome.errorMessage.startsWith('AWARE_SANDBOX_DENY:'));
  assert.equal(source.action.parameters.sandboxProfile, 'agent-default');
  assert.equal(source.action.parameters.requestedNamespace, 'agent-ns-1');
  assert.equal(source.action.parameters.effectiveNamespace, 'host');
  assert.deepEqual(source.action.parameters.hostEscapeCapabilities, ['filesystem', 'network']);
});

test('proxy: AST06 + AST10 cascade — when both toggles are ON, the source event is annotated as sandbox-boundary-violation', async () => {
  const { proxy, auditLogger } = buildProxy({
    enableAST06Annotation: true,
    enableAST10Annotation: true
  });
  await proxy.observeSandboxDecision({
    toolId: 'exec',
    target: '/usr/bin/curl',
    sandboxProfile: 'agent-default',
    requestedNamespace: 'agent-ns-1',
    effectiveNamespace: 'host',
    outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: namespace escape detected' }
  });
  // Two records: source event + AST06 annotation
  assert.equal(auditLogger.decisions.length, 2);
  const types = auditLogger.decisions.map((d) => d.action.type).sort();
  assert.deepEqual(types, ['ast10_annotation', 'sandbox_policy_decision']);
  const annotation = auditLogger.decisions.find((d) => d.action.type === 'ast10_annotation');
  assert.equal(annotation.action.target, 'AST06');
  assert.equal(annotation.action.reason, 'sandbox-boundary-violation');
  assert.equal(annotation.parentDecisionId, auditLogger.decisions.find((d) => d.action.type === 'sandbox_policy_decision').decisionId);
});

test('proxy: AST06 source event fails open (logDecision throw does not block the caller)', async () => {
  const proxy = new ToolObservationProxy({
    auditLogger: {
      logDecision: async () => { throw new Error('SIMULATED_AUDIT_FAILURE'); }
    },
    enableAST06Annotation: true
  });
  // The proxy MUST NOT throw — ADR-040 fail-open.
  const result = await proxy.observeSandboxDecision({
    toolId: 'exec',
    target: '/etc/shadow',
    sandboxProfile: 'agent-default',
    requestedNamespace: 'agent-ns-1',
    effectiveNamespace: 'host',
    outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: blocked' }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.observation.outcome.success, false);
});

// ============================================================================
// (3) AST08 source event — written when enableAST08Annotation=true
// ============================================================================

test('proxy: enableAST08Annotation=true writes a skill_scan_result source event', async () => {
  const { proxy, auditLogger } = buildProxy({ enableAST08Annotation: true });
  // Inject a fake scanner (SkillSpector default with no executable
  // → 'unavailable'). The audit chain still records the source
  // event; the policy decision is fail-closed.
  const result = await proxy.observeSkillActivation({
    skillId: 'unavailable/skill',
    artifactPath: '/tmp/skill.skill',
    artifactHash: 'b'.repeat(64),
    manifest: {}
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'SCAN_UNAVAILABLE');
  assert.equal(result.scanResult.verdict, 'unavailable');
  // The audit chain records the source event regardless of the
  // policy decision — denying a skill is itself evidence worth
  // recording.
  assert.equal(auditLogger.decisions.length, 1);
  const source = auditLogger.decisions[0];
  assert.equal(source.action.type, 'skill_scan_result');
  assert.equal(source.action.target, 'unavailable/skill');
  assert.equal(source.action.parameters.verdict, 'unavailable');
});

test('proxy: AST08 + AST10 cascade — when both toggles are ON, the source event is annotated as skill-scan-finding (when verdict triggers it)', async () => {
  // Inject a fake scanner that returns FINDINGS so the AST10 mapper
  // produces an AST08 annotation.
  const fakeScanner = {
    async scan() {
      return {
        scanner: 'fake',
        scannerVersion: 'fake-v1',
        rulesetVersion: 'fake-ruleset-1',
        artifactHash: 'c'.repeat(64),
        verdict: 'findings',
        findings: [{ id: 'F1', kind: 'suspicious-eval', severity: 'medium', message: 'eval of user input' }],
        status: 'ok',
        scannedAt: '2026-07-14T00:00:00.000Z',
        fromCache: false
      };
    }
  };
  const { proxy, auditLogger } = buildProxy({
    enableAST08Annotation: true,
    enableAST10Annotation: true,
    skillScanner: fakeScanner
  });
  const result = await proxy.observeSkillActivation({
    skillId: 'openclaw/skill-x',
    artifactPath: '/tmp/skill.skill',
    artifactHash: 'c'.repeat(64),
    manifest: {}
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'SCAN_FINDINGS');
  // Two records: source event + AST08 annotation
  assert.equal(auditLogger.decisions.length, 2);
  const types = auditLogger.decisions.map((d) => d.action.type).sort();
  assert.deepEqual(types, ['ast10_annotation', 'skill_scan_result']);
  const annotation = auditLogger.decisions.find((d) => d.action.type === 'ast10_annotation');
  assert.equal(annotation.action.target, 'AST08');
  assert.equal(annotation.action.reason, 'skill-scan-finding');
  assert.equal(annotation.parentDecisionId, auditLogger.decisions.find((d) => d.action.type === 'skill_scan_result').decisionId);
});

test('proxy: AST08 fail-closed — scanner unavailable on a new/untrusted skill refuses activation', async () => {
  const { proxy } = buildProxy({ enableAST08Annotation: true });
  const result = await proxy.observeSkillActivation({
    skillId: 'new-skill',
    artifactPath: '/tmp/new-skill.skill',
    artifactHash: 'd'.repeat(64),
    manifest: {} // no publisher identity, not on allowlist
  });
  assert.equal(result.allowed, false, 'AST08 must be fail-closed for new/untrusted skills when scanner is unavailable');
  assert.equal(result.reason, 'SCAN_UNAVAILABLE');
});

test('proxy: AST08 allowFindings=true — a FINDINGS scan does NOT refuse activation when the caller opts in', async () => {
  const fakeScanner = {
    async scan() {
      return {
        scanner: 'fake',
        scannerVersion: 'fake-v1',
        rulesetVersion: 'fake-ruleset-1',
        artifactHash: 'e'.repeat(64),
        verdict: 'findings',
        findings: [{ id: 'F1', kind: 'low-severity', severity: 'low', message: 'minor' }],
        status: 'ok',
        scannedAt: '2026-07-14T00:00:00.000Z',
        fromCache: false
      };
    }
  };
  const { proxy } = buildProxy({
    enableAST08Annotation: true,
    skillScanner: fakeScanner
  });
  const result = await proxy.observeSkillActivation({
    skillId: 'low-severity-skill',
    artifactPath: '/tmp/skill.skill',
    artifactHash: 'e'.repeat(64),
    manifest: {},
    activationPolicy: { allowFindings: true }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.scanResult.verdict, 'findings');
});

test('proxy: AST08 source event fails open (logDecision throw does not change the policy decision)', async () => {
  const fakeScanner = {
    async scan() {
      return {
        scanner: 'fake',
        scannerVersion: 'fake-v1',
        rulesetVersion: 'fake-ruleset-1',
        artifactHash: 'f'.repeat(64),
        verdict: 'clean',
        findings: [],
        status: 'ok',
        scannedAt: '2026-07-14T00:00:00.000Z',
        fromCache: false
      };
    }
  };
  const proxy = new ToolObservationProxy({
    auditLogger: {
      logDecision: async () => { throw new Error('SIMULATED_AUDIT_FAILURE'); }
    },
    enableAST08Annotation: true,
    skillScanner: fakeScanner
  });
  const result = await proxy.observeSkillActivation({
    skillId: 'clean/skill',
    artifactPath: '/tmp/skill.skill',
    artifactHash: 'f'.repeat(64),
    manifest: {}
  });
  assert.equal(result.allowed, true, 'CLEAN scan + audit-log failure → activation still allowed (fail-open)');
  assert.equal(result.scanResult.verdict, 'clean');
});

// ============================================================================
// (4) Contract violations — defensive typechecks
// ============================================================================

test('proxy: observeSandboxDecision rejects a non-object input', async () => {
  const { proxy } = buildProxy({ enableAST06Annotation: true });
  await assert.rejects(
    () => proxy.observeSandboxDecision(null),
    /requires a decision object/
  );
});

test('proxy: observeSkillActivation rejects a missing artifactHash', async () => {
  const { proxy } = buildProxy({ enableAST08Annotation: true });
  await assert.rejects(
    () => proxy.observeSkillActivation({ artifactPath: '/tmp/x' }),
    /artifactHash/
  );
});

test('proxy: observeSkillActivation rejects a missing artifactPath', async () => {
  const { proxy } = buildProxy({ enableAST08Annotation: true });
  await assert.rejects(
    () => proxy.observeSkillActivation({ artifactHash: 'a'.repeat(64) }),
    /artifactPath/
  );
});