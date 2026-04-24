/**
 * Phase 1.5 — Data Quality Foundation
 *
 * Creates tables for:
 *   1. source_reputation — rolling accuracy/corroboration tracking per source
 *   2. signal_disputes — user-flagged misclassifications
 *   3. geo_validation_log — geographic validation audit trail
 */
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // ── 1. Source reputation — rolling accuracy tracking ────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS source_reputation (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id       TEXT NOT NULL,
      source_name     TEXT NOT NULL,
      -- Rolling 30-day metrics
      total_signals   INTEGER NOT NULL DEFAULT 0,
      corroborated    INTEGER NOT NULL DEFAULT 0,
      disputed        INTEGER NOT NULL DEFAULT 0,
      -- Computed scores (updated by cron job)
      corroboration_rate  REAL DEFAULT 0.0,
      dispute_rate        REAL DEFAULT 0.0,
      computed_reliability REAL,
      base_reliability    REAL NOT NULL DEFAULT 0.5,
      -- Auto-adjustment tracking
      reliability_adjustment REAL DEFAULT 0.0,
      last_adjustment_reason TEXT,
      -- Timestamps
      window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW() - INTERVAL '30 days',
      window_end      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_id)
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_source_reputation_source_id ON source_reputation (source_id)`)

  // ── 2. Signal disputes — user-flagged misclassifications ───────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS signal_disputes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
      user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
      dispute_type    TEXT NOT NULL CHECK (dispute_type IN (
        'wrong_category', 'wrong_severity', 'wrong_location',
        'duplicate', 'spam', 'misleading', 'outdated'
      )),
      original_value  TEXT,
      suggested_value TEXT,
      reason          TEXT,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'auto_resolved')),
      resolved_at     TIMESTAMPTZ,
      resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_signal_disputes_signal_id ON signal_disputes (signal_id)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_signal_disputes_status ON signal_disputes (status) WHERE status = 'pending'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_signal_disputes_type ON signal_disputes (dispute_type, created_at DESC)`)

  // ── 3. Geo validation log — audit trail for geographic checks ──────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS geo_validation_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
      original_location TEXT,
      original_country  TEXT,
      original_lat      REAL,
      original_lng      REAL,
      validated_location TEXT,
      validated_country  TEXT,
      validated_lat      REAL,
      validated_lng      REAL,
      validation_method  TEXT NOT NULL CHECK (validation_method IN ('gazetteer', 'nominatim', 'reverse_geocode', 'country_code_check')),
      confidence        REAL DEFAULT 1.0,
      correction_applied BOOLEAN NOT NULL DEFAULT FALSE,
      issue_found       TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_geo_validation_signal ON geo_validation_log (signal_id)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_geo_validation_issues ON geo_validation_log (issue_found) WHERE issue_found IS NOT NULL`)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS geo_validation_log CASCADE')
  await knex.raw('DROP TABLE IF EXISTS signal_disputes CASCADE')
  await knex.raw('DROP TABLE IF EXISTS source_reputation CASCADE')
}
