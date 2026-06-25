// test/unit/api/user-pbkdf2.test.js
// SC-HIGH-006 regression guard: User.js PBKDF2 iteration count must be ≥100k.
//
// Why: OWASP 2023 password-storage cheat sheet recommends ≥600k iterations for
// PBKDF2-SHA256 (or ≥100k for SHA-512 due to higher per-iteration cost). The
// pre-fix User.js used 10k, which is brute-forceable on consumer GPUs in
// hours. Agent.js already used 100k — this test catches any regression to a
// weaker value in User.js.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// SC-HIGH-006 regression guard: User.js PBKDF2 iteration count must be ≥100k.
//
// Why: OWASP 2023 password-storage cheat sheet recommends ≥600k iterations for
// PBKDF2-SHA256 (or ≥100k for SHA-512 due to higher per-iteration cost). The
// pre-fix User.js used 10k, which is brute-forceable on consumer GPUs in
// hours. Agent.js already used 100k — this test catches any regression to a
// weaker value in User.js by statically reading the iteration count from the
// source. Timing-based assertions are unreliable across hardware.

const User = require('../../../src/api/models/User.js');
const userSrc = fs.readFileSync(
  path.join(__dirname, '../../../src/api/models/User.js'),
  'utf8'
);

test('User.hashPassword source uses ≥100k PBKDF2 iterations (SC-HIGH-006)', () => {
  const match = userSrc.match(/pbkdf2Sync\([^)]*?,\s*(\d+)\s*,\s*\d+\s*,\s*['"]sha512['"]\s*\)/);
  assert.ok(match, 'could not locate pbkdf2Sync call in User.js');
  const iterations = parseInt(match[1], 10);
  assert.ok(
    iterations >= 100000,
    `User.hashPassword uses ${iterations} iterations — must be ≥100000 (SC-HIGH-006 regression)`
  );
});

test('User.hashPassword is deterministic for the same salt', () => {
  const salt = 'deadbeef'.repeat(8); // 64 hex chars = 32 bytes
  const a = User.hashPassword('p4ssw0rd!', salt);
  const b = User.hashPassword('p4ssw0rd!', salt);
  assert.strictEqual(a, b);
});

test('User.hashPassword differs across salts', () => {
  const a = User.hashPassword('p4ssw0rd!', 'a'.repeat(64));
  const b = User.hashPassword('p4ssw0rd!', 'b'.repeat(64));
  assert.notStrictEqual(a, b);
});

test('User.validatePassword accepts the right password and rejects the wrong one (SC-HIGH-006)', () => {
  const salt = User.generateSalt();
  const hash = User.hashPassword('correct password', salt);
  assert.strictEqual(User.validatePassword('correct password', salt, hash), true);
  assert.strictEqual(User.validatePassword('wrong password', salt, hash), false);
});
