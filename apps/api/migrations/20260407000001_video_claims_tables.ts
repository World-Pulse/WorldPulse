/**
 * Migration: Video Claims Tables
 *
 * Creates tables for the Video/Transcript Claim Extraction pipeline:
 *   - video_sources     — Tracked video sources (YouTube, broadcasts, debates)
 *   - video_transcripts — Speech-to-text transcripts with segments
 *   - video_claims      — Extracted claims with type, confidence, verification
 *   - video_visual_ctx  — Visual context (chyrons, graphics, lower-thirds)
 *
 * Supports multi-language, speaker diarization, visual corroboration,
 * and cross-referencing against existing WorldPulse signals.
 *
 * @module migrations/20260407000001_video_claims_tables
 */

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // ── video_sources ─────────────────────────────────────────────────────
  await knex.schema.createTable('video_sources', (t) => {
    t.text('id').primary()
    t.text('url').notNullable()
    t.text('url_hash').notNullable().unique()
    t.text('type').notNullable()           // youtube | news_broadcast | political_debate | press_conference | un_session | direct_url | live_stream
    t.text('title').notNullable()
    t.text('publisher').notNullable()
    t.text('language').notNullable().defaultTo('en')
    t.integer('duration_s').notNullable().defaultTo(0)
    t.text('resolution').defaultTo('unknown')
    t.text('channel_name')
    t.timestamp('broadcast_date')
    t.text('country_code')
    t.text('thumbnail_url')
    t.jsonb('metadata').defaultTo('{}')
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  // ── video_transcripts ─────────────────────────────────────────────────
  await knex.schema.createTable('video_transcripts', (t) => {
    t.text('id').primary()
    t.text('source_id').notNullable().references('id').inTable('video_sources').onDelete('CASCADE')
    t.text('full_text').notNullable().defaultTo('')
    t.jsonb('segments').defaultTo('[]')     // TranscriptSegment[]
    t.integer('speaker_count').defaultTo(0)
    t.text('provider').notNullable()        // whisper | deepgram | assemblyai | google_stt | local
    t.text('language').notNullable().defaultTo('en')
    t.integer('word_count').defaultTo(0)
    t.timestamp('extracted_at').defaultTo(knex.fn.now())
  })

  // ── video_claims ──────────────────────────────────────────────────────
  await knex.schema.createTable('video_claims', (t) => {
    t.text('id').primary()
    t.text('transcript_id').notNullable().references('id').inTable('video_transcripts').onDelete('CASCADE')
    t.text('source_id').notNullable().references('id').inTable('video_sources').onDelete('CASCADE')
    t.text('text').notNullable()
    t.text('type').notNullable()           // factual | statistical | attribution | causal | predictive | visual | chyron | opinion
    t.float('confidence').notNullable().defaultTo(0)
    t.float('verification_score')
    t.text('status').notNullable().defaultTo('unverified') // verified | disputed | unverified | mixed | opinion | retracted
    t.text('speaker')
    t.float('timestamp_start_s').notNullable().defaultTo(0)
    t.float('timestamp_end_s').notNullable().defaultTo(0)
    t.jsonb('visual_context')               // VisualContext | null
    t.specificType('entities', 'text[]').defaultTo('{}')
    t.jsonb('cross_references').defaultTo('[]')
    t.timestamp('extracted_at').defaultTo(knex.fn.now())
  })

  // ── video_visual_ctx ──────────────────────────────────────────────────
  await knex.schema.createTable('video_visual_ctx', (t) => {
    t.text('id').primary()
    t.text('source_id').notNullable().references('id').inTable('video_sources').onDelete('CASCADE')
    t.float('timestamp_s').notNullable()
    t.text('type').notNullable()           // chyron | graphic | lower_third | title_card | map | chart
    t.text('text').notNullable()
    t.float('confidence').notNullable().defaultTo(0)
    t.text('ocr_raw')
    t.timestamp('detected_at').defaultTo(knex.fn.now())
  })

  // ── Indexes ───────────────────────────────────────────────────────────

  // video_sources indexes
  await knex.schema.raw('CREATE INDEX idx_video_sources_type ON video_sources (type)')
  await knex.schema.raw('CREATE INDEX idx_video_sources_language ON video_sources (language)')
  await knex.schema.raw('CREATE INDEX idx_video_sources_country ON video_sources (country_code)')
  await knex.schema.raw('CREATE INDEX idx_video_sources_broadcast ON video_sources (broadcast_date DESC NULLS LAST)')
  await knex.schema.raw('CREATE INDEX idx_video_sources_created ON video_sources (created_at DESC)')

  // video_transcripts indexes
  await knex.schema.raw('CREATE INDEX idx_video_transcripts_source ON video_transcripts (source_id)')
  await knex.schema.raw('CREATE INDEX idx_video_transcripts_language ON video_transcripts (language)')

  // video_claims indexes
  await knex.schema.raw('CREATE INDEX idx_video_claims_source ON video_claims (source_id)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_transcript ON video_claims (transcript_id)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_type ON video_claims (type)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_status ON video_claims (status)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_confidence ON video_claims (confidence DESC)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_timestamp ON video_claims (timestamp_start_s)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_extracted ON video_claims (extracted_at DESC)')
  await knex.schema.raw('CREATE INDEX idx_video_claims_speaker ON video_claims (speaker) WHERE speaker IS NOT NULL')
  await knex.schema.raw('CREATE INDEX idx_video_claims_entities ON video_claims USING GIN (entities)')

  // video_visual_ctx indexes
  await knex.schema.raw('CREATE INDEX idx_video_visual_source ON video_visual_ctx (source_id)')
  await knex.schema.raw('CREATE INDEX idx_video_visual_type ON video_visual_ctx (type)')
  await knex.schema.raw('CREATE INDEX idx_video_visual_timestamp ON video_visual_ctx (timestamp_s)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('video_visual_ctx')
  await knex.schema.dropTableIfExists('video_claims')
  await knex.schema.dropTableIfExists('video_transcripts')
  await knex.schema.dropTableIfExists('video_sources')
}
