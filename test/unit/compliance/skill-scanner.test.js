// SPDX-License-Identifier: Apache-2.0
// test/unit/compliance/skill-scanner.test.js
//
// Unit tests for src/compliance/skill-scanner.js — the vendor-neutral
// skill-scanner adapter introduced by ADR-048 §5.
//
// Coverage targets:
//   (1) Pinning — the result ALWAYS carries scanner, scannerVersion,
//       rulesetVersion, and artifactHash. Even on failure paths.
//   (2) Verdict taxonomy — clean / findings / malicious / unproven /
//       unavailable / failed each have a distinct emit path. The
//       'unavailable' verdict NEVER carries findings (it's an
//       operational signal, not a scan result).
//   (3) Cache semantics — cached results are only served for
//       allowlisted + hash-verified artifacts. A cached result for a
//       non-allowlisted artifact is never served.
//   (4) Fail-closed activation policy — defaultActivationPolicy()
//       refuses to activate on 'unavailable', 'failed', 'malicious',
//       'unproven', and unknown verdicts.
//   (5) Integration with ast10-mapper — the scan result feeds
//       `skill_scan_result` source events; AST08 fires on
//       findings/malicious/failed; AST01 fires on malicious/unproven
//       or when any finding has kind='malicious-content'.
//   (6) Mapper-pinning contract — Rule 9 (AST08) and Rule 10 (AST01)
//       require all four pinned fields. Missing pinning means the
//       mapper refuses to emit an annotation (defence-in-depth:
//       an operator can never accidentally publish an unpinned
//       AST01/AST08 annotation).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  createSkillScanner,
  defaultActivationPolicy,
  VERDICT,
  DEFAULT_SCANNER,
  PINNED_SCANNER_VERSION,
  PINNED_RULESET_VERSION,
  createInMemoryCache
} = require('../../../src/compliance/skill-scanner');
const { createAST10Mapper, classify } = require('../../../src/compliance/ast10-mapper');

// ----------------------------------------------------------------------------
// Helpers — minimal "fake" backend that returns canned scan results.
// The scanner's adapter treats any backend with { probeVersion,
// scanArtifact, scanner } identically, so the fake can mimic
// SkillSpector, Cisco skill-scanner, or a custom YARA rule.
// ----------------------------------------------------------------------------

function fakeBackend({ probe = 'skillspector-v1.0.0', scanResults = [] } = {}) {
  let callIndex = 0;
  return {
    scanner: 'fake',
    probeVersion: async () => probe,
    scanArtifact: async () => {
      const next = scanResults[callIndex++];
      if (!next) return { ok: false, reason: 'no_more_fakes' };
      return next;
    }
  };
}

function makeScannerRequest(overrides = {}) {
  return Object.assign({
    artifactPath: '/tmp/fake-skill.skill',
    artifactHash: 'a'.repeat(64),
    manifest: { name: 'fake-skill', version: '1.0.0' }
  }, overrides);
}

// ============================================================================
// (1) Pinning
// ============================================================================

test('skill-scanner: scan result ALWAYS carries scanner + scannerVersion + rulesetVersion + artifactHash', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({ scanResults: [{ ok: true, raw: { findings: [] } }] })
  });
  const result = await scanner.scan(makeScannerRequest());

  assert.equal(result.scanner, 'fake');
  assert.equal(typeof result.scannerVersion, 'string');
  assert.equal(typeof result.rulesetVersion, 'string');
  assert.equal(typeof result.artifactHash, 'string');
  assert.equal(result.artifactHash, 'a'.repeat(64));
});

test('skill-scanner: defaults pin to the ADR-048 scanner/rulset versions when no override is provided', () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({ scanResults: [] })
  });
  assert.equal(scanner.scannerVersion, PINNED_SCANNER_VERSION);
  assert.equal(scanner.rulesetVersion, PINNED_RULESET_VERSION);
});

test('skill-scanner: operator can override the pinned versions (but must be explicit)', () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({ scanResults: [] }),
    scannerVersion: 'skillspector-v1.2.3-test',
    rulesetVersion: 'ruleset-2026.07-test'
  });
  assert.equal(scanner.scannerVersion, 'skillspector-v1.2.3-test');
  assert.equal(scanner.rulesetVersion, 'ruleset-2026.07-test');
});

test('skill-scanner: missing artifactHash is a contract violation (never inferred)', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({ scanResults: [{ ok: true, raw: {} }] })
  });
  await assert.rejects(
    () => scanner.scan({ artifactPath: '/x' }),
    /artifactHash/
  );
});

test('skill-scanner: missing artifactPath is a contract violation', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({ scanResults: [] })
  });
  await assert.rejects(
    () => scanner.scan({ artifactHash: 'a'.repeat(64) }),
    /artifactPath/
  );
});

// ============================================================================
// (2) Verdict taxonomy
// ============================================================================

test('skill-scanner: clean verdict emits when the backend returns no findings and publisher is on allowlist', async () => {
  const hash = 'b'.repeat(64);
  const scanner = createSkillScanner({
    allowlist: [hash],
    backend: fakeBackend({
      scanResults: [{
        ok: true,
        raw: {
          findings: [],
          manifest: { publisher: { identity: 'ed25519:abc' } }
        }
      }]
    })
  });
  const result = await scanner.scan(makeScannerRequest({ artifactHash: hash, manifest: { name: 'clean', publisher: { identity: 'ed25519:abc' } } }));
  assert.equal(result.verdict, VERDICT.CLEAN);
  assert.deepEqual(result.findings, []);
});

test('skill-scanner: findings verdict emits when the backend returns findings of severity<=high', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({
      scanResults: [{
        ok: true,
        raw: { findings: [{ id: 'S1', kind: 'suspicious-eval', severity: 'medium', message: 'eval of user input' }] }
      }]
    })
  });
  const result = await scanner.scan(makeScannerRequest());
  assert.equal(result.verdict, VERDICT.FINDINGS);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, 'S1');
});

test('skill-scanner: malicious verdict emits when a finding has kind=malicious-content', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({
      scanResults: [{
        ok: true,
        raw: { findings: [{ id: 'M1', kind: 'malicious-content', severity: 'critical', message: 'dropper detected' }] }
      }]
    })
  });
  const result = await scanner.scan(makeScannerRequest());
  assert.equal(result.verdict, VERDICT.MALICIOUS);
  assert.equal(result.findings[0].kind, 'malicious-content');
});

test('skill-scanner: unproven verdict emits when no findings AND no publisher identity AND not on allowlist', async () => {
  const scanner = createSkillScanner({
    allowlist: [], // empty allowlist → unproven for unpinned
    backend: fakeBackend({ scanResults: [{ ok: true, raw: { findings: [] } }] })
  });
  const result = await scanner.scan(makeScannerRequest({ manifest: { name: 'unpinned' } }));
  assert.equal(result.verdict, VERDICT.UNPROVEN);
});

test('skill-scanner: unavailable verdict emits when the backend reports executable_not_configured', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({
      probe: null, // probeVersion returns null → probeState unavailable
      scanResults: []
    })
  });
  const result = await scanner.scan(makeScannerRequest());
  assert.equal(result.verdict, VERDICT.UNAVAILABLE);
  assert.equal(result.findings.length, 0, 'unavailable MUST NOT carry findings');
});

test('skill-scanner: failed verdict emits when the backend reports a runtime scan failure', async () => {
  const scanner = createSkillScanner({
    backend: fakeBackend({
      scanResults: [{ ok: false, reason: 'timeout' }]
    })
  });
  const result = await scanner.scan(makeScannerRequest());
  assert.equal(result.verdict, VERDICT.FAILED);
  assert.equal(result.findings.length, 0);
});

test('skill-scanner: healthHook fires exactly once per unavailable / failed result (NOT once per call when no failure)', async () => {
  const events = [];
  const scanner = createSkillScanner({
    backend: fakeBackend({
      scanResults: [{ ok: true, raw: { findings: [] } }]
    }),
    allowlist: ['a'.repeat(64)],
    healthHook: (e) => events.push(e)
  });
  await scanner.scan(makeScannerRequest({
    artifactHash: 'a'.repeat(64),
    manifest: { name: 'clean', publisher: { identity: 'ed25519:abc' } }
  }));
  // No failure → no healthHook events.
  assert.equal(events.length, 0);

  // Now scan with a backend that errors → healthHook fires once.
  const scanner2 = createSkillScanner({
    backend: fakeBackend({ scanResults: [{ ok: false, reason: 'timeout' }] }),
    healthHook: (e) => events.push(e)
  });
  await scanner2.scan(makeScannerRequest());
  const failed = events.filter((e) => e.reason === 'failed');
  assert.equal(failed.length, 1);
});

// ============================================================================
// (3) Cache semantics — only serve cached results when allowlisted +
//     hash-verified.
// ============================================================================

test('skill-scanner: cache HIT returns immediately when artifact is allowlisted AND hash matches', async () => {
  const hash = 'c'.repeat(64);
  const cache = createInMemoryCache();
  const scanner = createSkillScanner({
    allowlist: [hash],
    cache,
    backend: fakeBackend({ scanResults: [] }) // no actual scans — cache MUST serve
  });
  // First scan: backend would be invoked once if cache misses.
  // We pre-seed the cache via a manual set to simulate a prior scan.
  cache.set({
    scanner: scanner.scanner,
    scannerVersion: scanner.scannerVersion,
    rulesetVersion: scanner.rulesetVersion,
    artifactHash: hash,
    result: {
      scanner: scanner.scanner,
      scannerVersion: scanner.scannerVersion,
      rulesetVersion: scanner.rulesetVersion,
      artifactHash: hash,
      verdict: VERDICT.CLEAN,
      findings: [],
      status: 'ok',
      scannedAt: '2026-07-14T00:00:00.000Z'
    }
  });
  const result = await scanner.scan(makeScannerRequest({
    artifactHash: hash,
    manifest: { name: 'cached', publisher: { identity: 'ed25519:abc' } }
  }));
  assert.equal(result.verdict, VERDICT.CLEAN);
  assert.equal(result.fromCache, true);
});

test('skill-scanner: cache MISS when artifact is NOT on the allowlist (even if hash matches an entry)', async () => {
  const hash = 'd'.repeat(64);
  const cache = createInMemoryCache();
  // Pre-seed with a CLEAN result for `hash` BUT the scanner's allowlist does NOT include it.
  cache.set({
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: hash,
    result: {
      scanner: 'fake',
      scannerVersion: PINNED_SCANNER_VERSION,
      rulesetVersion: PINNED_RULESET_VERSION,
      artifactHash: hash,
      verdict: VERDICT.CLEAN,
      findings: [],
      status: 'ok',
      scannedAt: '2026-07-14T00:00:00.000Z'
    }
  });
  let backendInvoked = false;
  const scanner = createSkillScanner({
    allowlist: [], // NOT allowlisted
    cache,
    backend: {
      scanner: 'fake',
      probeVersion: async () => 'fake-v1',
      scanArtifact: async () => {
        backendInvoked = true;
        return { ok: true, raw: { findings: [] } };
      }
    }
  });
  await scanner.scan(makeScannerRequest({ artifactHash: hash }));
  assert.equal(backendInvoked, true, 'backend MUST be invoked when artifact is not allowlisted');
});

test('skill-scanner: never cache unavailable results (caller must re-attempt next time)', async () => {
  const scanner = createSkillScanner({
    allowlist: ['e'.repeat(64)],
    backend: fakeBackend({ probe: null, scanResults: [] })
  });
  await scanner.scan(makeScannerRequest({ artifactHash: 'e'.repeat(64) }));
  assert.equal(scanner.cache.size(), 0);
});

test('skill-scanner: never cache failed results (caller must re-attempt next time)', async () => {
  const scanner = createSkillScanner({
    allowlist: ['f'.repeat(64)],
    backend: fakeBackend({ scanResults: [{ ok: false, reason: 'timeout' }] })
  });
  await scanner.scan(makeScannerRequest({ artifactHash: 'f'.repeat(64) }));
  assert.equal(scanner.cache.size(), 0);
});

// ============================================================================
// (4) Fail-closed activation policy
// ============================================================================

test('activation policy: CLEAN → allowed', () => {
  const r = defaultActivationPolicy({ verdict: VERDICT.CLEAN, findings: [] });
  assert.equal(r.allowed, true);
});

test('activation policy: FINDINGS → allowed ONLY when opts.allowFindings=true', () => {
  const a = defaultActivationPolicy({ verdict: VERDICT.FINDINGS, findings: [{}] });
  assert.equal(a.allowed, false);
  assert.equal(a.reason, 'SCAN_FINDINGS');
  const b = defaultActivationPolicy({ verdict: VERDICT.FINDINGS, findings: [{}] }, { allowFindings: true });
  assert.equal(b.allowed, true);
});

test('activation policy: MALICIOUS → denied (no override)', () => {
  const r = defaultActivationPolicy({ verdict: VERDICT.MALICIOUS, findings: [{}] }, { allowFindings: true });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'SCAN_MALICIOUS');
});

test('activation policy: UNPROVEN → denied (fail-closed for unverified provenance)', () => {
  const r = defaultActivationPolicy({ verdict: VERDICT.UNPROVEN, findings: [] });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'SCAN_UNPROVEN');
});

test('activation policy: UNAVAILABLE → denied (fail-closed for scanner-unavailable on new/untrusted skills)', () => {
  const r = defaultActivationPolicy({ verdict: VERDICT.UNAVAILABLE, findings: [] });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'SCAN_UNAVAILABLE');
});

test('activation policy: FAILED → denied (fail-closed on scanner runtime failure)', () => {
  const r = defaultActivationPolicy({ verdict: VERDICT.FAILED, findings: [] });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'SCAN_FAILED');
});

test('activation policy: unknown verdict → denied (defence-in-depth)', () => {
  const r = defaultActivationPolicy({ verdict: 'wat', findings: [] });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'SCAN_UNKNOWN_VERDICT');
});

// ============================================================================
// (5) Integration with ast10-mapper — AST08 / AST01 rules fire on the
//     right scan-result events.
// ============================================================================

function scanResultEvent(scanResult) {
  return {
    decisionId: 'src-' + Math.random().toString(36).slice(2),
    parentDecisionId: null,
    timestamp: '2026-07-14T00:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: {
      type: 'skill_scan_result',
      target: 'fake-skill',
      parameters: {
        scanner: scanResult.scanner,
        scannerVersion: scanResult.scannerVersion,
        rulesetVersion: scanResult.rulesetVersion,
        artifactHash: scanResult.artifactHash,
        verdict: scanResult.verdict,
        findings: scanResult.findings
      }
    },
    context: { policyId: 'standards-fixture', policyVersion: '1' },
    outcome: { success: true, latencyMs: 1, errorMessage: null }
  };
}

test('integration: AST08 fires on a pinned FINDINGS scan result', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const scanResult = {
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: '1'.repeat(64),
    verdict: VERDICT.FINDINGS,
    findings: [{ id: 'F1', kind: 'suspicious-eval', severity: 'medium', message: 'eval' }]
  };
  const ann = classify(mapper, scanResultEvent(scanResult));
  const ast08 = ann.find((a) => a.matchedClasses.includes('AST08'));
  assert.ok(ast08, 'AST08 must fire on a pinned FINDINGS scan result');
  assert.equal(ast08.classification.rule, 'skill-scan-finding');
  assert.equal(ast08.evidence.scanner, 'fake');
  assert.equal(ast08.evidence.scannerVersion, PINNED_SCANNER_VERSION);
  assert.equal(ast08.evidence.artifactHash, '1'.repeat(64));
  assert.deepEqual(ast08.evidence.findingIds, ['F1']);
});

test('integration: AST08 fires on a pinned MALICIOUS scan result', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const scanResult = {
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: '2'.repeat(64),
    verdict: VERDICT.MALICIOUS,
    findings: [{ id: 'M1', kind: 'malicious-content', severity: 'critical', message: 'dropper' }]
  };
  const ann = classify(mapper, scanResultEvent(scanResult));
  const ast08 = ann.find((a) => a.matchedClasses.includes('AST08'));
  const ast01 = ann.find((a) => a.matchedClasses.includes('AST01'));
  assert.ok(ast08, 'AST08 must fire on a pinned MALICIOUS scan result');
  assert.ok(ast01, 'AST01 must ALSO fire on a pinned MALICIOUS scan result');
});

test('integration: AST01 fires on a pinned UNPROVEN scan result (no scanner finding, no publisher identity)', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const scanResult = {
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: '3'.repeat(64),
    verdict: VERDICT.UNPROVEN,
    findings: []
  };
  const ann = classify(mapper, scanResultEvent(scanResult));
  const ast01 = ann.find((a) => a.matchedClasses.includes('AST01'));
  const ast08 = ann.find((a) => a.matchedClasses.includes('AST08'));
  assert.ok(ast01, 'AST01 must fire on a pinned UNPROVEN scan result');
  assert.equal(ast01.classification.rule, 'malicious-or-unproven-skill');
  assert.equal(ast08, undefined, 'AST08 must NOT fire on UNPROVEN (no scanner findings to report)');
});

test('integration: AST08 NEVER fires on UNAVAILABLE (operational signal only)', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const scanResult = {
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: '4'.repeat(64),
    verdict: VERDICT.UNAVAILABLE,
    findings: []
  };
  const ann = classify(mapper, scanResultEvent(scanResult));
  for (const a of ann) {
    assert.ok(!a.matchedClasses.includes('AST08'),
      `AST08 must NOT fire on UNAVAILABLE; got rule=${a.classification.rule}`);
    assert.ok(!a.matchedClasses.includes('AST01'),
      `AST01 must NOT fire on UNAVAILABLE; got rule=${a.classification.rule}`);
  }
});

test('integration: AST08 NEVER fires on CLEAN (clean scans are not annotations)', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const scanResult = {
    scanner: 'fake',
    scannerVersion: PINNED_SCANNER_VERSION,
    rulesetVersion: PINNED_RULESET_VERSION,
    artifactHash: '5'.repeat(64),
    verdict: VERDICT.CLEAN,
    findings: []
  };
  const ann = classify(mapper, scanResultEvent(scanResult));
  for (const a of ann) {
    assert.ok(!a.matchedClasses.includes('AST08'),
      `AST08 must NOT fire on CLEAN; got rule=${a.classification.rule}`);
    assert.ok(!a.matchedClasses.includes('AST01'),
      `AST01 must NOT fire on CLEAN; got rule=${a.classification.rule}`);
  }
});

// ============================================================================
// (6) Mapper-pinning contract — Rule 9 / Rule 10 require all four
//     pinned fields. Missing pinning means the mapper refuses to
//     emit an annotation.
// ============================================================================

test('integration: AST08 does NOT fire when scannerVersion is missing (defence-in-depth)', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const event = {
    decisionId: 'src-unpinned-ast08',
    parentDecisionId: null,
    timestamp: '2026-07-14T00:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: {
      type: 'skill_scan_result',
      target: 'unpinned',
      parameters: {
        scanner: 'fake',
        // scannerVersion MISSING
        rulesetVersion: PINNED_RULESET_VERSION,
        artifactHash: '6'.repeat(64),
        verdict: VERDICT.FINDINGS,
        findings: [{ id: 'X', kind: 'suspicious-eval', severity: 'low' }]
      }
    },
    context: { policyId: 'p', policyVersion: '1' },
    outcome: { success: true }
  };
  const ann = classify(mapper, event);
  for (const a of ann) {
    assert.ok(!a.matchedClasses.includes('AST08'),
      `AST08 must NOT fire when scannerVersion is missing; got rule=${a.classification.rule}`);
  }
});

test('integration: AST01 does NOT fire when artifactHash is missing (defence-in-depth)', () => {
  const mapper = createAST10Mapper({ enableWrites: false });
  const event = {
    decisionId: 'src-unpinned-ast01',
    parentDecisionId: null,
    timestamp: '2026-07-14T00:00:00.000Z',
    actor: { agentId: 'agent-1' },
    action: {
      type: 'skill_scan_result',
      target: 'unpinned',
      parameters: {
        scanner: 'fake',
        scannerVersion: PINNED_SCANNER_VERSION,
        rulesetVersion: PINNED_RULESET_VERSION,
        // artifactHash MISSING
        verdict: VERDICT.MALICIOUS,
        findings: [{ id: 'Y', kind: 'malicious-content', severity: 'critical' }]
      }
    },
    context: { policyId: 'p', policyVersion: '1' },
    outcome: { success: true }
  };
  const ann = classify(mapper, event);
  for (const a of ann) {
    assert.ok(!a.matchedClasses.includes('AST01'),
      `AST01 must NOT fire when artifactHash is missing; got rule=${a.classification.rule}`);
  }
});

// ============================================================================
// (7) DEFAULT_SCANNER constant — exported for downstream consumers
//     (SkillActivationGate, decision-logger context fields).
// ============================================================================

test('module exports: DEFAULT_SCANNER is "skillspector" (per ADR-048 §5 first-implementation choice)', () => {
  assert.equal(DEFAULT_SCANNER, 'skillspector');
});