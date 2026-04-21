import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorldPulse } from '../client'
import { ApiError, TimeoutError, RateLimitError, NetworkError, WorldPulseError } from '../errors'
import type { WorldPulseConfig, Signal, PaginatedResponse } from '../types'

// ─── Helpers ─────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as Response)
}

function mockFetchSequence(responses: Array<{ body: unknown; status: number; headers?: Record<string, string> }>): typeof fetch {
  const fn = vi.fn()
  for (const [i, resp] of responses.entries()) {
    fn.mockResolvedValueOnce({
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers: new Headers(resp.headers ?? {}),
      json: () => Promise.resolve(resp.body),
    } as Response)
  }
  return fn
}

const SIGNAL_FIXTURE: Signal = {
  id: 'sig_001',
  title: 'Test signal',
  category: 'conflict',
  severity: 'high',
  reliability_score: 0.85,
  location_name: 'Kyiv, Ukraine',
  published_at: '2026-04-06T00:00:00.000Z',
  source_url: 'https://example.com/article',
}

// ─── Client Construction ─────────────────────────────────────────

describe('WorldPulse constructor', () => {
  it('uses default base URL when none provided', () => {
    const wp = new WorldPulse({ fetch: mockFetch({}) })
    const url = wp.buildUrl('/signals')
    expect(url).toContain('api.world-pulse.io')
  })

  it('accepts custom base URL', () => {
    const wp = new WorldPulse({ baseUrl: 'http://localhost:3001/api/v1/public', fetch: mockFetch({}) })
    const url = wp.buildUrl('/signals')
    expect(url).toContain('localhost:3001')
  })

  it('strips trailing slashes from base URL', () => {
    const wp = new WorldPulse({ baseUrl: 'http://localhost:3001/', fetch: mockFetch({}) })
    const url = wp.buildUrl('/signals')
    expect(url).toBe('http://localhost:3001/signals')
  })

  it('exposes all method groups', () => {
    const wp = new WorldPulse({ fetch: mockFetch({}) })
    expect(wp.signals).toBeDefined()
    expect(wp.categories).toBeDefined()
    expect(wp.sources).toBeDefined()
    expect(wp.intelligence).toBeDefined()
    expect(wp.countries).toBeDefined()
    expect(wp.threats).toBeDefined()
    expect(wp.stats).toBeDefined()
    expect(wp.breaking).toBeDefined()
  })
})

// ─── URL Building ────────────────────────────────────────────────

describe('buildUrl', () => {
  const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: mockFetch({}) })

  it('builds URL with no params', () => {
    expect(wp.buildUrl('/signals')).toBe('http://test.local/api/signals')
  })

  it('appends query params', () => {
    const url = wp.buildUrl('/signals', { category: 'conflict', limit: 10 })
    expect(url).toContain('category=conflict')
    expect(url).toContain('limit=10')
  })

  it('omits undefined and null params', () => {
    const url = wp.buildUrl('/signals', { category: undefined, severity: null, limit: 5 })
    expect(url).not.toContain('category')
    expect(url).not.toContain('severity')
    expect(url).toContain('limit=5')
  })

  it('encodes special characters', () => {
    const url = wp.buildUrl('/signals', { q: 'foo bar & baz' })
    expect(url).toContain('q=foo+bar')
  })
})

// ─── HTTP GET / Fetch Behavior ───────────────────────────────────

describe('get', () => {
  it('sends GET request with correct headers', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.get('/signals')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test.local/api/signals')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({
      'Accept': 'application/json',
    })
  })

  it('includes custom headers', async () => {
    const fetchMock = mockFetch({ success: true })
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: fetchMock,
      headers: { 'X-Custom': 'value' },
    })

    await wp.get('/signals')

    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Custom']).toBe('value')
  })

  it('returns parsed JSON on success', async () => {
    const body = { success: true, data: [SIGNAL_FIXTURE], total: 1, limit: 50, offset: 0 }
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: mockFetch(body) })

    const result = await wp.get<PaginatedResponse<Signal>>('/signals')
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.id).toBe('sig_001')
  })
})

// ─── Error Handling ──────────────────────────────────────────────

describe('error handling', () => {
  it('throws ApiError on 400 response', async () => {
    const body = { success: false, error: 'Bad request', code: 'VALIDATION_ERROR' }
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: mockFetch(body, 400),
      maxRetries: 0,
    })

    await expect(wp.get('/signals')).rejects.toThrow(ApiError)
    try {
      await wp.get('/signals')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(400)
      expect((err as ApiError).code).toBe('VALIDATION_ERROR')
    }
  })

  it('throws ApiError on 404', async () => {
    const body = { success: false, error: 'Not found', code: 'NOT_FOUND' }
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: mockFetch(body, 404),
      maxRetries: 0,
    })
    await expect(wp.get('/signals/nonexistent')).rejects.toThrow(ApiError)
  })

  it('throws RateLimitError on 429', async () => {
    const body = { success: false, error: 'Too many requests', code: 'RATE_LIMITED' }
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: mockFetch(body, 429, { 'Retry-After': '30' }),
      maxRetries: 0,
    })

    await expect(wp.get('/signals')).rejects.toThrow(RateLimitError)
    try {
      await wp.get('/signals')
    } catch (err) {
      expect((err as RateLimitError).retryAfterMs).toBe(30_000)
    }
  })

  it('throws NetworkError on fetch failure', async () => {
    const failFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: failFetch,
      maxRetries: 0,
    })

    await expect(wp.get('/signals')).rejects.toThrow(NetworkError)
  })

  it('throws TimeoutError on abort', async () => {
    const slowFetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    )
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: slowFetch,
      timeout: 100,
      maxRetries: 0,
    })

    await expect(wp.get('/signals')).rejects.toThrow(TimeoutError)
  })
})

// ─── Retry Logic ─────────────────────────────────────────────────

describe('retry logic', () => {
  it('retries on 500 then succeeds', async () => {
    const fetchSeq = mockFetchSequence([
      { body: null, status: 500 },
      { body: { success: true, data: [] }, status: 200 },
    ])
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: fetchSeq,
      maxRetries: 2,
      retryDelay: 1,
    })

    const result = await wp.get('/signals')
    expect(fetchSeq).toHaveBeenCalledTimes(2)
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('retries on 429 then succeeds', async () => {
    const fetchSeq = mockFetchSequence([
      { body: { success: false }, status: 429, headers: { 'Retry-After': '0' } },
      { body: { success: true, data: [] }, status: 200 },
    ])
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: fetchSeq,
      maxRetries: 2,
      retryDelay: 1,
    })

    const result = await wp.get('/signals')
    expect(fetchSeq).toHaveBeenCalledTimes(2)
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('exhausts retries on persistent 500', async () => {
    const fetchSeq = mockFetchSequence([
      { body: null, status: 500 },
      { body: null, status: 500 },
      { body: null, status: 500 },
    ])
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: fetchSeq,
      maxRetries: 2,
      retryDelay: 1,
    })

    await expect(wp.get('/signals')).rejects.toThrow(ApiError)
    expect(fetchSeq).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 400 (client error)', async () => {
    const fetchMock = mockFetch({ success: false, error: 'Bad request', code: 'BAD_REQUEST' }, 400)
    const wp = new WorldPulse({
      baseUrl: 'http://test.local/api',
      fetch: fetchMock,
      maxRetries: 2,
    })

    await expect(wp.get('/signals')).rejects.toThrow(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ─── Method Groups ───────────────────────────────────────────────

describe('signals', () => {
  it('list() calls /signals with params', async () => {
    const fetchMock = mockFetch({ success: true, data: [], total: 0, limit: 10, offset: 0 })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.signals.list({ category: 'climate', limit: 10 })

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/signals')
    expect(url).toContain('category=climate')
    expect(url).toContain('limit=10')
  })

  it('get() calls /signals/:id', async () => {
    const fetchMock = mockFetch({ success: true, data: { ...SIGNAL_FIXTURE, body: 'text' } })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.signals.get('sig_001')

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/signals/sig_001')
  })

  it('get() encodes special characters in ID', async () => {
    const fetchMock = mockFetch({ success: true, data: {} })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.signals.get('sig/with spaces')

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/signals/sig%2Fwith%20spaces')
  })
})

describe('categories', () => {
  it('list() calls /categories', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.categories.list()

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/categories')
  })
})

describe('sources', () => {
  it('list() calls /sources with params', async () => {
    const fetchMock = mockFetch({ success: true, data: [], total: 0, limit: 50, offset: 0 })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.sources.list({ tier: 'premium', country_code: 'US' })

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/sources')
    expect(url).toContain('tier=premium')
    expect(url).toContain('country_code=US')
  })
})

describe('intelligence', () => {
  it('list() calls /intelligence', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.intelligence.list()

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/intelligence')
  })
})

describe('countries', () => {
  it('list() calls /countries with params', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.countries.list({ since: '2026-04-01T00:00:00Z' })

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/countries')
    expect(url).toContain('since=')
  })
})

describe('threats', () => {
  it('list() calls /threats', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.threats.list()

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/threats')
  })
})

describe('stats', () => {
  it('get() calls /stats', async () => {
    const fetchMock = mockFetch({ success: true, data: { total_signals: 5000 } })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    const result = await wp.stats.get()

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/stats')
    expect(result.data.total_signals).toBe(5000)
  })
})

describe('breaking', () => {
  it('list() calls /breaking with params', async () => {
    const fetchMock = mockFetch({ success: true, data: [] })
    const wp = new WorldPulse({ baseUrl: 'http://test.local/api', fetch: fetchMock })

    await wp.breaking.list({ limit: 5 })

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/breaking')
    expect(url).toContain('limit=5')
  })
})

// ─── Error Class Hierarchy ───────────────────────────────────────

describe('error classes', () => {
  it('WorldPulseError is base class', () => {
    const err = new WorldPulseError('test', 'TEST')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('WorldPulseError')
    expect(err.code).toBe('TEST')
  })

  it('ApiError extends WorldPulseError', () => {
    const err = new ApiError('not found', 'NOT_FOUND', 404)
    expect(err).toBeInstanceOf(WorldPulseError)
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(404)
  })

  it('RateLimitError has retryAfterMs', () => {
    const err = new RateLimitError('slow down', '60')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.retryAfterMs).toBe(60_000)
  })

  it('RateLimitError with null Retry-After', () => {
    const err = new RateLimitError('slow down', null)
    expect(err.retryAfterMs).toBeNull()
  })

  it('TimeoutError has correct message', () => {
    const err = new TimeoutError('http://example.com', 5000)
    expect(err.message).toContain('5000ms')
    expect(err.code).toBe('TIMEOUT')
  })

  it('NetworkError wraps cause', () => {
    const cause = new TypeError('Failed to fetch')
    const err = new NetworkError('http://example.com', cause)
    expect(err.cause).toBe(cause)
    expect(err.code).toBe('NETWORK_ERROR')
  })
})

// ─── Type Safety ─────────────────────────────────────────────────

describe('type definitions', () => {
  it('Signal type has all required fields', () => {
    const sig: Signal = SIGNAL_FIXTURE
    expect(sig.id).toBeDefined()
    expect(sig.title).toBeDefined()
    expect(sig.category).toBeDefined()
    expect(sig.severity).toBeDefined()
    expect(sig.published_at).toBeDefined()
  })

  it('PaginatedResponse has pagination fields', () => {
    const resp: PaginatedResponse<Signal> = {
      success: true,
      data: [SIGNAL_FIXTURE],
      total: 1,
      limit: 50,
      offset: 0,
    }
    expect(resp.total).toBe(1)
    expect(resp.limit).toBe(50)
  })
})
