/**
 * tv-clips.test.ts
 * Unit tests for the GDELT TV News Clip integration.
 *
 * Covers:
 *  - extractTVKeywords — stop-word filtering and limit of 3
 *  - formatGdeltDate   — UTC date → YYYYMMDDHHMMSS
 *  - TV_CLIPS_CACHE_TTL and TV_CLIPS_RATE_LIMIT constants
 *  - Route handler: success, GDELT error, timeout, Redis caching,
 *    404 on missing signal, old-signal date-range logic,
 *    keyword extraction edge cases, rate-limit config
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
    get:    vi.fn(),
    setex:  vi.fn(),
    del:    vi.fn(),
    scan:   vi.fn(),
    unlink: vi.fn(),
    pipeline: vi.fn(),
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
  formatGdeltDate,
  TV_CLIPS_CACHE_TTL,
  TV_CLIPS_RATE_LIMIT,
} = await import('../routes/signals')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDbChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['where', 'first', 'select', 'join', 'orderBy', 'limit', 'offset',
                   'whereIn', 'whereNull', 'whereNotNull', 'count', 'groupBy',
                   'increment', 'insert', 'update', 'delete', 'returning',
                   'catch', 'whereRaw', 'orderByRaw']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  // Make the chain thenable so await works
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

const SAMPLE_GDELT_RESPONSE = {
  clips: [
    {
      url:         'https://tv.gdeltproject.org/clip1',
      station:     'CNN',
      show:        'Anderson Cooper 360',
      date_time:   '2026-03-28T22:00:00Z',
      preview_url: 'https://tv.gdeltproject.org/preview1.jpg',
      embed_url:   'https://tv.gdeltproject.org/embed1',
    },
    {
      url:         'https://tv.gdeltproject.org/clip2',
      station:     'BBC',
      show:        'World News',
      date_time:   '2026-03-28T18:00:00Z',
      preview_url: 'https://tv.gdeltproject.org/preview2.jpg',
      embed_url:   'https://tv.gdeltproject.org/embed2',
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

// ─── 1. extractTVKeywords ─────────────────────────────────────────────────────

describe('extractTVKeywords', () => {
  it('strips stop words and returns up to 3 keywords', () => {
    const kw = extractTVKeywords('The earthquake in Turkey kills hundreds')
    expect(kw).not.toContain('the')
    expect(kw).not.toContain('in')
    expect(kw.length).toBeLessThanOrEqual(3)
    expect(kw).toContain('earthquake')
    expect(kw).toContain('turkey')
  })

  it('returns at most 3 keywords from a long title', () => {
    const kw = extractTVKeywords('Major flooding disaster kills hundreds of people in southern Bangladesh delta region')
    expect(kw.length).toBe(3)
  })

  it('strips punctuation and lowercases', () => {
    const kw = extractTVKeywords("Russia's invasion of Ukraine escalates!")
    expect(kw.every(w => w === w.toLowerCase())).toBe(true)
    expect(kw.every(w => /^[a-z0-9]+$/.test(w))).toBe(true)
  })

  it('handles empty title gracefully', () => {
    expect(extractTVKeywords('')).toEqual([])
  })
})

// ─── 2. formatGdeltDate ───────────────────────────────────────────────────────

describe('formatGdeltDate', () => {
  it('formats a UTC date as YYYYMMDDHHMMSS', () => {
    const d = new Date('2026-03-15T08:05:03Z')
    expect(formatGdeltDate(d)).toBe('20260315080503')
  })

  it('pads single-digit month, day, hour, min, sec', () => {
    const d = new Date('2026-01-02T03:04:05Z')
    expect(formatGdeltDate(d)).toBe('20260102030405')
  })
})

// ─── 3. Constants ─────────────────────────────────────────────────────────────

describe('TV clips constants', () => {
  it('TV_CLIPS_CACHE_TTL is 1800 (30 min)', () => {
    expect(TV_CLIPS_CACHE_TTL).toBe(1800)
  })

  it('TV_CLIPS_RATE_LIMIT is 30', () => {
    expect(TV_CLIPS_RATE_LIMIT).toBe(30)
  })
})

// ─── 4. Route handler ─────────────────────────────────────────────────────────

describe('GET /signals/:id/tv-clips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns clips array on success', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id:         'sig-1',
      title:      'Major earthquake strikes Turkey',
      summary:    null,
      created_at: new Date(), // recent signal
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(SAMPLE_GDELT_RESPONSE),
    })

    const res = await app.inject({ method: 'GET', url: '/signals/sig-1/tv-clips' })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ success: boolean; data: { clips: unknown[]; total: number } }>()
    expect(body.success).toBe(true)
    expect(body.data.clips).toHaveLength(2)
    expect(body.data.total).toBe(2)

    await app.close()
  })

  it('returns empty clips array on GDELT fetch error', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-2', title: 'Flood warning', summary: null, created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('Network error'))

    const res = await app.inject({ method: 'GET', url: '/signals/sig-2/tv-clips' })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ success: boolean; data: { clips: unknown[] } }>()
    expect(body.success).toBe(true)
    expect(body.data.clips).toEqual([])

    await app.close()
  })

  it('returns empty clips array on timeout', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-3', title: 'Hurricane warning', summary: null, created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const fetchMock  = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(abortError)

    const res = await app.inject({ method: 'GET', url: '/signals/sig-3/tv-clips' })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ success: boolean; data: { clips: unknown[] } }>()
    expect(body.success).toBe(true)
    expect(body.data.clips).toEqual([])

    await app.close()
  })

  it('caches response in Redis and returns cached result on second call', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-4', title: 'Wildfire California', summary: null, created_at: new Date(),
    }))

    const cachedPayload = JSON.stringify({
      success: true,
      data: { clips: [{ id: 'c1', station: 'FOX NEWS', showName: 'Fox Report', showDate: '', previewUrl: '', clipUrl: '', durationSecs: null }], query: 'wildfire california', total: 1 },
    })

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    // First call: cache miss; second call: cache hit
    redisMock.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cachedPayload)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(SAMPLE_GDELT_RESPONSE) })

    // First request — should hit GDELT + write to Redis
    const res1 = await app.inject({ method: 'GET', url: '/signals/sig-4/tv-clips' })
    expect(res1.statusCode).toBe(200)
    expect(redisMock.setex).toHaveBeenCalledWith(`tv-clips:sig-4`, TV_CLIPS_CACHE_TTL, expect.any(String))

    // Second request — should be served from cache
    const res2 = await app.inject({ method: 'GET', url: '/signals/sig-4/tv-clips' })
    expect(res2.statusCode).toBe(200)
    expect(res2.headers['x-cache-hit']).toBe('true')

    // fetch should only have been called once (first request)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('returns 404 if signal not found', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain(undefined)) // .first() returns undefined

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/signals/nonexistent/tv-clips' })
    expect(res.statusCode).toBe(404)

    const body = res.json<{ success: boolean; error: string }>()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/not found/i)

    await app.close()
  })

  it('uses date-range query for signals older than 7 days', async () => {
    const app = await buildApp()

    // Signal published 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-old', title: 'Old conflict report', summary: null, created_at: tenDaysAgo,
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ clips: [] }) })

    await app.inject({ method: 'GET', url: '/signals/sig-old/tv-clips' })

    // The URL passed to fetch should contain startdatetime/enddatetime, not timespan
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('startdatetime=')
    expect(calledUrl).toContain('enddatetime=')
    expect(calledUrl).not.toContain('timespan=')

    await app.close()
  })

  it('uses timespan=7d for recent signals (≤7 days old)', async () => {
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-recent', title: 'Breaking news event', summary: null, created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ clips: [] }) })

    await app.inject({ method: 'GET', url: '/signals/sig-recent/tv-clips' })

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('timespan=7d')
    expect(calledUrl).not.toContain('startdatetime=')

    await app.close()
  })

  it('rate limit config is 30 req/min', async () => {
    // Build the app and confirm the route registers with the expected rate limit.
    // @fastify/rate-limit exposes x-ratelimit-limit header on responses.
    const app = await buildApp()

    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue(makeDbChain({
      id: 'sig-rl', title: 'Rate limit test', summary: null, created_at: new Date(),
    }))

    const redisMock = redis as unknown as Record<string, ReturnType<typeof vi.fn>>
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ clips: [] }) })

    const res = await app.inject({ method: 'GET', url: '/signals/sig-rl/tv-clips' })
    expect(res.statusCode).toBe(200)
    // @fastify/rate-limit sets x-ratelimit-limit to the configured max
    expect(Number(res.headers['x-ratelimit-limit'])).toBe(TV_CLIPS_RATE_LIMIT)

    await app.close()
  })
})
