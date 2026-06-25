// test/unit/scripts/audit-retention-cleanup.test.js
//
// C-step finding #17 (P1, AR-HIGH-002 — Audit log retention policy absent).
//
// Validates scripts/audit-retention-cleanup.js against a temp AUDIT_DIR:
//   - Records older than AWARE_AUDIT_RETENTION_DAYS are archived.
//   - Records newer than the retention window are kept live.
//   - The live chain is rewritten with re-computed hashes from GENESIS.
//   - The chain link from the kept partition back to the archived prefix
//     is intentionally broken (archive file is the old chain).
//   - Invalid AWARE_AUDIT_RETENTION_DAYS exits with code 2.
//   - Missing AUDIT_DIR is a no-op (idempotent).
//   - Empty chain is a no-op.
//
// The test runs the cleanup as a child process so the test can verify
// stdout contract + exit code AND inspect the resulting filesystem
// independently.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../../../scripts/audit-retention-cleanup.js');

// Build a synthetic decision chain that matches the live logger's
// canonical-serialization shape so the cleanup's hash recomputation
// agrees with what the chain would produce.
const FIELD_ORDER = [
  'action',
  'actor',
  'context',
  'decisionId',
  'outcome',
  'parentDecisionId',
  'prevHash',
  'timestamp',
];
const GENESIS_HASH = '0'.repeat(64);

function canonicalSerialize(record) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    if (key in record && key !== 'hash') ordered[key] = record[key];
  }
  return JSON.stringify(ordered);
}

function computeHash(record, prevHash) {
  return crypto.createHash('sha256')
    .update(canonicalSerialize(record) + prevHash, 'utf8')
    .digest('hex');
}

function buildRecord({ decisionId, parentDecisionId, timestamp, prevHash }) {
  const base = {
    decisionId,
    parentDecisionId: parentDecisionId || null,
    timestamp,
    actor: { agentId: 'test-agent', trustScore: 1.0 },
    action: { type: 'coordinate', target: 'aware-coordinator', reason: 'test' },
    context: { taskType: 'standard', K: null, sessionId: null },
    outcome: { success: true, latencyMs: 100, errorMessage: null },
  };
  const hash = computeHash(base, prevHash);
  return { ...base, prevHash, hash };
}

function makeTempAuditDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aware-audit-retention-'));
  return dir;
}

function writeChain(dir, records) {
  const file = path.join(dir, 'decision-chain.jsonl');
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function readChain(dir) {
  const file = path.join(dir, 'decision-chain.jsonl');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((l) => JSON.parse(l));
}

function listArchive(dir) {
  const archiveDir = path.join(dir, 'archive');
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir);
}

function runCleanup(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Behavior tests ────────────────────────────────────────────────────

test('retention: archives records older than the retention window', () => {
  const dir = makeTempAuditDir();
  try {
    const now = Date.now();
    const old = buildRecord({
      decisionId: 'old-1',
      timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(), // 100 days old
      prevHash: GENESIS_HASH,
    });
    const recent = buildRecord({
      decisionId: 'recent-1',
      timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day old
      prevHash: old.hash,
    });
    writeChain(dir, [old, recent]);

    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0, `cleanup failed: stderr=${result.stderr}`);
    assert.match(result.stdout, /archived 1 records/);

    const kept = readChain(dir);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].decisionId, 'recent-1');
    // The kept chain is re-hashed from GENESIS (chain link broken on purpose).
    assert.equal(kept[0].prevHash, GENESIS_HASH);
    // The hash itself is recomputed by the cleanup, not preserved.
    assert.notEqual(kept[0].hash, recent.hash);

    // Archive contains the old record.
    const archives = listArchive(dir);
    assert.equal(archives.length, 1);
    const archiveContent = fs.readFileSync(path.join(dir, 'archive', archives[0]), 'utf8');
    assert.match(archiveContent, /"decisionId":"old-1"/);
  } finally {
    removeDir(dir);
  }
});

test('retention: keeps chain untouched when nothing is expired', () => {
  const dir = makeTempAuditDir();
  try {
    const now = Date.now();
    const recent = buildRecord({
      decisionId: 'recent-1',
      timestamp: new Date(now - 1000).toISOString(),
      prevHash: GENESIS_HASH,
    });
    writeChain(dir, [recent]);

    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /none older than 30 days/);

    const kept = readChain(dir);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].decisionId, 'recent-1');
    // Untouched — same hash and prevHash as the input.
    assert.equal(kept[0].hash, recent.hash);
    assert.equal(kept[0].prevHash, recent.prevHash);
  } finally {
    removeDir(dir);
  }
});

test('retention: empty AUDIT_DIR is a no-op', () => {
  const dir = makeTempAuditDir(); // no chain file at all
  try {
    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /chain empty/);
  } finally {
    removeDir(dir);
  }
});

test('retention: missing AUDIT_DIR is a no-op (idempotent)', () => {
  const dir = makeTempAuditDir();
  removeDir(dir);
  const result = runCleanup({
    AUDIT_DIR: dir,
    AWARE_AUDIT_RETENTION_DAYS: '30',
    AWARE_DB_ENABLED: '0',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /AUDIT_DIR does not exist/);
});

test('retention: defaults to 2555 days when env var is unset', () => {
  const dir = makeTempAuditDir();
  try {
    const now = Date.now();
    const yearsOld = buildRecord({
      decisionId: 'years-1',
      timestamp: new Date(now - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 3 years old
      prevHash: GENESIS_HASH,
    });
    writeChain(dir, [yearsOld]);

    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '',  // empty → default
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0);
    // 3 years < 7 years → should NOT be archived
    assert.match(result.stdout, /none older than 2555 days/);
  } finally {
    removeDir(dir);
  }
});

test('retention: invalid retention value exits with code 2', () => {
  const dir = makeTempAuditDir();
  try {
    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: 'not-a-number',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /invalid AWARE_AUDIT_RETENTION_DAYS/);
  } finally {
    removeDir(dir);
  }
});

test('retention: negative retention value exits with code 2', () => {
  const dir = makeTempAuditDir();
  try {
    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '-1',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 2);
  } finally {
    removeDir(dir);
  }
});

test('retention: kept partition hash chain is internally consistent', () => {
  // After cleanup with multiple kept records, each record's hash should
  // be the cleanup's recomputation: canonicalSerialize(record) + prevHash.
  const dir = makeTempAuditDir();
  try {
    const now = Date.now();
    const old1 = buildRecord({
      decisionId: 'old-1',
      timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
      prevHash: GENESIS_HASH,
    });
    const kept1 = buildRecord({
      decisionId: 'kept-1',
      timestamp: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      prevHash: old1.hash,
    });
    const kept2 = buildRecord({
      decisionId: 'kept-2',
      timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
      prevHash: kept1.hash,
    });
    writeChain(dir, [old1, kept1, kept2]);

    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0);

    const kept = readChain(dir);
    assert.equal(kept.length, 2);
    // kept[0] starts from GENESIS, kept[1] chains from kept[0]'s recomputed hash.
    assert.equal(kept[0].prevHash, GENESIS_HASH);
    assert.equal(kept[1].prevHash, kept[0].hash);
    // And the recomputed hashes match what the canonical-serialize + sha256 produces.
    assert.equal(kept[0].hash, computeHash(kept[0], kept[0].prevHash));
    assert.equal(kept[1].hash, computeHash(kept[1], kept[1].prevHash));
  } finally {
    removeDir(dir);
  }
});

test('retention: idempotent — running twice archives no additional records', () => {
  const dir = makeTempAuditDir();
  try {
    const now = Date.now();
    const old = buildRecord({
      decisionId: 'old-1',
      timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
      prevHash: GENESIS_HASH,
    });
    writeChain(dir, [old]);

    const first = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(first.status, 0);

    const second = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(second.status, 0);
    // After run 1 archived everything, the live chain is empty. Run 2
    // is a true no-op. Either "chain empty" or "none older than 30 days"
    // is acceptable; both mean "did nothing wrong".
    assert.ok(
      /none older than 30 days/.test(second.stdout) || /chain empty/.test(second.stdout),
      `unexpected idempotent-run stdout: ${second.stdout}`,
    );

    // The archive file from the first run is still there but no new
    // records were appended (the live chain is empty after run 1).
    const kept = readChain(dir);
    assert.equal(kept.length, 0);
  } finally {
    removeDir(dir);
  }
});

test('retention: keeps records with unparseable timestamps (defensive)', () => {
  // A record with a bad timestamp shouldn't be silently dropped. The
  // cleanup keeps it (better than silent data loss).
  const dir = makeTempAuditDir();
  try {
    const record = {
      decisionId: 'bad-ts-1',
      parentDecisionId: null,
      timestamp: 'not-a-real-date',
      actor: { agentId: 'test', trustScore: 1.0 },
      action: { type: 'coordinate', target: 'aware-coordinator', reason: 'test' },
      context: { taskType: 'standard', K: null, sessionId: null },
      outcome: { success: true, latencyMs: 100, errorMessage: null },
      prevHash: GENESIS_HASH,
      hash: 'placeholder',
    };
    writeChain(dir, [record]);

    const result = runCleanup({
      AUDIT_DIR: dir,
      AWARE_AUDIT_RETENTION_DAYS: '30',
      AWARE_DB_ENABLED: '0',
    });
    assert.equal(result.status, 0);

    const kept = readChain(dir);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].decisionId, 'bad-ts-1');
  } finally {
    removeDir(dir);
  }
});
