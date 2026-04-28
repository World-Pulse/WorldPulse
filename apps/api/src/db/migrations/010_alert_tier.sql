-- Migration 010: Alert Tier Classification Column
-- Adds alert_tier to signals table for FLASH / PRIORITY / ROUTINE urgency classification.
-- Backfills existing rows using the same logic as computeAlertTier() in lib/alert-tier.ts.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS alert_tier VARCHAR(8) NOT NULL DEFAULT 'ROUTINE';

-- Index for efficient filtering by tier (e.g. GET /feed?tier=FLASH)
CREATE INDEX IF NOT EXISTS idx_signals_alert_tier ON signals(alert_tier);

-- Backfill existing signals using classification rules:
--   FLASH:    critical severity + reliability_score >= 0.65
--             OR critical severity + category = 'breaking'
--   PRIORITY: critical (below FLASH), high severity, or breaking/conflict/disaster category
--   ROUTINE:  everything else
UPDATE signals
SET alert_tier = CASE
  WHEN severity = 'critical'
    AND (reliability_score >= 0.65 OR category = 'breaking')
    THEN 'FLASH'
  WHEN severity IN ('critical', 'high')
    OR category IN ('breaking', 'conflict', 'disaster')
    THEN 'PRIORITY'
  ELSE 'ROUTINE'
END;
