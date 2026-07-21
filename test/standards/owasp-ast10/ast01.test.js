'use strict';

// AST01 — Skill Provenance & Supply Chain (per ADR-048 §5 / Rule 10).
//
// ADR-048 §5 closes the AST01 gap by introducing the AST01 rule
// `malicious-or-unproven-skill`. The rule fires on the SAME
// `skill_scan_result` source event as AST08 (Rule 9), but with a
// distinct classification: malicious content (verdict='malicious' OR
// finding.kind='malicious-content') OR unproven publisher provenance
// (verdict='unproven'). All four pinned fields (scanner,
// scannerVersion, rulesetVersion, artifactHash) are required for the
// annotation to fire.

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

describe('AST01 — Skill Provenance & Supply Chain', () => {
  test('maps a pinned MALICIOUS scan result to malicious-or-unproven-skill (AST01)', async () => {
    const scanner = 'skillspector';
    const scannerVersion = 'skillspector-v1.0.0';
    const rulesetVersion = 'ruleset-2026.07';
    const artifactHash = 'a'.repeat(64);
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'evil/skill',
        parameters: {
          scanner,
          scannerVersion,
          rulesetVersion,
          artifactHash,
          verdict: 'malicious',
          findings: [
            { id: 'M1', kind: 'malicious-content', severity: 'critical', message: 'dropper' }
          ]
        }
      }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const ast01 = annotations.find((a) => a.matchedClasses.includes('AST01'));
    assert.ok(ast01, 'AST01 must fire on a pinned MALICIOUS scan result');
    assert.equal(ast01.classification.rule, 'malicious-or-unproven-skill');
    assert.equal(ast01.classification.confidence, 'H');

    const ast01Decision = decisions.find((d) => d.action.target === 'AST01');
    assert.ok(ast01Decision, 'AST01 annotation must produce a sibling decision record');
    assertAnnotationShape(ast01, source, 'AST01', 'malicious-or-unproven-skill');
    assertDecisionShape(ast01Decision, source, 'AST01', 'malicious-or-unproven-skill');
    // Evidence fields MUST carry the pinned metadata for downstream
    // compliance reporting.
    assert.equal(ast01.evidence.scanner, scanner);
    assert.equal(ast01.evidence.scannerVersion, scannerVersion);
    assert.equal(ast01.evidence.rulesetVersion, rulesetVersion);
    assert.equal(ast01.evidence.artifactHash, artifactHash);
  });

  test('maps a pinned UNPROVEN scan result to malicious-or-unproven-skill (AST01)', async () => {
    const artifactHash = 'b'.repeat(64);
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'unproven/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash,
          verdict: 'unproven',
          findings: []
        }
      }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const ast01 = annotations.find((a) => a.matchedClasses.includes('AST01'));
    assert.ok(ast01, 'AST01 must fire on a pinned UNPROVEN scan result');
    assert.equal(ast01.classification.rule, 'malicious-or-unproven-skill');

    const ast01Decision = decisions.find((d) => d.action.target === 'AST01');
    assert.ok(ast01Decision, 'AST01 must produce a sibling decision record');
    assertAnnotationShape(ast01, source, 'AST01', 'malicious-or-unproven-skill');
    assertDecisionShape(ast01Decision, source, 'AST01', 'malicious-or-unproven-skill');
  });

  test('defence: AST01 does NOT fire when the scan result is UNAVAILABLE (operational signal only)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'unavailable/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'c'.repeat(64),
          verdict: 'unavailable',
          findings: []
        }
      }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST01'),
        `AST01 must NOT fire on UNAVAILABLE; got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST01 does NOT fire when the scan result is CLEAN (no malicious content, publisher on allowlist)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'clean/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'd'.repeat(64),
          verdict: 'clean',
          findings: []
        }
      }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST01'),
        `AST01 must NOT fire on CLEAN; got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST01 does NOT fire when any pinned field is missing (defence-in-depth)', async () => {
    // artifactHash missing
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'unpinned/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          // artifactHash MISSING
          verdict: 'malicious',
          findings: [{ id: 'M1', kind: 'malicious-content', severity: 'critical' }]
        }
      }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST01'),
        `AST01 must NOT fire when artifactHash is missing; got rule=${a.classification.rule}`);
    }
  });
});