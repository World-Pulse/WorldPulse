/**
 * Video/Transcript Claim Extraction API Routes
 *
 * Provides endpoints for querying video sources, transcripts, and
 * extracted claims — WorldPulse's counter to Factiverse Gather and
 * GDELT's TV translation/knowledge graph capabilities.
 *
 * Endpoints:
 *   GET  /sources           — List tracked video sources
 *   GET  /sources/:id       — Get source detail + recent claims + transcript
 *   GET  /claims            — Search/filter extracted video claims
 *   GET  /claims/:id        — Get claim detail with cross-references
 *   GET  /transcripts/:id   — Get transcript with segments
 *   GET  /stats             — Video claim extraction statistics
 *   GET  /channels          — List monitored video channels
 *   GET  /languages         — Supported language breakdown
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'

// ─── Types ───────────────────────────────────────────────────────────────────

export type VideoSourceType =
  | 'youtube' | 'news_broadcast' | 'political_debate'
  | 'press_conference' | 'un_session' | 'direct_url' | 'live_stream'

export type VideoClaimType =
  | 'factual' | 'statistical' | 'attribution' | 'causal'
  | 'predictive' | 'visual' | 'chyron' | 'opinion'

export type VideoClaimStatus =
  | 'verified' | 'disputed' | 'unverified' | 'mixed' | 'opinion' | 'retracted'

export const VIDEO_SOURCE_TYPES: VideoSourceType[] = [
  'youtube', 'news_broadcast', 'political_debate',
  'press_conference', 'un_session', 'direct_url', 'live_stream',
]

export const VIDEO_CLAIM_TYPES: VideoClaimType[] = [
  'factual', 'statistical', 'attribution', 'causal',
  'predictive', 'visual', 'chyron', 'opinion',
]

export const VIDEO_CLAIM_STATUSES: VideoClaimStatus[] = [
  'verified', 'disputed', 'unverified', 'mixed', 'opinion', 'retracted',
]

export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ar', 'zh', 'ru', 'de', 'pt', 'ja', 'ko', 'hi', 'tr'] as const

export const SORT_FIELDS = ['confidence', 'verification_score', 'timestamp_start_s', 'extracted_at', 'status', 'type'] as const
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

// ─── Monitored Channels ─────────────────────────────────────────────────────

export interface MonitoredChannel {
  name: string
  type: VideoSourceType
  url: string
  language: string
  country: string
  category: string
  update_frequency: string
}

export const MONITORED_CHANNELS: MonitoredChannel[] = [
  // News Broadcasts (10)
  { name: 'BBC News', type: 'news_broadcast', url: 'https://www.youtube.com/@BBCNews', language: 'en', country: 'GB', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'CNN', type: 'news_broadcast', url: 'https://www.youtube.com/@CNN', language: 'en', country: 'US', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'Al Jazeera English', type: 'news_broadcast', url: 'https://www.youtube.com/@AlJazeeraEnglish', language: 'en', country: 'QA', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'DW News', type: 'news_broadcast', url: 'https://www.youtube.com/@DWNews', language: 'en', country: 'DE', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'France 24 English', type: 'news_broadcast', url: 'https://www.youtube.com/@FRANCE24English', language: 'en', country: 'FR', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'NHK World', type: 'news_broadcast', url: 'https://www.youtube.com/@NHKWORLDJAPANNews', language: 'en', country: 'JP', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'CGTN', type: 'news_broadcast', url: 'https://www.youtube.com/@CGTNOfficial', language: 'en', country: 'CN', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'TRT World', type: 'news_broadcast', url: 'https://www.youtube.com/@TRTWorld', language: 'en', country: 'TR', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'WION', type: 'news_broadcast', url: 'https://www.youtube.com/@WIONews', language: 'en', country: 'IN', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'ABC News Australia', type: 'news_broadcast', url: 'https://www.youtube.com/@ABCNewsAustralia', language: 'en', country: 'AU', category: 'News Broadcast', update_frequency: 'daily' },
  // Political Debates (4)
  { name: 'C-SPAN', type: 'political_debate', url: 'https://www.youtube.com/@cspan', language: 'en', country: 'US', category: 'Political Debate', update_frequency: 'daily' },
  { name: 'UK Parliament', type: 'political_debate', url: 'https://www.youtube.com/@UKParliament', language: 'en', country: 'GB', category: 'Political Debate', update_frequency: 'weekly' },
  { name: 'European Parliament', type: 'political_debate', url: 'https://www.youtube.com/@EuropeanParliament', language: 'en', country: 'BE', category: 'Political Debate', update_frequency: 'weekly' },
  { name: 'Australian Parliament', type: 'political_debate', url: 'https://www.youtube.com/@AusParlTV', language: 'en', country: 'AU', category: 'Political Debate', update_frequency: 'weekly' },
  // Press Conferences & UN (3)
  { name: 'White House', type: 'press_conference', url: 'https://www.youtube.com/@WhiteHouse', language: 'en', country: 'US', category: 'Press Conference', update_frequency: 'daily' },
  { name: 'UN Web TV', type: 'un_session', url: 'https://www.youtube.com/@UnitedNations', language: 'en', country: 'US', category: 'UN Session', update_frequency: 'daily' },
  { name: 'NATO Channel', type: 'press_conference', url: 'https://www.youtube.com/@NATOChannel', language: 'en', country: 'BE', category: 'Press Conference', update_frequency: 'weekly' },
  // Investigative (2)
  { name: 'VICE News', type: 'youtube', url: 'https://www.youtube.com/@VICENews', language: 'en', country: 'US', category: 'Investigative', update_frequency: 'daily' },
  { name: 'Bellingcat', type: 'youtube', url: 'https://www.youtube.com/@Bellingcat', language: 'en', country: 'NL', category: 'Investigative', update_frequency: 'weekly' },
  // Multi-language (6)
  { name: 'France 24 Français', type: 'news_broadcast', url: 'https://www.youtube.com/@FRANCE24', language: 'fr', country: 'FR', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'DW Español', type: 'news_broadcast', url: 'https://www.youtube.com/@DWEspanol', language: 'es', country: 'DE', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'Al Jazeera Arabic', type: 'news_broadcast', url: 'https://www.youtube.com/@AlJazeera', language: 'ar', country: 'QA', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'Globo News', type: 'news_broadcast', url: 'https://www.youtube.com/@GloboNews', language: 'pt', country: 'BR', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'Россия 24', type: 'news_broadcast', url: 'https://www.youtube.com/@Russia24TV', language: 'ru', country: 'RU', category: 'News Broadcast', update_frequency: 'daily' },
]

// ─── Route Plugin ────────────────────────────────────────────────────────────

const videoClaimsPlugin: FastifyPluginAsync = async (app) => {
  // ── GET /sources ──────────────────────────────────────────────────────
  app.get('/sources', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const page = clampPage(q.page)
      const limit = clampLimit(q.limit)
      const offset = (page - 1) * limit
      const type = q.type && VIDEO_SOURCE_TYPES.includes(q.type as VideoSourceType) ? q.type : null
      const language = q.language && SUPPORTED_LANGUAGES.includes(q.language as typeof SUPPORTED_LANGUAGES[number]) ? q.language : null
      const search = q.search?.trim() || null

      const cacheKey = `video-sources:${type}:${language}:${search}:${page}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))

      const conditions: string[] = []
      const params: unknown[] = []

      if (type) { conditions.push(`type = ?`); params.push(type) }
      if (language) { conditions.push(`language = ?`); params.push(language) }
      if (search) { conditions.push(`(title ILIKE ? OR publisher ILIKE ? OR channel_name ILIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const [countResult, rows] = await Promise.all([
        db.raw(`SELECT COUNT(*) FROM video_sources ${where}`, params),
        db.raw(`SELECT * FROM video_sources ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
      ])

      const total = parseInt(countResult.rows[0].count, 10)
      const response = { data: rows.rows, total, page, limit, pages: Math.ceil(total / limit) }

      await redis.set(cacheKey, JSON.stringify(response), 'EX', 3600)
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list video sources')
    }
  })

  // ── GET /sources/:id ──────────────────────────────────────────────────
  app.get('/sources/:id', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }

      const [source, claims, transcript] = await Promise.all([
        db.raw('SELECT * FROM video_sources WHERE id = ?', [id]),
        db.raw('SELECT * FROM video_claims WHERE source_id = ? ORDER BY timestamp_start_s LIMIT 50', [id]),
        db.raw('SELECT * FROM video_transcripts WHERE source_id = ? ORDER BY extracted_at DESC LIMIT 1', [id]),
      ])

      if (source.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Video source not found')

      return reply.send({
        source: source.rows[0],
        claims: claims.rows,
        transcript: transcript.rows[0] ?? null,
      })
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch video source')
    }
  })

  // ── GET /claims ───────────────────────────────────────────────────────
  app.get('/claims', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const page = clampPage(q.page)
      const limit = clampLimit(q.limit)
      const offset = (page - 1) * limit
      const type = q.type && VIDEO_CLAIM_TYPES.includes(q.type as VideoClaimType) ? q.type : null
      const status = q.status && VIDEO_CLAIM_STATUSES.includes(q.status as VideoClaimStatus) ? q.status : null
      const sourceId = q.source_id || null
      const speaker = q.speaker?.trim() || null
      const search = q.search?.trim() || null
      const minConfidence = q.min_confidence ? parseFloat(q.min_confidence) : null
      const sortField = isValidSortField(q.sort) ? q.sort : 'extracted_at'
      const sortDir = q.dir === 'asc' ? 'ASC' : 'DESC'

      const cacheKey = `video-claims:${type}:${status}:${sourceId}:${speaker}:${search}:${minConfidence}:${sortField}:${sortDir}:${page}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))

      const conditions: string[] = []
      const params: unknown[] = []

      if (type) { conditions.push(`type = ?`); params.push(type) }
      if (status) { conditions.push(`status = ?`); params.push(status) }
      if (sourceId) { conditions.push(`source_id = ?`); params.push(sourceId) }
      if (speaker) { conditions.push(`speaker ILIKE ?`); params.push(`%${speaker}%`) }
      if (search) { conditions.push(`text ILIKE ?`); params.push(`%${search}%`) }
      if (minConfidence !== null) { conditions.push(`confidence >= ?`); params.push(minConfidence) }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const [countResult, rows] = await Promise.all([
        db.raw(`SELECT COUNT(*) FROM video_claims ${where}`, params),
        db.raw(`SELECT * FROM video_claims ${where} ORDER BY ${sortField} ${sortDir} LIMIT ? OFFSET ?`, [...params, limit, offset]),
      ])

      const total = parseInt(countResult.rows[0].count, 10)
      const response = { data: rows.rows, total, page, limit, pages: Math.ceil(total / limit) }

      await redis.set(cacheKey, JSON.stringify(response), 'EX', 1800)
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list video claims')
    }
  })

  // ── GET /claims/:id ───────────────────────────────────────────────────
  app.get('/claims/:id', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const claim = await db.raw('SELECT * FROM video_claims WHERE id = ?', [id])
      if (claim.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Video claim not found')
      return reply.send(claim.rows[0])
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch video claim')
    }
  })

  // ── GET /transcripts/:id ──────────────────────────────────────────────
  app.get('/transcripts/:id', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const transcript = await db.raw('SELECT * FROM video_transcripts WHERE id = ?', [id])
      if (transcript.rows.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Transcript not found')
      return reply.send(transcript.rows[0])
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch transcript')
    }
  })

  // ── GET /stats ────────────────────────────────────────────────────────
  app.get('/stats', { preHandler: optionalAuth }, async (req, reply) => {
    try {
      const cacheKey = 'video-claims:stats'
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))

      const [sourcesCount, claimsCount, transcriptsCount, typeBreakdown, statusBreakdown, languageBreakdown, sourceTypeBreakdown] = await Promise.all([
        db.raw('SELECT COUNT(*) FROM video_sources'),
        db.raw('SELECT COUNT(*) FROM video_claims'),
        db.raw('SELECT COUNT(*) FROM video_transcripts'),
        db.raw('SELECT type, COUNT(*) as count FROM video_claims GROUP BY type ORDER BY count DESC'),
        db.raw('SELECT status, COUNT(*) as count FROM video_claims GROUP BY status ORDER BY count DESC'),
        db.raw('SELECT language, COUNT(*) as count FROM video_sources GROUP BY language ORDER BY count DESC'),
        db.raw('SELECT type, COUNT(*) as count FROM video_sources GROUP BY type ORDER BY count DESC'),
      ])

      const totalDuration = await db.raw('SELECT COALESCE(SUM(duration_s), 0) as total FROM video_sources')

      const response = {
        sources: parseInt(sourcesCount.rows[0].count, 10),
        claims: parseInt(claimsCount.rows[0].count, 10),
        transcripts: parseInt(transcriptsCount.rows[0].count, 10),
        total_duration_hours: Math.round(parseInt(totalDuration.rows[0].total, 10) / 3600),
        monitored_channels: MONITORED_CHANNELS.length,
        supported_languages: SUPPORTED_LANGUAGES.length,
        by_claim_type: typeBreakdown.rows,
        by_claim_status: statusBreakdown.rows,
        by_language: languageBreakdown.rows,
        by_source_type: sourceTypeBreakdown.rows,
      }

      await redis.set(cacheKey, JSON.stringify(response), 'EX', 3600)
      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch video stats')
    }
  })

  // ── GET /channels ─────────────────────────────────────────────────────
  app.get('/channels', { preHandler: optionalAuth }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const category = q.category?.trim() || null
    const language = q.language?.trim() || null

    let channels = MONITORED_CHANNELS
    if (category) channels = channels.filter(c => c.category.toLowerCase() === category.toLowerCase())
    if (language) channels = channels.filter(c => c.language === language)

    return reply.send({
      channels,
      total: channels.length,
      categories: [...new Set(MONITORED_CHANNELS.map(c => c.category))],
      languages: [...new Set(MONITORED_CHANNELS.map(c => c.language))],
    })
  })

  // ── GET /languages ────────────────────────────────────────────────────
  app.get('/languages', { preHandler: optionalAuth }, async (req, reply) => {
    const languageNames: Record<string, string> = {
      en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic',
      zh: 'Chinese', ru: 'Russian', de: 'German', pt: 'Portuguese',
      ja: 'Japanese', ko: 'Korean', hi: 'Hindi', tr: 'Turkish',
    }

    return reply.send({
      languages: SUPPORTED_LANGUAGES.map(code => ({
        code,
        name: languageNames[code] ?? code,
        channels: MONITORED_CHANNELS.filter(c => c.language === code).length,
      })),
      total: SUPPORTED_LANGUAGES.length,
    })
  })
}

export default videoClaimsPlugin
