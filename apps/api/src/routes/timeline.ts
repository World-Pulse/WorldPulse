import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'
import { z } from 'zod'

// ─── Constants ──────────────────────────────────────────────────────────────────
const TIMELINE_CACHE_TTL = 60 // seconds
const MAX_SIGNALS_PER_BUCKET = 50
const MAX_BUCKETS = 200

// ─── Validation Schema ──────────────────────────────────────────────────────────
const TimelineQuerySchema = z.object({
  range: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h'),
  category: z.string().optional(),
  severity: z.string().optional(),
  bbox: z.string().optional(),
})

// ─── Bucket interval mapping ────────────────────────────────────────────────────
const RANGE_CONFIG: Record<string, { hours: number; bucket: string; bucketLabel: string }> = {
  '1h':  { hours: 1,    bucket: '5 minutes',  bucketLabel: '5min'  },
  '6h':  { hours: 6,    bucket: '15 minutes', bucketLabel: '15min' },
  '24h': { hours: 24,   bucket: '1 hour',     bucketLabel: '1h'    },
  '7d':  { hours: 168,  bucket: '1 hour',     bucketLabel: '1h'    },
  '30d': { hours: 720,  bucket: '6 hours',    bucketLabel: '6h'    },
}

function parseBbox(raw: string): { coords: [number, number, number, number] } | { error: string } {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some(n => !isFinite(n) || isNaN(n))) {
    return { error: 'bbox must be exactly 4 comma-separated finite numbers' }
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number]
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    return { error: 'bbox coordinates out of valid range' }
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return { error: 'bbox min values must be strictly less than max counterparts' }
  }
  return { coords: [minLng, minLat, maxLng, maxLat] }
}

// ─── Route ──────────────────────────────────────────────────────────────────────
export const registerTimelineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['signals']
  })

  /**
   * GET /api/v1/signals/map/timeline
   *
   * Returns time-bucketed signal data for historical playback.
   * Each bucket contains a timestamp, count, and up to 50 signals with geo data.
   */
  app.get('/map/timeline', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['signals'],
      summary: 'Timeline signal buckets for historical playback',
      description: 'Returns signals bucketed by time interval for the time slider. Supports range, category, severity, and bbox filters.',
      querystring: {
        type: 'object',
        properties: {
          range:    { type: 'string', enum: ['1h', '6h', '24h', '7d', '30d'], default: '24h' },
          category: { type: 'string' },
          severity: { type: 'string' },
          bbox:     { type: 'string', description: 'minLng,minLat,maxLng,maxLat' },
        },
      },
    },
  }, async (req, reply) => {
    const parsed = TimelineQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query')
    }
    const { range, category, severity, bbox } = parsed.data
    const config = RANGE_CONFIG[range]!

    // ── Cache key ─────────────────────────────────────────────
    const bboxKey = bbox ? `:${bbox}` : ''
    const cacheKey = `signals:timeline:${range}:${category ?? 'all'}:${severity ?? 'all'}${bboxKey}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    // ── Build query ───────────────────────────────────────────
    // Step 1: Get bucketed counts + signal data using window functions
    let query = db('signals')
      .whereNotNull('location')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw(`NOW() - INTERVAL '${config.hours} hours'`))
      .select([
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'location_name', 'country_code', 'reliability_score', 'created_at',
        'is_breaking',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
        db.raw(`date_trunc('${config.bucket.split(' ')[1] === 'minutes' ? 'hour' : config.bucket.split(' ')[1]}', created_at) as bucket_time`),
      ])
      .orderBy('created_at', 'desc')

    // For minute-level bucketing, use raw expression
    if (config.bucket === '5 minutes') {
      query = db('signals')
        .whereNotNull('location')
        .whereIn('status', ['verified', 'pending'])
        .where('created_at', '>', db.raw(`NOW() - INTERVAL '${config.hours} hours'`))
        .select([
          'id', 'title', 'summary', 'category', 'severity', 'status',
          'location_name', 'country_code', 'reliability_score', 'created_at',
          'is_breaking',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
          db.raw(`to_timestamp(floor(extract(epoch from created_at) / 300) * 300) as bucket_time`),
        ])
        .orderBy('created_at', 'desc')
    } else if (config.bucket === '15 minutes') {
      query = db('signals')
        .whereNotNull('location')
        .whereIn('status', ['verified', 'pending'])
        .where('created_at', '>', db.raw(`NOW() - INTERVAL '${config.hours} hours'`))
        .select([
          'id', 'title', 'summary', 'category', 'severity', 'status',
          'location_name', 'country_code', 'reliability_score', 'created_at',
          'is_breaking',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
          db.raw(`to_timestamp(floor(extract(epoch from created_at) / 900) * 900) as bucket_time`),
        ])
        .orderBy('created_at', 'desc')
    } else if (config.bucket === '6 hours') {
      query = db('signals')
        .whereNotNull('location')
        .whereIn('status', ['verified', 'pending'])
        .where('created_at', '>', db.raw(`NOW() - INTERVAL '${config.hours} hours'`))
        .select([
          'id', 'title', 'summary', 'category', 'severity', 'status',
          'location_name', 'country_code', 'reliability_score', 'created_at',
          'is_breaking',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
          db.raw(`to_timestamp(floor(extract(epoch from created_at) / 21600) * 21600) as bucket_time`),
        ])
        .orderBy('created_at', 'desc')
    }

    if (category && category !== 'all') query = query.where('category', category)
    if (severity && severity !== 'all') query = query.where('severity', severity)

    // Bounding-box spatial filter
    if (bbox) {
      const bboxParsed = parseBbox(bbox)
      if ('error' in bboxParsed) return sendError(reply, 400, 'VALIDATION_ERROR', bboxParsed.error)
      const [minLng, minLat, maxLng, maxLat] = bboxParsed.coords
      query = query.whereRaw(
        'ST_Within(location::geometry, ST_MakeEnvelope(?, ?, ?, ?, 4326))',
        [minLng, minLat, maxLng, maxLat],
      )
    }

    // Limit total signals for performance
    query = query.limit(MAX_BUCKETS * MAX_SIGNALS_PER_BUCKET)

    const rows = await query

    // ── Group into buckets ────────────────────────────────────
    const bucketMap = new Map<string, {
      t: string
      count: number
      signals: Array<{
        id: string
        lat: number
        lng: number
        severity: string
        category: string
        title: string
        is_breaking: boolean
      }>
    }>()

    for (const row of rows) {
      const t = new Date(row.bucket_time as Date).toISOString()
      let bucket = bucketMap.get(t)
      if (!bucket) {
        bucket = { t, count: 0, signals: [] }
        bucketMap.set(t, bucket)
      }
      bucket.count++
      if (bucket.signals.length < MAX_SIGNALS_PER_BUCKET) {
        bucket.signals.push({
          id:          row.id as string,
          lat:         Number(row.lat),
          lng:         Number(row.lng),
          severity:    row.severity as string,
          category:    row.category as string,
          title:       row.title as string,
          is_breaking: Boolean(row.is_breaking),
        })
      }
    }

    // Sort buckets chronologically
    const buckets = Array.from(bucketMap.values())
      .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
      .slice(0, MAX_BUCKETS)

    const totalSignals = rows.length

    const response = {
      success: true,
      data: {
        range,
        bucket_interval: config.bucketLabel,
        buckets,
        total_signals: totalSignals,
        generated_at: new Date().toISOString(),
      },
    }

    redis.setex(cacheKey, TIMELINE_CACHE_TTL, JSON.stringify(response)).catch(() => {})
    return reply.send(response)
  })
}
