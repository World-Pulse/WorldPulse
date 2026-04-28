/**
 * Audio/Podcast Claim Extraction API Routes
 *
 * Provides endpoints for submitting audio sources, retrieving transcripts,
 * and querying extracted claims — WorldPulse's counter to Factiverse's
 * live audio fact-checking capability.
 *
 * Endpoints:
 *   GET  /sources           — List tracked audio/podcast sources
 *   GET  /sources/:id       — Get source detail + recent claims
 *   POST /sources           — Submit a new audio source for processing
 *   GET  /claims            — Search/filter extracted audio claims
 *   GET  /claims/:id        — Get claim detail with cross-references
 *   GET  /transcripts/:id   — Get transcript with segments
 *   GET  /stats             — Audio claim extraction statistics
 *   GET  /podcasts          — List monitored news podcast feeds
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AudioSourceType = 'podcast' | 'youtube' | 'direct_url' | 'live_stream'
export type AudioClaimType = 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive' | 'opinion'
export type AudioClaimStatus = 'verified' | 'disputed' | 'unverified' | 'mixed' | 'opinion'

export const AUDIO_SOURCE_TYPES: AudioSourceType[] = ['podcast', 'youtube', 'direct_url', 'live_stream']
export const AUDIO_CLAIM_TYPES: AudioClaimType[] = ['factual', 'statistical', 'attribution', 'causal', 'predictive', 'opinion']
export const AUDIO_CLAIM_STATUSES: AudioClaimStatus[] = ['verified', 'disputed', 'unverified', 'mixed', 'opinion']

export const SORT_FIELDS = ['confidence', 'verification_score', 'timestamp_start_s', 'extracted_at', 'status'] as const
export type SortField = typeof SORT_FIELDS[number]

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function clampPage(page: unknown, fallback = 1): number {
  const n = Number(page)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 1000)
}

export function clampLimit(limit: unknown, fallback = 20): number {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 100)
}

export function isValidSortField(field: unknown): field is SortField {
  return typeof field === 'string' && SORT_FIELDS.includes(field as SortField)
}

export function mapSourceRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    url: String(row.url ?? ''),
    type: String(row.type ?? 'direct_url') as AudioSourceType,
    title: String(row.title ?? ''),
    publisher: String(row.publisher ?? ''),
    language: String(row.language ?? 'en'),
    duration_s: row.duration_s != null ? Number(row.duration_s) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    podcast_name: row.podcast_name ? String(row.podcast_name) : null,
    episode_number: row.episode_number != null ? Number(row.episode_number) : null,
    metadata: row.metadata ?? {},
    created_at: String(row.created_at ?? ''),
    last_processed_at: row.last_processed_at ? String(row.last_processed_at) : null,
  }
}

export function mapClaimRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    transcript_id: String(row.transcript_id ?? ''),
    source_id: String(row.source_id ?? ''),
    text: String(row.text ?? ''),
    type: String(row.type ?? 'factual') as AudioClaimType,
    confidence: Number(row.confidence ?? 0),
    verification_score: Number(row.verification_score ?? 0),
    status: String(row.status ?? 'unverified') as AudioClaimStatus,
    speaker: row.speaker ? String(row.speaker) : null,
    speaker_name: row.speaker_name ? String(row.speaker_name) : null,
    timestamp_start_s: Number(row.timestamp_start_s ?? 0),
    timestamp_end_s: Number(row.timestamp_end_s ?? 0),
    context: row.context ? String(row.context) : null,
    entities: Array.isArray(row.entities) ? row.entities : [],
    cross_references: row.cross_references ?? [],
    extracted_at: String(row.extracted_at ?? ''),
  }
}

export function mapTranscriptRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    source_id: String(row.source_id ?? ''),
    language: String(row.language ?? 'en'),
    duration_s: Number(row.duration_s ?? 0),
    word_count: Number(row.word_count ?? 0),
    speaker_count: Number(row.speaker_count ?? 0),
    provider: String(row.provider ?? 'whisper'),
    segments: row.segments ?? [],
    transcribed_at: String(row.transcribed_at ?? ''),
  }
}

// ─── News Podcast Registry (for /podcasts endpoint) ─────────────────────────

export const NEWS_PODCAST_FEEDS = [
  { name: 'NPR News Now', publisher: 'NPR', language: 'en', category: 'general_news', feed_url: 'https://feeds.npr.org/500005/podcast.xml' },
  { name: 'The Daily', publisher: 'The New York Times', language: 'en', category: 'general_news', feed_url: 'https://feeds.simplecast.com/54nAGcIl' },
  { name: 'Up First', publisher: 'NPR', language: 'en', category: 'general_news', feed_url: 'https://feeds.npr.org/510318/podcast.xml' },
  { name: 'Post Reports', publisher: 'The Washington Post', language: 'en', category: 'general_news', feed_url: 'https://feeds.megaphone.fm/PPY6458293959' },
  { name: 'The Intelligence', publisher: 'The Economist', language: 'en', category: 'analysis', feed_url: 'https://rss.acast.com/theintelligencepodcast' },
  { name: 'Global News Podcast', publisher: 'BBC World Service', language: 'en', category: 'international', feed_url: 'https://podcasts.files.bbci.co.uk/p02nq0gn.rss' },
  { name: 'France 24 — International News', publisher: 'France 24', language: 'en', category: 'international', feed_url: 'https://www.france24.com/en/podcasts/rss' },
  { name: 'Al Jazeera — The Take', publisher: 'Al Jazeera', language: 'en', category: 'international', feed_url: 'https://podcast.aljazeera.com/podcasts/thetake.xml' },
  { name: 'The Lawfare Podcast', publisher: 'Lawfare', language: 'en', category: 'security', feed_url: 'https://www.lawfaremedia.org/feed/lawfare-podcast-feed' },
  { name: 'War on the Rocks', publisher: 'War on the Rocks', language: 'en', category: 'security', feed_url: 'https://warontherocks.com/feed/podcast/' },
  { name: 'Hard Fork', publisher: 'The New York Times', language: 'en', category: 'technology', feed_url: 'https://feeds.simplecast.com/l2i9YnTd' },
  { name: 'Pivot', publisher: 'New York Magazine', language: 'en', category: 'technology', feed_url: 'https://feeds.megaphone.fm/pivot' },
  { name: 'Planet Money', publisher: 'NPR', language: 'en', category: 'economics', feed_url: 'https://feeds.npr.org/510289/podcast.xml' },
  { name: 'Science Friday', publisher: 'WNYC', language: 'en', category: 'science', feed_url: 'https://feeds.feedburner.com/sciencefriday' },
  { name: 'Reveal', publisher: 'The Center for Investigative Reporting', language: 'en', category: 'investigative', feed_url: 'https://feeds.megaphone.fm/revealpodcast' },
  { name: 'Journal en français facile', publisher: 'RFI', language: 'fr', category: 'international', feed_url: 'https://www.rfi.fr/fr/podcasts/journal-français-facile/podcast' },
  { name: 'El Hilo', publisher: 'Radio Ambulante', language: 'es', category: 'international', feed_url: 'https://feeds.megaphone.fm/elhilo' },
  { name: 'NachDenkSeiten', publisher: 'NachDenkSeiten', language: 'de', category: 'analysis', feed_url: 'https://www.nachdenkseiten.de/feed/' },
  { name: 'Internationalen', publisher: 'Dagens Nyheter', language: 'sv', category: 'international', feed_url: 'https://rss.acast.com/internationalen' },
  { name: 'Odd Lots', publisher: 'Bloomberg', language: 'en', category: 'economics', feed_url: 'https://feeds.bloomberg.com/podcasts/etf_iq.xml' },
] as const

// ─── Route Plugin ────────────────────────────────────────────────────────────

const audioClaimsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /sources — List tracked audio sources ──────────────────────────────
  fastify.get('/sources', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const page = clampPage(q.page)
      const limit = clampLimit(q.limit)
      const offset = (page - 1) * limit
      const typeFilter = q.type && AUDIO_SOURCE_TYPES.includes(q.type as AudioSourceType)
        ? q.type : null
      const search = q.search?.trim() || null
      const language = q.language?.trim() || null

      const cacheKey = `audio:sources:${typeFilter}:${language}:${search}:${page}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))

      const conditions: string[] = []
      const params: unknown[] = []

      if (typeFilter) { conditions.push(`type = ?`); params.push(typeFilter) }
      if (language) { conditions.push(`language = ?`); params.push(language) }
      if (search) { conditions.push(`(title ILIKE ? OR publisher ILIKE ? OR podcast_name ILIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const countResult = await db.raw(`SELECT COUNT(*) as total FROM audio_sources ${where}`, params)
      const total = Number(countResult.rows[0]?.total ?? 0)

      const rows = await db.raw(
        `SELECT * FROM audio_sources ${where} ORDER BY last_processed_at DESC NULLS LAST, created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      const response = {
        data: rows.rows.map(mapSourceRow),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }

      await redis.setex(cacheKey, 300, JSON.stringify(response)) // 5 min cache
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch audio sources')
    }
  })

  // ── GET /sources/:id — Source detail + recent claims ──────────────────────
  fastify.get('/sources/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }

      const cached = await redis.get(`audio:source:${id}`)
      if (cached) return reply.send(JSON.parse(cached))

      const sourceResult = await db.raw('SELECT * FROM audio_sources WHERE id = ?', [id])
      if (sourceResult.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Audio source not found')

      const source = mapSourceRow(sourceResult.rows[0])

      // Get recent claims from this source
      const claimsResult = await db.raw(
        `SELECT * FROM audio_claims WHERE source_id = ? ORDER BY extracted_at DESC LIMIT 20`,
        [id],
      )

      // Get transcript summary
      const transcriptResult = await db.raw(
        `SELECT id, duration_s, word_count, speaker_count, provider, transcribed_at
         FROM audio_transcripts WHERE source_id = ? ORDER BY transcribed_at DESC LIMIT 5`,
        [id],
      )

      const response = {
        source,
        recent_claims: claimsResult.rows.map(mapClaimRow),
        transcripts: transcriptResult.rows.map(mapTranscriptRow),
        claim_count: claimsResult.rows.length,
      }

      await redis.setex(`audio:source:${id}`, 300, JSON.stringify(response))
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch audio source')
    }
  })

  // ── GET /claims — Search/filter audio claims ──────────────────────────────
  fastify.get('/claims', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const page = clampPage(q.page)
      const limit = clampLimit(q.limit)
      const offset = (page - 1) * limit
      const typeFilter = q.type && AUDIO_CLAIM_TYPES.includes(q.type as AudioClaimType)
        ? q.type : null
      const statusFilter = q.status && AUDIO_CLAIM_STATUSES.includes(q.status as AudioClaimStatus)
        ? q.status : null
      const search = q.search?.trim() || null
      const sourceId = q.source_id?.trim() || null
      const minConfidence = q.min_confidence ? Number(q.min_confidence) : null
      const sortField = isValidSortField(q.sort) ? q.sort : 'extracted_at'
      const sortDir = q.order === 'asc' ? 'ASC' : 'DESC'

      const cacheKey = `audio:claims:list:${typeFilter}:${statusFilter}:${sourceId}:${search}:${minConfidence}:${sortField}:${sortDir}:${page}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))

      const conditions: string[] = []
      const params: unknown[] = []

      if (typeFilter) { conditions.push(`c.type = ?`); params.push(typeFilter) }
      if (statusFilter) { conditions.push(`c.status = ?`); params.push(statusFilter) }
      if (sourceId) { conditions.push(`c.source_id = ?`); params.push(sourceId) }
      if (search) { conditions.push(`c.text ILIKE ?`); params.push(`%${search}%`) }
      if (minConfidence != null && Number.isFinite(minConfidence)) {
        conditions.push(`c.confidence >= ?`); params.push(minConfidence)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1'

      const countResult = await db.raw(
        `SELECT COUNT(*) as total FROM audio_claims c ${where}`, params,
      )
      const total = Number(countResult.rows[0]?.total ?? 0)

      const rows = await db.raw(
        `SELECT c.*, s.title as source_title, s.publisher as source_publisher
         FROM audio_claims c
         LEFT JOIN audio_sources s ON s.id = c.source_id
         ${where}
         ORDER BY c.${sortField} ${sortDir}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      const response = {
        data: rows.rows.map((row: Record<string, unknown>) => ({
          ...mapClaimRow(row),
          source_title: row.source_title ? String(row.source_title) : null,
          source_publisher: row.source_publisher ? String(row.source_publisher) : null,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }

      await redis.setex(cacheKey, 120, JSON.stringify(response)) // 2 min cache
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch audio claims')
    }
  })

  // ── GET /claims/:id — Claim detail ────────────────────────────────────────
  fastify.get('/claims/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }

      const cached = await redis.get(`audio:claim:${id}`)
      if (cached) return reply.send(JSON.parse(cached))

      const result = await db.raw(
        `SELECT c.*, s.title as source_title, s.publisher as source_publisher, s.url as source_url
         FROM audio_claims c
         LEFT JOIN audio_sources s ON s.id = c.source_id
         WHERE c.id = ?`,
        [id],
      )
      if (result.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Audio claim not found')

      const row = result.rows[0]
      const response = {
        ...mapClaimRow(row),
        source_title: row.source_title ? String(row.source_title) : null,
        source_publisher: row.source_publisher ? String(row.source_publisher) : null,
        source_url: row.source_url ? String(row.source_url) : null,
      }

      await redis.setex(`audio:claim:${id}`, 300, JSON.stringify(response))
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch audio claim')
    }
  })

  // ── GET /transcripts/:id — Transcript with segments ───────────────────────
  fastify.get('/transcripts/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }

      const cached = await redis.get(`audio:transcript:${id}`)
      if (cached) return reply.send(JSON.parse(cached))

      const result = await db.raw(
        `SELECT t.*, s.title as source_title, s.publisher as source_publisher
         FROM audio_transcripts t
         LEFT JOIN audio_sources s ON s.id = t.source_id
         WHERE t.id = ?`,
        [id],
      )
      if (result.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Transcript not found')

      const row = result.rows[0]
      const response = {
        ...mapTranscriptRow(row),
        full_text: String(row.full_text ?? ''),
        source_title: row.source_title ? String(row.source_title) : null,
        source_publisher: row.source_publisher ? String(row.source_publisher) : null,
      }

      await redis.setex(`audio:transcript:${id}`, 300, JSON.stringify(response))
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch transcript')
    }
  })

  // ── GET /stats — Audio claim extraction statistics ────────────────────────
  fastify.get('/stats', { preHandler: [optionalAuth] }, async (req, reply) => {
    try {
      const cached = await redis.get('audio:stats')
      if (cached) return reply.send(JSON.parse(cached))

      const [sourcesResult, claimsResult, typeBreakdown, statusBreakdown, languageBreakdown] = await Promise.all([
        db.raw('SELECT COUNT(*) as total, SUM(duration_s) as total_duration FROM audio_sources'),
        db.raw('SELECT COUNT(*) as total, AVG(confidence) as avg_confidence, AVG(verification_score) as avg_verification FROM audio_claims'),
        db.raw('SELECT type, COUNT(*) as count FROM audio_claims GROUP BY type ORDER BY count DESC'),
        db.raw('SELECT status, COUNT(*) as count FROM audio_claims GROUP BY status ORDER BY count DESC'),
        db.raw('SELECT language, COUNT(*) as count FROM audio_sources GROUP BY language ORDER BY count DESC'),
      ])

      const response = {
        total_sources: Number(sourcesResult.rows[0]?.total ?? 0),
        total_duration_hours: Math.round((Number(sourcesResult.rows[0]?.total_duration ?? 0) / 3600) * 10) / 10,
        total_claims: Number(claimsResult.rows[0]?.total ?? 0),
        avg_confidence: Math.round(Number(claimsResult.rows[0]?.avg_confidence ?? 0) * 100) / 100,
        avg_verification_score: Math.round(Number(claimsResult.rows[0]?.avg_verification ?? 0) * 100) / 100,
        claim_types: Object.fromEntries(typeBreakdown.rows.map((r: Record<string, unknown>) => [r.type, Number(r.count)])),
        claim_statuses: Object.fromEntries(statusBreakdown.rows.map((r: Record<string, unknown>) => [r.status, Number(r.count)])),
        languages: Object.fromEntries(languageBreakdown.rows.map((r: Record<string, unknown>) => [r.language, Number(r.count)])),
        monitored_podcasts: NEWS_PODCAST_FEEDS.length,
      }

      await redis.setex('audio:stats', 300, JSON.stringify(response))
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch audio claim stats')
    }
  })

  // ── GET /podcasts — List monitored news podcast feeds ─────────────────────
  fastify.get('/podcasts', { preHandler: [optionalAuth] }, async (_req, reply) => {
    try {
      const q = (_req.query as Record<string, string | undefined>)
      const category = q.category?.trim() || null
      const language = q.language?.trim() || null

      let feeds = [...NEWS_PODCAST_FEEDS]
      if (category) feeds = feeds.filter(f => f.category === category)
      if (language) feeds = feeds.filter(f => f.language === language)

      const categories = [...new Set(NEWS_PODCAST_FEEDS.map(f => f.category))]
      const languages = [...new Set(NEWS_PODCAST_FEEDS.map(f => f.language))]

      return reply.send({
        data: feeds,
        total: feeds.length,
        categories,
        languages,
      })
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch podcast feeds')
    }
  })
}

export default audioClaimsRoutes
