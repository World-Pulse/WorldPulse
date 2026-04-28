-- WorldPulse Production Hotfix Migration
-- Date: 2026-04-15
-- Purpose: Fix schema drift from Apr 3-5 DB recovery
-- Run via: docker exec -i wp_postgres psql -U wp_user -d worldpulse_db < /path/to/migration_hotfix.sql

BEGIN;

-- ─── 1. Add missing category enum values ────────────────────────────────────
-- These were added to init.sql but never applied to prod after DB recovery.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction in PG < 16,
-- so we use a DO block with exception handling per value.

COMMIT;

-- ADD VALUE must run outside a transaction block
DO $$ BEGIN
  ALTER TYPE category ADD VALUE IF NOT EXISTS 'finance';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE category ADD VALUE IF NOT EXISTS 'humanitarian';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE category ADD VALUE IF NOT EXISTS 'weather';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE category ADD VALUE IF NOT EXISTS 'infrastructure';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Widen country_code from CHAR(2) to VARCHAR(3) ───────────────────────
-- ISO 3166-1 alpha-3 codes need 3 chars; some sources send alpha-3.
ALTER TABLE signals ALTER COLUMN country_code TYPE VARCHAR(3);

-- ─── 3. Add missing alert_tier column ────────────────────────────────────────
-- Scraper NWS source INSERTs alert_tier but column was lost in DB recovery.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS alert_tier TEXT;

-- ─── 4. Create developer_webhooks table (simplified, no api_keys FK) ─────────
-- The api_keys table doesn't exist in prod yet; we drop the FK for now.
CREATE TABLE IF NOT EXISTS developer_webhooks (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id          UUID,
  url                 TEXT        NOT NULL,
  secret              TEXT        NOT NULL,
  events              TEXT[]      NOT NULL DEFAULT ARRAY['signal.new'],
  filters             JSONB       NOT NULL DEFAULT '{}',
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

-- ─── Done ────────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT unnest(enum_range(NULL::category));
--   \d signals   (check country_code is varchar(3), alert_tier exists)
--   \d developer_webhooks
