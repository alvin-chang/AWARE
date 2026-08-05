// test/unit/api/tier-promotions-handler.test.js
// Unit tests for src/v2/tier_promotions_handler.js
//
// Coverage:
//   - validateTierPromotion: every required-field branch, every enum, every
//     format check (UUID, RFC3339), additionalProperties:false at root,
//     non-object body, capabilities_added shape, metadata shape, canonical
//     value on success.
//   - createTierPromotionsRouter: end-to-end POST /v2/tier-promotions
//     through Express + supertest, covering 202/400/401 paths and the
//     DB-disabled / DB-write-failed / DB-success / DB-duplicate cases
//     via the getConn / recordTierPromotion factory overrides.
//
// Persistence is delegated to the DB-backed writer (src/db/tier-promotions.js,
// sibling card t_5955682e); we exercise that integration with stubs here
// and rely on t_5955682e's own tests for the real DB round-trip.
//
// Run: node --test test/unit/api/tier-promotions-handler.test.js
// or: npm test (it'll be picked up by the unit glob)

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const express = require('express');

const {
  validateTierPromotion,
  createTierPromotionsRouter,
} = require('../../../src/v2/tier_promotions_handler');

// A canonical, valid TierPromotion payload. Used as the base for all
// success-path tests; mutation-test variants override one field at a time
// to exercise each validation branch.
function validPayload(overrides = {}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    agent_id: 'agent:coder:instance-7f3a',
    from_tier: 'T1',
    to_tier: 'T2',
    promoted_by: 'svc:compliance-officer',
    promoted_at: '2026-07-06T12:00:00.000Z',
    ...overrides,
  };
}

// Stub factories. The handler's `createTierPromotionsRouter({ getConn,
// recordTierPromotion })` accepts both — letting tests pin the persistence
// outcome without ever touching a real database.
function stubGetConn(conn) {
  return async () => conn;
}
function stubRecord(result) {
  return async () => result;
}
function throwingRecord() {
  return async () => {
    throw new Error('boom');
  };
}

// Build a minimal Express app with the same bearer-auth gate the real
// APIGateway provides, so the 401 path is exercised here too.
function buildApp({ withAuth = true, getConn, recordTierPromotion } = {}) {
  const app = express();
  app.use(express.json());
  if (withAuth) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
      }
      next();
    });
  }
  app.use('/v2', createTierPromotionsRouter({ getConn, recordTierPromotion }));
  return app;
}

// ---------------------------------------------------------------------------

describe('validateTierPromotion', () => {
  test('accepts a minimal valid payload', () => {
    const r = validateTierPromotion(validPayload());
    assert.strictEqual(r.valid, true, JSON.stringify(r));
    assert.strictEqual(r.value.id, '11111111-2222-4333-8444-555555555555');
    assert.strictEqual(r.value.to_tier, 'T2');
  });

  test('accepts a payload with all optional fields populated', () => {
    const r = validateTierPromotion(
      validPayload({
        capabilities_added: ['code_write', 'test_write'],
        request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        metadata: { ticket: 'SEC-1234', reviewer: 'alvin' },
      })
    );
    assert.strictEqual(r.valid, true, JSON.stringify(r));
    assert.deepStrictEqual(r.value.capabilities_added, ['code_write', 'test_write']);
    assert.strictEqual(r.value.metadata.ticket, 'SEC-1234');
  });

  test('rejects null body', () => {
    const r = validateTierPromotion(null);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.message.includes('JSON object')));
  });

  test('rejects array body', () => {
    const r = validateTierPromotion([1, 2, 3]);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.message.includes('JSON object')));
  });

  test('rejects primitive body', () => {
    const r = validateTierPromotion('not a payload');
    assert.strictEqual(r.valid, false);
  });

  test('rejects extra top-level fields (additionalProperties: false)', () => {
    const r = validateTierPromotion(validPayload({ sneaky: 'value' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'sneaky'));
  });

  // --- Required-field enforcement ----------------------------------------

  test('rejects missing id', () => {
    const { id, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'id' && v.message.includes('required')));
  });

  test('rejects missing agent_id', () => {
    const { agent_id, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'agent_id'));
  });

  test('rejects missing from_tier', () => {
    const { from_tier, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'from_tier'));
  });

  test('rejects missing to_tier', () => {
    const { to_tier, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'to_tier'));
  });

  test('rejects missing promoted_by', () => {
    const { promoted_by, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'promoted_by'));
  });

  test('rejects missing promoted_at', () => {
    const { promoted_at, ...rest } = validPayload();
    const r = validateTierPromotion(rest);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'promoted_at'));
  });

  // --- Type / format enforcement ------------------------------------------

  test('rejects non-string id', () => {
    const r = validateTierPromotion(validPayload({ id: 12345 }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'id'));
  });

  test('rejects non-UUID id', () => {
    const r = validateTierPromotion(validPayload({ id: 'not-a-uuid' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'id' && v.message.includes('UUID')));
  });

  test('rejects invalid from_tier enum', () => {
    const r = validateTierPromotion(validPayload({ from_tier: 'T5' }));
    assert.strictEqual(r.valid, false);
    assert.ok(
      r.violations.some(
        v => v.path === 'from_tier' && v.message.includes('T0, T1, T2, T3, T4')
      )
    );
  });

  test('rejects invalid to_tier enum', () => {
    const r = validateTierPromotion(validPayload({ to_tier: 'executive' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'to_tier'));
  });

  test('rejects promoted_at that is not RFC3339 (date-only)', () => {
    const r = validateTierPromotion(validPayload({ promoted_at: '2026-07-06' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'promoted_at'));
  });

  test('rejects promoted_at with timezone offset missing colon', () => {
    const r = validateTierPromotion(validPayload({ promoted_at: '2026-07-06T12:00:00+0000' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'promoted_at'));
  });

  test('accepts promoted_at with positive timezone offset', () => {
    const r = validateTierPromotion(validPayload({ promoted_at: '2026-07-06T14:00:00+02:00' }));
    assert.strictEqual(r.valid, true, JSON.stringify(r));
  });

  test('rejects promoted_at with month 13 (impossible calendar date)', () => {
    const r = validateTierPromotion(validPayload({ promoted_at: '2026-13-01T00:00:00Z' }));
    assert.strictEqual(r.valid, false);
    assert.ok(
      r.violations.some(
        v => v.path === 'promoted_at' && v.message.includes('not a valid calendar date')
      )
    );
  });

  test('rejects non-string promoted_by', () => {
    const r = validateTierPromotion(validPayload({ promoted_by: 42 }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'promoted_by'));
  });

  test('rejects capabilities_added as non-array', () => {
    const r = validateTierPromotion(validPayload({ capabilities_added: 'code_write' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'capabilities_added'));
  });

  test('rejects capabilities_added with non-string element', () => {
    const r = validateTierPromotion(validPayload({ capabilities_added: ['code_write', 42] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'capabilities_added'));
  });

  test('rejects request_id with bad UUID', () => {
    const r = validateTierPromotion(validPayload({ request_id: 'not-a-uuid' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'request_id'));
  });

  test('rejects metadata as array (must be object)', () => {
    const r = validateTierPromotion(validPayload({ metadata: [1, 2, 3] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some(v => v.path === 'metadata'));
  });

  test('accepts metadata with arbitrary keys (spec says sub-object is open)', () => {
    const r = validateTierPromotion(
      validPayload({ metadata: { anyKey: 'anyValue', nested: { a: 1 } } })
    );
    assert.strictEqual(r.valid, true, JSON.stringify(r));
  });

  test('reports all violations in one pass (no short-circuit on first)', () => {
    const r = validateTierPromotion({
      id: 'not-a-uuid',
      from_tier: 'T5',
      unknown_field: 'oops',
    });
    assert.strictEqual(r.valid, false);
    const paths = r.violations.map(v => v.path).sort();
    assert.ok(paths.includes('id'), `expected 'id' in ${JSON.stringify(paths)}`);
    assert.ok(paths.includes('from_tier'));
    assert.ok(paths.includes('unknown_field'));
    assert.ok(paths.includes('agent_id'));
    assert.ok(paths.includes('to_tier'));
    assert.ok(paths.includes('promoted_by'));
    assert.ok(paths.includes('promoted_at'));
  });

  test('canonical value drops unknown keys and preserves declared order', () => {
    const r = validateTierPromotion({
      promoted_at: '2026-07-06T12:00:00Z',
      promoted_by: 'svc:test',
      to_tier: 'T2',
      from_tier: 'T1',
      agent_id: 'a',
      id: '11111111-2222-4333-8444-555555555555',
      metadata: { keep: true },
    });
    assert.strictEqual(r.valid, true);
    assert.deepStrictEqual(
      Object.keys(r.value),
      ['id', 'agent_id', 'from_tier', 'to_tier', 'promoted_by', 'promoted_at', 'metadata']
    );
  });
});

// ---------------------------------------------------------------------------

describe('createTierPromotionsRouter (HTTP)', () => {
  test('returns 401 when no bearer token is supplied', async () => {
    const app = buildApp({ withAuth: true });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .send(validPayload())
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 401);
  });

  test('returns 202 + event_id + accepted_at for a valid payload (DB disabled / no conn)', async () => {
    // Simulate AWARE_DB_ENABLED=false: getConn returns null, the DB
    // writer returns {recorded:false, reason:'no-connection'}, handler
    // still answers 202 per the spec.
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn(null),
      recordTierPromotion: stubRecord({ recorded: false, reason: 'no-connection' }),
    });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload())
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 202, JSON.stringify(res.body));
    assert.strictEqual(res.body.event_id, validPayload().id);
    assert.match(res.body.accepted_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('returns 202 when DB writer reports duplicate (idempotent retry)', async () => {
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn({ query: async () => ({ rows: [] }) }),
      recordTierPromotion: stubRecord({ recorded: false, reason: 'duplicate' }),
    });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload())
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 202);
  });

  test('returns 202 when DB writer throws (best-effort persistence)', async () => {
    // Pool blip / network failure. Spec semantics: still 202.
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn({ query: async () => ({ rows: [] }) }),
      recordTierPromotion: throwingRecord(),
    });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload())
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 202, JSON.stringify(res.body));
  });

  test('returns 202 when DB write succeeds (recorded:true)', async () => {
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn({ query: async () => ({ rows: [{ id: 1 }] }) }),
      recordTierPromotion: stubRecord({ recorded: true }),
    });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload())
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 202);
  });

  test('passes the canonicalised event to the DB writer', async () => {
    let observed = null;
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn(null),
      recordTierPromotion: async (conn, promotion) => {
        observed = { conn, promotion };
        return { recorded: false, reason: 'no-connection' };
      },
    });
    const payload = validPayload({
      capabilities_added: ['code_write'],
      metadata: { reviewer: 'alvin' },
    });
    await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(payload)
      .set('Content-Type', 'application/json');
    assert.ok(observed, 'recordTierPromotion was never called');
    assert.strictEqual(observed.promotion.id, payload.id);
    assert.strictEqual(observed.promotion.from_tier, 'T1');
    assert.strictEqual(observed.promotion.to_tier, 'T2');
    assert.deepStrictEqual(observed.promotion.capabilities_added, ['code_write']);
  });

  test('returns 400 with structured violations for malformed payload', async () => {
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn(null),
      recordTierPromotion: stubRecord({ recorded: false, reason: 'no-connection' }),
    });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send({ id: 'not-a-uuid', from_tier: 'T5' })
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Malformed/);
    assert.ok(Array.isArray(res.body.violations));
    assert.ok(res.body.violations.length > 0);
  });

  test('does NOT call recordTierPromotion on 400', async () => {
    let called = false;
    const app = buildApp({
      withAuth: true,
      getConn: stubGetConn(null),
      recordTierPromotion: async () => {
        called = true;
        return { recorded: false, reason: 'no-connection' };
      },
    });
    await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send({ id: 'not-a-uuid' })
      .set('Content-Type', 'application/json');
    assert.strictEqual(called, false, 'writer should not be called on validation failure');
  });

  test('returns 400 when body is an array', async () => {
    const app = buildApp({ withAuth: true });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send([1, 2, 3])
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 400);
  });

  test('returns 400 when extra top-level keys are present', async () => {
    const app = buildApp({ withAuth: true });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload({ evil: 'yes' }))
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.violations.some(v => v.path === 'evil'));
  });

  test('returns 400 when promoted_at is date-only (not RFC3339)', async () => {
    const app = buildApp({ withAuth: true });
    const res = await request(app)
      .post('/v2/tier-promotions')
      .set('Authorization', 'Bearer faketoken')
      .send(validPayload({ promoted_at: '2026-07-06' }))
      .set('Content-Type', 'application/json');
    assert.strictEqual(res.status, 400);
  });
});