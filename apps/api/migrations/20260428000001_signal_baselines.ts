import type { Knex } from 'knex'

/**
 * Phase 1.6.1 — Statistical Baselines
 *
 * Stores daily signal counts by category × region × severity so the system
 * can compute rolling averages, z-scores, and detect genuine anomalies
 * against historical norms.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('signal_baselines', (t) => {
    t.increments('id').primary()
    t.date('date').notNullable()
    t.string('category', 50).notNullable()
    t.string('region', 100).notNullable().defaultTo('global')
    t.string('severity', 20).notNullable().defaultTo('all')
    t.integer('signal_count').notNullable().defaultTo(0)
    t.float('avg_reliability').defaultTo(0)
    t.integer('corroborated_count').defaultTo(0)   // signals with source_count >= 2
    t.integer('day_of_week').notNullable()          // 0=Sunday, 6=Saturday — for seasonality
    t.timestamp('computed_at').defaultTo(knex.fn.now())

    // Unique constraint: one row per date × category × region × severity
    t.unique(['date', 'category', 'region', 'severity'])

    // Query indexes
    t.index(['category', 'region', 'date'])
    t.index(['date'])
  })

  // Anomaly log — records when z-score exceeds threshold
  await knex.schema.createTable('signal_anomalies', (t) => {
    t.increments('id').primary()
    t.date('date').notNullable()
    t.string('category', 50).notNullable()
    t.string('region', 100).notNullable().defaultTo('global')
    t.integer('current_count').notNullable()
    t.float('baseline_avg').notNullable()           // rolling average
    t.float('baseline_stddev').notNullable()         // standard deviation
    t.float('z_score').notNullable()                 // how many σ above/below
    t.string('direction', 10).notNullable()          // 'above' | 'below'
    t.string('window', 10).notNullable()             // '7d' | '30d' | '90d'
    t.boolean('acknowledged').defaultTo(false)
    t.timestamp('detected_at').defaultTo(knex.fn.now())

    t.index(['date', 'category'])
    t.index(['z_score'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('signal_anomalies')
  await knex.schema.dropTableIfExists('signal_baselines')
}
