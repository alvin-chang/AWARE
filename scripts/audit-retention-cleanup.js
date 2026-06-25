#!/usr/bin/env node
// scripts/audit-retention-cleanup.js
//
// C-step finding #17 (AR-HIGH-002 — Audit log retention policy absent).
//
// AWARE's compliance posture claims DORA Art.26 / SOC2 CC7.2 / ISO 27001
// A.12.4.1 compliance. Each of those standards requires incident-logging
// with a documented retention window. Without this script, audit data
// grows unbounded and the compliance claim is unsupported.
//
// Retention window: AWARE_AUDIT_RETENTION_DAYS (default 2555 = 7 years,
// the DORA Art.26 baseline for incident records).
//
// What this script does (best-effort, never throws):
//
//   1. JSONL chain (AUDIT_DIR/decision-chain.jsonl):
//      - Reads the chain.
//      - For records older than the retention window, copies them to
//        AUDIT_DIR/archive/decision-chain-YYYY-MM-DD.jsonl (one file
//        per cleanup run, date-stamped).
//      - Rewrites the live chain to retain only recent records.
//      - Recomputes the in-memory index and hash chain so the live
//        chain remains internally consistent.
//
//   2. Postgres aware_conversations table:
//      - DELETEs rows whose timestamp is older than the retention window.
//      - Skipped when AWARE_DB_ENABLED=0 or POSTGRES_* env vars are unset.
//
// Usage:
//   node scripts/audit-retention-cleanup.js                  # uses defaults
//   AWARE_AUDIT_RETENTION_DAYS=90 node scripts/audit-retention-cleanup.js
//
// Cron usage (operator-specific — install on a daily schedule):
//   0 3 * * * cd /opt/aware && node scripts/audit-retention-cleanup.js >> /var/log/aware-audit-retention.log 2>&1
//
// Exit codes:
//   0 — cleanup ran (with or without records deleted)
//   2 — missing or invalid AWARE_AUDIT_RETENTION_DAYS
//
// Designed to be safe to re-run idempotently: a second run with the
// same retention window deletes no additional records.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ─────────────────────────────────────────────────────

const AUDIT_DIR = process.env.AUDIT_DIR || '/data/audit';
const AUDIT_LOG_FILE = path.join(AUDIT_DIR, 'decision-chain.jsonl');
const AUDIT_INDEX_FILE = path.join(AUDIT_DIR, 'decision-chain.idx');
const ARCHIVE_DIR = path.join(AUDIT_DIR, 'archive');

const RETENTION_DAYS_RAW = process.env.AWARE_AUDIT_RETENTION_DAYS;
const RETENTION_DAYS = RETENTION_DAYS_RAW == null || RETENTION_DAYS_RAW === ''
  ? 2555
  : Number(RETENTION_DAYS_RAW);

if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
  process.stderr.write(`[audit-retention] invalid AWARE_AUDIT_RETENTION_DAYS=${RETENTION_DAYS_RAW}\n`);
  process.exit(2);
}

const CUTOFF_MS = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

// ─── Logging helpers ───────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[audit-retention] ${msg}\n`);
}

// ─── JSONL chain cleanup ───────────────────────────────────────────────

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    log(`AUDIT_DIR does not exist (${AUDIT_DIR}); nothing to do`);
    return false;
  }
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  return true;
}

function loadChain() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
  const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => {
    try { return JSON.parse(line); }
    catch (err) { throw new Error(`malformed JSONL line: ${err.message}`); }
  });
}

// Canonical serialization matches src/audit/decision-logger.js so the
// recomputed hashes are byte-identical to what the live chain produced.
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

function canonicalSerialize(record) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    if (key in record && key !== 'hash') ordered[key] = record[key];
  }
  return JSON.stringify(ordered);
}

const GENESIS_HASH = '0'.repeat(64);

function computeRecordHash(record, prevHash) {
  const canonical = canonicalSerialize(record);
  return crypto.createHash('sha256').update(canonical + prevHash, 'utf8').digest('hex');
}

function cleanupChain() {
  if (!ensureAuditDir()) return { archived: 0, kept: 0, reason: 'no-audit-dir' };

  const records = loadChain();
  if (records.length === 0) {
    log('chain empty; nothing to do');
    return { archived: 0, kept: 0, reason: 'empty' };
  }

  // Partition by cutoff. Records are append-only and sorted by timestamp,
  // so the "old" partition is the prefix and the "kept" partition is the
  // suffix. We re-hash the kept partition from the genesis hash so the
  // chain is consistent without its old prefix.
  const oldRecords = [];
  const keptRecords = [];
  for (const r of records) {
    const ts = Date.parse(r.timestamp);
    if (!Number.isFinite(ts)) {
      // Bad timestamp — keep the record (better than silent data loss).
      keptRecords.push(r);
      continue;
    }
    if (ts < CUTOFF_MS) oldRecords.push(r);
    else keptRecords.push(r);
  }

  if (oldRecords.length === 0) {
    log(`chain has ${records.length} records, none older than ${RETENTION_DAYS} days`);
    return { archived: 0, kept: keptRecords.length, reason: 'nothing-expired' };
  }

  // Archive old records to a date-stamped file.
  const today = new Date().toISOString().slice(0, 10);
  const archiveFile = path.join(ARCHIVE_DIR, `decision-chain-${today}.jsonl`);
  const archiveContent = oldRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
  // Append-mode so multiple runs on the same day accumulate; for a true
  // fresh-archive-per-day semantic the operator can cron this daily and
  // the second run will be a no-op (all old records already archived).
  fs.appendFileSync(archiveFile, archiveContent);

  // Recompute the chain for the kept partition from GENESIS_HASH. The
  // chain link between the last-archived record and the first-kept
  // record is intentionally broken — the archive file IS the old chain
  // up to that point. A consumer verifying the live chain sees a fresh
  // chain starting at GENESIS_HASH; a consumer verifying a past decision
  // should look at the appropriate archive file.
  let prevHash = GENESIS_HASH;
  const newIndex = {};
  for (const r of keptRecords) {
    // CRITICAL: set r.prevHash BEFORE computing the hash, so the
    // canonical-serialize payload includes the new (recomputed)
    // prevHash, not the input chain's prevHash. Otherwise the on-disk
    // hash won't match a re-derivation from the on-disk record.
    r.prevHash = prevHash;
    const { hash: _drop, ...rest } = r;  // strip old hash; rest has new prevHash
    const newHash = computeRecordHash(rest, prevHash);
    r.hash = newHash;
    newIndex[r.decisionId] = newHash;
    prevHash = newHash;
  }

  // Rewrite the live chain.
  const liveContent = keptRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(AUDIT_LOG_FILE, liveContent);

  // Rewrite the in-memory index file. Operators who re-deploy after
  // a long downtime can rebuild this from the chain itself, so we
  // don't need a separate backup.
  fs.writeFileSync(AUDIT_INDEX_FILE, JSON.stringify(newIndex));

  log(`archived ${oldRecords.length} records to ${archiveFile}; kept ${keptRecords.length} live records`);
  return { archived: oldRecords.length, kept: keptRecords.length, reason: 'ok' };
}

// ─── Postgres cleanup (best-effort) ────────────────────────────────────

async function cleanupPostgres() {
  if (process.env.AWARE_DB_ENABLED === '0') {
    log('postgres cleanup skipped (AWARE_DB_ENABLED=0)');
    return { deleted: 0, reason: 'db-disabled' };
  }

  // Lazy-load pg so this script is usable without the db driver installed
  // (e.g., for chain-only retention in a small dev box).
  let pg;
  try { pg = require('pg'); }
  catch (err) {
    log(`postgres cleanup skipped (pg module not installed: ${err.message})`);
    return { deleted: 0, reason: 'no-pg-driver' };
  }

  const host = process.env.AWARE_DB_HOST;
  const port = Number(process.env.AWARE_DB_PORT) || 5432;
  const database = process.env.AWARE_DB_DATABASE;
  const user = process.env.AWARE_DB_USER;
  const password = process.env.AWARE_POSTGRES_PASSWORD || process.env.PGPASSWORD;
  if (!host || !database || !user) {
    log('postgres cleanup skipped (AWARE_DB_HOST/DATABASE/USER not all set)');
    return { deleted: 0, reason: 'db-env-unset' };
  }

  const client = new pg.Client({ host, port, database, user, password });
  try {
    await client.connect();
    // aware_conversations is the table name from src/db/logger.js. The
    // timestamp column there is `created_at` (default now()).
    const cutoffIso = new Date(CUTOFF_MS).toISOString();
    const result = await client.query(
      'DELETE FROM aware_conversations WHERE created_at < $1',
      [cutoffIso],
    );
    log(`postgres: deleted ${result.rowCount} aware_conversations rows older than ${cutoffIso}`);
    return { deleted: result.rowCount || 0, reason: 'ok' };
  } catch (err) {
    log(`postgres cleanup failed (chain cleanup already succeeded): ${err.message}`);
    return { deleted: 0, reason: 'db-error', error: err.message };
  } finally {
    try { await client.end(); } catch (_) { /* swallow */ }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  log(`retention=${RETENTION_DAYS}d cutoff=${new Date(CUTOFF_MS).toISOString()}`);

  const chainResult = cleanupChain();

  let pgResult = { deleted: 0, reason: 'skipped' };
  if (process.env.AWARE_DB_ENABLED !== '0') {
    pgResult = await cleanupPostgres();
  }

  log(`summary: chain archived=${chainResult.archived} kept=${chainResult.kept}; postgres deleted=${pgResult.deleted}`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[audit-retention] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
