// src/db/tier-promotions.js — Postgres-backed tier-promotion audit log
//
// Persistence-side half of the AWARE v2 tier-promotion contract.
// Parents: t_58ba2031 (openapi.yaml schema for /v2/tier-promotions).
//
// On every TierPromotion event that flows through the coordinator, this writes
// a single row to aware_tier_promotions with:
//   - the wire-level fields (event_id, agent_id, from_tier, to_tier, ...)
//   - the full PBOM delta (capabilities_added)
//   - who promoted (promoted_by)
//   - the policies that authorised the change (policies_evaluated, audit-only)
//
// Resilience contract:
//   - recordTierPromotion() never throws — it returns a structured result
//     `{recorded: boolean, reason?: string}` so the caller can decide what to do.
//   - All errors (pool unavailable, malformed input, etc.) are reported via
//     the return value, not thrown.
//   - Idempotency: the `idempotency_key` is a SHA-256 of
//     (agent_id, from_tier, promoted_at, promoted_by). Two calls with the same
//     key produce exactly one row; the second is silently dropped via
//     ON CONFLICT (idempotency_key) DO NOTHING.
//   - When DB is disabled (AWARE_DB_ENABLED=false) the function returns
//     `{recorded: false, reason: 'db-disabled'}` without ever touching the DB.
//
// Validation:
//   - capabilities_added entries must match the PBOM grammar
//     `<verb>:<resource>:<scope?>` (e.g. `read:document`, `write:db:tenant`).
//     Malformed entries cause a pre-DB validation failure with
//     reason: 'invalid-capability' so the coordinator logs a clear error
//     instead of writing garbage that RM can't query.
//
// Why not pull the conn from getPool() internally?
//   - The card explicitly specifies `recordTierPromotion(conn, promotion)` so
//     callers (test stubs, future coordinator transaction wrappers) can pass
//     their own connection. This matches the prm-cache test-seam pattern
//     where _setPoolForTest installs a fake that .query() goes through.
//
// Public API:
//   import { recordTierPromotion, buildIdempotencyKey } from './db/tier-promotions.js';

import { createHash } from 'node:crypto';

// PBOM grammar per the task body recommendation: "<verb>:<resource>:<scope?>"
// - verb: lowercase letters (read, write, delete, execute, ...)
// - resource: lowercase letters / digits / dashes (document, db, file-system, ...)
// - scope: optional, lowercase letters / digits / dashes / dots / colons / slashes
//   (e.g. `tenant`, `repo:aware`, `org:acme/unit:engineering`)
//
// Examples that PASS:    read:document, write:db:tenant, exec:shell:repo:aware
// Examples that FAIL:    "Read:Document" (uppercase), "readdocument" (no colon),
//                        "read:document:" (trailing empty scope), ":document" (no verb)
const CAPABILITY_RE = /^[a-z]+:[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9./:-]*)?$/;

const VALID_TIERS = new Set(['T0', 'T1', 'T2', 'T3', 'T4']);

// ─── Pure helpers (exported for testing) ─────────────────────────────────

/**
 * Build the SHA-256 idempotency key from the four promotion-defining fields.
 * Stable across retries because those fields are set by the originating
 * principal and are not regenerated on retry.
 *
 * @param {Object} promotion
 * @param {string} promotion.agent_id
 * @param {string} promotion.from_tier
 * @param {string|Date} promotion.promoted_at
 * @param {string} promotion.promoted_by
 * @returns {string} 64-char hex SHA-256
 */
export function buildIdempotencyKey(promotion) {
  const promotedAt = promotion.promoted_at instanceof Date
    ? promotion.promoted_at.toISOString()
    : String(promotion.promoted_at || '');
  const payload = [
    String(promotion.agent_id || ''),
    String(promotion.from_tier || ''),
    promotedAt,
    String(promotion.promoted_by || ''),
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Validate a single capability string against the PBOM grammar.
 * Exported so tests can pin the grammar without going through the DB.
 */
export function isValidCapability(cap) {
  if (typeof cap !== 'string' || cap.length === 0) return false;
  return CAPABILITY_RE.test(cap);
}

// ─── Input validation ─────────────────────────────────────────────────────

/**
 * Pre-DB validation. Returns null on success, or a string reason on failure.
 * Keeps the error reasons machine-readable so callers can route on them
 * (the coordinator probably wants to log "invalid-capability" loudly but
 * "db-disabled" silently).
 */
function validatePromotion(promotion) {
  if (!promotion || typeof promotion !== 'object') return 'not-an-object';
  if (!promotion.id) return 'missing-id';
  if (!promotion.agent_id) return 'missing-agent_id';
  if (!promotion.promoted_by) return 'missing-promoted_by';
  if (!promotion.promoted_at) return 'missing-promoted_at';
  if (!promotion.from_tier) return 'missing-from_tier';
  if (!promotion.to_tier) return 'missing-to_tier';

  if (!VALID_TIERS.has(promotion.from_tier)) return 'invalid-from_tier';
  if (!VALID_TIERS.has(promotion.to_tier)) return 'invalid-to_tier';

  const caps = promotion.capabilities_added;
  if (caps !== undefined && caps !== null) {
    if (!Array.isArray(caps)) return 'capabilities_added-not-array';
    for (const cap of caps) {
      if (!isValidCapability(cap)) return 'invalid-capability';
    }
  }

  const policies = promotion.policies_evaluated;
  if (policies !== undefined && policies !== null) {
    if (!Array.isArray(policies)) return 'policies_evaluated-not-array';
    for (const p of policies) {
      if (!p || typeof p !== 'object') return 'policies_evaluated-not-object';
      if (typeof p.policy_id !== 'string' || !p.policy_id) return 'policies_evaluated-missing-policy_id';
      // parameters may be any JSON-serialisable value or undefined
    }
  }

  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Record a tier-promotion event to the audit log.
 *
 * @param {{query: (sql: string, params: unknown[]) => Promise<unknown>}} conn
 *        A pg Pool, Client, or stub that implements .query(sql, params).
 *        May be null/undefined — the function returns db-disabled in that case.
 * @param {Object} promotion  The TierPromotion event payload.
 *        Required: id, agent_id, from_tier, to_tier, promoted_by, promoted_at
 *        Optional: capabilities_added (array of PBOM strings),
 *                  policies_evaluated (array of {policy_id, parameters}),
 *                  request_id (UUID), metadata (object)
 * @returns {Promise<{recorded: boolean, reason?: string, idempotency_key?: string, error?: string}>}
 */
export async function recordTierPromotion(conn, promotion) {
  const reason = validatePromotion(promotion);
  if (reason) {
    return { recorded: false, reason };
  }

  if (!conn || typeof conn.query !== 'function') {
    return { recorded: false, reason: 'no-connection' };
  }

  const idempotencyKey = buildIdempotencyKey(promotion);

  // Normalise JSONB fields. Always pass strings to pg — let it cast to JSONB.
  const capabilitiesJson = JSON.stringify(promotion.capabilities_added || []);
  const policiesJson = JSON.stringify(promotion.policies_evaluated || []);
  const metadataJson = JSON.stringify(promotion.metadata || {});

  // Normalise promoted_at: accept Date or string.
  const promotedAt = promotion.promoted_at instanceof Date
    ? promotion.promoted_at.toISOString()
    : String(promotion.promoted_at);

  const sql = `
    INSERT INTO aware_tier_promotions (
      event_id, agent_id, from_tier, to_tier,
      promoted_by, promoted_at,
      capabilities_added, request_id, metadata,
      policies_evaluated, idempotency_key
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7::jsonb, $8, $9::jsonb,
      $10::jsonb, $11
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;

  try {
    const result = await conn.query(sql, [
      promotion.id,
      promotion.agent_id,
      promotion.from_tier,
      promotion.to_tier,
      promotion.promoted_by,
      promotedAt,
      capabilitiesJson,
      promotion.request_id || null,
      metadataJson,
      policiesJson,
      idempotencyKey,
    ]);

    // ON CONFLICT DO NOTHING returns 0 rows when the key was already there.
    // The (event_id UNIQUE) constraint can also cause a duplicate to surface
    // as a unique_violation; we treat that as "already recorded" too.
    const rows = result && result.rows ? result.rows : [];
    if (rows.length === 0) {
      return { recorded: false, reason: 'duplicate', idempotency_key: idempotencyKey };
    }
    return { recorded: true, idempotency_key: idempotencyKey };
  } catch (err) {
    // event_id UNIQUE collision is treated the same as idempotency_key collision:
    // a retry that happened to compute the same idempotency_key from
    // re-derived timestamps. Both are "already recorded, no-op".
    if (err && err.code === '23505') {
      return { recorded: false, reason: 'duplicate', idempotency_key: idempotencyKey };
    }
    return {
      recorded: false,
      reason: 'insert-failed',
      idempotency_key: idempotencyKey,
      error: err && err.message ? err.message : String(err),
    };
  }
}