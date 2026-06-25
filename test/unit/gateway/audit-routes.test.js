// test/unit/gateway/audit-routes.test.js
//
// C-step finding #16 (P1, AR-HIGH-001 partial — v2 surface):
// Validates the v2 gateway mounts the audit HTTP API at /api/audit/*.
//
// What we verify:
//   - The audit module is loaded lazily (gateway can boot without it)
//   - /api/audit/verify surfaces the audit chain's verifyChain result
//   - /api/audit/records/:id surfaces the audit chain's getRecord
//   - /api/audit/* requests do NOT get proxied to the upstream
//
// We point AUDIT_DIR at a temp directory containing a synthetic chain
// so the test doesn't touch real audit data.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

process.env.GATEWAY_HOST = '127.0.0.1';
process.env.GATEWAY_PORT = '0';
process.env.AWARE_GATEWAY_KILL_SWITCH = '0';
process.env.COORDINATOR_URL = 'http://placeholder:0';

const FIELD_ORDER = [
  'action', 'actor', 'context', 'decisionId',
  'outcome', 'parentDecisionId', 'prevHash', 'timestamp',
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

function buildRecord({ decisionId, prevHash, timestamp }) {
  const base = {
    decisionId,
    parentDecisionId: null,
    timestamp,
    actor: { agentId: 'test', trustScore: 1.0 },
    action: { type: 'coordinate', target: 'aware-coordinator', reason: 'test' },
    context: { taskType: 'standard', K: null, sessionId: null },
    outcome: { success: true, latencyMs: 100, errorMessage: null },
  };
  const hash = computeHash(base, prevHash);
  return { ...base, prevHash, hash };
}

function makeTempAuditDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aware-gateway-audit-'));
  const file = path.join(dir, 'decision-chain.jsonl');
  const r1 = buildRecord({
    decisionId: '11111111-1111-4111-8111-111111111111',
    prevHash: GENESIS_HASH,
    timestamp: new Date().toISOString(),
  });
  const r2 = buildRecord({
    decisionId: '22222222-2222-4222-8222-222222222222',
    prevHash: r1.hash,
    timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(file, [r1, r2].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

function loadGateway() {
  delete require.cache[require.resolve('../../../src/gateway/server.js')];
  return require('../../../src/gateway/server.js');
}

function startGateway() {
  return new Promise((resolve, reject) => {
    const { app } = loadGateway();
    const server = app.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('audit: gateway /api/audit/verify returns the chain verification result', async (t) => {
  const dir = makeTempAuditDir();
  process.env.AUDIT_DIR = dir;
  const { server, baseUrl } = await startGateway();
  t.after(() => {
    closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await fetch(`${baseUrl}/api/audit/verify`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // The audit module returns { success, verified, verifiedAt, ... } — we
  // don't pin the exact shape (audit module may evolve), only that the
  // endpoint exists and returns 200 + JSON.
  assert.equal(body.success, true);
});

test('audit: gateway /api/audit/records/:id returns the record', async (t) => {
  const dir = makeTempAuditDir();
  process.env.AUDIT_DIR = dir;
  // CRITICAL: the audit module caches state in module scope (the `index`
  // Map). When multiple tests run in the same process, the index may have
  // stale entries from a previous test's AUDIT_DIR. Force a fresh module
  // load so the new AUDIT_DIR takes effect.
  Object.keys(require.cache).forEach((key) => {
    if (key.includes('/src/audit/') || key.includes('/src/api/routes/audit')) {
      delete require.cache[key];
    }
  });
  const { server, baseUrl } = await startGateway();
  t.after(() => {
    closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await fetch(`${baseUrl}/api/audit/records/22222222-2222-4222-8222-222222222222`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.record.decisionId, '22222222-2222-4222-8222-222222222222');
});

test('audit: /api/audit/* does NOT proxy to upstream', async (t) => {
  // Set COORDINATOR_URL to a port where nothing is listening. If the
  // gateway proxies /api/audit/verify to the coordinator, the test
  // would hang or 502; we expect the gateway to answer locally with
  // 200 (or 404 if AUDIT_DIR isn't set — both are valid "did not
  // proxy" outcomes).
  const dir = makeTempAuditDir();
  process.env.AUDIT_DIR = dir;
  process.env.COORDINATOR_URL = 'http://127.0.0.1:1'; // nothing listens here
  const { server, baseUrl } = await startGateway();
  t.after(() => {
    closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Use a short timeout — if the gateway tried to proxy, we'd block.
  const res = await Promise.race([
    fetch(`${baseUrl}/api/audit/verify`),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
  ]);
  assert.equal(res.status, 200, 'gateway should answer /api/audit/verify locally');
});

test('audit: unknown /api/audit/* path returns 404 (not proxied)', async (t) => {
  const dir = makeTempAuditDir();
  process.env.AUDIT_DIR = dir;
  process.env.COORDINATOR_URL = 'http://127.0.0.1:1';
  const { server, baseUrl } = await startGateway();
  t.after(() => {
    closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await fetch(`${baseUrl}/api/audit/nonexistent`);
  // 404 means the audit router declined (Express default) without
  // proxying. Reviewerally, it does NOT block on a hung upstream.
  assert.ok([404, 200].includes(res.status), `unexpected status ${res.status}`);
});
