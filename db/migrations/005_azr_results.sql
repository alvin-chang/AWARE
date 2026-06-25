-- Migration 005: aware_azr_results table
-- Phase 4 of AWARE 2.0 — Postgres-backed AZR self-play results registry.
-- Populated by the trainer service after a Modal training run completes
-- (specifically, by parsing the run's azr_corpus.jsonl that the
-- training image writes alongside the DPO dataset — see
-- training/run.py:gen_azr_corpus). Queried by the outcome-filter's
-- new `azr_result` rule, which gates redacted-internal-project preference pairs against
-- AZR pass/fail signals (the AWARE 2.0 Architecture ADR (internal) Decision 2: "AZR outcome filter
-- gates redacted-internal-project process training — signals are NOT merged at the
-- reward level").
--
-- This table is the *join surface* between the two training corpora:
-- - redacted-internal-project pairs come from rl-pipeline preference-pair JSONL files,
--   written from `aware_conversations` rows whose `pair_path` is set.
-- - AZR pairs come from the same Modal training run that emits
--   `azr_corpus.jsonl` (when `gen_azr_corpus` is enabled).
--
-- The join key (per Phase 4 architectural decision, tag-based):
--   (task_type, problem_hash)
-- where `problem_hash` is a sha256 of the normalized `problem` text.
-- This is deterministic, idempotent, and side-steps the question of
-- whether two different phrasings of the same problem are the same
-- problem (that's a future embedding-similarity filter).
--
-- Schema is intentionally narrow: per-AZR-record outcomes + a few
-- metadata fields. The full problem text + chosen/rejected reasoning
-- live in the azr_corpus.jsonl on the Modal Volume (and are
-- reachable via `corpus_path`); the DB row is the queryable index.

CREATE TABLE IF NOT EXISTS aware_azr_results (
  id               BIGSERIAL    PRIMARY KEY,
  run_id           TEXT         NOT NULL REFERENCES aware_training_runs(run_id) ON DELETE CASCADE,
  recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Join key (per Phase 4 architectural decision: tag-based)
  task_type        TEXT         NOT NULL,    -- 'azr_self_play' (current); future: 'code', 'math'
  problem_hash     TEXT         NOT NULL,    -- sha256(normalize_whitespace(problem))

  -- The actual join surface — the redacted-internal-project side needs this to match
  -- against. rl-pipeline writes the same hash into each preference
  -- pair's _content_hash field, so the join is by content-hash.
  content_hash     TEXT         NOT NULL,    -- copied from pair._content_hash (azr_corpus side)

  -- Outcome signal (the gate)
  passed           BOOLEAN      NOT NULL,    -- True iff the chosen solution passed the hidden tests
  verification_method TEXT      NOT NULL DEFAULT 'azr.executor',

  -- Metadata (denormalized for query convenience)
  chosen_score     REAL,                    -- 1.0 if chosen passed, 0.0 if rejected passed (always 1.0 today)
  rejected_score   REAL,                    -- 0.0 today (binary outcome)
  duration_ms      INTEGER,                 -- wall clock for the sandbox run
  corpus_path      TEXT                     -- path to azr_corpus.jsonl on the Modal Volume
);

-- Join index: how the outcome-filter looks up "does this redacted-internal-project
-- pair's (task_type, content_hash) have an AZR result?"
-- Partial index: only successful AZR results, which is what the
-- outcome-filter drops pairs on (failure = hard negative).
CREATE INDEX IF NOT EXISTS idx_azr_results_join_key
  ON aware_azr_results (task_type, content_hash)
  WHERE passed = true;

-- Operator queries: "what was the AZR pass rate for this run?"
CREATE INDEX IF NOT EXISTS idx_azr_results_run_id
  ON aware_azr_results (run_id, recorded_at DESC);

-- Operational queries: "how many AZR results have we accumulated?"
-- (Bumps a counter that's surfaced in the trainer's tick log.)
CREATE INDEX IF NOT EXISTS idx_azr_results_recorded_at
  ON aware_azr_results (recorded_at DESC);
