/**
 * STIX 2.1 export routes for WorldPulse signals.
 * Content-Type: application/stix+json;version=2.1
 *
 * GET /api/v1/stix/signals/:id  — single signal as STIX bundle
 * GET /api/v1/stix/signals      — filtered bulk export (max 500)
 * GET /api/v1/stix/feed         — TAXII-like feed, latest 100 signals
 */
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { apiKeyAuth } from '../middleware/auth'
import { SignalToStixConverter } from '../lib/stix'
import { sendError } from '../lib/errors'
import type { Signal } from '@worldpulse/types'

const STIX_CONTENT_TYPE = 'application/stix+json;version=2.1'

const converter = new SignalToStixConverter()

// ─── DB Row → Signal mapping ──────────────────────────────────────────────────

function rowToSignal(row: Record<string, unknown>): Signal {
  return {
    id:               row.id as string,
    title:            row.title as string,
    summary:          row.summary as string | null,
    body:             row.body as string | null,
    category:         row.category as Signal['category'],
    severity:         row.severity as Signal['severity'],
    status:           row.status as Signal['status'],
    reliabilityScore: Number(row.reliability_score ?? 0.5),
    alertTier:        (row.alert_tier as Signal['alertTier']) ?? 'ROUTINE',
    sourceCount:      Number(row.source_count ?? 1),
    location:         row.lat != null && row.lng != null
                        ? { lat: Number(row.lat), lng: Number(row.lng) }
                        : null,
    locationName:     row.location_name as string | null,
    countryCode:      row.country_code as string | null,
    region:           row.region as string | null,
    tags:             (row.tags as string[]) ?? [],
    sources:          [],
    originalUrls:     (row.original_urls as string[]) ?? [],
    language:         (row.language as string) ?? 'en',
    viewCount:        Number(row.view_count ?? 0),
    shareCount:       Number(row.share_count ?? 0),
    postCount:        Number(row.post_count ?? 0),
    eventTime:        row.event_time as string | null,
    firstReported:    row.first_reported as string,
    verifiedAt:       row.verified_at as string | null,
    lastUpdated:      row.last_updated as string,
    createdAt:        row.created_at as string,
  }
}

// ─── Query schema for bulk/feed endpoints ─────────────────────────────────────

const BulkQuerySchema = z.object({
  category: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  since:    z.string().datetime({ offset: true }).optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
})

// ─── Signal DB columns to select ─────────────────────────────────────────────

const SIGNAL_COLS = [
  'id', 'title', 'summary', 'body', 'category', 'severity', 'status',
  'reliability_score', 'source_count', 'location_name', 'country_code',
  'region', 'tags', 'original_urls', 'language', 'view_count', 'share_count',
  'post_count', 'event_time', 'first_reported', 'verified_at',
  'last_updated', 'created_at',
  // PostGIS lat/lng extracted as plain floats
  db.raw('ST_Y(location::geometry) AS lat'),
  db.raw('ST_X(location::geometry) AS lng'),
]

export const registerStixRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['stix']
  })

  // ─── GET /signals/:id ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/signals/:id', {
    preHandler: [apiKeyAuth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params

    const row = await db('signals')
      .where('signals.id', id)
      .select(SIGNAL_COLS)
      .first() as Record<string, unknown> | undefined

    if (!row) {
      return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    }

    const signal = rowToSignal(row)
    const bundle = converter.buildBundle([signal])

    return reply
      .header('Content-Type', STIX_CONTENT_TYPE)
      .send(bundle)
  })

  // ─── GET /signals ─────────────────────────────────────────────────────────
  app.get('/signals', {
    preHandler: [apiKeyAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = BulkQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
      })
    }

    const { category, severity, since, limit } = parsed.data

    const query = db('signals').select(SIGNAL_COLS)

    if (category) query.where('category', category)
    if (severity) query.where('severity', severity)
    if (since)    query.where('created_at', '>=', since)

    query.orderBy('created_at', 'desc').limit(limit)

    const rows = await query as Record<string, unknown>[]
    const signals = rows.map(rowToSignal)
    const bundle = converter.buildBundle(signals)

    return reply
      .header('Content-Type', STIX_CONTENT_TYPE)
      .send(bundle)
  })

  // ─── GET /feed ────────────────────────────────────────────────────────────
  app.get('/feed', {
    preHandler: [apiKeyAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const rows = await db('signals')
      .select(SIGNAL_COLS)
      .orderBy('created_at', 'desc')
      .limit(100) as Record<string, unknown>[]

    const signals = rows.map(rowToSignal)
    const bundle = converter.buildBundle(signals)

    return reply
      .header('Content-Type', STIX_CONTENT_TYPE)
      .send(bundle)
  })
}
