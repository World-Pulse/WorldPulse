import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { PublicSignalsQuerySchema, parseQuery } from '../lib/query-schemas'
import { sendError } from '../lib/errors'

const PUBLIC_CACHE_TTL = 30  // seconds

export const registerPublicRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /signals ──────────────────────────────────────────
  app.get('/signals', {
    schema: {
      tags: ['public'],
      summary: 'List verified signals (public, no auth required)',
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (e.g. conflict, climate, politics)' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          limit:    { type: 'number', default: 50, maximum: 100, minimum: 1 },
          offset:   { type: 'number', default: 0, minimum: 0 },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:                { type: 'string' },
                  title:             { type: 'string' },
                  category:          { type: 'string' },
                  severity:          { type: 'string' },
                  reliability_score: { type: 'number' },
                  location_name:     { type: 'string', nullable: true },
                  published_at:      { type: 'string' },
                  source_url:        { type: 'string', nullable: true },
                },
              },
            },
            total:  { type: 'number' },
            limit:  { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    // Always set public CORS header
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')

    const qr = parseQuery(PublicSignalsQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { category, severity, limit: safeLimit, offset: safeOffset } = qr.data

    // Cache key encodes all query params
    const cacheKey = `public:signals:${category ?? 'all'}:${severity ?? 'all'}:${safeLimit}:${safeOffset}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return reply
        .header('X-Cache-Hit', 'true')
        .send(JSON.parse(cached))
    }

    // ── Build query ───────────────────────────────────────────
    let query = db('signals')
      .where('status', 'verified')
      .orderBy('created_at', 'desc')
      .limit(safeLimit)
      .offset(safeOffset)
      .select([
        'id', 'title', 'category', 'severity',
        'reliability_score', 'location_name',
        db.raw('created_at as published_at'),
        'source_url',
      ])

    if (category && category !== 'all') query = query.where('category', category)
    if (severity && severity !== 'all') query = query.where('severity', severity)

    // ── Count query (same filters, no pagination) ─────────────
    let countQuery = db('signals').where('status', 'verified')
    if (category && category !== 'all') countQuery = countQuery.where('category', category)
    if (severity && severity !== 'all') countQuery = countQuery.where('severity', severity)

    const [rows, countRows] = await Promise.all([
      query,
      countQuery.count('id as count'),
    ])
    const countRow = countRows[0] as { count: string | number } | undefined
    const count = countRow?.count ?? 0

    const response = {
      success: true,
      data: rows.map(formatPublicSignal),
      total:  Number(count),
      limit:  safeLimit,
      offset: safeOffset,
    }

    redis.setex(cacheKey, PUBLIC_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })

  // ─── OPTIONS preflight ────────────────────────────────────
  app.options('/signals', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply
      .header('Access-Control-Allow-Origin',  '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .header('Access-Control-Max-Age',       '86400')
    return reply.status(204).send()
  })
}

function formatPublicSignal(row: Record<string, unknown>) {
  return {
    id:                row.id,
    title:             row.title,
    category:          row.category,
    severity:          row.severity,
    reliability_score: row.reliability_score !== null ? Number(row.reliability_score) : null,
    location_name:     row.location_name ?? null,
    published_at:      row.published_at instanceof Date
      ? (row.published_at as Date).toISOString()
      : (row.published_at as string | null) ?? null,
    source_url: row.source_url ?? null,
  }
}
