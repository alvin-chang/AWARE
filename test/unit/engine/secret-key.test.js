// test/unit/engine/secret-key.test.js
//
// SC-CRITICAL-001 (security audit 2026-06-25): the AWAREEngine
// constructor previously failed open with `|| 'default_secret'`, allowing
// a fresh deployment with no env vars to run with a publicly-known JWT
// signing key.
//
// This test exercises the extracted resolveSecretKey() helper in
// src/engine-secret.js — the validation rule has a single canonical home
// and is testable in isolation (without the AWAREEngine module-load chain,
// which has a pre-existing circular require with src/election that breaks
// module-load under `node --test`).
//
// The same regression is also covered in tests/integration/basic-integration.test.js
// at the integration level (jest).

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSecretKey, DEFAULT_MIN_LENGTH } = require('../../../src/engine-secret.js');

test('SC-CRITICAL-001: throws when neither config nor env provides a secret', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: undefined, envSecretKey: undefined }),
    /SECRET_KEY is required/,
    'must fail-closed when no secret is provided'
  );
});

test('SC-CRITICAL-001: throws when config secret is empty string', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: '', envSecretKey: undefined }),
    /SECRET_KEY is required/,
    'empty string must be treated as missing'
  );
});

test('SC-CRITICAL-001: throws when config secret is too short (5 chars)', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: 'short', envSecretKey: undefined }),
    /at least 32 characters/,
    'short secret must be rejected'
  );
});

test('SC-CRITICAL-001: throws when config secret is exactly 31 chars', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: 'a'.repeat(31), envSecretKey: undefined }),
    /at least 32 characters/,
    'boundary: 31 chars must fail'
  );
});

test('SC-CRITICAL-001: env secret used when config secret is absent', () => {
  const result = resolveSecretKey({
    configSecretKey: undefined,
    envSecretKey: 'a'.repeat(48),
  });
  assert.equal(result.length, 48);
});

test('SC-CRITICAL-001: config secret takes precedence over env secret', () => {
  const result = resolveSecretKey({
    configSecretKey: 'b'.repeat(48),
    envSecretKey: 'a'.repeat(48),
  });
  assert.equal(result, 'b'.repeat(48));
});

test('SC-CRITICAL-001: accepts a 32-char secretKey (boundary)', () => {
  const result = resolveSecretKey({ configSecretKey: 'a'.repeat(32) });
  assert.equal(result.length, 32);
});

test('SC-CRITICAL-001: accepts a long secret', () => {
  const result = resolveSecretKey({ configSecretKey: 'a'.repeat(128) });
  assert.equal(result.length, 128);
});

test('SC-CRITICAL-001: non-string config secret (e.g. number) is rejected', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: 12345, envSecretKey: undefined }),
    /SECRET_KEY is required/,
    'non-string secret must be rejected as missing'
  );
});

test('SC-CRITICAL-001: custom minLength is honored', () => {
  assert.throws(
    () => resolveSecretKey({ configSecretKey: 'a'.repeat(8), minLength: 16 }),
    /at least 16 characters/,
    'minLength override must be applied'
  );
  const result = resolveSecretKey({ configSecretKey: 'a'.repeat(16), minLength: 16 });
  assert.equal(result.length, 16);
});

test('SC-CRITICAL-001: DEFAULT_MIN_LENGTH is 32', () => {
  assert.equal(DEFAULT_MIN_LENGTH, 32);
});
