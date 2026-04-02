import type { Knex } from 'knex'

/**
 * Migration: Country Resilience Cache Table
 *
 * Creates `country_resilience_cache` for persisting computed resilience scores
 * beyond Redis TTL, enabling historical trend tracking over time.
 *
 * Columns:
 *   country_code     — ISO 3166-1 alpha-2, primary key
 *   composite_score  — weighted composite 0–100 (higher = more resilient)
 *   dimensions       — jsonb snapshot of per-dimension scores
 *   risk_level       — Low | Moderate | Elevated | High | Critical
 *   risk_color       — hex color string for UI
 *   trend            — improving | stable | deteriorating
 *   trend_delta      — numeric change vs previous period
 *   signals_analyzed — total signals used in computation
 *   computed_at      — timestamp of last computation
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('country_resilience_cache', (t) => {
    t.string('country_code', 2).primary()
    t.float('composite_score').notNullable().defaultTo(100)
    t.jsonb('dimensions').notNullable().defaultTo('{}')
    t.string('risk_level', 20).notNullable().defaultTo('Low')
    t.string('risk_color', 10).notNullable().defaultTo('#00e676')
    t.string('trend', 20).notNullable().defaultTo('stable')
    t.float('trend_delta').notNullable().defaultTo(0)
    t.integer('signals_analyzed').notNullable().defaultTo(0)
    t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  })

  // Index on composite_score for fast ranking queries
  await knex.schema.raw(
    'CREATE INDEX idx_country_resilience_score ON country_resilience_cache (composite_score DESC)'
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('country_resilience_cache')
}
