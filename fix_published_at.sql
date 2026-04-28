ALTER TABLE signals ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE signals SET published_at = COALESCE(event_time, first_reported, created_at) WHERE published_at IS NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_ids UUID[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_signals_published_at ON signals(published_at DESC);
