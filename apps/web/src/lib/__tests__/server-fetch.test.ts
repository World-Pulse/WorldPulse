/**
 * The website server's short-lived cache of API answers (lib/server-fetch.ts,
 * plan D3, Oct 13, 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch, clearServerFetchCache } from '../server-fetch'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('cachedFetch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearServerFetchCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('answers repeat requests from the cache within the time given', async () => {
    fetchMock.mockImplementation(async () => json(200, { n: 1 }))
    const a = await cachedFetch('https://api.test/a', 30_000)
    const b = await cachedFetch('https://api.test/a', 30_000)
    expect(await a.json()).toEqual({ n: 1 })
    expect(await b.json()).toEqual({ n: 1 })
    expect(b.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks again once the time has passed', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => json(200, { n: 1 }))
    await cachedFetch('https://api.test/a', 1_000)
    vi.advanceTimersByTime(1_500)
    await cachedFetch('https://api.test/a', 1_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one call among simultaneous requests', async () => {
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>(r => { release = r }))
    const all = Promise.all([1, 2, 3, 4, 5].map(() => cachedFetch('https://api.test/burst', 10_000)))
    await Promise.resolve()
    release(json(200, { ok: true }))
    const answers = await all
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await Promise.all(answers.map(r => r.json()))).toEqual(Array(5).fill({ ok: true }))
  })

  it('keeps a 404 but not a refusal or a server error', async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { error: 'not found' }))
      .mockResolvedValueOnce(json(429, { error: 'slow down' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
      .mockResolvedValueOnce(json(503, { error: 'down' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    expect((await cachedFetch('https://api.test/missing', 10_000)).status).toBe(404)
    expect((await cachedFetch('https://api.test/missing', 10_000)).status).toBe(404)
    expect((await cachedFetch('https://api.test/busy', 10_000)).status).toBe(429)
    expect((await cachedFetch('https://api.test/busy', 10_000)).status).toBe(200)
    expect((await cachedFetch('https://api.test/down', 10_000)).status).toBe(503)
    expect((await cachedFetch('https://api.test/down', 10_000)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('passes a network failure on, and tries again next time', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(json(200, { ok: true }))
    await expect(cachedFetch('https://api.test/flaky', 10_000)).rejects.toThrow('ECONNREFUSED')
    expect((await cachedFetch('https://api.test/flaky', 10_000)).status).toBe(200)
  })

  it('keeps different addresses apart', async () => {
    fetchMock.mockImplementation(async (url: string) => json(200, { url }))
    expect(await (await cachedFetch('https://api.test/x', 10_000)).json()).toEqual({ url: 'https://api.test/x' })
    expect(await (await cachedFetch('https://api.test/y', 10_000)).json()).toEqual({ url: 'https://api.test/y' })
  })
})

describe('cachedFetch size limits', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    clearServerFetchCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('does not keep an answer too big to keep', async () => {
    fetchMock.mockImplementation(async () => new Response('x'.repeat(2_100_000), { status: 200 }))
    await cachedFetch('https://api.test/huge', 10_000)
    await cachedFetch('https://api.test/huge', 10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
