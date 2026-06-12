-- Migration 004: training_runs table
-- Phase 3 of AWARE 2.0 — Postgres-backed DPO training run registry.
-- The trainer service (src/trainer/index.js) writes a row for every
-- job it submits to Modal, and updates it when the job completes.
--
-- This table is the authoritative record of "what runs have we done
-- and what state are they in" — replaces ad-hoc log scraping.
--
-- Schema is intentionally narrow: metadata about the run, not the
-- full DPO dataset (that lives in the Modal Volume as JSONL).
-- All columns are nullable except: run_id, started_at, status.

CREATE TABLE IF NOT EXISTS aware_training_runs (
  run_id           TEXT         PRIMARY KEY,
  started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  status           TEXT         NOT NULL DEFAULT 'pending',
  -- 'pending' = submitted to Modal, waiting for first poll
  -- 'running' = Modal reported job is in progress
  -- 'completed' = job exited 0 with a checkpoint
  -- 'failed' = job exited non-zero or hit timeout
  -- 'cancelled' = operator killed via AWARE_TRAINER_ENABLED=0

  -- DPO dataset metadata
  n_pairs          INTEGER,
  source           TEXT,         -- 'preference_pairs_volume' | 'azr_self_play' | 'combined'
  dataset_path     TEXT,         -- path on the Modal Volume

  -- Modal job metadata
  modal_job_id     TEXT,
  modal_app_name   TEXT,
  base_model       TEXT,
  gpu_type         TEXT,

  -- DPO hyperparameters (snapshot at submit time)
  beta             REAL,
  learning_rate    REAL,
  epochs           INTEGER,
  per_device_batch_size INTEGER,

  -- Cost / usage tracking (populated when job completes)
  duration_sec     INTEGER,
  estimated_cost_usd  REAL,
  modal_gpu_hours     REAL,

  -- Checkpoint output
  checkpoint_dir   TEXT,         -- path on the Modal Volume
  checkpoint_size_mb REAL,
  active_symlink_target TEXT,    -- resolved active symlink after the run

  -- Failure diagnostics (NULL on success)
  exit_code        INTEGER,
  error_message    TEXT
);

-- The trainer service polls for runs that need status updates.
-- A partial index on status='running' keeps the polling query fast
-- even when the table has millions of historical completed runs.
CREATE INDEX IF NOT EXISTS idx_train_runs_status_running
  ON aware_training_runs (started_at DESC)
  WHERE status = 'running';

-- Operator queries: "what's the most recent run?"
CREATE INDEX IF NOT EXISTS idx_train_runs_started_at
  ON aware_training_runs (started_at DESC);
