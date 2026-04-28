/**
 * PULSE AI Publisher System — database foundation
 *
 * Creates the @pulse system user and supporting tables for
 * the autonomous editorial pipeline.
 */
import type { Knex } from 'knex'

// Deterministic UUID so all environments share the same PULSE user ID
export const PULSE_USER_ID = '00000000-0000-4000-a000-000000000001'

export async function up(knex: Knex): Promise<void> {
  // ── 1. Upsert PULSE system user ──────────────────────────────────────────
  // If the old worldpulse_ai user exists, rename it. Otherwise insert fresh.
  await knex.raw(`
    INSERT INTO users (id, handle, display_name, account_type, verified, trust_score, bio, avatar_url)
    VALUES (
      '${PULSE_USER_ID}',
      'pulse',
      'PULSE',
      'ai',
      TRUE,
      1.000,
      'Published Updates on Live Signals & Events — WorldPulse AI Bureau. Autonomous intelligence analysis powered by open-source AI.',
      '/images/pulse-avatar.png'
    )
    ON CONFLICT (id) DO UPDATE SET
      handle       = EXCLUDED.handle,
      display_name = EXCLUDED.display_name,
      bio          = EXCLUDED.bio,
      trust_score  = EXCLUDED.trust_score
  `)

  // Retire old AI digest user if it exists
  await knex.raw(`
    UPDATE users SET suspended = TRUE, suspension_reason = 'Replaced by @pulse'
    WHERE handle = 'worldpulse_ai' AND id != '${PULSE_USER_ID}'
  `)

  // ── 2. PULSE publish log — tracks every piece of content PULSE produces ──
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS pulse_publish_log (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
      content_type  VARCHAR(30) NOT NULL CHECK (content_type IN (
        'flash_brief', 'analysis', 'daily_briefing', 'social_thread', 'weekly_report', 'syndicated'
      )),
      source_signals UUID[] DEFAULT '{}',
      model_used    VARCHAR(100),
      token_count   INTEGER DEFAULT 0,
      generation_ms INTEGER DEFAULT 0,
      published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata      JSONB DEFAULT '{}'
    )
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_pulse_log_type ON pulse_publish_log(content_type)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_pulse_log_date ON pulse_publish_log(published_at DESC)`)

  // ── 3. PULSE syndication — tracks social media posts mirrored back ───────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS pulse_syndication (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      platform      VARCHAR(20) NOT NULL CHECK (platform IN ('x', 'reddit', 'linkedin', 'hackernews')),
      external_id   VARCHAR(255),
      external_url  VARCHAR(512) NOT NULL,
      post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
      title         VARCHAR(500),
      engagement    JSONB DEFAULT '{}',
      synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_checked  TIMESTAMPTZ
    )
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_pulse_synd_platform ON pulse_syndication(platform)`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_synd_ext ON pulse_syndication(platform, external_id)`)

  // ── 4. PULSE queue — pending content awaiting generation/publish ──────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS pulse_queue (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      content_type  VARCHAR(30) NOT NULL,
      priority      INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
      payload       JSONB NOT NULL DEFAULT '{}',
      status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ
    )
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_pulse_queue_status ON pulse_queue(status, priority DESC)`)

  // ── 5. Add pulse_content_type column to posts for easy filtering ──────────
  await knex.raw(`
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS pulse_content_type VARCHAR(30)
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_posts_pulse_type ON posts(pulse_content_type) WHERE pulse_content_type IS NOT NULL`)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE posts DROP COLUMN IF EXISTS pulse_content_type`)
  await knex.raw(`DROP TABLE IF EXISTS pulse_queue CASCADE`)
  await knex.raw(`DROP TABLE IF EXISTS pulse_syndication CASCADE`)
  await knex.raw(`DROP TABLE IF EXISTS pulse_publish_log CASCADE`)
  // Don't delete the PULSE user on rollback — it may have authored posts
}
