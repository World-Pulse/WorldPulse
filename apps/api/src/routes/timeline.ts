import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'
import { longQuery } from '../lib/long-query'
import { signalsHaveStoryIds } from '../lib/stories'
import { z } from 'zod'

// ─── Constants ──────────────────────────────────────────────────────────────────
const TIMELINE_CACHE_TTL = 60 // seconds
export const MAX_SIGNALS_PER_BUCKET = 50
const MAX_BUCKETS = 200

/**
 * The ranges of a day or less are bucketed in the database (Nov 21, 2026): every report of the range is counted in
 * its bucket and the newest MAX_SIGNALS_PER_BUCKET of each are kept. Until then the newest 10,000 reports were read
 * and bucketed here, and from Nov 20, with about 1,000 located reports an hour, "the last 24 hours" were the last 13:
 * the morning video (map ?play=24h) played half the day, and its query read 10,000 reports with their summaries. The
 * week and the month keep the older way.
 */
export const BUCKETED_RANGES: ReadonlySet<string> = new Set(['1h', '6h', '24h'])
/** Seconds the bucketed query may take (the pool's 5 s ran out at 5:30 AM on Nov 20 and 21: no video) */
export const TIMELINE_QUERY_SECONDS = 15
/** The last answer that worked, kept 6 hours: what a request gets when the query gives up (marked stale) */
export const LAST_GOOD_TTL = 6 * 3600

/** Each range's bucket, as SQL on created_at */
export const BUCKET_SQL: Record<string, string> = {
  '1h':  'to_timestamp(floor(extract(epoch from created_at) / 300) * 300)',
  '6h':  'to_timestamp(floor(extract(epoch from created_at) / 900) * 900)',
  '24h': "date_trunc('hour', created_at)",
}

/**
 * One query for a range's buckets: every located verified or pending report of the range ranked in its bucket (the
 * newest first) and counted, and the newest `perBucket` of each read back with what the map shows.
 */
export function bucketedTimelineSql(
  range: string,
  filters: { category?: string; severity?: string; bbox?: [number, number, number, number] },
  hasStoryIds: boolean,
  perBucket = MAX_SIGNALS_PER_BUCKET,
): { sql: string; bindings: unknown[] } {
  const config = RANGE_CONFIG[range]
  const bucket = BUCKET_SQL[range]
  if (!config || !bucket) throw new Error(`no bucketed query for range ${range}`)
  const where = [
    'location IS NOT NULL',
    "status IN ('verified', 'pending')",
    `created_at > NOW() - INTERVAL '${config.hours} hours'`,
  ]
  const bindings: unknown[] = []
  if (filters.category && filters.category !== 'all') { where.push('category = ?'); bindings.push(filters.category) }
  if (filters.severity && filters.severity !== 'all') { where.push('severity = ?'); bindings.push(filters.severity) }
  if (filters.bbox) { where.push('ST_Within(location::geometry, ST_MakeEnvelope(?, ?, ?, ?, 4326))'); bindings.push(...filters.bbox) }
  bindings.push(perBucket)
  const storyKey = hasStoryIds ? 'COALESCE(s.story_id, s.id)::text AS story_key' : 's.id::text AS story_key'
  const sql = `WITH ranked AS (
  SELECT id, created_at, ${bucket} AS bucket_time,
         row_number() OVER (PARTITION BY ${bucket} ORDER BY created_at DESC, id DESC) AS rn,
         count(*) OVER (PARTITION BY ${bucket}) AS bucket_count
    FROM signals
   WHERE ${where.join('\n     AND ')}
)
SELECT s.id, s.title, s.category, s.severity, s.status, s.is_breaking, ${storyKey},
       ST_X(s.location::geometry) AS lng, ST_Y(s.location::geometry) AS lat,
       r.bucket_time, r.bucket_count
  FROM ranked r
  JOIN signals s ON s.id = r.id
 WHERE r.rn <= ?
 ORDER BY r.bucket_time ASC, r.created_at DESC, r.id DESC`
  return { sql, bindings }
}

export interface TimelineRow {
  id: string; title: string; category: string; severity: string; status: string; is_breaking: boolean
  story_key?: string | null; lng: number | string; lat: number | string
  bucket_time: Date | string; bucket_count?: number | string
}

export interface TimelineBucket {
  t: string
  count: number
  signals: Array<{
    id: string; lat: number; lng: number; severity: string; category: string; title: string
    is_breaking: boolean; status: string
    /** The report's story, when it is one of several reports of it */
    story?: string
  }>
}

/**
 * Rows to buckets, oldest first. A row's bucket_count (the bucketed query's) is the bucket's count of reports; rows
 * without one (the older query's) are counted one by one.
 */
export function bucketsFromRows(rows: TimelineRow[], perBucket = MAX_SIGNALS_PER_BUCKET): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>()
  for (const row of rows) {
    const t = new Date(row.bucket_time).toISOString()
    let bucket = map.get(t)
    const counted = row.bucket_count != null && Number.isFinite(Number(row.bucket_count))
    if (!bucket) {
      bucket = { t, count: counted ? Number(row.bucket_count) : 0, signals: [] }
      map.set(t, bucket)
    }
    if (!counted) bucket.count++
    if (bucket.signals.length < perBucket) {
      bucket.signals.push({
        id:          row.id,
        lat:         Number(row.lat),
        lng:         Number(row.lng),
        severity:    row.severity,
        category:    row.category,
        title:       row.title,
        is_breaking: Boolean(row.is_breaking),
        status:      row.status,
        // only when it differs from the report's own id, to keep the answer small
        ...(row.story_key && row.story_key !== row.id ? { story: row.story_key } : {}),
      })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    .slice(0, MAX_BUCKETS)
}

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

    let bboxCoords: [number, number, number, number] | undefined
    if (bbox) {
      const bboxParsed = parseBbox(bbox)
      if ('error' in bboxParsed) return sendError(reply, 400, 'VALIDATION_ERROR', bboxParsed.error)
      bboxCoords = bboxParsed.coords
    }

    // Each report's story (Nov 8, 2026): the map's video captions the story the camera visits with the story's
    // own headline, as its closing card does (one report of the Krakow shooting said nine dead, the story six)
    const hasStoryIds = await signalsHaveStoryIds()

    // A day or less: bucketed in the database, every report counted (BUCKETED_RANGES). When the query gives up, the
    // last answer that worked (up to LAST_GOOD_TTL old, marked stale), else 503: the page tries again
    if (BUCKETED_RANGES.has(range)) {
      const lastKey = `signals:timeline:last:${cacheKey.slice('signals:timeline:'.length)}`
      try {
        const { sql, bindings } = bucketedTimelineSql(range, { category, severity, bbox: bboxCoords }, hasStoryIds)
        const result = await longQuery(TIMELINE_QUERY_SECONDS, trx => trx.raw(sql, bindings))
        const rows = ((result as { rows?: TimelineRow[] })?.rows ?? []) as TimelineRow[]
        const buckets = bucketsFromRows(rows)
        const response = {
          success: true,
          data: {
            range,
            bucket_interval: config.bucketLabel,
            buckets,
            total_signals: buckets.reduce((n, b) => n + b.count, 0),
            generated_at: new Date().toISOString(),
          },
        }
        const json = JSON.stringify(response)
        redis.setex(cacheKey, TIMELINE_CACHE_TTL, json).catch(() => {})
        redis.setex(lastKey, LAST_GOOD_TTL, json).catch(() => {})
        return reply.send(response)
      } catch (err) {
        req.log?.warn?.({ err, range }, 'timeline: the bucketed query gave up')
        const last = await redis.get(lastKey).catch(() => null)
        if (last) {
          const body = JSON.parse(last) as { data?: Record<string, unknown> }
          if (body.data) body.data.stale = true
          return reply.header('X-Cache-Stale', 'true').send(body)
        }
        return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The timeline could not be read in time; try again in a minute')
      }
    }

    const storyKey = hasStoryIds
      ? db.raw('COALESCE(story_id, id)::text AS story_key')
      : db.raw('id::text AS story_key')

    // ── Build query ───────────────────────────────────────────
    // Step 1: Get bucketed counts + signal data using window functions
    let query = db('signals')
      .whereNotNull('location')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw(`NOW() - INTERVAL '${config.hours} hours'`))
      .select([
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'location_name', 'country_code', 'reliability_score', 'created_at',
        'is_breaking', storyKey,
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
          'is_breaking', storyKey,
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
          'is_breaking', storyKey,
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
          'is_breaking', storyKey,
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
          db.raw(`to_timestamp(floor(extract(epoch from created_at) / 21600) * 21600) as bucket_time`),
        ])
        .orderBy('created_at', 'desc')
    }

    if (category && category !== 'all') query = query.where('category', category)
    if (severity && severity !== 'all') query = query.where('severity', severity)

    // Bounding-box spatial filter
    if (bboxCoords) {
      const [minLng, minLat, maxLng, maxLat] = bboxCoords
      query = query.whereRaw(
        'ST_Within(location::geometry, ST_MakeEnvelope(?, ?, ?, ?, 4326))',
        [minLng, minLat, maxLng, maxLat],
      )
    }

    // Limit total signals for performance (the week and the month: the newest 10,000)
    query = query.limit(MAX_BUCKETS * MAX_SIGNALS_PER_BUCKET)

    const rows = await query

    // ── Group into buckets ────────────────────────────────────
    const buckets = bucketsFromRows(rows as TimelineRow[])

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
