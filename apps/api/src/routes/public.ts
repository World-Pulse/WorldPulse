import type { FastifyPluginAsync } from 'fastify'
import type { Knex } from 'knex'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { PublicSignalsQuerySchema, parseQuery } from '../lib/query-schemas'
import { sendError } from '../lib/errors'
import { staleWhileRevalidate } from '../lib/swr-cache'
import { longQuery } from '../lib/long-query'
import { signalCategories } from '../lib/categories'
import { siteInfo, sitesOfLinks } from '../lib/outlets'
import { signalsHaveStoryIds } from '../lib/stories'

const PUBLIC_CACHE_TTL = 30  // seconds

/**
 * How many verified signals match a filter (plan V3a, Oct 20, 2026). Every
 * call used to count them all while the caller waited, and on the busiest
 * filters (none, the docs' first example category=conflict, economy) the
 * count ran past the database's 5-second limit: the main "no signup needed"
 * endpoint answered 500 after 5 s on its default call. Now the exact count is
 * made in the background, kept 10 minutes and served up to a day old; until
 * one is kept, the database's own estimate answers at once (total_exact: false).
 */
const TOTAL_SWR = { freshSeconds: 600, staleSeconds: 86_400, lockSeconds: 90 }
const TOTAL_SECONDS = 60
/** Exact counts made at once in this process: each holds a connection for up to a minute, and a client asking for many filters mustn't tie up the pool */
const MAX_COUNTS = 2
let counting = 0

function verified(q: Knex.QueryBuilder, category?: string, severity?: string): Knex.QueryBuilder {
  let out = q.where('status', 'verified')
  if (category && category !== 'all') out = out.where('category', category)
  if (severity) out = out.where('severity', severity)
  return out
}

async function exactTotal(category?: string, severity?: string): Promise<{ total: number; exact: boolean }> {
  // Past the cap the estimate keeps answering, and a later call counts
  if (counting >= MAX_COUNTS) throw new Error('Exact counts busy')
  counting++
  try {
    const rows = await longQuery(TOTAL_SECONDS, trx => verified(trx('signals'), category, severity).count('id as count') as unknown as Promise<Array<{ count: string | number }>>)
    return { total: Number(rows[0]?.count ?? 0), exact: true }
  } finally {
    counting--
  }
}

/** The planner's row estimate for the same filter: planning only, so it answers in milliseconds */
async function estimatedTotal(category?: string, severity?: string): Promise<{ total: number; exact: boolean }> {
  const q = verified(db('signals').select(db.raw('1')), category, severity).toSQL()
  const result = await db.raw(`EXPLAIN (FORMAT JSON) ${q.sql}`, q.bindings as Knex.ValueDict[]) as { rows?: Array<{ 'QUERY PLAN'?: Array<{ Plan?: { 'Plan Rows'?: number } }> }> }
  const rows = result.rows?.[0]?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows']
  if (typeof rows !== 'number' || !Number.isFinite(rows)) throw new Error('no estimate')
  return { total: Math.max(0, Math.round(rows)), exact: false }
}

function matchingTotal(category?: string, severity?: string): Promise<{ total: number; exact: boolean }> {
  return staleWhileRevalidate(
    `public:signals:total:v1:${category || 'all'}:${severity || 'all'}`,
    TOTAL_SWR,
    () => exactTotal(category, severity),
    () => estimatedTotal(category, severity),
  )
}

/**
 * The languages of the news (Nov 10, 2026; Devon, 2:51 PM: "AI tools from 35 to 40, built on today's work: the quiet
 * places, the languages a story is reported in, and the day's newly confirmed non-English stories"). Kept 5 minutes.
 */
const LANGUAGES_SWR = { freshSeconds: 300, staleSeconds: 3_600, lockSeconds: 60 }

export interface LanguageCount { language: string; reports: number; verified: number; waiting: number; countries: number }
export interface VerifiedAbroad {
  id: string; title: string; language: string; country: string | null; severity: string | null; category: string | null
  verifiedAt: string | null; storyId: string | null; storyLanguages: string[]
}

/** Each language's reports of the last `hours`: how many, verified, waiting with one outlet, and from how many countries */
async function languageCounts(hours: number): Promise<LanguageCount[]> {
  const result = await longQuery(20, trx => trx.raw(
    `SELECT trim(language) AS language,
            count(*)::int AS reports,
            count(*) FILTER (WHERE status = 'verified')::int AS verified,
            count(*) FILTER (WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1)::int AS waiting,
            count(DISTINCT country_code) FILTER (WHERE country_code ~ '^[A-Z]{2}$')::int AS countries
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND trim(language) ~ '^[a-z]{2}$'
      GROUP BY 1
      ORDER BY reports DESC`, [hours]) as unknown as Promise<{ rows?: Array<Record<string, unknown>> }>)
  return (result.rows ?? []).map(r => ({
    language: String(r.language), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0,
    waiting: Number(r.waiting) || 0, countries: Number(r.countries) || 0,
  }))
}

/** The newest reports in a language other than English that turned verified in the last `hours`, with their story's languages */
async function verifiedAbroad(hours: number): Promise<VerifiedAbroad[]> {
  const stories = await signalsHaveStoryIds()
  const storyLanguages = stories
    ? `(SELECT array_agg(DISTINCT trim(m.language)) FROM signals m
         WHERE m.story_id = s.story_id AND m.status IN ('verified', 'pending') AND trim(m.language) ~ '^[a-z]{2}$')`
    : 'NULL::text[]'
  const result = await longQuery(20, trx => trx.raw(
    `SELECT s.id::text AS id, s.title, trim(s.language) AS language, s.country_code, s.severity::text AS severity,
            s.category::text AS category, s.verified_at, ${stories ? 's.story_id::text' : 'NULL::text'} AS story_id,
            ${storyLanguages} AS story_languages
       FROM signals s
      WHERE s.status = 'verified'
        AND s.created_at > NOW() - make_interval(hours => ?)
        AND s.verified_at > NOW() - make_interval(hours => ?)
        AND trim(s.language) ~ '^[a-z]{2}$' AND trim(s.language) <> 'en'
      ORDER BY s.verified_at DESC
      LIMIT 80`, [hours + 24, hours]) as unknown as Promise<{ rows?: Array<Record<string, unknown>> }>)
  return (result.rows ?? []).map(r => {
    const language = String(r.language)
    const langs = Array.isArray(r.story_languages) ? r.story_languages.map(String).filter(l => /^[a-z]{2}$/.test(l)) : []
    return {
      id: String(r.id), title: String(r.title ?? ''), language,
      country: typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null,
      severity: typeof r.severity === 'string' ? r.severity : null, category: typeof r.category === 'string' ? r.category : null,
      verifiedAt: r.verified_at ? new Date(r.verified_at as string).toISOString() : null,
      storyId: typeof r.story_id === 'string' ? r.story_id : null,
      storyLanguages: [...new Set([language, ...langs])].sort(),
    }
  })
}

export interface PlaceCount { country: string; reports: number; verified: number; waiting: number; waitingSerious: number; languages: string[] }

/**
 * Each country's news reports of the last `days` (not a machine feed's: aircraft, fires, quakes): how many, how many
 * turned verified, and how many wait with one outlet (the serious ones too), with the languages they are in
 */
async function placeCounts(days: number): Promise<PlaceCount[]> {
  const result = await longQuery(25, trx => trx.raw(
    `SELECT country_code AS country,
            count(*)::int AS reports,
            count(*) FILTER (WHERE status = 'verified')::int AS verified,
            count(*) FILTER (WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1)::int AS waiting,
            count(*) FILTER (WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1
                               AND severity IN ('medium', 'high', 'critical'))::int AS waiting_serious,
            array_agg(DISTINCT trim(language)) FILTER (WHERE trim(language) ~ '^[a-z]{2}$') AS languages
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND status IN ('verified', 'pending')
        AND country_code ~ '^[A-Z]{2}$'
        AND (NOT (tags @> ARRAY['osint']::text[]) OR tags @> ARRAY['gdelt']::text[])
      GROUP BY 1`, [days]) as unknown as Promise<{ rows?: Array<Record<string, unknown>> }>)
  return (result.rows ?? []).map(r => ({
    country: String(r.country), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0,
    waiting: Number(r.waiting) || 0, waitingSerious: Number(r.waiting_serious) || 0,
    languages: Array.isArray(r.languages) ? r.languages.map(String).sort() : [],
  }))
}

/** An integer query value between min and max, else the default */
function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

export const registerPublicRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /signals ──────────────────────────────────────────
  app.get('/signals', {
    schema: {
      tags: ['public'],
      summary: 'List verified signals (public, no auth required)',
      querystring: {
        type: 'object',
        properties: {
          // (its example "politics" is no category: that answered 400, plan V3i)
          category: { type: 'string', description: 'One of the names GET /api/v1/public/categories lists (e.g. conflict, climate, economy), or all' },
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
                  // plan 15 (Oct 21, 2026): how many independent outlets, which websites, its page
                  outlets:           { type: 'number' },
                  sites:             { type: 'array', items: { type: 'string' } },
                  // plan 15 (Oct 22, 2026): each website's outlet: name, kind, home country, state media
                  site_info: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        site:        { type: 'string' },
                        name:        { type: 'string', nullable: true },
                        kind:        { type: 'string' },
                        country:     { type: 'string', nullable: true },
                        state_media: { type: 'boolean' },
                      },
                    },
                  },
                  url:               { type: 'string' },
                },
              },
            },
            total:  { type: 'number' },
            /** false: the database's estimate, while the exact count is made (plan V3a) */
            total_exact: { type: 'boolean' },
            limit:  { type: 'number' },
            offset: { type: 'number' },
            // The same, as the other lists answer it (plan V3f). Listed here or
            // the serializer drops it: on Oct 21, 2026 it shipped unlisted and
            // never reached readers
            meta: {
              type: 'object',
              properties: {
                total:       { type: 'number' },
                total_exact: { type: 'boolean' },
                limit:       { type: 'number' },
                offset:      { type: 'number' },
                has_more:    { type: 'boolean' },
              },
            },
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

    // An unknown category answered 500 (the database refuses a name its list
    // doesn't have); now 400 with the list (also at GET /public/categories)
    if (category && category !== 'all') {
      const known = await signalCategories().catch(() => [] as string[])
      if (known.length && !known.includes(category)) {
        return sendError(reply, 400, 'VALIDATION_ERROR', `category must be one of: ${known.join(', ')} (or all)`)
      }
    }

    // Cache key encodes all query params
    // v2: each signal says its outlets, websites and page (plan 15, Oct 21, 2026)
    const cacheKey = `public:signals:v2:${category ?? 'all'}:${severity ?? 'all'}:${safeLimit}:${safeOffset}`
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
        'source_url', 'source_count', 'original_urls',
      ])

    if (category && category !== 'all') query = query.where('category', category)
    if (severity) query = query.where('severity', severity)

    // ── How many match (kept and remade in the background, see matchingTotal) ──
    const [rows, counted] = await Promise.all([
      query,
      matchingTotal(category, severity).catch(() => null),
    ])
    const seen = safeOffset + rows.length

    // never fewer than this page shows (an estimate can be low)
    const total = Math.max(counted?.total ?? 0, seen)
    const response = {
      success: true,
      data: rows.map(formatPublicSignal),
      total,
      total_exact: counted?.exact ?? false,
      limit:  safeLimit,
      offset: safeOffset,
      // the same, in the meta block the other lists answer with (plan V3f, Oct 21, 2026)
      meta: { total, total_exact: counted?.exact ?? false, limit: safeLimit, offset: safeOffset, has_more: seen < total },
    }

    redis.setex(cacheKey, PUBLIC_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })

  // ─── GET /categories ───────────────────────────────────────
  // The categories ?category= takes (plan V3a): the docs listed a few, and a
  // name outside the database's list answered 500
  app.get('/categories', {
    schema: { tags: ['public'], summary: 'The categories signals can have (public, no auth required)' },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const names = await signalCategories().catch(() => null)
    if (!names || !names.length) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The category list could not be read; try again shortly')
    return reply.send({ success: true, data: names })
  })

  // ─── GET /second-outlets ──────────────────────────────────
  // The other outlets found for reports only one outlet carried (plan 0s3,
  // Oct 22, 2026): the scraper searches GDELT's news index for them
  // (apps/scraper/src/pipeline/second-outlet.ts). Today's and yesterday's
  // counts (UTC days) and the latest reports it found outlets for, so anyone
  // can read the matches.
  app.get('/second-outlets', {
    schema: { tags: ['public'], summary: 'Other outlets found for one-outlet reports (public, no auth required)' },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
    const days = [day(0), day(1)]
    // the world's coverage counts (apps/scraper/src/pipeline/gkg-pulse.ts): the files counted each hour, the last 7 days
    const hourNow = Math.floor(Date.now() / 3_600_000) * 3_600_000
    const hours = Array.from({ length: 168 }, (_, i) => new Date(hourNow - i * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, ''))
    const [today, yesterday, recent, last, archive, archiveDone, week, weekDone, hourFiles] = await Promise.all([
      redis.hgetall(`second-outlet:day:${days[0]}`).catch(() => null),
      redis.hgetall(`second-outlet:day:${days[1]}`).catch(() => null),
      redis.lrange('second-outlet:recent', 0, 49).catch(() => [] as string[]),
      redis.get('second-outlet:last-cycle').catch(() => null),
      // the April–May repair (apps/scraper/src/pipeline/archive-outlets.ts)
      redis.hgetall('repair:archive-outlets:stats').catch(() => null),
      redis.get('repair:archive-outlets:2026-10-22:done').catch(() => null),
      // version 2's keys (Oct 22, 5:30 PM: the tighter kinds of event)
      redis.hgetall('gkg:pulse:2:backfill').catch(() => null),
      redis.get('repair:gkg-pulse-week:2026-10-22b:done').catch(() => null),
      Promise.all(hours.map(h => redis.hget(`gkg:pulse:2:${h}`, '_files').catch(() => null))),
    ])
    const numbers = (h: Record<string, string> | null) =>
      Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, Number(v) || 0]))
    const latest = (recent ?? []).flatMap(entry => {
      try { return [JSON.parse(entry) as Record<string, unknown>] } catch { return [] }
    })
    let lastCycle: unknown = null
    try { lastCycle = last ? JSON.parse(last) : null } catch { lastCycle = null }
    const archived = archive && Object.keys(archive).length
      ? { ...Object.fromEntries(Object.entries(archive).map(([k, v]) => [k, /^\d+$/.test(v) ? Number(v) : v])), done_at: archiveDone ?? null }
      : null
    // counts as numbers; "last" is a file's time (20261018041500), kept as written
    const values = (h: Record<string, string> | null) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, k !== 'last' && /^\d+$/.test(v) ? Number(v) : v]))
    const counted = hourFiles.map(v => Number(v) || 0)
    const pulse = {
      week: week && Object.keys(week).length ? { ...values(week), done_at: weekDone ?? null } : null,
      // the files counted in each of the last 24 hours, oldest first, the hour now last (4 an hour when every file is read)
      last_24h: Object.fromEntries(hours.slice(0, 24).map((h, i) => [h, counted[i]!]).reverse()),
      hours_counted_7d: counted.filter(n => n > 0).length,
    }
    return reply.send({ success: true, data: { days: { [days[0]!]: numbers(today), [days[1]!]: numbers(yesterday) }, last_cycle: lastCycle, latest, archive: archived, pulse } })
  })

  // ─── GET /languages (Nov 10, 2026) ────────────────────────
  // The languages of the last hours' reports, and the newest reports in another language than English that turned verified
  app.get('/languages', {
    schema: { tags: ['public'], summary: 'The languages of the news, and the newest verified reports in other languages than English (public, no auth required)' },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const hours = boundedInt((req.query as Record<string, unknown>)?.hours, 24, 1, 72)
    try {
      const [languages, verified] = await Promise.all([
        staleWhileRevalidate(`public:languages:v1:counts:${hours}`, LANGUAGES_SWR, () => languageCounts(hours)),
        staleWhileRevalidate(`public:languages:v1:verified:${hours}`, LANGUAGES_SWR, () => verifiedAbroad(hours)),
      ])
      return reply.send({ success: true, data: { hours, languages, verified } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The languages could not be counted just now; try again in a minute')
    }
  })

  // ─── GET /unconfirmed-places (Nov 10, 2026) ───────────────
  // Each country's news reports of the last days: how many turned verified, how many wait with one outlet
  app.get('/unconfirmed-places', {
    schema: { tags: ['public'], summary: 'Where news goes unconfirmed: each country\'s reports, verified and waiting for a second outlet (public, no auth required)' },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const days = boundedInt((req.query as Record<string, unknown>)?.days, 7, 1, 14)
    try {
      const places = await staleWhileRevalidate(`public:unconfirmed-places:v1:${days}`, { freshSeconds: 600, staleSeconds: 3_600, lockSeconds: 60 }, () => placeCounts(days))
      return reply.send({ success: true, data: { days, places } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The places could not be counted just now; try again in a minute')
    }
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

/** The websites of a signal's links, each once, without "www." (10 at most) */
export function sitesOf(urls: unknown): string[] {
  return sitesOfLinks(urls, 10)
}

export function formatPublicSignal(row: Record<string, unknown>) {
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
    // The independent outlets that reported it (an outlet's sister sites and
    // word-for-word wire copies count once: pipeline/independence.ts), the
    // websites it links to, and its page (plan 15, Oct 21, 2026)
    outlets: Math.max(1, Math.round(Number(row.source_count ?? 1)) || 1),
    sites:   sitesOf(row.original_urls),
    // what each website is (lib/outlets.ts, plan 15, Oct 22, 2026)
    site_info: siteInfo(sitesOf(row.original_urls)).map(s => ({ site: s.site, name: s.name, kind: s.kind, country: s.country, state_media: s.stateMedia })),
    url:     `https://world-pulse.io/signals/${encodeURIComponent(String(row.id))}`,
  }
}
