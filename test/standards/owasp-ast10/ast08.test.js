'use strict';

// AST08 — Skill Scanning / Reconnaissance (per ADR-048 §5 / Rule 9).
//
// ADR-048 §5 closes the AST08 gap by introducing a vendor-neutral
// skill-scanner adapter (`src/compliance/skill-scanner.js`,
// default backend = NVIDIA SkillSpector) and a mapper rule
// `skill-scan-finding`. The rule fires when the scanner returns a
// `skill_scan_result` source event with:
//   - verdict ∈ { 'findings', 'malicious', 'failed' } AND
//   - all four pinned fields present: scanner, scannerVersion,
//     rulesetVersion, artifactHash.
// CLEAN and UNAVAILABLE scans NEVER produce an AST08 annotation —
// CLEAN scans are positive evidence (no risk to report) and
// UNAVAILABLE is an operational health signal handled separately.

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

describe('AST08 — Skill Scanning / Reconnaissance', () => {
  test('maps a pinned FINDINGS scan result to skill-scan-finding (AST08)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'openclaw/skill-x',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'a'.repeat(64),
          verdict: 'findings',
          findings: [
            { id: 'F1', kind: 'suspicious-eval', severity: 'medium', message: 'eval of user input' }
          ]
        }
      }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const ast08 = annotations.find((a) => a.matchedClasses.includes('AST08'));
    assert.ok(ast08, 'AST08 must fire on a pinned FINDINGS scan result');
    assert.equal(ast08.classification.rule, 'skill-scan-finding');
    assert.equal(ast08.classification.confidence, 'H');

    const ast08Decision = decisions.find((d) => d.action.target === 'AST08');
    assert.ok(ast08Decision, 'AST08 must produce a sibling decision record');
    assertAnnotationShape(ast08, source, 'AST08', 'skill-scan-finding');
    assertDecisionShape(ast08Decision, source, 'AST08', 'skill-scan-finding');

    // Evidence MUST carry the pinned metadata for downstream
    // compliance reporting.
    assert.equal(ast08.evidence.scanner, 'skillspector');
    assert.equal(ast08.evidence.scannerVersion, 'skillspector-v1.0.0');
    assert.equal(ast08.evidence.rulesetVersion, 'ruleset-2026.07');
    assert.equal(ast08.evidence.artifactHash, 'a'.repeat(64));
    assert.deepEqual(ast08.evidence.findingIds, ['F1']);
    assert.deepEqual(ast08.evidence.findingSeverities, ['medium']);
  });

  test('maps a pinned MALICIOUS scan result to skill-scan-finding (AST08) AND malicious-or-unproven-skill (AST01)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'evil/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'b'.repeat(64),
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
    const ast08 = annotations.find((a) => a.matchedClasses.includes('AST08'));
    const ast01 = annotations.find((a) => a.matchedClasses.includes('AST01'));
    assert.ok(ast08, 'AST08 must fire on a pinned MALICIOUS scan result');
    assert.ok(ast01, 'AST01 must ALSO fire on a pinned MALICIOUS scan result (cross-class fan-out)');
    assert.equal(ast08.classification.rule, 'skill-scan-finding');
    assert.equal(ast01.classification.rule, 'malicious-or-unproven-skill');

    // Both annotations share the same parentDecisionId — they are
    // sibling records on the same source event.
    const ast08Decision = decisions.find((d) => d.action.target === 'AST08');
    const ast01Decision = decisions.find((d) => d.action.target === 'AST01');
    assert.ok(ast08Decision && ast01Decision, 'both annotations must produce sibling decision records');
    assert.equal(ast08Decision.parentDecisionId, source.decisionId);
    assert.equal(ast01Decision.parentDecisionId, source.decisionId);
    assert.notEqual(ast08Decision.decisionId, ast01Decision.decisionId,
      'AST08 and AST01 must have distinct decisionIds (chain integrity)');
  });

  test('maps a pinned FAILED scan result to skill-scan-finding (AST08)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'broken-scan/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'c'.repeat(64),
          verdict: 'failed',
          findings: []
        }
      }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    const ast08 = annotations.find((a) => a.matchedClasses.includes('AST08'));
    assert.ok(ast08, 'AST08 must fire on a pinned FAILED scan result');
    assert.equal(ast08.classification.rule, 'skill-scan-finding');
    const ast08Decision = decisions.find((d) => d.action.target === 'AST08');
    assert.ok(ast08Decision, 'AST08 must produce a sibling decision record');
    assertAnnotationShape(ast08, source, 'AST08', 'skill-scan-finding');
    assertDecisionShape(ast08Decision, source, 'AST08', 'skill-scan-finding');
  });

  test('defence: AST08 does NOT fire on a CLEAN scan result', async () => {
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
      assert.ok(!a.matchedClasses.includes('AST08'),
        `AST08 must NOT fire on CLEAN; got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST08 does NOT fire on an UNAVAILABLE scan result (operational signal only)', async () => {
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'unavailable/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          rulesetVersion: 'ruleset-2026.07',
          artifactHash: 'e'.repeat(64),
          verdict: 'unavailable',
          findings: []
        }
      }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST08'),
        `AST08 must NOT fire on UNAVAILABLE (operational signal only); got rule=${a.classification.rule}`);
    }
  });

  test('defence: AST08 does NOT fire when any pinned field is missing (defence-in-depth)', async () => {
    // rulesetVersion missing
    const source = sourceEvent({
      action: {
        type: 'skill_scan_result',
        target: 'unpinned/skill',
        parameters: {
          scanner: 'skillspector',
          scannerVersion: 'skillspector-v1.0.0',
          // rulesetVersion MISSING
          artifactHash: 'f'.repeat(64),
          verdict: 'findings',
          findings: [{ id: 'F1', kind: 'suspicious-eval', severity: 'low' }]
        }
      }
    });
    const { mapper } = capturingMapper();
    const { classifyAndLog } = loadMapper();
    const annotations = await classifyAndLog(mapper, source);
    for (const a of annotations) {
      assert.ok(!a.matchedClasses.includes('AST08'),
        `AST08 must NOT fire when rulesetVersion is missing; got rule=${a.classification.rule}`);
    }
  });
});