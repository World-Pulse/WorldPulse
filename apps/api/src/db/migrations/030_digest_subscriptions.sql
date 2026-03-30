-- Migration 030: digest_subscriptions
-- Weekly/daily email digest subscription management

CREATE TABLE IF NOT EXISTS digest_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  frequency    TEXT        NOT NULL DEFAULT 'weekly'
                           CHECK (frequency IN ('daily', 'weekly')),
  categories   TEXT[]      DEFAULT '{}',
  min_severity TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (min_severity IN ('critical', 'high', 'medium', 'low', 'info')),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Only one active subscription per email address
CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_subscriptions_email
  ON digest_subscriptions(email) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_user_id
  ON digest_subscriptions(user_id);
