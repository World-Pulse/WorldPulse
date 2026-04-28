-- Migration 020: Add media bias columns to sources table
-- Supports WorldPulse media bias detection feature (Ground News competitor parity)

ALTER TABLE sources ADD COLUMN IF NOT EXISTS bias_score      DECIMAL(4,3) DEFAULT NULL;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS bias_label      VARCHAR(20)  DEFAULT 'unknown';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS bias_confidence VARCHAR(10)  DEFAULT 'low';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS bias_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sources_bias_label ON sources(bias_label);
