// SC-MOD-015 (security audit 2026-06-25, B-step): 5 route files exist
// in src/api/routes/ but were never mounted in src/api/index.js. Two
// (compliance.js, tools.js) export Express routers and mount as-is.
// Three (identity-v2.js, audit.js, hot-reload-policies.js) export
// collections of route handlers and need adapter wrappers. The audit
// notes that a single ~2h Coder task closes 4 highs at once
// (AR-HIGH-001, RP-HIGH-001 partial, MR-008, SC-MOD-015).
//
// We verify the mount by static analysis of src/api/index.js: each
// of the 5 previously-orphaned route files must be wired up via
// `this.app.use('/api/<mountpoint>', ...)`. Static analysis sidesteps
// the heavy module-load chain (Agent.js + auth.js call process.exit(1)
// on missing/short SECRET_KEY) so the test stays fast and deterministic.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiIndexSource = fs.readFileSync(
  path.join(__dirname, '../../../src/api/index.js'),
  'utf8',
);

test('SC-MOD-015: compliance.js + tools.js are mounted (router exports)', () => {
  // Both were mounted in the previous session. Re-verify they remain
  // present after this session's changes.
  assert.match(
    apiIndexSource,
    /this\.app\.use\(['"]\/api\/compliance['"],\s*complianceRouter\)/,
    'complianceRouter must be mounted at /api/compliance',
  );
  assert.match(
    apiIndexSource,
    /this\.app\.use\(['"]\/api\/tools['"],\s*toolsRouter\)/,
    'toolsRouter must be mounted at /api/tools',
  );
});

test('SC-MOD-015: identity-v2.js is mounted (lazy-require adapter)', () => {
  // identity-v2.js exports { router, initializeServices, getServices }.
  // The fix uses a lazy-require adapter so the heavy module-load chain
  // (auth.js + Agent.js) doesn't crash the gateway at boot.
  assert.match(
    apiIndexSource,
    /this\.app\.use\(['"]\/api\/identity-v2['"]/,
    'identity-v2 must be mounted at /api/identity-v2',
  );
  assert.match(
    apiIndexSource,
    /require\(['"]\.\/routes\/identity-v2['"]\)/,
    'identity-v2 route file must be required (lazy inside the adapter)',
  );
  assert.match(
    apiIndexSource,
    /\btry\s*\{[\s\S]*?require\(['"]\.\/routes\/identity-v2['"]\)/,
    'identity-v2 require must be wrapped in try/catch for graceful failure',
  );
});

test('SC-MOD-015: audit.js is mounted via adapter (handlers, not router)', () => {
  // audit.js exports 5 route handlers. We wrap them in an Express
  // Router so the file's intended URLs (`/log`, `/chain/:decisionId`,
  // `/verify`, `/export`, `/records/:decisionId`) are reachable.
  assert.match(
    apiIndexSource,
    /this\.app\.use\(['"]\/api\/audit['"],\s*auditAdapter\)/,
    'auditAdapter must be mounted at /api/audit',
  );
  assert.match(
    apiIndexSource,
    /require\(['"]\.\/routes\/audit['"]\)/,
    'audit route file must be required',
  );
  // All 5 handlers must be wired up.
  for (const handler of [
    'logDecisionRoute',
    'getChainRoute',
    'verifyChainRoute',
    'exportChainRoute',
    'getRecordRoute',
  ]) {
    assert.match(
      apiIndexSource,
      new RegExp(`\\b${handler}\\b`),
      `audit handler ${handler} must be referenced in the adapter`,
    );
  }
});

test('SC-MOD-015: hot-reload-policies.js is mounted via adapter', () => {
  // hot-reload-policies.js exports 6 route handlers. We mount them at
  // /api/policies/hot/* so they don't collide with the existing
  // /api/policies router mounted on line 225.
  assert.match(
    apiIndexSource,
    /this\.app\.use\(['"]\/api\/policies\/hot['"],\s*policyAdapter\)/,
    'policyAdapter must be mounted at /api/policies/hot',
  );
  assert.match(
    apiIndexSource,
    /require\(['"]\.\/routes\/hot-reload-policies['"]\)/,
    'hot-reload-policies route file must be required',
  );
  // All 6 handlers must be wired up.
  for (const handler of [
    'validatePolicyRoute',
    'updatePolicyRoute',
    'listPoliciesRoute',
    'getPolicyRoute',
    'reloadPolicyRoute',
    'getPolicyHistoryRoute',
  ]) {
    assert.match(
      apiIndexSource,
      new RegExp(`\\b${handler}\\b`),
      `policy handler ${handler} must be referenced in the adapter`,
    );
  }
});

test('SC-MOD-015: all 5 sentinel-flagged route files are now mounted', () => {
  // Cross-check: every file path the audit listed in SC-MOD-015 must
  // appear in api/index.js at least once (imported OR mounted).
  const sentinelFiles = [
    'identity-v2',
    'audit',
    'hot-reload-policies',
    'compliance',
    'tools',
  ];
  for (const name of sentinelFiles) {
    assert.match(
      apiIndexSource,
      new RegExp(`routes/${name}`),
      `routes/${name} must appear in api/index.js`,
    );
  }
});
