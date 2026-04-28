import type { Knex } from 'knex'

/**
 * Phase 1.6.2 — Persistent Event Threads
 *
 * Graduates ephemeral Redis correlation clusters into durable PostgreSQL
 * event threads that track developing stories over weeks.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('event_threads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.string('title', 300).notNullable()
    t.text('summary').nullable()                    // LLM-generated narrative arc
    t.string('category', 50).notNullable()
    t.string('region', 200).nullable()
    t.string('status', 20).notNullable().defaultTo('developing')
      // developing | escalating | stable | resolved
    t.string('peak_severity', 20).notNullable().defaultTo('low')
    t.integer('signal_count').notNullable().defaultTo(0)
    t.integer('source_count').notNullable().defaultTo(0)
    t.float('avg_reliability').defaultTo(0)
    t.jsonb('severity_trajectory').defaultTo('[]')
      // Array of { timestamp, avg_severity_rank, signal_count }
    t.jsonb('related_entities').defaultTo('[]')
      // Array of { name, type, mention_count }
    t.string('cluster_id').nullable()               // Original Redis cluster_id
    t.timestamp('first_seen').notNullable().defaultTo(knex.fn.now())
    t.timestamp('last_updated').notNullable().defaultTo(knex.fn.now())
    t.timestamp('resolved_at').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())

    t.index(['status'])
    t.index(['category'])
    t.index(['last_updated'])
    t.index(['first_seen'])
    t.index(['cluster_id'])
  })

  await knex.schema.createTable('event_thread_signals', (t) => {
    t.uuid('thread_id').notNullable().references('id').inTable('event_threads').onDelete('CASCADE')
    t.uuid('signal_id').notNullable()
    t.string('role', 20).notNullable().defaultTo('member')
      // primary | member — the highest-severity signal is "primary"
    t.timestamp('added_at').defaultTo(knex.fn.now())

    t.primary(['thread_id', 'signal_id'])
    t.index(['signal_id'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('event_thread_signals')
  await knex.schema.dropTableIfExists('event_threads')
}
