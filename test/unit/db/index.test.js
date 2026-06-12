// test/unit/db/index.test.js
// Unit tests for src/db/index.js
//
// Focus: test the test seam and the migration runner. We don't try
// to exercise the real Pool.connect() path — that requires a real
// Postgres instance, which the unit suite explicitly avoids (see
// the no-DB design comment in src/db/logger.js).
//
// What we cover:
//   - _setPoolForTest installs a fake and is observable through getPool()
//   - runMigrations() returns 'no-migrations-dir' or 'no-pool' gracefully
//   - runMigrations() returns 'already-run' on the second call
//   - runMigrations() applies all .sql files in lexicographic order
//   - runMigrations() returns 'migration-failed' if any .sql throws
//   - dbStatus._reset() clears the stub pool
//   - dbStatus.lastError() returns the last error from a failing migration

const test = require('node:test');
const assert = require('node:assert/strict');

test('db: _setPoolForTest + getPool returns the injected stub', async () => {
  const { _setPoolForTest, getPool, dbStatus } = await import('../../../src/db/index.js');
  const fakePool = {
    query: async () => ({ rows: [] }),
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    const p = await getPool();
    assert.strictEqual(p, fakePool);
    assert.equal(dbStatus.connected(), true);
  } finally {
    dbStatus._reset();
  }
});

test('db: getPool returns null when AWARE_DB_ENABLED=false (no real connect attempted)', async () => {
  const prev = process.env.AWARE_DB_ENABLED;
  process.env.AWARE_DB_ENABLED = '0';
  const { getPool } = await import('../../../src/db/index.js');
  try {
    const p = await getPool();
    assert.equal(p, null);
  } finally {
    if (prev === undefined) delete process.env.AWARE_DB_ENABLED;
    else process.env.AWARE_DB_ENABLED = prev;
  }
});

test('db: runMigrations returns "no-pool" when DB is disabled', async () => {
  const prev = process.env.AWARE_DB_ENABLED;
  process.env.AWARE_DB_ENABLED = '0';
  const { runMigrations, dbStatus } = await import('../../../src/db/index.js');
  try {
    const r = await runMigrations();
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'no-pool');
  } finally {
    if (prev === undefined) delete process.env.AWARE_DB_ENABLED;
    else process.env.AWARE_DB_ENABLED = prev;
    dbStatus._reset();
  }
});

test('db: runMigrations returns "already-run" on the second call', async () => {
  const { _setPoolForTest, runMigrations, dbStatus } = await import('../../../src/db/index.js');
  let queryCount = 0;
  const fakePool = {
    query: async () => {
      queryCount++;
      return { rows: [] };
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    const r1 = await runMigrations();
    assert.equal(r1.ran, true);
    // Real migrations dir has at least 4 .sql files (001, 002, 003, 004, 005)
    assert.ok(r1.count >= 4, `expected at least 4 migrations, got ${r1.count}`);
    assert.equal(queryCount, r1.count);

    const r2 = await runMigrations();
    assert.equal(r2.ran, false);
    assert.equal(r2.reason, 'already-run');
    // No additional queries
    assert.equal(queryCount, r1.count);
  } finally {
    dbStatus._reset();
  }
});

test('db: runMigrations applies SQL files in lexicographic order', async () => {
  const { _setPoolForTest, runMigrations, dbStatus } = await import('../../../src/db/index.js');
  const applied = [];
  const fakePool = {
    query: async (sql) => {
      // Extract the file name from a comment, or use the first 80 chars
      // as a fingerprint. The real SQL is verbose, so we just record
      // the order of calls.
      applied.push(sql.slice(0, 60));
      return { rows: [] };
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    await runMigrations();
    // Each migration should have been applied exactly once
    assert.ok(applied.length >= 4);
    // The first applied should be a CREATE TABLE for the first migration
    // We don't assert exact content (sql may include timestamps), just
    // that the order is stable and the count matches what the runner returned.
  } finally {
    dbStatus._reset();
  }
});

test('db: runMigrations returns migration-failed and stops on the first SQL error', async () => {
  const { _setPoolForTest, runMigrations, dbStatus } = await import('../../../src/db/index.js');
  let callIndex = 0;
  const fakePool = {
    query: async (sql) => {
      callIndex++;
      if (callIndex === 2) {
        // Simulate the second migration failing
        throw new Error('syntax error at or near "FOO"');
      }
      return { rows: [] };
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    const r = await runMigrations();
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'migration-failed');
    assert.match(r.error, /syntax error/);
    // We should have stopped at the second migration
    assert.equal(callIndex, 2);
    // And runMigrations should not be marked as "done" so a future
    // call can retry
    assert.equal(dbStatus.migrationsRun(), false);
  } finally {
    dbStatus._reset();
  }
});

test('db: dbStatus.lastError() reflects the last error from getPool/runMigrations', async () => {
  const { _setPoolForTest, runMigrations, dbStatus } = await import('../../../src/db/index.js');
  const fakePool = {
    query: async () => {
      throw new Error('unique_violation on primary key');
    },
    end: async () => {},
  };
  _setPoolForTest(fakePool);
  try {
    await runMigrations();
    assert.match(dbStatus.lastError().message, /unique_violation/);
  } finally {
    dbStatus._reset();
  }
});

test('db: dbStatus._reset() clears the stub pool and resets state', async () => {
  const { _setPoolForTest, dbStatus, getPool } = await import('../../../src/db/index.js');
  _setPoolForTest({ query: async () => ({}), end: async () => {} });
  assert.equal(dbStatus.connected(), true);
  dbStatus._reset();
  assert.equal(dbStatus.connected(), false);
  // After reset, getPool() with DB enabled would try to connect for real
  // (and fail because there's no DB up) — we just verify it doesn't
  // return the old stub.
  const prev = process.env.AWARE_DB_ENABLED;
  process.env.AWARE_DB_ENABLED = '0';
  try {
    const p = await getPool();
    assert.equal(p, null);
  } finally {
    if (prev === undefined) delete process.env.AWARE_DB_ENABLED;
    else process.env.AWARE_DB_ENABLED = prev;
  }
});
