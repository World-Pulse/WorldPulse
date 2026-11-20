/**
 * GET /api/v1/public/second-outlets (plan 0s3, Oct 22, 2026): what the
 * scraper's search of GDELT's news index found for reports only one outlet
 * carried, today's and yesterday's counts and the latest matches, so the
 * matches can be read by anyone.
 */
import { describe, it, expect, vi } from 'vitest'

const today = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const hourAgo = (n: number) => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - n * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, '')

// a read that fails (Nov 20, 2026): the last cycle's key, the hourly counters' round trip
const failing = { lastCycle: false, hours: false }
const hourFiles = (key: string, field: string) => (field === '_files' && key === `gkg:pulse:2:${hourAgo(1)}` ? '4' : field === '_files' && key === `gkg:pulse:2:${hourAgo(30)}` ? '1' : null)
vi.mock('../db/redis', () => ({
  redis: {
    get: async (key: string) => {
      if (key === 'second-outlet:last-cycle' && failing.lastCycle) throw new Error('Command timed out')
      return key === 'repair:archive-outlets:2026-10-22:done' ? '2026-10-22T23:10:00Z' : null
    },
    hget: async (key: string, field: string) => hourFiles(key, field),
    pipeline: (commands: string[][]) => ({
      exec: async () => {
        if (failing.hours) throw new Error('Command timed out')
        return commands.map(([, key, field]) => [null, hourFiles(key!, field!)])
      },
    }),
    setex: async () => 'OK',
    hgetall: async (key: string) => (key.endsWith(today) ? { searched: '40', matched: '9', outlets: '13', promoted: '8' }
      : key === 'repair:archive-outlets:stats' ? { days: '46', verified: '1200', last_day: '2026-05-20' }
      : key === 'gkg:pulse:2:backfill' ? { files: '120', skipped: '2', missing: '0', failed: '1', last: '20261018041500', updated_at: '2026-10-22T21:52:00.000Z' } : {}),
    lrange: async () => [
      JSON.stringify({ id: 's1', title: 'Six dead as bus hits tree in Chhattisgarh', found: [{ site: 'ndtv.com', title: 'Six killed after bus hits tree in Chhattisgarh', url: 'https://www.ndtv.com/a' }] }),
      'not json',
    ],
  },
}))
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: (s: string) => s }) }))
vi.mock('../lib/categories', () => ({ signalCategories: async () => ['conflict'] }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: async () => ({ total: 0, exact: true }) }))

import Fastify from 'fastify'
import { registerPublicRoutes } from '../routes/public'

describe('GET /api/v1/public/second-outlets', () => {
  it("answers the days' counts as numbers and the latest matches", async () => {
    const app = Fastify()
    await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/second-outlets' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    const { data } = res.json()
    expect(data.days[today]).toEqual({ searched: 40, matched: 9, outlets: 13, promoted: 8 })
    expect(data.days[yesterday]).toEqual({})
    expect(data.latest).toHaveLength(1)
    expect(data.latest[0].found[0].site).toBe('ndtv.com')
    // the April–May repair's progress (Oct 22)
    expect(data.archive).toEqual({ days: 46, verified: 1200, last_day: '2026-05-20', done_at: '2026-10-22T23:10:00Z' })
    // the world's coverage counts: the week count's progress and the files counted each hour (Oct 22)
    expect(data.pulse.week).toEqual({ files: 120, skipped: 2, missing: 0, failed: 1, last: '20261018041500', updated_at: '2026-10-22T21:52:00.000Z', done_at: null })
    expect(Object.keys(data.pulse.last_24h)).toHaveLength(24)
    expect(Object.keys(data.pulse.last_24h)).toEqual(Array.from({ length: 24 }, (_, i) => hourAgo(23 - i)))
    expect(data.pulse.last_24h[hourAgo(1)]).toBe(4)
    expect(data.pulse.last_24h[hourAgo(2)]).toBe(0)
    expect(data.pulse.hours_counted_7d).toBe(2)
    expect(data.unread).toEqual([])
  })

  // Nov 20, 2026: under the night's load the counters' reads ran past Redis's 2-second limit and every failure read
  // as "no files": the status page raised GDELT's alarm while GDELT's files were all read
  it("names what it couldn't read, its counts null rather than 0", async () => {
    failing.hours = true
    failing.lastCycle = true
    try {
      const app = Fastify()
      await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
      const res = await app.inject({ method: 'GET', url: '/api/v1/public/second-outlets' })
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data.unread).toEqual(['last_cycle', 'hours'])
      expect(data.pulse.last_24h).toBeNull()
      expect(data.pulse.hours_counted_7d).toBeNull()
      expect(data.last_cycle).toBeNull()
      // the rest still answers
      expect(data.days[today]).toEqual({ searched: 40, matched: 9, outlets: 13, promoted: 8 })
    } finally {
      failing.hours = false
      failing.lastCycle = false
    }
  })
})
