// test/unit/db/tier-promotions.test.js
// Unit tests for src/db/tier-promotions.js — AWARE v2 tier-promotion audit writer.
//
// Strategy: pure-function tests for buildIdempotencyKey / isValidCapability,
// then stub-pool tests for recordTierPromotion's happy path, idempotency
// collision, unique_violation collision, validation failures, and
// pool-unavailable paths. We don't need a real Postgres — the writer
// takes the connection as an argument (per the card body), so a stub with
// .query() is sufficient.
//
// Matches the rest of the v2 suite: Node's built-in test runner
// (node --test), strict assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- buildIdempotencyKey (pure) -----------------------------------------

test('tierPromotions: buildIdempotencyKey returns 64-char hex SHA-256', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const k = buildIdempotencyKey({
    agent_id: 'agent-1',
    from_tier: 'T1',
    promoted_at: '2026-07-06T12:00:00.000Z',
    promoted_by: 'user:alice',
  });
  assert.equal(typeof k, 'string');
  assert.equal(k.length, 64);
  assert.match(k, /^[0-9a-f]{64}$/);
});

test('tierPromotions: buildIdempotencyKey is deterministic for same inputs', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const p = {
    agent_id: 'a',
    from_tier: 'T1',
    promoted_at: '2026-07-06T12:00:00.000Z',
    promoted_by: 'alice',
  };
  assert.equal(buildIdempotencyKey(p), buildIdempotencyKey(p));
});

test('tierPromotions: buildIdempotencyKey differs for different agent_id', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const base = { from_tier: 'T1', promoted_at: '2026-07-06T12:00:00.000Z', promoted_by: 'alice' };
  const k1 = buildIdempotencyKey({ ...base, agent_id: 'a' });
  const k2 = buildIdempotencyKey({ ...base, agent_id: 'b' });
  assert.notEqual(k1, k2);
});

test('tierPromotions: buildIdempotencyKey differs for different from_tier', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const base = { agent_id: 'a', promoted_at: '2026-07-06T12:00:00.000Z', promoted_by: 'alice' };
  const k1 = buildIdempotencyKey({ ...base, from_tier: 'T0' });
  const k2 = buildIdempotencyKey({ ...base, from_tier: 'T1' });
  assert.notEqual(k1, k2);
});

test('tierPromotions: buildIdempotencyKey differs for different promoted_at', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const base = { agent_id: 'a', from_tier: 'T1', promoted_by: 'alice' };
  const k1 = buildIdempotencyKey({ ...base, promoted_at: '2026-07-06T12:00:00.000Z' });
  const k2 = buildIdempotencyKey({ ...base, promoted_at: '2026-07-06T12:00:01.000Z' });
  assert.notEqual(k1, k2);
});

test('tierPromotions: buildIdempotencyKey differs for different promoted_by', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const base = { agent_id: 'a', from_tier: 'T1', promoted_at: '2026-07-06T12:00:00.000Z' };
  const k1 = buildIdempotencyKey({ ...base, promoted_by: 'alice' });
  const k2 = buildIdempotencyKey({ ...base, promoted_by: 'bob' });
  assert.notEqual(k1, k2);
});

test('tierPromotions: buildIdempotencyKey normalises Date and ISO string to the same key', async () => {
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  const base = { agent_id: 'a', from_tier: 'T1', promoted_by: 'alice' };
  const d = new Date('2026-07-06T12:00:00.000Z');
  const k1 = buildIdempotencyKey({ ...base, promoted_at: d });
  const k2 = buildIdempotencyKey({ ...base, promoted_at: '2026-07-06T12:00:00.000Z' });
  assert.equal(k1, k2);
});

// --- isValidCapability (pure) -------------------------------------------

test('tierPromotions: isValidCapability accepts <verb>:<resource>', async () => {
  const { isValidCapability } = await import('../../../src/db/tier-promotions.js');
  assert.equal(isValidCapability('read:document'), true);
  assert.equal(isValidCapability('write:db'), true);
  assert.equal(isValidCapability('execute:shell'), true);
});

test('tierPromotions: isValidCapability accepts <verb>:<resource>:<scope>', async () => {
  const { isValidCapability } = await import('../../../src/db/tier-promotions.js');
  assert.equal(isValidCapability('read:document:tenant'), true);
  assert.equal(isValidCapability('write:db:repo:aware'), true);
  assert.equal(isValidCapability('execute:shell:org:acme/unit:eng'), true);
});

test('tierPromotions: isValidCapability rejects malformed strings', async () => {
  const { isValidCapability } = await import('../../../src/db/tier-promotions.js');
  // Missing colon between verb and resource
  assert.equal(isValidCapability('readdocument'), false);
  // Uppercase verb (grammar is lowercase only)
  assert.equal(isValidCapability('Read:document'), false);
  // Empty scope (trailing colon)
  assert.equal(isValidCapability('read:document:'), false);
  // Missing verb
  assert.equal(isValidCapability(':document'), false);
  // Empty string
  assert.equal(isValidCapability(''), false);
  // Non-string
  assert.equal(isValidCapability(null), false);
  assert.equal(isValidCapability(undefined), false);
  assert.equal(isValidCapability(123), false);
  assert.equal(isValidCapability({}), false);
});

// --- recordTierPromotion: validation ------------------------------------

const validPromotion = {
  id: '11111111-2222-3333-4444-555555555555',
  agent_id: 'agent-7',
  from_tier: 'T1',
  to_tier: 'T2',
  promoted_by: 'user:alice',
  promoted_at: '2026-07-06T12:00:00.000Z',
  capabilities_added: ['read:document', 'write:db:tenant'],
  policies_evaluated: [
    { policy_id: 'tier-promotion-t1-to-t2', parameters: { min_trust: 0.8 } },
  ],
};

test('tierPromotions: recordTierPromotion rejects null promotion', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const r = await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, null);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'not-an-object');
});

test('tierPromotions: recordTierPromotion rejects missing required fields', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  for (const field of ['id', 'agent_id', 'from_tier', 'to_tier', 'promoted_by', 'promoted_at']) {
    const p = { ...validPromotion };
    delete p[field];
    const r = await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, p);
    assert.equal(r.recorded, false, `expected rejection for missing ${field}`);
    assert.equal(r.reason, `missing-${field}`);
  }
});

test('tierPromotions: recordTierPromotion rejects invalid tier values', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const p1 = { ...validPromotion, from_tier: 'T9' };
  const p2 = { ...validPromotion, to_tier: 't2' }; // lowercase not in enum
  assert.equal((await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, p1)).reason, 'invalid-from_tier');
  assert.equal((await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, p2)).reason, 'invalid-to_tier');
});

test('tierPromotions: recordTierPromotion rejects invalid capability strings', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const p = { ...validPromotion, capabilities_added: ['read:document', 'BadFormat'] };
  const r = await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, p);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'invalid-capability');
});

test('tierPromotions: recordTierPromotion rejects non-array capabilities_added', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const p = { ...validPromotion, capabilities_added: 'read:document' };
  const r = await recordTierPromotion({ query: async () => ({ rows: [{ id: 1 }] }) }, p);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'capabilities_added-not-array');
});

test('tierPromotions: recordTierPromotion rejects malformed policies_evaluated', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  // Not an array
  let r = await recordTierPromotion(
    { query: async () => ({ rows: [{ id: 1 }] }) },
    { ...validPromotion, policies_evaluated: 'not-an-array' }
  );
  assert.equal(r.reason, 'policies_evaluated-not-array');

  // Entry missing policy_id
  r = await recordTierPromotion(
    { query: async () => ({ rows: [{ id: 1 }] }) },
    { ...validPromotion, policies_evaluated: [{ parameters: {} }] }
  );
  assert.equal(r.reason, 'policies_evaluated-missing-policy_id');

  // Entry not an object
  r = await recordTierPromotion(
    { query: async () => ({ rows: [{ id: 1 }] }) },
    { ...validPromotion, policies_evaluated: ['just-a-string'] }
  );
  assert.equal(r.reason, 'policies_evaluated-not-object');
});

// --- recordTierPromotion: connection handling ---------------------------

test('tierPromotions: recordTierPromotion returns no-connection when conn is null', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const r = await recordTierPromotion(null, validPromotion);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'no-connection');
});

test('tierPromotions: recordTierPromotion returns no-connection when conn has no query()', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const r = await recordTierPromotion({}, validPromotion);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'no-connection');
});

// --- recordTierPromotion: happy path ------------------------------------

test('tierPromotions: recordTierPromotion writes a row with the right SQL and JSONB params', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  let captured = null;
  const fakeConn = {
    query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ id: 42 }] };
    },
  };

  const r = await recordTierPromotion(fakeConn, validPromotion);
  assert.equal(r.recorded, true);
  assert.equal(typeof r.idempotency_key, 'string');
  assert.equal(r.idempotency_key.length, 64);

  // SQL contains all expected columns
  assert.match(captured.sql, /INSERT INTO aware_tier_promotions/);
  assert.match(captured.sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(captured.sql, /RETURNING id/);

  // Params: event_id, agent_id, from_tier, to_tier, promoted_by, promoted_at,
  //         capabilities_added (jsonb), request_id, metadata (jsonb),
  //         policies_evaluated (jsonb), idempotency_key
  const p = captured.params;
  assert.equal(p.length, 11);
  assert.equal(p[0], validPromotion.id);
  assert.equal(p[1], validPromotion.agent_id);
  assert.equal(p[2], validPromotion.from_tier);
  assert.equal(p[3], validPromotion.to_tier);
  assert.equal(p[4], validPromotion.promoted_by);
  assert.equal(p[5], validPromotion.promoted_at);

  // JSONB params are JSON strings
  assert.equal(typeof p[6], 'string');
  assert.deepEqual(JSON.parse(p[6]), validPromotion.capabilities_added);
  assert.equal(p[7], null); // request_id not set
  assert.equal(typeof p[8], 'string');
  assert.deepEqual(JSON.parse(p[8]), {}); // metadata defaulted
  assert.equal(typeof p[9], 'string');
  assert.deepEqual(JSON.parse(p[9]), validPromotion.policies_evaluated);

  // idempotency_key matches the explicit builder
  const { buildIdempotencyKey } = await import('../../../src/db/tier-promotions.js');
  assert.equal(p[10], buildIdempotencyKey(validPromotion));
  assert.equal(p[10], r.idempotency_key);
});

test('tierPromotions: recordTierPromotion accepts Date promoted_at and converts to ISO', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  let captured = null;
  const fakeConn = {
    query: async (sql, params) => { captured = params; return { rows: [{ id: 1 }] }; },
  };
  const d = new Date('2026-07-06T12:00:00.000Z');
  await recordTierPromotion(fakeConn, { ...validPromotion, promoted_at: d });
  assert.equal(captured[5], d.toISOString());
});

test('tierPromotions: recordTierPromotion defaults capabilities_added to []', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  let captured = null;
  const fakeConn = {
    query: async (sql, params) => { captured = params; return { rows: [{ id: 1 }] }; },
  };
  const p = { ...validPromotion };
  delete p.capabilities_added;
  await recordTierPromotion(fakeConn, p);
  assert.deepEqual(JSON.parse(captured[6]), []);
});

test('tierPromotions: recordTierPromotion defaults policies_evaluated to []', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  let captured = null;
  const fakeConn = {
    query: async (sql, params) => { captured = params; return { rows: [{ id: 1 }] }; },
  };
  const p = { ...validPromotion };
  delete p.policies_evaluated;
  await recordTierPromotion(fakeConn, p);
  assert.deepEqual(JSON.parse(captured[9]), []);
});

// --- recordTierPromotion: idempotency (the headline acceptance criterion) -

test('tierPromotions: two calls with the same (agent_id, from_tier, promoted_at, promoted_by) produce exactly one row', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');

  // In-memory "table" keyed by idempotency_key. ON CONFLICT DO NOTHING means
  // the second call returns 0 rows. This models the actual Postgres behaviour
  // for a single connection's view of the table.
  const table = new Map();
  let queries = 0;

  const fakeConn = {
    query: async (sql, params) => {
      queries++;
      const key = params[10];
      // Naive ON CONFLICT simulation: if the key is already there, return 0 rows
      if (table.has(key)) {
        return { rows: [] };
      }
      table.set(key, { id: table.size + 1 });
      return { rows: [table.get(key)] };
    },
  };

  const r1 = await recordTierPromotion(fakeConn, validPromotion);
  const r2 = await recordTierPromotion(fakeConn, validPromotion);

  assert.equal(r1.recorded, true);
  assert.equal(r2.recorded, false);
  assert.equal(r2.reason, 'duplicate');
  assert.equal(r1.idempotency_key, r2.idempotency_key);
  assert.equal(table.size, 1, 'exactly one row should exist after two identical writes');
  assert.equal(queries, 2);
});

test('tierPromotions: a different promoted_at produces a fresh row (distinct idempotency key)', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const table = new Map();
  const fakeConn = {
    query: async (sql, params) => {
      const key = params[10];
      if (table.has(key)) return { rows: [] };
      table.set(key, { id: table.size + 1 });
      return { rows: [table.get(key)] };
    },
  };

  const r1 = await recordTierPromotion(fakeConn, validPromotion);
  const r2 = await recordTierPromotion(fakeConn, {
    ...validPromotion,
    promoted_at: '2026-07-06T12:00:01.000Z',
  });

  assert.equal(r1.recorded, true);
  assert.equal(r2.recorded, true);
  assert.notEqual(r1.idempotency_key, r2.idempotency_key);
  assert.equal(table.size, 2);
});

// --- recordTierPromotion: unique_violation on event_id ------------------

test('tierPromotions: event_id UNIQUE collision (Postgres 23505) is treated as duplicate', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const fakeConn = {
    query: async () => {
      const err = new Error('duplicate key value violates unique constraint "aware_tier_promotions_event_id_key"');
      err.code = '23505';
      throw err;
    },
  };

  const r = await recordTierPromotion(fakeConn, validPromotion);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'duplicate');
  assert.equal(typeof r.idempotency_key, 'string');
});

test('tierPromotions: non-23505 error from conn.query is reported as insert-failed', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  const fakeConn = {
    query: async () => {
      const err = new Error('connection terminated unexpectedly');
      // No .code — generic failure
      throw err;
    },
  };

  const r = await recordTierPromotion(fakeConn, validPromotion);
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'insert-failed');
  assert.match(r.error, /connection terminated/);
  assert.equal(typeof r.idempotency_key, 'string');
});

test('tierPromotions: never throws on bad input — always returns structured result', async () => {
  const { recordTierPromotion } = await import('../../../src/db/tier-promotions.js');
  // No-throw contract: even wildly wrong input returns a result, never throws
  const r1 = await recordTierPromotion(undefined, undefined);
  assert.equal(typeof r1, 'object');
  assert.equal(r1.recorded, false);

  const r2 = await recordTierPromotion(
    { query: async () => { throw new Error('boom'); } },
    'not-an-object'
  );
  assert.equal(r2.recorded, false);
  assert.equal(r2.reason, 'not-an-object');

  const r3 = await recordTierPromotion(null, validPromotion);
  assert.equal(r3.recorded, false);
  assert.equal(r3.reason, 'no-connection');
});

// --- re-export from db barrel -------------------------------------------

test('tierPromotions: src/db/index.js re-exports the writer and helpers', async () => {
  const barrel = await import('../../../src/db/index.js');
  assert.equal(typeof barrel.recordTierPromotion, 'function');
  assert.equal(typeof barrel.buildIdempotencyKey, 'function');
  assert.equal(typeof barrel.isValidCapability, 'function');
});