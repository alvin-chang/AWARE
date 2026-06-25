// test/unit/scripts/seed-dev-users-production-guard.test.js
//
// SEC-005 : scripts/seed-dev-users.js
// must refuse to run when NODE_ENV=production. The seed users have
// predictable passwords (admin/user) with salts committed in source —
// running in production would create real accounts with known passwords.
//
// We test this by spawning the script as a child process with NODE_ENV=production
// and asserting it exits non-zero with the expected stderr message.
//
// This test is CJS (matches the rest of test/unit/**) and uses node:test.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'seed-dev-users.js');

test('SEC-005: seed-dev-users.js refuses to run with NODE_ENV=production', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(result.status, 0, `script exited ${result.status}, expected non-zero. stderr: ${result.stderr}`);
  assert.match(
    result.stderr,
    /cannot run in NODE_ENV=production/,
    'stderr should mention NODE_ENV=production'
  );
});

test('SEC-005: seed-dev-users.js exits with the SEC-005 citation', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.match(result.stderr, /SEC-005/, 'stderr should cite the SEC-005 finding');
});

test('SEC-005: seed-dev-users.js runs in development mode (NODE_ENV unset)', () => {
  // We only assert that the script *runs* — it may write a users.json
  // file or fail for other reasons (e.g. the data dir is read-only in
  // the test env). The contract we care about is "doesn't refuse on
  // NODE_ENV absence", so exit code 0 OR a non-production-related error
  // are both acceptable.
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, NODE_ENV: undefined },
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status !== 0) {
    // Make sure the failure is NOT the production guard
    assert.doesNotMatch(
      result.stderr || '',
      /cannot run in NODE_ENV=production/,
      `script failed in dev mode: ${result.stderr}`
    );
  }
});
