'use strict';

// AST06 — Sandbox & Isolation Failures (per ADR-048 §4 / Rule 8).
//
// ADR-048 §4 closes the AST06 gap by routing sandbox policy decisions
// through `ToolObservationProxy.observeSandboxDecision()` as first-
// class source events. The annotation rule
// `sandbox-boundary-violation` fires when:
//   (a) the source event's outcome.errorMessage starts with
//       `AWARE_SANDBOX_DENY:`, OR
//   (b) there is a verified requested/effective namespace mismatch
//       (and `allowMismatch` is not explicitly true).
//
// The proxy/mapper remain fail-open per ADR-040: a logDecision
// failure does NOT block the sandbox policy's own enforcement. The
// sandbox policy module retains its own fail policy — independent
// from the annotation path.

const {
  describe,
  test,
  assert,
  loadMapper,
  sourceEvent,
  capturingMapper,
  assertAnnotationShape,
  assertDecisionShape
} = require('./helpers');

describe('AST06 — Sandbox & Isolation Failures', () => {
  test('maps an AWARE_SANDBOX_DENY source event to sandbox-boundary-violation (AST06)', async () => {
    const source = sourceEvent({
      action: {
        type: 'sandbox_policy_decision',
        toolId: 'exec',
        target: '/usr/bin/curl',
        reason: 'AWARE_SANDBOX_DENY: namespace escape detected',
        parameters: {
          sandboxProfile: 'agent-default',
          requestedNamespace: 'agent-ns-1',
          effectiveNamespace: 'agent-ns-1',
          hostEscapeCapabilities: ['filesystem', 'network']
        }
      },
      outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: namespace escape detected' }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const ast06 = annotations.find((a) => a.matchedClasses.includes('AST06'));
    assert.ok(ast06, 'AST06 must fire on an AWARE_SANDBOX_DENY source event');
    assert.equal(ast06.classification.rule, 'sandbox-boundary-violation');
    assert.equal(ast06.classification.confidence, 'H');

    const ast06Decision = decisions.find((d) => d.action.target === 'AST06');
    assert.ok(ast06Decision, 'AST06 must produce a sibling decision record');
    assertAnnotationShape(ast06, source, 'AST06', 'sandbox-boundary-violation');
    assertDecisionShape(ast06Decision, source, 'AST06', 'sandbox-boundary-violation');

    // Evidence MUST carry the sandbox-profile fields (per ADR-048 §3
    // coverage-map row for AST06).
    assert.equal(ast06.evidence.sandboxProfile, 'agent-default');
    assert.equal(ast06.evidence.requestedNamespace, 'agent-ns-1');
    assert.equal(ast06.evidence.effectiveNamespace, 'agent-ns-1');
    assert.ok(Array.isArray(ast06.evidence.hostEscapeCapability));
    assert.ok(ast06.evidence.hostEscapeCapability.includes('filesystem'));
  });

  test('maps a verified requested/effective namespace mismatch to sandbox-boundary-violation (AST06)', async () => {
    const source = sourceEvent({
      action: {
        type: 'sandbox_policy_decision',
        toolId: 'write_file',
        target: '/etc/shadow',
        reason: 'sandbox-policy',
        parameters: {
          sandboxProfile: 'agent-default',
          requestedNamespace: 'agent-ns-1',
          effectiveNamespace: 'host', // MISMATCH
          hostEscapeCapabilities: ['filesystem']
        }
      },
      outcome: { success: true, errorMessage: null }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const ast06 = annotations.find((a) => a.matchedClasses.includes('AST06'));
    assert.ok(ast06, 'AST06 must fire on a verified namespace mismatch');
    assert.equal(ast06.classification.rule, 'sandbox-boundary-violation');
    assert.equal(ast06.evidence.requestedNamespace, 'agent-ns-1');
    assert.equal(ast06.evidence.effectiveNamespace, 'host');

    const ast06Decision = decisions.find((d) => d.action.target === 'AST06');
    assert.ok(ast06Decision, 'AST06 must produce a sibling decision record');
    assertAnnotationShape(ast06, source, 'AST06', 'sandbox-boundary-violation');
    assertDecisionShape(ast06Decision, source, 'AST06', 'sandbox-boundary-violation');
  });

  test('defence: AST06 does NOT fire on a clean sandbox-policy decision (no deny, no mismatch)', async () => {
    const source = sourceEvent({
      action: {
        type: 'sandbox_policy_decision',
        toolId: 'read_file',
        target: '/tmp/foo.txt',
        reason: 'sandbox-policy',
        parameters: {
          sandboxProfile: 'agent-default',
          requestedNamespace: 'agent-ns-1',
          effectiveNamespace: 'agent-ns-1', // MATCH
          hostEscapeCapabilities: []
        }
      },
      outcome: { success: true, errorMessage: null }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST06'),
        `AST06 must NOT fire on a clean sandbox-policy decision; got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST06 does NOT fire when the namespace mismatch is explicitly allowlisted (allowMismatch=true)', async () => {
    const source = sourceEvent({
      action: {
        type: 'sandbox_policy_decision',
        toolId: 'write_file',
        target: '/etc/shadow',
        reason: 'sandbox-policy',
        parameters: {
          sandboxProfile: 'agent-default',
          requestedNamespace: 'agent-ns-1',
          effectiveNamespace: 'host',
          hostEscapeCapabilities: [],
          allowMismatch: true // operator explicitly allowlisted the mismatch
        }
      },
      outcome: { success: true, errorMessage: null }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST06'),
        `AST06 must NOT fire when allowMismatch=true; got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST06 does NOT fire on tool_dispatch events (only sandbox_policy_decision events)', async () => {
    // Defence-in-depth: the rule must NOT be re-triggered by other
    // action types. Per ADR-048 §4, "Do not infer AST06 from generic
    // tool observations."
    const source = sourceEvent({
      action: {
        type: 'tool_dispatch',
        toolId: 'exec',
        target: '/etc/shadow',
        parameters: { command: 'cat /etc/shadow' }
      },
      outcome: { success: false, errorMessage: 'AWARE_SANDBOX_DENY: blocked' }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST06') || a.classification.rule !== 'sandbox-boundary-violation',
        `AST06 must NOT be inferred from tool_dispatch; got rule=${a.classification.rule}`);
    }
  });
});