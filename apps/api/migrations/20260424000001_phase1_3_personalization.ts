/**
 * Phase 1.3 — Personalization Layer
 *
 * Creates tables for:
 *   1. user_interactions — implicit learning (clicks, expands, bookmarks)
 *   2. alert_rules — "Notify me when CRITICAL + [category] + [region]"
 *   3. saved_searches — save filter combo, one-click access
 */
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // ── 1. User interactions — implicit learning ───────────────────────────
  // Tracks clicks, expands, and time-on-signal for implicit interest learning.
  // After 50+ interactions, the system infers interests without explicit config.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS user_interactions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_id     UUID REFERENCES signals(id) ON DELETE SET NULL,
      post_id       UUID REFERENCES posts(id) ON DELETE SET NULL,
      interaction_type TEXT NOT NULL CHECK (interaction_type IN ('click', 'expand', 'bookmark', 'share', 'dwell')),
      category      TEXT,
      country_code  TEXT,
      severity      TEXT,
      metadata      JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Indexes for querying user history and computing interest weights
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions (user_id)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user_interactions_user_created ON user_interactions (user_id, created_at DESC)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_user_interactions_user_category ON user_interactions (user_id, category)`)

  // ── 2. Alert rules — user-defined notification triggers ────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      enabled       BOOLEAN NOT NULL DEFAULT TRUE,
      -- Match criteria (all optional — empty = match all)
      min_severity  TEXT DEFAULT 'critical' CHECK (min_severity IN ('critical', 'high', 'medium', 'low', 'info')),
      categories    TEXT[] DEFAULT '{}',
      regions       TEXT[] DEFAULT '{}',
      country_codes TEXT[] DEFAULT '{}',
      keywords      TEXT[] DEFAULT '{}',
      -- Delivery channels
      notify_email  BOOLEAN NOT NULL DEFAULT TRUE,
      notify_in_app BOOLEAN NOT NULL DEFAULT TRUE,
      notify_push   BOOLEAN NOT NULL DEFAULT FALSE,
      -- Rate limiting
      cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      last_triggered_at TIMESTAMPTZ,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      -- Timestamps
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_alert_rules_user_id ON alert_rules (user_id)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = TRUE`)

  // ── 3. Alert history — what got sent ───────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_id     UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
      channels      TEXT[] NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_alert_history_user_id ON alert_history (user_id, created_at DESC)`)

  // ── 4. Saved searches ─────────────────────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      -- Saved filter state
      query         TEXT,
      search_type   TEXT DEFAULT 'all',
      categories    TEXT[] DEFAULT '{}',
      severities    TEXT[] DEFAULT '{}',
      countries     TEXT[] DEFAULT '{}',
      date_from     TIMESTAMPTZ,
      date_to       TIMESTAMPTZ,
      min_reliability INTEGER,
      sort_by       TEXT DEFAULT 'newest',
      -- Usage tracking
      use_count     INTEGER NOT NULL DEFAULT 0,
      last_used_at  TIMESTAMPTZ,
      -- Timestamps
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches (user_id)`)

  // ── 5. In-app notifications table ──────────────────────────────────────
  // Generic notification store for alert rule matches and other events
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type          TEXT NOT NULL CHECK (type IN ('alert_match', 'mention', 'reply', 'system')),
      title         TEXT NOT NULL,
      body          TEXT,
      link          TEXT,
      signal_id     UUID REFERENCES signals(id) ON DELETE SET NULL,
      rule_id       UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
      read          BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read, created_at DESC)`)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS notifications CASCADE')
  await knex.raw('DROP TABLE IF EXISTS saved_searches CASCADE')
  await knex.raw('DROP TABLE IF EXISTS alert_history CASCADE')
  await knex.raw('DROP TABLE IF EXISTS alert_rules CASCADE')
  await knex.raw('DROP TABLE IF EXISTS user_interactions CASCADE')
}
