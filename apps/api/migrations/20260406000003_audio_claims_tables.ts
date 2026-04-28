/**
 * Migration: Audio Claims Tables
 *
 * Creates tables for the Audio/Podcast Claim Extraction pipeline:
 *   - audio_sources: tracked podcast/audio feeds
 *   - audio_transcripts: speech-to-text output with segments
 *   - audio_claims: extracted checkable claims with verification status
 */

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // ─── audio_sources ──────────────────────────────────────────────
  await knex.schema.createTable('audio_sources', (t) => {
    t.string('id', 16).primary()                      // sha256 truncated
    t.text('url').notNullable().unique()
    t.string('type', 20).notNullable()                 // podcast | youtube | direct_url | live_stream
    t.text('title').notNullable()
    t.text('publisher').notNullable()
    t.string('language', 5).notNullable().defaultTo('en')
    t.integer('duration_s').nullable()
    t.timestamp('published_at').nullable()
    t.text('podcast_name').nullable()
    t.integer('episode_number').nullable()
    t.jsonb('metadata').defaultTo('{}')
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('last_processed_at').nullable()

    t.index(['type'], 'idx_audio_sources_type')
    t.index(['publisher'], 'idx_audio_sources_publisher')
    t.index(['language'], 'idx_audio_sources_language')
    t.index(['published_at'], 'idx_audio_sources_published_at')
  })

  // ─── audio_transcripts ──────────────────────────────────────────
  await knex.schema.createTable('audio_transcripts', (t) => {
    t.string('id', 16).primary()
    t.string('source_id', 16).notNullable()
      .references('id').inTable('audio_sources').onDelete('CASCADE')
    t.text('full_text').notNullable()
    t.string('language', 5).notNullable().defaultTo('en')
    t.integer('duration_s').notNullable().defaultTo(0)
    t.integer('word_count').notNullable().defaultTo(0)
    t.integer('speaker_count').notNullable().defaultTo(0)
    t.string('provider', 20).notNullable()             // whisper | deepgram | assemblyai | local
    t.jsonb('segments').defaultTo('[]')                 // TranscriptSegment[]
    t.timestamp('transcribed_at').notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())

    t.index(['source_id'], 'idx_audio_transcripts_source')
    t.index(['provider'], 'idx_audio_transcripts_provider')
    t.index(['language'], 'idx_audio_transcripts_language')
    t.index(['transcribed_at'], 'idx_audio_transcripts_time')
  })

  // ─── audio_claims ───────────────────────────────────────────────
  await knex.schema.createTable('audio_claims', (t) => {
    t.string('id', 16).primary()
    t.string('transcript_id', 16).notNullable()
      .references('id').inTable('audio_transcripts').onDelete('CASCADE')
    t.string('source_id', 16).notNullable()
      .references('id').inTable('audio_sources').onDelete('CASCADE')
    t.text('text').notNullable()
    t.string('type', 20).notNullable()                 // factual | statistical | attribution | causal | predictive | opinion
    t.float('confidence').notNullable().defaultTo(0)    // 0-1
    t.float('verification_score').notNullable().defaultTo(0) // 0-1
    t.string('status', 20).notNullable().defaultTo('unverified')
    t.text('speaker').nullable()                        // Speaker label
    t.text('speaker_name').nullable()                   // Resolved name
    t.float('timestamp_start_s').notNullable().defaultTo(0)
    t.float('timestamp_end_s').notNullable().defaultTo(0)
    t.text('context').nullable()
    t.specificType('entities', 'text[]').defaultTo('{}')
    t.jsonb('cross_references').defaultTo('[]')
    t.timestamp('extracted_at').notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())

    t.index(['transcript_id'], 'idx_audio_claims_transcript')
    t.index(['source_id'], 'idx_audio_claims_source')
    t.index(['type'], 'idx_audio_claims_type')
    t.index(['status'], 'idx_audio_claims_status')
    t.index(['confidence'], 'idx_audio_claims_confidence')
    t.index(['verification_score'], 'idx_audio_claims_verification')
    t.index(['extracted_at'], 'idx_audio_claims_extracted')
    t.index(['timestamp_start_s'], 'idx_audio_claims_timestamp')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audio_claims')
  await knex.schema.dropTableIfExists('audio_transcripts')
  await knex.schema.dropTableIfExists('audio_sources')
}
