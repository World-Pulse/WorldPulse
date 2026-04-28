import type { Knex } from 'knex'

/**
 * Add source_url column to signals table.
 * This column is referenced by many routes (public, rss, pulse, source-packs, etc.)
 * but was missing from prod due to schema drift during the Apr 3-5 DB recovery.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('signals', 'source_url')
  if (!hasColumn) {
    await knex.schema.alterTable('signals', (t) => {
      t.string('source_url', 512).nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('signals', 'source_url')
  if (hasColumn) {
    await knex.schema.alterTable('signals', (t) => {
      t.dropColumn('source_url')
    })
  }
}
