/**
 * Migration: Knowledge Graph Tables
 *
 * Creates entity_nodes and entity_edges tables for the AI Knowledge Graph.
 * Supports entity-relationship extraction, graph queries, and trending detection.
 *
 * Tables:
 *   - entity_nodes: Named entities (people, organisations, locations, etc.)
 *   - entity_edges: Relationships between entities (leads, sanctions, allied_with, etc.)
 *
 * Indexes optimised for:
 *   - Entity lookup by type + name
 *   - Neighbor traversal (edges by source or target)
 *   - Trending detection (last_seen + mention_count)
 *   - Full-text search on canonical_name
 */

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // ── Entity Nodes ──────────────────────────────────────────────────────
  await knex.schema.createTable('entity_nodes', (t) => {
    t.string('id', 16).primary()                         // sha256 hash prefix
    t.string('type', 32).notNullable()                    // person, organisation, location, etc.
    t.string('canonical_name', 512).notNullable()         // normalised display name
    t.specificType('aliases', 'text[]').defaultTo('{}')   // other forms seen
    t.timestamp('first_seen').notNullable().defaultTo(knex.fn.now())
    t.timestamp('last_seen').notNullable().defaultTo(knex.fn.now())
    t.integer('mention_count').notNullable().defaultTo(1)
    t.specificType('signal_ids', 'text[]').defaultTo('{}') // last N signal references
    t.jsonb('metadata').defaultTo('{}')                    // extensible metadata

    // Indexes
    t.index(['type', 'canonical_name'], 'idx_entity_type_name')
    t.index(['last_seen'], 'idx_entity_last_seen')
    t.index(['mention_count'], 'idx_entity_mention_count')
    t.index(['type'], 'idx_entity_type')
  })

  // GIN index for full-text search on canonical_name
  await knex.raw(`
    CREATE INDEX idx_entity_name_trgm ON entity_nodes
    USING gin (canonical_name gin_trgm_ops)
  `)

  // GIN index for alias array containment
  await knex.raw(`
    CREATE INDEX idx_entity_aliases ON entity_nodes USING gin (aliases)
  `)

  // ── Entity Edges (Relationships) ──────────────────────────────────────
  await knex.schema.createTable('entity_edges', (t) => {
    t.string('id', 16).primary()                         // sha256 hash prefix
    t.string('source_entity_id', 16).notNullable()
    t.string('target_entity_id', 16).notNullable()
    t.string('predicate', 64).notNullable()              // leads, sanctions, allied_with, etc.
    t.float('weight').notNullable().defaultTo(0.5)       // co-occurrence strength 0-1
    t.specificType('signal_ids', 'text[]').defaultTo('{}')
    t.timestamp('first_seen').notNullable().defaultTo(knex.fn.now())
    t.timestamp('last_seen').notNullable().defaultTo(knex.fn.now())

    // Foreign keys
    t.foreign('source_entity_id').references('entity_nodes.id').onDelete('CASCADE')
    t.foreign('target_entity_id').references('entity_nodes.id').onDelete('CASCADE')

    // Indexes for graph traversal
    t.index(['source_entity_id', 'predicate'], 'idx_edge_source_pred')
    t.index(['target_entity_id', 'predicate'], 'idx_edge_target_pred')
    t.index(['predicate'], 'idx_edge_predicate')
    t.index(['weight'], 'idx_edge_weight')
    t.index(['last_seen'], 'idx_edge_last_seen')
  })

  // Composite index for fast neighbor lookups
  await knex.raw(`
    CREATE INDEX idx_edge_both_entities ON entity_edges (source_entity_id, target_entity_id)
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('entity_edges')
  await knex.schema.dropTableIfExists('entity_nodes')
}
