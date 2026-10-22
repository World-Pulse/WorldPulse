/**
 * GET /api/v1/public/signals says how many independent outlets reported each
 * signal, which websites, and its page (plan 15, Oct 21, 2026: "an
 * independent-outlet count per signal ... in the public API"). Until now it
 * answered only a reliability score, though every signal it lists is
 * verified by two or more outlets. Through the route's own response schema,
 * which drops any field it doesn't list.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/redis', () => ({ redis: { get: async () => null, setex: async () => 'OK' } }))
vi.mock('../lib/categories', () => ({ signalCategories: async () => ['conflict'] }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: async () => ({ total: 2, exact: true }) }))
vi.mock('../db/postgres', () => {
  const rows = [
    { id: 's1', title: 'Drone strike on a market', category: 'conflict', severity: 'high', reliability_score: '0.91', location_name: 'El Fasher',
      published_at: '2026-10-21T10:00:00Z', source_url: null, source_count: 4,
      original_urls: ['https://www.bbc.co.uk/news/a', 'https://apnews.com/article/b', 'https://www.bbc.co.uk/news/a2', 'not a link', 'https://dabangasudan.org/en/c'] },
    { id: 's2', title: 'Talks resume', category: 'conflict', severity: 'medium', reliability_score: '0.8', location_name: null,
      published_at: '2026-10-21T09:00:00Z', source_url: null, source_count: null, original_urls: null },
  ]
  const q: Record<string, unknown> = {}
  for (const m of ['where', 'orderBy', 'limit', 'offset', 'select', 'whereRaw']) q[m] = () => q
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok)
  return { db: Object.assign(() => q, { raw: (s: string) => s }) }
})

import Fastify from 'fastify'
import { registerPublicRoutes, sitesOf } from '../routes/public'

describe('GET /api/v1/public/signals: outlets', () => {
  it('each signal with its outlets, websites and page, through the response schema', async () => {
    const app = Fastify()
    await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals?limit=2' })
    expect(res.statusCode).toBe(200)
    const [one, two] = res.json().data
    expect(one).toMatchObject({
      outlets: 4,
      sites: ['bbc.co.uk', 'apnews.com', 'dabangasudan.org'],
      url: 'https://world-pulse.io/signals/s1',
    })
    // what each website is (the outlet directory, Oct 22, 2026), through the schema too
    expect(one.site_info).toEqual([
      { site: 'bbc.co.uk', name: 'BBC', kind: 'international', country: 'GB', state_media: false },
      { site: 'apnews.com', name: 'AP', kind: 'agency', country: 'US', state_media: false },
      { site: 'dabangasudan.org', name: 'Radio Dabanga', kind: 'national', country: 'SD', state_media: false },
    ])
    // a signal without a count says 1, without links an empty list
    expect(two).toMatchObject({ outlets: 1, sites: [], site_info: [], url: 'https://world-pulse.io/signals/s2' })
  })

  it('websites each once, at most 10', () => {
    expect(sitesOf(Array.from({ length: 15 }, (_, i) => `https://site${i}.example/x`))).toHaveLength(10)
    expect(sitesOf('https://example.com')).toEqual([])
  })
})
