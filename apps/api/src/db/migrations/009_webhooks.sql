-- Migration 009: Developer Outbound Webhooks
-- Enables developers to register HTTP endpoints that receive signal events.
-- HMAC-SHA256 signatures ensure authenticity of deliveries.

CREATE TABLE IF NOT EXISTS developer_webhooks (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id          UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  url                 TEXT        NOT NULL,
  secret              TEXT        NOT NULL,          -- HMAC signing secret (never returned after creation)
  events              TEXT[]      NOT NULL DEFAULT ARRAY['signal.new'],
  filters             JSONB       NOT NULL DEFAULT '{}',  -- { category, severity, country_code }
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at   TIMESTAMPTZ,
  total_deliveries    INTEGER     NOT NULL DEFAULT 0,
  failed_deliveries   INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    UUID        NOT NULL REFERENCES developer_webhooks(id) ON DELETE CASCADE,
  event         TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status_code   INTEGER,
  success       BOOLEAN     NOT NULL DEFAULT false,
  error_msg     TEXT,
  duration_ms   INTEGER,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dev_webhooks_user      ON developer_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_webhooks_active    ON developer_webhooks(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh  ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_at  ON webhook_deliveries(delivered_at DESC);
