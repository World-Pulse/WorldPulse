/**
 * Served at once, made fresh in the background (lib/swr-cache.ts, Oct 13, 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = new Map<string, string>()
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' }),
  set: vi.fn(async (k: string, v: string, ..._args: unknown[]) => {
    if (store.has(k)) return null
    store.set(k, v)
    return 'OK'
  }),
  del: vi.fn(async (k: string) => { store.delete(k); return 1 }),
}
vi.mock('../../db/redis', () => ({ get redis() { return redisMock } }))

import { staleWhileRevalidate } from '../swr-cache'

const opts = { freshSeconds: 900, staleSeconds: 7200 }
const flush = () => new Promise(r => setTimeout(r, 0))

describe('staleWhileRevalidate', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T04:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('makes the value while the caller waits when nothing is kept, then keeps it', async () => {
    const make = vi.fn(async () => 'v1')
    expect(await staleWhileRevalidate('k', opts, make)).toBe('v1')
    expect(await staleWhileRevalidate('k', opts, make)).toBe('v1')
    expect(make).toHaveBeenCalledTimes(1)
    expect(redisMock.setex).toHaveBeenCalledWith('k', 8100, expect.any(String))
  })

  it('serves an old value at once and makes the next one in the background, once', async () => {
    await staleWhileRevalidate('k', opts, async () => 'old')
    vi.setSystemTime(new Date('2026-10-13T04:20:00Z')) // 20 minutes: no longer fresh
    let finish: (v: string) => void = () => {}
    const make = vi.fn(() => new Promise<string>(r => { finish = r }))
    expect(await staleWhileRevalidate('k', opts, make)).toBe('old')
    expect(await staleWhileRevalidate('k', opts, make)).toBe('old') // still making: not asked again
    expect(make).toHaveBeenCalledTimes(1)
    finish('new')
    await flush(); await flush(); await flush()
    expect(await staleWhileRevalidate('k', opts, make)).toBe('new')
    expect(store.has('k:refreshing')).toBe(false)
  })

  it('keeps serving the old value when making the next one fails', async () => {
    await staleWhileRevalidate('k', opts, async () => 'old')
    vi.setSystemTime(new Date('2026-10-13T04:20:00Z'))
    expect(await staleWhileRevalidate('k', opts, async () => { throw new Error('Claude cap') })).toBe('old')
    await flush(); await flush(); await flush()
    expect(await staleWhileRevalidate('k', opts, async () => 'new')).toBe('old') // the retry starts now
    await flush(); await flush(); await flush()
    expect(await staleWhileRevalidate('k', opts, async () => 'newer')).toBe('new')
  })

  it('makes a new value while the caller waits once the old one is too old', async () => {
    await staleWhileRevalidate('k', opts, async () => 'old')
    vi.setSystemTime(new Date('2026-10-13T07:00:00Z')) // 3 hours: past fresh + stale
    expect(await staleWhileRevalidate('k', opts, async () => 'new')).toBe('new')
  })

  it('works without Redis', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('down'))
    redisMock.setex.mockRejectedValueOnce(new Error('down'))
    expect(await staleWhileRevalidate('k', opts, async () => 'v')).toBe('v')
  })
})
