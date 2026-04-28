import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('posts', (table) => {
    table.boolean('pinned').notNullable().defaultTo(false)
    table.uuid('pinned_in_community_id').nullable().references('id').inTable('communities').onDelete('SET NULL')
  })

  // Index for efficiently querying pinned posts per community
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_pinned_community
    ON posts (pinned_in_community_id, created_at DESC)
    WHERE pinned = TRUE AND deleted_at IS NULL
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('posts', (table) => {
    table.dropColumn('pinned')
    table.dropColumn('pinned_in_community_id')
  })
}
