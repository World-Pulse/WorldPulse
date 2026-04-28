-- Migration 031: last_corroborated_at
-- Adds a dedicated timestamp tracking when a signal was last corroborated
-- by an additional source. This enables true velocity detection in ViralityBadge
-- (previously relied on last_updated as a proxy, which updates for any reason).
--
-- Applied by: brain agent cycle 16 (2026-03-29)

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS last_corroborated_at TIMESTAMPTZ DEFAULT NULL;

-- Index for sorting/filtering by corroboration recency
CREATE INDEX IF NOT EXISTS idx_signals_last_corroborated_at
  ON signals(last_corroborated_at DESC NULLS LAST);

-- Backfill: for signals that already have multiple sources (corroborated),
-- initialise last_corroborated_at from last_updated as best approximation.
-- Null remains for single-source signals (never corroborated).
UPDATE signals
  SET last_corroborated_at = last_updated
  WHERE source_count > 1
    AND last_corroborated_at IS NULL;

COMMENT ON COLUMN signals.last_corroborated_at IS
  'Timestamp of last cross-source corroboration event. NULL = never corroborated. '
  'Used by ViralityBadge to compute spreading velocity with precision.';
