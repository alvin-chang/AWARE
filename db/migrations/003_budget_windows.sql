-- Migration 003: budget_windows index
-- Phase 2.3 of AWARE 2.0 — rolling-30d LLM cost budget watchdog.
--
-- The watchdog reads:
--   SELECT COALESCE(SUM(cost_total_usd), 0)::float
--   FROM aware_conversations
--   WHERE ts > now() - $1::interval
--     AND cost_total_usd IS NOT NULL
--     AND ok = true
--
-- (Column note: aware_conversations.ts is the timestamp column — see
-- db/migrations/001_conversations.sql. The watchdog uses ts, not
-- created_at, to match the existing schema.)
--
-- This composite partial index covers that scan:
--   - leading column ts (the range predicate)
--   - trailing column cost_total_usd (the SUM)
--   - partial WHERE ok = true AND cost_total_usd IS NOT NULL keeps it
--     small — only successful requests with a known cost
--
-- Schema design notes:
--   - No schema change to aware_conversations (Phase 2.1 already created it)
--   - No separate budget table — the budget state is derived on read
--     (the spend is in the conversations table, the limits are in env)
--   - The watchdog query is idempotent; running it twice is fine
--
-- Out of scope (Phase 2.3):
--   - Background vacuum of old conversation rows
--   - Per-user / per-agent budget attribution (the watchdog is global)
--   - Budget forecast / trend (just current spend vs limits)

CREATE INDEX IF NOT EXISTS idx_conv_cost_ts
    ON aware_conversations (ts, cost_total_usd)
    WHERE cost_total_usd IS NOT NULL AND ok = true;
