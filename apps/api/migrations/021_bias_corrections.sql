-- Migration 021: Community Crowdsourced Bias Corrections
-- Allows authenticated users to submit and vote on bias label corrections for sources.
-- Auto-applies when a correction reaches 10+ net votes with 70%+ consensus.

CREATE TABLE IF NOT EXISTS source_bias_corrections (
  id            SERIAL PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  suggested_label VARCHAR(20) NOT NULL CHECK (
    suggested_label IN (
      'far-left','left','center-left','center','center-right','right','far-right',
      'satire','state_media','unknown'
    )
  ),
  notes         TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','applied','rejected','spam')
  ),
  applied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_bias_votes (
  id            SERIAL PRIMARY KEY,
  correction_id INTEGER NOT NULL REFERENCES source_bias_corrections(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote          SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (correction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bias_corrections_source
  ON source_bias_corrections (source_id, status);

CREATE INDEX IF NOT EXISTS idx_bias_votes_correction
  ON source_bias_votes (correction_id);
