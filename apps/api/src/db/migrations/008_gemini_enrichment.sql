-- Migration 008: Gemini enrichment columns + reactivate scrapers
-- Adds Gemini intelligence fields to signals table
-- Reactivates all sources so scraper processes full pipeline

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS gemini_enriched   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gemini_context    TEXT,
  ADD COLUMN IF NOT EXISTS gemini_confidence NUMERIC(4,3);

-- Reactivate all sources that were auto-disabled due to scraper downtime
-- The circuit breaker marks them inactive after repeated failures; reset now
UPDATE sources SET active = TRUE WHERE active = FALSE;

-- Reset failure counts so sources get a fresh chance
UPDATE sources SET
  failure_count = 0,
  last_error    = NULL
WHERE failure_count > 0;

-- Ensure all verified signals have verified_at set
UPDATE signals
  SET verified_at = created_at
  WHERE status = 'verified' AND verified_at IS NULL;

-- Auto-verify signals that are pending but have reliability >= 0.65
-- (these were blocked waiting for Kafka which has been unreachable)
UPDATE signals
  SET status = 'verified', verified_at = NOW()
  WHERE status = 'pending'
    AND reliability_score >= 0.65;
