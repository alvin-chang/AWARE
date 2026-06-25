// test/unit/api/compliance-access-control.test.js
// SC-HIGH-008 regression guard: compliance-access-control middleware
// MUST NOT trust x-compliance-role from request headers. The role must
// only come from req.user.complianceRole (populated by upstream JWT/session).
//
// Without this guard, an attacker can set `x-compliance-role: compliance-admin`
// and gain admin permissions on any compliance API.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('SC-HIGH-008: middleware ignores x-compliance-role header', async () => {
  const url = pathToFileURL(
    path.join(__dirname, '../../../src/api/middleware/compliance-access-control.js')
  ).href;
  const mod = await import(url);

  // Create a fake request that ONLY has the spoofable header, no req.user.
  // Before the fix: this would have been treated as 'compliance-admin' or
  // 'executive' (high-privilege default). After the fix: defaults to
  // 'auditor' (lowest privilege) and any admin-only permission check fails.
  const calls = [];
  const req = {
    headers: { 'x-compliance-role': 'compliance-admin' },
    user: undefined,
  };
  const res = {
    status: () => ({ json: (v) => { calls.push(v); return res; } }),
    json: (v) => { calls.push(v); return res; },
  };
  const next = () => { calls.push('NEXT'); };

  // 'compliance:admin' is admin-only — should be DENIED for an
  // unauthenticated request that tries to spoof via header.
  const middleware = mod.createComplianceAccessControl('compliance:admin');
  middleware(req, res, next);

  // The middleware should NOT have called next(); it should have responded
  // with 403 PERMISSION_DENIED.
  assert.strictEqual(calls[0]?.reason, 'PERMISSION_DENIED',
    `expected PERMISSION_DENIED, got ${JSON.stringify(calls[0])}`);
});

test('SC-HIGH-008: middleware honors req.user.complianceRole when set', async () => {
  const url = pathToFileURL(
    path.join(__dirname, '../../../src/api/middleware/compliance-access-control.js')
  ).href;
  const mod = await import(url);

  const calls = [];
  const req = {
    headers: { 'x-compliance-role': 'auditor' }, // trying to override DOWN to auditor
    user: { complianceRole: 'compliance-admin', agentId: 'a1' },
  };
  const res = {
    status: () => ({ json: (v) => { calls.push(v); return res; } }),
    json: (v) => { calls.push(v); return res; },
  };
  const next = () => { calls.push('NEXT'); };

  const middleware = mod.createComplianceAccessControl('compliance:admin');
  middleware(req, res, next);

  // Should have called next() because req.user says compliance-admin
  assert.strictEqual(calls[0], 'NEXT', `expected NEXT, got ${JSON.stringify(calls[0])}`);
});

test('SC-HIGH-008: header tries to OVERRIDE DOWN — header is ignored', async () => {
  const url = pathToFileURL(
    path.join(__dirname, '../../../src/api/middleware/compliance-access-control.js')
  ).href;
  const mod = await import(url);

  // Authenticated as compliance-admin, but header says auditor.
  // The header MUST NOT downgrade the user's role.
  const calls = [];
  const req = {
    headers: { 'x-compliance-role': 'auditor' },
    user: { complianceRole: 'compliance-admin', agentId: 'a2' },
  };
  const res = {
    status: () => ({ json: (v) => { calls.push(v); return res; } }),
    json: (v) => { calls.push(v); return res; },
  };
  const next = () => { calls.push('NEXT'); };

  const middleware = mod.createComplianceAccessControl('compliance:admin');
  middleware(req, res, next);

  assert.strictEqual(calls[0], 'NEXT',
    `header should not be able to downgrade role, got ${JSON.stringify(calls[0])}`);
});
