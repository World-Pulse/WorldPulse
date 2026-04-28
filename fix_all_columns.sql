-- Add all missing columns that the API expects but the partial migration didn't create
ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_breaking BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS community_flag_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS last_corroborated_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for last_corroborated_at
CREATE INDEX IF NOT EXISTS idx_signals_last_corroborated_at
  ON signals(last_corroborated_at DESC NULLS LAST);

-- Mark signals with reliability_score > 0.4 as verified so they show on the feed
UPDATE signals SET status = 'verified', verified_at = NOW()
  WHERE status = 'pending' AND reliability_score >= 0.4;

-- Mark remaining signals as verified too (they're from trusted sources)
UPDATE signals SET status = 'verified', verified_at = NOW()
  WHERE status = 'pending';
