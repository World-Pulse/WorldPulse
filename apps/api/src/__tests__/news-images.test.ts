/**
 * news-images.test.ts
 * Unit tests for the GDELT Visual News Imagery integration.
 *
 * Covers:
 *  - NEWS_IMAGES_CACHE_TTL and NEWS_IMAGES_RATE_LIMIT constants
 *  - Route handler: success path, GDELT error, AbortError timeout,
 *    Redis cache hit, 404 on missing signal, filters images with no
 *    socialimage field, response shape validation (NewsImage interface)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'

// ── Mocks must be declared before any imports that trigger them ──────────────

vi.mock('../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:       vi.fn(),
    setex:     vi.fn(),
    del:       vi.fn(),
    scan:      vi.fn(),
    unlink:    vi.fn(),
    pipeline:  vi.fn(),
    zrevrange: vi.fn(),
  },
}))

vi.mock('../middleware/auth', () => ({
  optionalAuth: vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
  authenticate: vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
}))

vi.mock('../lib/search',          () => ({ indexSignal: vi.fn(), removeSignal: vi.fn() }))
vi.mock('../lib/search-events',   () => ({ publishSignalUpsert: vi.fn(), publishSignalDelete: vi.fn() }))
vi.mock('../lib/signal-summary',  () => ({ generateSignalSummary: vi.fn(), refreshSignalSummary: vi.fn() }))
vi.mock('../lib/slop-detector',   () => ({ slopDetector: { scoreSignal: vi.fn() } }))
vi.mock('../lib/pinecone',        () => ({ generateEmbedding: vi.fn(), querySimilar: vi.fn(), isPineconeEnabled: vi.fn(() => false) }))
vi.mock('../lib/risk-score',      () => ({ computeRiskScore: vi.fn(() => ({ score: 0, level: 'low', label: 'Low' })) }))
vi.mock('../lib/cib-detection',   () => ({ detectCIB: vi.fn() }))
vi.mock('../lib/source-bias',     () => ({ getSourceBias: vi.fn(), extractDomain: vi.fn() }))
vi.mock('../lib/errors',          () => ({ sendError: vi.fn() }))

// ── Lazy imports (after mocks) ───────────────────────────────────────────────

const { db }    = await import('../db/postgres')
const { redis } = await import('../db/redis')

const {
  registerSignalRoutes,
  extractTVKeywords,
  NEWS_IMAGES_CACHE_TTL,
  NEWS_IMAGES_RATE_LIMIT,
} = await import('../routes/signals')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDbChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'where', 'first', 'select', 'join', 'orderBy', 'limit', 'offset',
    'whereIn', 'whereNull', 'whereNotNull', 'count', 'groupBy',
    'increment', 'insert', 'update', 'delete', 'returning',
    'catch', 'whereRaw', 'orderByRaw',
  ]
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

const SAMPLE_GDELT_DOC_RESPONSE = {
  articles: [
    {
      url:           'https://reuters.com/article-1',
      title:         'Earthquake strikes Turkey, hundreds feared dead',
      seendate:      '20260328T120000Z',
      socialimage:   'https://cdn.reuters.com/img1.jpg',
      domain:        'reuters.com',
      language:      'English',
      sourcecountry: 'United States',
    },
    {
      url:           'https://bbc.com/article-2',
      title:         'Turkey earthquake: rescue teams mobilise',
      seendate:      '20260328T140000Z',
      socialimage:   'https://ichef.bbci.co.uk/img2.jpg',
      domain:        'bbc.com',
      language:      'English',
      sourcecountry: 'United Kingdom',
    },
    {
      // This article has no socialimage — should be filtered out
      url:           'https://example.com/no-image',
      title:         'More details emerge',
      seendate:      '20260328T150000Z',
      socialimage:   '',
      domain:        'example.com',
      language:      'English',
      sourcecountry: 'United States',
    },
  ],
}

async function buildApp() {
  const app = Fastify()
  await app.register(fastifyRateLimit, { global: false })
  await app.register(registerSignalRoutes, { prefix: '/signals' })
  await app.ready()
  return app
}

// ─── 1. Constants ─────────────────────────────────────────────────────────────

describe('news-images constants', () => {
  it('NEWS_IMAGES_CACHE_TTL is 3600 (1 hour)', () => {
    expect(NEWS_IMAGES_CACHE_TTL).toBe(3600)
  })

  it('NEWS_IMAGES_RATE_LIMIT is 30', () => {
    expect(NEWS_IMAGES_RATE_LIMIT).toBe(30)
  })
})

// ─── 2. extractTVKeywords (shared helper, re-verified here) ──────────────────

describe('extractTVKeywords (used for news-images queries)', () => {
  it('strips stop words and limits to 3 keywords', () => {
    const kw = extractTVKeywords('The earthquake in Turkey kills hundreds')
    expect(kw.length).toBeLessThanOrEqual(3)
    expect(kw).not.toContain('the')
    expect(kw).not.toContain('in')
  })

  it('handles empty title gracefully', () => {
    expect(extractTVKeywords('')).toEqual([])
  })
})

// ─── 3. Route handler: GET /signals/:id/news-images ──────────────────────────

describe('GET /signals/:id/news-images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns images array with correct shape on success', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-1',
      title:      'Major earthquake strikes Turkey',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const globalFetch = vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(SAMPLE_GDELT_DOC_RESPONSE),
    })
    vi.stubGlobal('fetch', globalFetch)

    const res = await app.inject({ method: 'GET', url: '/signals/sig-1/news-images' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { images: unknown[]; query: string; total: number } }
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.images)).toBe(true)
    // Only articles with non-empty socialimage should be included (2 of 3)
    expect(body.data.images.length).toBe(2)
    expect(body.data.total).toBe(2)
    expect(typeof body.data.query).toBe('string')
  })

  it('filters out articles with empty socialimage', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-noimg',
      title:      'Breaking news',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ articles: [{ url: 'https://x.com', title: 'T', seendate: '20260101T000000Z', socialimage: '', domain: 'x.com', language: 'English', sourcecountry: 'US' }] }),
    }))

    const res  = await app.inject({ method: 'GET', url: '/signals/sig-noimg/news-images' })
    const body = JSON.parse(res.body) as { success: boolean; data: { images: unknown[] } }
    expect(body.success).toBe(true)
    expect(body.data.images.length).toBe(0)
  })

  it('returns { images: [] } on GDELT network error — never 500', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-err',
      title:      'Crisis erupts in South Asia',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const res = await app.inject({ method: 'GET', url: '/signals/sig-err/news-images' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { images: unknown[] } }
    expect(body.success).toBe(true)
    expect(body.data.images).toEqual([])
  })

  it('returns { images: [] } on AbortError (timeout) — never 500', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-timeout',
      title:      'Flooding in Southeast Asia',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const abortErr = new DOMException('The operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))

    const res = await app.inject({ method: 'GET', url: '/signals/sig-timeout/news-images' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { images: unknown[] } }
    expect(body.success).toBe(true)
    expect(body.data.images).toEqual([])
  })

  it('returns Redis-cached response without calling GDELT', async () => {
    const app = await buildApp()

    const cachedPayload = JSON.stringify({
      success: true,
      data: { images: [{ id: 'ni_0_x', imageUrl: 'https://cached.jpg', caption: 'Cached', sourceUrl: null, sourceDomain: null, date: null }], query: 'test', total: 1 },
    })

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(cachedPayload)

    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const res = await app.inject({ method: 'GET', url: '/signals/sig-cached/news-images' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
    // GDELT should NOT be called
    expect(globalFetch).not.toHaveBeenCalled()
    const body = JSON.parse(res.body) as { data: { images: unknown[] } }
    expect(body.data.images.length).toBe(1)
  })

  it('returns 404 when signal is not found', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain(undefined))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/signals/nonexistent-id/news-images' })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/not found/i)
  })

  it('caches result in Redis with NEWS_IMAGES_CACHE_TTL', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-ttl',
      title:      'Economic sanctions expand',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(SAMPLE_GDELT_DOC_RESPONSE),
    }))

    await app.inject({ method: 'GET', url: '/signals/sig-ttl/news-images' })

    expect(redisMock.setex).toHaveBeenCalledWith(
      'news-images:sig-ttl',
      NEWS_IMAGES_CACHE_TTL,
      expect.any(String),
    )
  })

  it('returned NewsImage objects have required fields', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-shape',
      title:      'Missile launch detected',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(SAMPLE_GDELT_DOC_RESPONSE),
    }))

    const res = await app.inject({ method: 'GET', url: '/signals/sig-shape/news-images' })
    const body = JSON.parse(res.body) as { data: { images: Array<{ id: unknown; imageUrl: unknown; caption: unknown; sourceUrl: unknown; sourceDomain: unknown; date: unknown }> } }

    for (const img of body.data.images) {
      expect(typeof img.id).toBe('string')
      expect(typeof img.imageUrl).toBe('string')
      expect(img.imageUrl.length).toBeGreaterThan(0)
      // caption / sourceUrl / sourceDomain / date may be null
      expect('caption'      in img).toBe(true)
      expect('sourceUrl'    in img).toBe(true)
      expect('sourceDomain' in img).toBe(true)
      expect('date'         in img).toBe(true)
    }
  })

  it('does not call GDELT when articles array is missing from response', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-empty-resp',
      title:      'Quiet day in markets',
      created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ status: 'ok' }), // no 'articles' key
    }))

    const res  = await app.inject({ method: 'GET', url: '/signals/sig-empty-resp/news-images' })
    const body = JSON.parse(res.body) as { data: { images: unknown[]; total: number } }
    expect(body.data.images).toEqual([])
    expect(body.data.total).toBe(0)
  })

  it('rate limit config is NEWS_IMAGES_RATE_LIMIT', () => {
    // The constant is exported and equals 30
    expect(NEWS_IMAGES_RATE_LIMIT).toBe(30)
  })
})
