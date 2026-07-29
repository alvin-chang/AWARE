-- Migration 006: tier_promotions audit table
-- Persistence-side half of the AWARE v2 tier-promotion contract (parents: t_58ba2031).
--
-- The openapi.yaml commits to a TierPromotion event flow (POST /v2/tier-promotions,
-- 202 Accepted). Without persistent audit storage the contract is theatre — RM
-- downstream reads nothing because nothing exists. This table is the storage
-- surface for every promotion that the AWARE coordinator emits.
--
-- One row per TierPromotion event. The `idempotency_key` UNIQUE constraint
-- is the deduplication boundary: the coordinator can retry the same promotion
-- (e.g. after a coordinator crash mid-write) and the second write is silently
-- dropped. The key is a SHA-256 of (agent_id, from_tier, promoted_at, promoted_by),
-- which is stable across retries because those four fields are set by the
-- originating principal and are not regenerated on retry.
--
-- The shape stored here intentionally extends the wire-level TierPromotion:
-- `policies_evaluated` and `idempotency_key` are audit-only denormalisations
-- (not on the wire) so RiskMandate.ai's reconstruct-the-rationale queries can
-- answer "why was this approved" without re-joining against the policy engine.
--
-- Out of scope (other cards): API endpoint, automatic emission from the
-- coordinator, RM-side hook, retroactive backfill, UI surfaces.

CREATE TABLE IF NOT EXISTS aware_tier_promotions (
  id                  BIGSERIAL    PRIMARY KEY,

  -- Wire-level fields (mirror openapi.yaml TierPromotion)
  event_id            UUID         NOT NULL UNIQUE,         -- TierPromotion.id; lets us join to RM echoes
  agent_id            TEXT         NOT NULL,
  from_tier           TEXT         NOT NULL,                -- 'T0'..'T4' (was 'prior_tier' in the original card body; renamed to match the spec)
  to_tier             TEXT         NOT NULL,                -- 'T0'..'T4'
  promoted_by         TEXT         NOT NULL,                -- principal that authorised the change
  promoted_at         TIMESTAMPTZ  NOT NULL,                -- when the promotion was applied (RFC3339 in, timestamptz out)
  capabilities_added  JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- PBOM delta: array of "<verb>:<resource>:<scope?>" strings
  request_id          UUID,                                 -- dedup token echoed on resulting Mandate (nullable for legacy)
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- free-form context bag (closed at root; metadata allows any keys per openapi.yaml)

  -- Audit-only denormalisations (not on the wire)
  policies_evaluated  JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- array of { policy_id, parameters } — RM reconstructs rationale from this
  idempotency_key     TEXT         NOT NULL UNIQUE,         -- sha256(agent_id|from_tier|promoted_at|promoted_by)

  recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- RM queries: "show me this agent's promotion history, newest first"
CREATE INDEX IF NOT EXISTS idx_tier_promotions_agent_promoted_at
  ON aware_tier_promotions (agent_id, promoted_at DESC);

-- Operator queries: "what did this principal promote?" — surfaces who authorised what
CREATE INDEX IF NOT EXISTS idx_tier_promotions_promoted_by
  ON aware_tier_promotions (promoted_by, promoted_at DESC);

-- Forward-joins from the wire-level UUID (RM echoes on Mandate.triggering_event_id)
-- UNIQUE constraint above already covers the lookup; the index makes it fast.