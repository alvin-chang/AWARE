-- Migration 002: aware_prm_cache table
-- Phase 2.2 of AWARE 2.0 — Postgres-backed PRM score cache.
--
-- Caches Process Reward Model (PRM) judge scores from heavy-think.
-- Keyed by SHA-256 hash of canonicalized {problem, reasoning, task_type, context, prm_model}.
-- Same inputs → same PRM score (with temperature=0), so we can skip the LLM call on cache hit.
--
-- Schema design:
--   - content_hash is the SHA-256 hex of the canonicalized input tuple
--   - UPSERT on conflict increments hit_count and bumps last_hit_at
--   - hit_count is the "usefulness" signal — high hit_count rows are valuable training data
--   - last_hit_at drives TTL: rows older than config.prmCache.ttlDays are filtered on read
--   - prm_model lets us invalidate by version: bump the model name → old rows become orphans
--
-- Out of scope (Phase 2.2):
--   - Background vacuum of expired rows (TTL is a read-side filter, not a sweeper)
--   - Distributed cache (this is a single-coordinator local cache by design)

CREATE TABLE IF NOT EXISTS aware_prm_cache (
    content_hash    CHAR(64)        PRIMARY KEY,
    score           NUMERIC(4,3)    NOT NULL CHECK (score >= 0 AND score <= 1),
    strengths       JSONB           NOT NULL DEFAULT '[]'::jsonb,
    weaknesses      JSONB           NOT NULL DEFAULT '[]'::jsonb,
    confidence      NUMERIC(4,3)    NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    prm_model       TEXT            NOT NULL DEFAULT 'primary-model',
    prm_cost_usd    NUMERIC(10,6)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_hit_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    hit_count       INTEGER         NOT NULL DEFAULT 1 CHECK (hit_count >= 0)
);

-- For TTL sweeps and "what's hot" diagnostics.
CREATE INDEX IF NOT EXISTS aware_prm_cache_last_hit_idx
    ON aware_prm_cache (last_hit_at);

-- For "which model scored this" diagnostics.
CREATE INDEX IF NOT EXISTS aware_prm_cache_prm_model_idx
    ON aware_prm_cache (prm_model);
