-- Migration 001: conversations table
-- Phase 2.1 of AWARE 2.0 — Postgres-backed conversation logger.
-- Every /coordinate call writes a row to this table.
--
-- The schema is intentionally narrow: metadata about the request, not
-- the full conversation. The full refined trace is stored truncated
-- to 8000 chars; the full content lives in the preference-pair JSONL
-- at redacted-internal-pipeline-output/preference-pairs/ (separate write by
-- rl-pipeline).
--
-- All columns are nullable except: request_id, ts, ok, problem.
-- request_id is the canonical key (matches the gateway's x-request-id).

CREATE TABLE IF NOT EXISTS aware_conversations (
  request_id      UUID         PRIMARY KEY,
  ts              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  problem         TEXT         NOT NULL,
  task_type       TEXT,
  k               INT,
  backend_used    TEXT,
  ok              BOOLEAN      NOT NULL,
  confidence      REAL,
  cost_total_usd  REAL,
  refined_trace   TEXT,    -- truncated to 8000 chars
  pair_path       TEXT,    -- path to rl-pipeline preference pair JSONL (nullable)
  session_id      TEXT,
  agent_id        TEXT,
  duration_ms     INT,
  error_kind      TEXT,    -- 'killed' | 'timeout' | 'cost_cap' | 'backend' | 'internal' | NULL on success
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_aware_conversations_ts
  ON aware_conversations (ts DESC);

CREATE INDEX IF NOT EXISTS idx_aware_conversations_session_id
  ON aware_conversations (session_id) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aware_conversations_ok
  ON aware_conversations (ok) WHERE ok = false;
