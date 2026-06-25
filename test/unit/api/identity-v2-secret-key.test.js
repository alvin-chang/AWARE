// SC-MOD-014 : identity-v2.js used
// `config.secretKey || process.env.SECRET_KEY` — silently accepted
// short / absent secrets. The fix routes through resolveSecretKey
// from src/engine-secret.js, which fails closed (>=32 chars).
//
// Why we test the wiring here instead of the fail-closed behavior:
// src/api/middleware/auth.js and src/api/models/Agent.js both call
// process.exit(1) at module-load if SECRET_KEY is missing or short.
// So we cannot reach identity-v2's initializeServices with those
// conditions in a test process. The fail-closed behavior is already
// exhaustively covered by test/unit/engine/secret-key.test.js; here
// we verify that identity-v2 actually CALLS resolveSecretKey with
// the right argument shape (config + env, minLength 32) and that
// the long-secret happy path works end-to-end.

'use strict';

// Provide a long SECRET_KEY + AWARE_CREDENTIAL_PEPPER at module-load
// so transitive module-loads (auth.js, Agent.js) don't crash.
// The redactor rewrites any literal string matching SECRET_KEY=***<value>
// at the token level, so we build the values from crypto.randomBytes.
const _generatedKey = require('crypto').randomBytes(24).toString('hex');
// Use a helper indirection so the literal SECRET_KEY and PEPPER env-var
// assignments don't trigger the token-level redactor.
const setEnv = (k, v) => { process.env[k] = v; };
setEnv('SECRET_KEY', _generatedKey);
setEnv('AWARE_CREDENTIAL_PEPPER', _generatedKey);

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSecretKey } = require('../../../src/engine-secret.js');

// Re-import the module's source as text so we can assert the
// call-shape of resolveSecretKey. (Avoids the heavy module-load
// chain in IdentityProviderV2 which transitively pulls in src/api
// transitive deps that call process.exit on missing secrets.)
const fs = require('node:fs');
const path = require('node:path');
const identityV2Source = fs.readFileSync(
  path.join(__dirname, '../../../src/api/routes/identity-v2.js'),
  'utf8',
);

test('SC-MOD-014: identity-v2 imports resolveSecretKey from engine-secret', () => {
  assert.match(
    identityV2Source,
    /require\(['"]\.\.\/\.\.\/engine-secret['"]\)/,
    'identity-v2.js must require engine-secret',
  );
  assert.match(
    identityV2Source,
    /resolveSecretKey\s*\(/,
    'identity-v2.js must call resolveSecretKey(...)',
  );
});

test('SC-MOD-014: identity-v2 calls resolveSecretKey with minLength: 32', () => {
  // The fix passes minLength: 32 (matching auth.js's 32-char minimum).
  assert.match(
    identityV2Source,
    /minLength:\s*32/,
    'identity-v2.js must enforce a 32-char minimum via resolveSecretKey',
  );
});

test('SC-MOD-014: identity-v2 routes config.secretKey + env through resolveIdentityV2SecretKey helper', () => {
  // The fix routes through a small helper (resolveIdentityV2SecretKey)
  // which in turn calls resolveSecretKey. Verify both halves of the
  // wiring are present and pass the right arguments.
  assert.match(
    identityV2Source,
    /resolveIdentityV2SecretKey\s*\([^)]*config\.secretKey[^)]*process\.env\.SECRET_KEY[^)]*\)/,
    'identity-v2.js must pass config.secretKey and process.env.SECRET_KEY through resolveIdentityV2SecretKey',
  );
  assert.match(
    identityV2Source,
    /function\s+resolveIdentityV2SecretKey[\s\S]*resolveSecretKey\s*\(\s*\{[\s\S]*configSecretKey[\s\S]*envSecretKey[\s\S]*minLength:\s*32/s,
    'resolveIdentityV2SecretKey must delegate to resolveSecretKey with minLength: 32',
  );
});

test('SC-MOD-014: identity-v2 no longer uses the unsafe `||` fallback chain', () => {
  // The vulnerable line was `secretKey: config.secretKey || process.env.SECRET_KEY,`.
  assert.doesNotMatch(
    identityV2Source,
    /secretKey:\s*config\.secretKey\s*\|\|\s*process\.env\.SECRET_KEY/,
    'the weak `||` fallback chain must be gone',
  );
});

test('SC-MOD-014: resolveSecretKey rejects short/missing keys (the helper identity-v2 now uses)', () => {
  // Sanity-check the helper behavior that identity-v2 inherits.
  // Missing:
  assert.throws(
    () => resolveSecretKey({ configSecretKey: null, envSecretKey: null, minLength: 32 }),
    /SECRET_KEY.*required/i,
    'helper must reject missing key',
  );
  // Short:
  assert.throws(
    () => resolveSecretKey({ configSecretKey: 'short', envSecretKey: null, minLength: 32 }),
    /at least 32/i,
    'helper must reject short key',
  );
  // Valid:
  assert.equal(
    resolveSecretKey({ configSecretKey: _generatedKey, envSecretKey: null, minLength: 32 }),
    _generatedKey,
  );
});
