import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from '../lib/logger'
import { sendError } from '../lib/errors'

// ─── Constants ─────────────────────────────────────────────────────────────

const RSS_CACHE_TTL = 120 // seconds
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const SITE_URL = process.env.SITE_URL ?? 'https://worldpulse.io'
const API_URL = process.env.API_URL ?? 'https://api.worldpulse.io'

const VALID_CATEGORIES = [
  'conflict', 'climate', 'politics', 'health', 'technology', 'economics',
  'disaster', 'security', 'environment', 'military', 'humanitarian',
  'infrastructure', 'space', 'maritime', 'aviation', 'cyber', 'nuclear',
] as const

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

interface SignalRow {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliability_score: number | null
  location_name: string | null
  country_code: string | null
  source_url: string | null
  source_count: number | null
  created_at: string | Date
  updated_at: string | Date | null
}

function signalToAtomEntry(signal: SignalRow): string {
  const published = new Date(signal.created_at).toISOString()
  const updated = signal.updated_at
    ? new Date(signal.updated_at).toISOString()
    : published
  const link = `${SITE_URL}/signals/${signal.id}`
  const reliability = signal.reliability_score != null
    ? ` | Reliability: ${(signal.reliability_score * 100).toFixed(0)}%`
    : ''
  const location = signal.location_name
    ? ` | ${escapeXml(signal.location_name)}`
    : ''
  const summary = signal.summary
    ? escapeXml(signal.summary)
    : `${escapeXml(signal.category)} signal — severity: ${escapeXml(signal.severity)}${reliability}${location}`

  return `  <entry>
    <id>urn:worldpulse:signal:${escapeXml(signal.id)}</id>
    <title>${escapeXml(signal.title)}</title>
    <summary type="text">${summary}</summary>
    <link href="${escapeXml(link)}" rel="alternate" type="text/html"/>
    <published>${published}</published>
    <updated>${updated}</updated>
    <category term="${escapeXml(signal.category)}"/>
    <category term="severity:${escapeXml(signal.severity)}"/>
    ${signal.reliability_score != null ? `<category term="reliability:${(signal.reliability_score * 100).toFixed(0)}"/>` : ''}
    ${signal.source_url ? `<link href="${escapeXml(signal.source_url)}" rel="via" title="Original source"/>` : ''}
    <wp:severity xmlns:wp="${SITE_URL}/ns/1.0">${escapeXml(signal.severity)}</wp:severity>
    ${signal.reliability_score != null ? `<wp:reliability xmlns:wp="${SITE_URL}/ns/1.0">${signal.reliability_score.toFixed(3)}</wp:reliability>` : ''}
    ${signal.location_name ? `<wp:location xmlns:wp="${SITE_URL}/ns/1.0">${escapeXml(signal.location_name)}</wp:location>` : ''}
    ${signal.country_code ? `<wp:country xmlns:wp="${SITE_URL}/ns/1.0">${escapeXml(signal.country_code)}</wp:country>` : ''}
    ${signal.source_count != null ? `<wp:sourceCount xmlns:wp="${SITE_URL}/ns/1.0">${signal.source_count}</wp:sourceCount>` : ''}
  </entry>`
}

function signalToJsonItem(signal: SignalRow): Record<string, unknown> {
  const link = `${SITE_URL}/signals/${signal.id}`
  return {
    id: `urn:worldpulse:signal:${signal.id}`,
    url: link,
    title: signal.title,
    summary: signal.summary ?? `${signal.category} signal — severity: ${signal.severity}`,
    date_published: new Date(signal.created_at).toISOString(),
    date_modified: signal.updated_at
      ? new Date(signal.updated_at).toISOString()
      : new Date(signal.created_at).toISOString(),
    tags: [
      signal.category,
      `severity:${signal.severity}`,
      ...(signal.reliability_score != null ? [`reliability:${(signal.reliability_score * 100).toFixed(0)}`] : []),
      ...(signal.country_code ? [signal.country_code] : []),
    ],
    _worldpulse: {
      severity: signal.severity,
      reliability_score: signal.reliability_score,
      location_name: signal.location_name,
      country_code: signal.country_code,
      source_count: signal.source_count,
      source_url: signal.source_url,
    },
  }
}

async function fetchSignals(opts: {
  category?: string
  severity?: string
  minReliability?: number
  limit: number
}): Promise<SignalRow[]> {
  let query = db('signals')
    .select(
      'id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'location_name', 'country_code',
      'source_url', 'source_count', 'created_at', 'updated_at',
    )
    .orderBy('created_at', 'desc')
    .limit(opts.limit)

  if (opts.category) {
    query = query.where('category', opts.category)
  }
  if (opts.severity) {
    query = query.where('severity', opts.severity)
  }
  if (opts.minReliability != null) {
    query = query.where('reliability_score', '>=', opts.minReliability)
  }

  return query as unknown as Promise<SignalRow[]>
}

function buildAtomFeed(signals: SignalRow[], opts: { title: string; selfUrl: string }): string {
  const updated = signals.length > 0
    ? new Date(signals[0]!.created_at).toISOString()
    : new Date().toISOString()

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:wp="${SITE_URL}/ns/1.0">
  <id>${escapeXml(opts.selfUrl)}</id>
  <title>${escapeXml(opts.title)}</title>
  <subtitle>Real-time verified intelligence from the WorldPulse open-source network</subtitle>
  <link href="${escapeXml(opts.selfUrl)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(SITE_URL)}" rel="alternate" type="text/html"/>
  <updated>${updated}</updated>
  <author>
    <name>WorldPulse Intelligence Network</name>
    <uri>${SITE_URL}</uri>
  </author>
  <generator uri="${SITE_URL}" version="1.0.0">WorldPulse</generator>
  <rights>MIT License — ${SITE_URL}</rights>
${signals.map(signalToAtomEntry).join('\n')}
</feed>`
}

function buildJsonFeed(signals: SignalRow[], opts: { title: string; selfUrl: string }): Record<string, unknown> {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: opts.title,
    home_page_url: SITE_URL,
    feed_url: opts.selfUrl,
    description: 'Real-time verified intelligence from the WorldPulse open-source network',
    authors: [{ name: 'WorldPulse Intelligence Network', url: SITE_URL }],
    language: 'en',
    items: signals.map(signalToJsonItem),
    _worldpulse: {
      api_version: '1.0.0',
      documentation: `${API_URL}/api/docs`,
      total_items: signals.length,
    },
  }
}

// ─── Cache helpers ─────────────────────────────────────────────────────────

async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key)
  } catch {
    return null
  }
}

async function cacheSet(key: string, value: string, ttl: number): Promise<void> {
  try {
    await redis.set(key, value, 'EX', ttl)
  } catch (err) {
    logger.warn({ err, key }, 'RSS cache set failed')
  }
}

// ─── Route Registration ────────────────────────────────────────────────────

export const registerRssRoutes: FastifyPluginAsync = async (app) => {

  // ─── Atom Feed: All Signals ────────────────────────────────────────────
  app.get('/signals.xml', {
    schema: {
      tags: ['rss'],
      summary: 'Atom 1.0 feed of verified signals',
      description: 'Returns an Atom XML feed of the latest verified signals. Supports category, severity, and reliability filters. Cached for 2 minutes.',
      querystring: {
        type: 'object',
        properties: {
          category:        { type: 'string', description: 'Filter by signal category' },
          severity:        { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          min_reliability: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum reliability score (0-1)' },
          limit:           { type: 'number', default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT },
        },
        additionalProperties: false,
      },
      response: {
        200: { type: 'string', description: 'Atom XML feed' },
        400: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { category, severity, min_reliability, limit = DEFAULT_LIMIT } =
      req.query as { category?: string; severity?: string; min_reliability?: number; limit?: number }

    if (category && !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return sendError(reply, 400, 'VALIDATION_ERROR', `Invalid category: ${category}`)
    }

    const cacheKey = `rss:atom:${category ?? 'all'}:${severity ?? 'all'}:${min_reliability ?? '0'}:${limit}`
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return reply
        .header('Content-Type', 'application/atom+xml; charset=utf-8')
        .header('X-Cache', 'HIT')
        .send(cached)
    }

    const signals = await fetchSignals({ category, severity, minReliability: min_reliability, limit })
    const selfUrl = `${API_URL}/api/v1/rss/signals.xml`
    const title = category
      ? `WorldPulse Signals — ${category}`
      : 'WorldPulse Signals — All Categories'
    const xml = buildAtomFeed(signals, { title, selfUrl })

    await cacheSet(cacheKey, xml, RSS_CACHE_TTL)

    return reply
      .header('Content-Type', 'application/atom+xml; charset=utf-8')
      .header('X-Cache', 'MISS')
      .send(xml)
  })

  // ─── JSON Feed: All Signals ────────────────────────────────────────────
  app.get('/signals.json', {
    schema: {
      tags: ['rss'],
      summary: 'JSON Feed 1.1 of verified signals',
      description: 'Returns a JSON Feed (https://jsonfeed.org/) of the latest verified signals. Ideal for programmatic consumption and AI agent pipelines.',
      querystring: {
        type: 'object',
        properties: {
          category:        { type: 'string', description: 'Filter by signal category' },
          severity:        { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          min_reliability: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum reliability score (0-1)' },
          limit:           { type: 'number', default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT },
        },
        additionalProperties: false,
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { category, severity, min_reliability, limit = DEFAULT_LIMIT } =
      req.query as { category?: string; severity?: string; min_reliability?: number; limit?: number }

    if (category && !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return sendError(reply, 400, 'VALIDATION_ERROR', `Invalid category: ${category}`)
    }

    const cacheKey = `rss:json:${category ?? 'all'}:${severity ?? 'all'}:${min_reliability ?? '0'}:${limit}`
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return reply
        .header('Content-Type', 'application/feed+json; charset=utf-8')
        .header('X-Cache', 'HIT')
        .send(cached)
    }

    const signals = await fetchSignals({ category, severity, minReliability: min_reliability, limit })
    const selfUrl = `${API_URL}/api/v1/rss/signals.json`
    const title = category
      ? `WorldPulse Signals — ${category}`
      : 'WorldPulse Signals — All Categories'
    const feed = buildJsonFeed(signals, { title, selfUrl })
    const body = JSON.stringify(feed)

    await cacheSet(cacheKey, body, RSS_CACHE_TTL)

    return reply
      .header('Content-Type', 'application/feed+json; charset=utf-8')
      .header('X-Cache', 'MISS')
      .send(body)
  })

  // ─── Per-Category Atom Feed ────────────────────────────────────────────
  app.get('/category/:category.xml', {
    schema: {
      tags: ['rss'],
      summary: 'Atom feed for a specific signal category',
      params: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Signal category slug' },
        },
        required: ['category'],
      },
      querystring: {
        type: 'object',
        properties: {
          severity:        { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          min_reliability: { type: 'number', minimum: 0, maximum: 1 },
          limit:           { type: 'number', default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT },
        },
        additionalProperties: false,
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { category } = req.params as { category: string }
    const { severity, min_reliability, limit = DEFAULT_LIMIT } =
      req.query as { severity?: string; min_reliability?: number; limit?: number }

    if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return sendError(reply, 404, 'NOT_FOUND', `Unknown category: ${category}`)
    }

    const cacheKey = `rss:atom:cat:${category}:${severity ?? 'all'}:${min_reliability ?? '0'}:${limit}`
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return reply
        .header('Content-Type', 'application/atom+xml; charset=utf-8')
        .header('X-Cache', 'HIT')
        .send(cached)
    }

    const signals = await fetchSignals({ category, severity, minReliability: min_reliability, limit })
    const selfUrl = `${API_URL}/api/v1/rss/category/${category}.xml`
    const title = `WorldPulse Signals — ${category.charAt(0).toUpperCase() + category.slice(1)}`
    const xml = buildAtomFeed(signals, { title, selfUrl })

    await cacheSet(cacheKey, xml, RSS_CACHE_TTL)

    return reply
      .header('Content-Type', 'application/atom+xml; charset=utf-8')
      .header('X-Cache', 'MISS')
      .send(xml)
  })

  // ─── Per-Category JSON Feed ────────────────────────────────────────────
  app.get('/category/:category.json', {
    schema: {
      tags: ['rss'],
      summary: 'JSON Feed for a specific signal category',
      params: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Signal category slug' },
        },
        required: ['category'],
      },
      querystring: {
        type: 'object',
        properties: {
          severity:        { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          min_reliability: { type: 'number', minimum: 0, maximum: 1 },
          limit:           { type: 'number', default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT },
        },
        additionalProperties: false,
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { category } = req.params as { category: string }
    const { severity, min_reliability, limit = DEFAULT_LIMIT } =
      req.query as { severity?: string; min_reliability?: number; limit?: number }

    if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return sendError(reply, 404, 'NOT_FOUND', `Unknown category: ${category}`)
    }

    const cacheKey = `rss:json:cat:${category}:${severity ?? 'all'}:${min_reliability ?? '0'}:${limit}`
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return reply
        .header('Content-Type', 'application/feed+json; charset=utf-8')
        .header('X-Cache', 'HIT')
        .send(cached)
    }

    const signals = await fetchSignals({ category, severity, minReliability: min_reliability, limit })
    const selfUrl = `${API_URL}/api/v1/rss/category/${category}.json`
    const title = `WorldPulse Signals — ${category.charAt(0).toUpperCase() + category.slice(1)}`
    const feed = buildJsonFeed(signals, { title, selfUrl })
    const body = JSON.stringify(feed)

    await cacheSet(cacheKey, body, RSS_CACHE_TTL)

    return reply
      .header('Content-Type', 'application/feed+json; charset=utf-8')
      .header('X-Cache', 'MISS')
      .send(body)
  })

  // ─── Feed Discovery (OPML) ────────────────────────────────────────────
  app.get('/opml', {
    schema: {
      tags: ['rss'],
      summary: 'OPML feed list for RSS reader import',
      description: 'Returns an OPML document listing all available WorldPulse feeds for one-click RSS reader import.',
    },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const baseUrl = `${API_URL}/api/v1/rss`
    const categories = VALID_CATEGORIES.map(cat =>
      `      <outline text="WorldPulse — ${cat.charAt(0).toUpperCase() + cat.slice(1)}" title="WorldPulse — ${cat.charAt(0).toUpperCase() + cat.slice(1)}" type="rss" xmlUrl="${baseUrl}/category/${cat}.xml" htmlUrl="${SITE_URL}"/>`
    ).join('\n')

    const opml = `<?xml version="1.0" encoding="utf-8"?>
<opml version="2.0">
  <head>
    <title>WorldPulse Intelligence Feeds</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
    <ownerName>WorldPulse Intelligence Network</ownerName>
    <docs>${SITE_URL}</docs>
  </head>
  <body>
    <outline text="WorldPulse — All Signals" title="WorldPulse — All Signals" type="rss" xmlUrl="${baseUrl}/signals.xml" htmlUrl="${SITE_URL}"/>
    <outline text="By Category" title="By Category">
${categories}
    </outline>
  </body>
</opml>`

    return reply
      .header('Content-Type', 'text/x-opml; charset=utf-8')
      .send(opml)
  })
}
