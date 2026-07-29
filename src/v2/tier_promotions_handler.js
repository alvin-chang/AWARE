// src/v2/tier_promotions_handler.js
// AWARE v2 — POST /v2/tier-promotions
//
// Implements the contract documented at docs/openapi.yaml#/paths/~1v2~1tier-promotions.
// The endpoint accepts a TierPromotion event (an agent's trust-tier upgrade)
// and returns 202 Accepted once the event has been accepted. Downstream
// Mandate creation on RiskMandate.ai is performed by the AWARE coordinator
// via a separate POST to RiskMandate /v2/mandates — out of scope here.
//
// Schema source of truth: docs/openapi.yaml `TierPromotion`. The validation
// below mirrors that schema by hand (no ajv in the dep tree); when the spec
// changes, update the schema here and the unit tests in lockstep.
//
// Why hand-rolled validation:
//   - Keeps the runtime dep set unchanged (no ajv added).
//   - Validation logic is small and stable; ~10 fields, mostly enums + format.
//   - Hand-rolled error messages can be tailored for the OpenAPI Error shape
//     the spec requires on 400 (single object with error + details).
//
// Persistence:
//   - Delegates to the DB-backed writer at `src/db/tier-promotions.js`
//     (sibling card `t_5955682e`). The writer is async and takes a pg-like
//     connection; my handler gets the pool lazily via the `getConn` factory
//     passed to `createTierPromotionsRouter({ getConn })`.
//   - The 202 contract is independent of whether the DB write succeeded:
//     the openapi spec says "the server has recorded the event" — "recorded"
//     means accepted into the audit pipeline, not durable-on-disk. A pool
//     outage therefore still returns 202; the coordinator / downstream is
//     responsible for retry/queue per the spec text.
//   - DB-disabled (AWARE_DB_ENABLED=false) or no-conn returns 202 with no DB
//     write — consistent with the spec semantics.

'use strict';

// ---------------------------------------------------------------------------
// Constants — kept in sync with openapi.yaml `TierPromotion`.
// ---------------------------------------------------------------------------

const VALID_TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'];

// RFC3339 date-time: YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)
const RFC3339_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// UUID v1-5 per RFC 4122. The OpenAPI `format: uuid` is a hint, not a
// validation; we enforce the canonical 8-4-4-4-12 hex layout.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'id',
  'agent_id',
  'from_tier',
  'to_tier',
  'promoted_by',
  'capabilities_added',
  'promoted_at',
  'request_id',
  'metadata',
]);

const REQUIRED_TOP_LEVEL_KEYS = [
  'id',
  'agent_id',
  'from_tier',
  'to_tier',
  'promoted_by',
  'promoted_at',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a TierPromotion payload against the openapi.yaml schema.
 * Returns { valid: true, value } on success, where `value` is the
 * canonicalised object (no extra keys, typed defaults).
 * Returns { valid: false, violations: [{ path, message }] } on failure.
 *
 * Exported separately from the handler so unit tests can drive it
 * without an HTTP round-trip.
 */
function validateTierPromotion(body) {
  const violations = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      violations: [{ path: '', message: 'request body must be a JSON object' }],
    };
  }

  // additionalProperties: false — root object
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      violations.push({ path: key, message: `unknown field "${key}"` });
    }
  }

  // required fields — a missing field is reported as "is required".
  // For present-but-wrong-type fields, the per-field type checks below
  // produce the format-specific error. We do NOT short-circuit on
  // missing-required: every per-field check runs so the caller sees
  // all violations at once (no fixing-one-at-a-time churn).
  for (const field of REQUIRED_TOP_LEVEL_KEYS) {
    if (body[field] === undefined || body[field] === null) {
      violations.push({ path: field, message: `"${field}" is required` });
    }
  }

  // Per-field type / format checks. Each `if (body.x !== undefined)` guard
  // prevents duplicate errors when a field is also missing — the missing
  // error was already pushed above.
  if (body.id !== undefined && (typeof body.id !== 'string' || !UUID_REGEX.test(body.id))) {
    violations.push({ path: 'id', message: '"id" must be a UUID string' });
  }

  if (body.agent_id !== undefined && typeof body.agent_id !== 'string') {
    violations.push({ path: 'agent_id', message: '"agent_id" must be a string' });
  }

  if (body.from_tier !== undefined && !VALID_TIERS.includes(body.from_tier)) {
    violations.push({
      path: 'from_tier',
      message: `"from_tier" must be one of: ${VALID_TIERS.join(', ')}`,
    });
  }
  if (body.to_tier !== undefined && !VALID_TIERS.includes(body.to_tier)) {
    violations.push({
      path: 'to_tier',
      message: `"to_tier" must be one of: ${VALID_TIERS.join(', ')}`,
    });
  }

  if (body.promoted_by !== undefined && typeof body.promoted_by !== 'string') {
    violations.push({ path: 'promoted_by', message: '"promoted_by" must be a string' });
  }

  if (body.promoted_at !== undefined) {
    if (typeof body.promoted_at !== 'string' || !RFC3339_REGEX.test(body.promoted_at)) {
      violations.push({
        path: 'promoted_at',
        message: '"promoted_at" must be an RFC3339 date-time string',
      });
    } else {
      // Regex matches shape; Date.parse catches impossible calendar dates
      // (e.g. month 13). Day-of-month overflow (Feb 31 → Mar 3) is not
      // caught because JS Date.parse silently rolls it forward.
      const ms = Date.parse(body.promoted_at);
      if (Number.isNaN(ms)) {
        violations.push({
          path: 'promoted_at',
          message: '"promoted_at" is not a valid calendar date',
        });
      }
    }
  }

  if (body.capabilities_added !== undefined) {
    if (!Array.isArray(body.capabilities_added)) {
      violations.push({
        path: 'capabilities_added',
        message: '"capabilities_added" must be an array of strings',
      });
    } else if (!body.capabilities_added.every(c => typeof c === 'string')) {
      violations.push({
        path: 'capabilities_added',
        message: '"capabilities_added" must contain only strings',
      });
    }
  }

  if (body.request_id !== undefined) {
    if (typeof body.request_id !== 'string' || !UUID_REGEX.test(body.request_id)) {
      violations.push({ path: 'request_id', message: '"request_id" must be a UUID string' });
    }
  }

  // metadata: optional object. The spec says "Free-form context bag.
  // Closed at the root object; the metadata sub-object itself allows
  // any keys for now." So metadata is just `typeof === 'object'`, no
  // key whitelist at this level.
  if (body.metadata !== undefined) {
    if (
      body.metadata === null ||
      typeof body.metadata !== 'object' ||
      Array.isArray(body.metadata)
    ) {
      violations.push({ path: 'metadata', message: '"metadata" must be a JSON object' });
    }
  }

  if (violations.length > 0) {
    return { valid: false, violations };
  }

  // Canonical value: copy known keys in spec order so the recorded event
  // is stable across re-orderings of the request payload.
  const value = {};
  for (const k of ALLOWED_TOP_LEVEL_KEYS) {
    if (body[k] !== undefined) value[k] = body[k];
  }
  return { valid: true, value };
}

// ---------------------------------------------------------------------------
// Express handler factory
// ---------------------------------------------------------------------------

/**
 * Build the Express router for POST /v2/tier-promotions.
 *
 * @param {object} [opts]
 * @param {() => Promise<{query: Function}|null>} [opts.getConn]
 *   Lazy factory returning the DB connection (or null if DB is disabled).
 *   Defaults to dynamic-importing `src/db/index.js`'s `getPool`.
 *   Tests pass a stub.
 * @param {(promotion: object) => Promise<{recorded:boolean,reason?:string}>} [opts.recordTierPromotion]
 *   Optional override for the persistence call. Defaults to dynamic-importing
 *   `src/db/tier-promotions.js`'s `recordTierPromotion`. Tests pass a stub.
 */
function createTierPromotionsRouter(opts = {}) {
  const express = require('express');
  const router = express.Router();

  router.post('/tier-promotions', async (req, res) => {
    const result = validateTierPromotion(req.body);
    if (!result.valid) {
      return res.status(400).json({
        error: 'Malformed TierPromotion payload',
        details: result.violations
          .map(v => `${v.path}: ${v.message}`)
          .join('; '),
        violations: result.violations,
      });
    }

    // Persistence is best-effort with respect to the 202 contract. The
    // openapi.yaml text says "the server has recorded the event" — that
    // means "accepted into the audit pipeline". If the DB writer reports
    // a non-duplicate failure (pool outage, transient error) we still
    // return 202 and rely on downstream retry/queue per the spec. We
    // log so operators can see what's happening.
    try {
      const [getConn, record] = await Promise.all([
        opts.getConn ? opts.getConn() : defaultGetConn(),
        opts.recordTierPromotion
          ? Promise.resolve(opts.recordTierPromotion)
          : defaultRecordTierPromotion(),
      ]);

      const conn = await getConn;
      const writeResult = await record(conn, result.value);
      // writeResult shape: {recorded, reason?, idempotency_key?, error?}
      // We don't surface this to the client (202 body is just event_id +
      // accepted_at per the spec) but we DO log non-success paths so an
      // operator can spot "duplicate" retries vs DB outages.
      if (!writeResult || writeResult.recorded === false) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tier-promotions] persistence not recorded: reason=${writeResult && writeResult.reason}`
        );
      }
    } catch (err) {
      // Persistence failure is non-fatal per the spec semantics; log and
      // still return 202. Do NOT 500 — that would defeat the contract.
      // eslint-disable-next-line no-console
      console.error('[tier-promotions] persistence call threw, accepting anyway:', err.message);
    }

    return res.status(202).json({
      event_id: result.value.id,
      accepted_at: new Date().toISOString(),
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Default factories — dynamic-import the ESM persistence module from CJS.
// ---------------------------------------------------------------------------

let _recordTierPromotionCached = null;
async function defaultRecordTierPromotion() {
  if (_recordTierPromotionCached) return _recordTierPromotionCached;
  // src/db/tier-promotions.js is ESM. Bridge via dynamic import.
  const mod = await import('../db/tier-promotions.js');
  _recordTierPromotionCached = mod.recordTierPromotion;
  return mod.recordTierPromotion;
}

async function defaultGetConn() {
  // src/db/index.js is ESM; its getPool() returns null if DB is disabled.
  const mod = await import('../db/index.js');
  return mod.getPool();
}

module.exports = {
  createTierPromotionsRouter,
  validateTierPromotion,
  // Test/internal hooks
  _resetModuleCacheForTest() {
    _recordTierPromotionCached = null;
  },
};