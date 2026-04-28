CREATE TABLE IF NOT EXISTS api_keys (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  key_hash           TEXT        NOT NULL UNIQUE,
  tier               TEXT        NOT NULL CHECK (tier IN ('free','pro','enterprise')),
  rate_limit_per_min INT         NOT NULL DEFAULT 60,
  rate_limit_per_day INT         NOT NULL DEFAULT 1000,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  last_used_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user     ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash     ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active   ON api_keys(user_id) WHERE is_active = true;
