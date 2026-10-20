/**
 * How the SDK asks and what it does with the answer (plan V3h): the address
 * and parameters each method sends, the headers, and the errors for the
 * answers the API gives (apps/api/src/lib/errors.ts, lib/error-reply.ts,
 * lib/rate-limit-options.ts). fetch is stubbed: no network.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WorldPulse, DEFAULT_BASE_URL,
  WorldPulseError, ApiError, RateLimitError, NetworkError, TimeoutError,
  type SignalList,
} from '../index'

const ID = '6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30'

/** A fetch answering `status` with `body` (JSON unless it's a string) */
function answer(status = 200, body: unknown = { success: true, data: [] }, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }))
}

/** What the first request sent */
function sent(fetch: ReturnType<typeof answer>) {
  const [url, init] = fetch.mock.calls[0]!
  return { url: new URL(String(url)), init: init ?? {}, headers: new Headers(init?.headers) }
}

/** The error a call rejects with */
async function failure(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
  } catch (err) {
    return err
  }
  throw new Error('the call succeeded')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// An answer of GET /api/v1/public/signals, as routes/public.ts builds it
const SIGNALS: SignalList = {
  success: true,
  data: [{
    id: ID,
    title: 'Magnitude 6.2 earthquake near Tonga',
    category: 'disaster',
    severity: 'high',
    reliability_score: 0.87,
    location_name: 'Tonga',
    published_at: '2026-10-20T14:32:00.000Z',
    source_url: 'https://example.com/tonga',
  }],
  total: 2847,
  total_exact: false,
  limit: 50,
  offset: 0,
}

describe('requests', () => {
  it('ask https://api.world-pulse.io by default, with GET and Accept: application/json, and no credentials', async () => {
    const fetch = answer()
    await new WorldPulse({ fetch }).signals.list()
    const { url, init, headers } = sent(fetch)
    expect(DEFAULT_BASE_URL).toBe('https://api.world-pulse.io')
    expect(url.href).toBe('https://api.world-pulse.io/api/v1/public/signals')
    expect(init.method).toBe('GET')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.has('x-api-key')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('go to the baseUrl given, without its trailing slash, keeping its path', async () => {
    const local = answer()
    await new WorldPulse({ fetch: local, baseUrl: 'http://localhost:3001/' }).categories.list()
    expect(sent(local).url.href).toBe('http://localhost:3001/api/v1/public/categories')

    const behindProxy = answer()
    await new WorldPulse({ fetch: behindProxy, baseUrl: 'https://example.org/worldpulse//' }).stories.top()
    expect(sent(behindProxy).url.href).toBe('https://example.org/worldpulse/api/v1/stories')
  })

  it('send the parameters given and leave the others out', async () => {
    const fetch = answer()
    await new WorldPulse({ fetch }).signals.list({ category: 'conflict', limit: 10 })
    expect([...sent(fetch).url.searchParams]).toEqual([['category', 'conflict'], ['limit', '10']])
  })

  it.each([
    ['signals.list',    (wp: WorldPulse) => wp.signals.list({ category: 'climate', severity: 'info', limit: 100, offset: 10_000 }), '/api/v1/public/signals', { category: 'climate', severity: 'info', limit: '100', offset: '10000' }],
    ['stories.top',     (wp: WorldPulse) => wp.stories.top({ hours: 72, limit: 20, country: 'NG' }),                               '/api/v1/stories',        { hours: '72', limit: '20', country: 'NG' }],
    ['stories.week',    (wp: WorldPulse) => wp.stories.week('2026-W42'),                                                            '/api/v1/stories/week',   { week: '2026-W42' }],
    ['stories.week()',  (wp: WorldPulse) => wp.stories.week(),                                                                      '/api/v1/stories/week',   {}],
    ['search.semantic', (wp: WorldPulse) => wp.search.semantic('drought & crop failure in Kenya', { limit: 5, category: 'climate' }), '/api/v1/search/semantic', { q: 'drought & crop failure in Kenya', limit: '5', category: 'climate' }],
    ['countries.list',  (wp: WorldPulse) => wp.countries.list({ window: '30d', limit: 200, category: 'conflict' }),                 '/api/v1/countries',      { window: '30d', limit: '200', category: 'conflict' }],
    ['categories.list', (wp: WorldPulse) => wp.categories.list(),                                                                   '/api/v1/public/categories', {}],
  ] as const)('%s sends its parameters under the names its route reads', async (_name, call, path, params) => {
    const fetch = answer()
    await call(new WorldPulse({ fetch }))
    const { url } = sent(fetch)
    expect(url.pathname).toBe(path)
    expect(Object.fromEntries(url.searchParams)).toEqual(params)
  })

  it('encode what a question holds', async () => {
    const fetch = answer(200, { success: true, results: [], semantic: true, partial: false })
    await new WorldPulse({ fetch }).search.semantic('drought & crop failure in Kenya?')
    expect(sent(fetch).url.search).toBe('?q=drought+%26+crop+failure+in+Kenya%3F')
  })

  it('put a signal or story id in the path', async () => {
    const signal = answer()
    await new WorldPulse({ fetch: signal }).signals.get(ID)
    expect(sent(signal).url.pathname).toBe(`/api/v1/signals/${ID}`)

    const story = answer()
    await new WorldPulse({ fetch: story }).stories.get(ID.toUpperCase())
    expect(sent(story).url.pathname).toBe(`/api/v1/stories/${ID.toUpperCase()}`)
  })

  it('refuse an id that isn\'t a UUID without asking: "week" would reach another route', async () => {
    const fetch = answer()
    const wp = new WorldPulse({ fetch })
    for (const call of [wp.stories.get('week'), wp.stories.get(''), wp.signals.get('count'), wp.signals.get(`${ID}/summary`)]) {
      const err = await failure(call)
      expect(err).toBeInstanceOf(TypeError)
      expect(String((err as Error).message)).toMatch(/UUID/)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('send an API key as X-API-Key and a sign-in token as Authorization: Bearer, as the API reads them', async () => {
    const fetch = answer()
    await new WorldPulse({ fetch, apiKey: 'wp_live_0123456789abcdef0123456789abcdef', token: 'eyJhbGciOi.payload.sig' }).signals.list()
    const { headers } = sent(fetch)
    expect(headers.get('x-api-key')).toBe('wp_live_0123456789abcdef0123456789abcdef')
    expect(headers.get('authorization')).toBe('Bearer eyJhbGciOi.payload.sig')
  })

  it('add the headers given to every request', async () => {
    const fetch = answer()
    const wp = new WorldPulse({ fetch, headers: { 'X-Request-Id': 'abc-123' } })
    await wp.signals.list()
    await wp.stories.week()
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('x-request-id')).toBe('abc-123')
  })

  /** A fetch that notes the `this` it was called with */
  function noting(): { fetch: typeof globalThis.fetch; receivers: unknown[] } {
    const receivers: unknown[] = []
    const fetch = function (this: unknown) {
      receivers.push(this)
      return Promise.resolve(new Response('{"success":true,"data":[]}'))
    } as unknown as typeof globalThis.fetch
    return { fetch, receivers }
  }

  it('use the global fetch when none is given, called on globalThis', async () => {
    const { fetch, receivers } = noting()
    vi.stubGlobal('fetch', fetch)
    await new WorldPulse().categories.list()
    expect(receivers).toEqual([globalThis])
  })

  it('call a fetch given as a plain function (a browser\'s fetch refuses any other `this`)', async () => {
    const { fetch, receivers } = noting()
    await new WorldPulse({ fetch }).categories.list()
    expect(receivers).toEqual([undefined])
  })

  it('return the answer as the API sent it', async () => {
    const wp = new WorldPulse({ fetch: answer(200, SIGNALS) })
    await expect(wp.signals.list()).resolves.toEqual(SIGNALS)
  })
})

describe('errors', () => {
  it('a route\'s 400 ({ success: false, code, error }) throws ApiError with the status, code, message and body', async () => {
    const body = { success: false, code: 'VALIDATION_ERROR', error: 'category must be one of: breaking, conflict, climate (or all)' }
    const err = await failure(new WorldPulse({ fetch: answer(400, body) }).signals.list({ category: 'not-a-category' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(WorldPulseError)
    const e = err as ApiError
    expect(e.name).toBe('ApiError')
    expect(e.status).toBe(400)
    expect(e.code).toBe('VALIDATION_ERROR')
    expect(e.message).toBe('WorldPulse API 400 VALIDATION_ERROR: category must be one of: breaking, conflict, climate (or all)')
    expect(e.body).toEqual(body)
    expect(e.url).toBe('https://api.world-pulse.io/api/v1/public/signals?category=not-a-category')
  })

  it('a 404 says so', async () => {
    const err = await failure(new WorldPulse({ fetch: answer(404, { success: false, code: 'NOT_FOUND', error: 'Story not found' }) }).stories.get(ID))
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).code).toBe('NOT_FOUND')
  })

  it('the error handler\'s answers ({ statusCode, code, error, message }) give their message', async () => {
    const body = { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message: 'querystring/window must be equal to one of the allowed values' }
    const err = await failure(new WorldPulse({ fetch: answer(400, body) }).countries.list())
    expect((err as ApiError).code).toBe('FST_ERR_VALIDATION')
    expect((err as ApiError).message).toBe('WorldPulse API 400 FST_ERR_VALIDATION: querystring/window must be equal to one of the allowed values')
  })

  it('a 429 throws RateLimitError, with the seconds Retry-After asks', async () => {
    const body = { statusCode: 429, code: 'RATE_LIMITED', error: 'Too Many Requests', message: 'Too many requests. Slow down.' }
    const fetch = answer(429, body, { 'retry-after': '37', 'x-ratelimit-remaining': '0' })
    const err = await failure(new WorldPulse({ fetch }).search.semantic('ports closed by the strike'))
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as RateLimitError
    expect(e.name).toBe('RateLimitError')
    expect(e.status).toBe(429)
    expect(e.code).toBe('RATE_LIMITED')
    expect(e.retryAfter).toBe(37)
    expect(e.message).toBe('WorldPulse API 429 RATE_LIMITED: Too many requests. Slow down.')
    expect(e.body).toEqual(body)
  })

  it('a Retry-After date counts the seconds until it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    const err = await failure(new WorldPulse({ fetch: answer(429, {}, { 'retry-after': 'Tue, 20 Oct 2026 12:01:30 GMT' }) }).categories.list())
    expect((err as RateLimitError).retryAfter).toBe(90)
  })

  it('a 429 without Retry-After has retryAfter null', async () => {
    const err = await failure(new WorldPulse({ fetch: answer(429, { success: false, code: 'RATE_LIMITED', error: 'Too many requests' }) }).categories.list())
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).retryAfter).toBeNull()
  })

  it('a 5xx, which says nothing of its cause, throws ApiError without a code', async () => {
    const body = { statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong on our side.' }
    const err = await failure(new WorldPulse({ fetch: answer(500, body) }).stories.top())
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).code).toBeNull()
    expect((err as ApiError).message).toBe('WorldPulse API 500: Something went wrong on our side.')
  })

  it('an error answer that isn\'t JSON (a proxy\'s page) is kept as text', async () => {
    const page = '<html><body><h1>502 Bad Gateway</h1></body></html>'
    const err = await failure(new WorldPulse({ fetch: answer(502, page) }).stories.week())
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
    expect((err as ApiError).code).toBeNull()
    expect((err as ApiError).body).toBe(page)
    expect((err as ApiError).message).toBe('WorldPulse API 502')
  })

  it('nothing is retried: one request per call', async () => {
    const busy = answer(503, { success: false, code: 'SERVICE_UNAVAILABLE', error: 'The category list could not be read; try again shortly' })
    await failure(new WorldPulse({ fetch: busy }).categories.list())
    expect(busy).toHaveBeenCalledTimes(1)

    const limited = answer(429, {}, { 'retry-after': '1' })
    await failure(new WorldPulse({ fetch: limited }).categories.list())
    expect(limited).toHaveBeenCalledTimes(1)
  })

  it('a 2xx answer that isn\'t JSON throws WorldPulseError', async () => {
    const err = await failure(new WorldPulse({ fetch: answer(200, '<html>Captive portal</html>') }).categories.list())
    expect(err).toBeInstanceOf(WorldPulseError)
    expect(err).not.toBeInstanceOf(ApiError)
    expect((err as Error).message).toMatch(/isn't JSON/)
  })

  it('fetch failing throws NetworkError, carrying the cause', async () => {
    const cause = new TypeError('fetch failed')
    const err = await failure(new WorldPulse({ fetch: vi.fn().mockRejectedValue(cause) }).signals.list())
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).toBeInstanceOf(WorldPulseError)
    expect((err as NetworkError).name).toBe('NetworkError')
    expect((err as NetworkError).cause).toBe(cause)
    expect((err as NetworkError).url).toBe('https://api.world-pulse.io/api/v1/public/signals')
  })

  it('no answer within `timeout` ms throws TimeoutError (the request is aborted)', async () => {
    let signal: AbortSignal | undefined
    const silent = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    }))
    const err = await failure(new WorldPulse({ fetch: silent, timeout: 20 }).stories.top())
    expect(err).toBeInstanceOf(TimeoutError)
    expect((err as TimeoutError).name).toBe('TimeoutError')
    expect((err as TimeoutError).timeout).toBe(20)
    expect(signal?.aborted).toBe(true)
  })

  it('timeout: 0 waits as long as the answer takes', async () => {
    const slow = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(init?.signal?.aborted).toBe(false)
      return new Response(JSON.stringify(SIGNALS))
    })
    await expect(new WorldPulse({ fetch: slow, timeout: 0 }).signals.list()).resolves.toEqual(SIGNALS)
  })
})
