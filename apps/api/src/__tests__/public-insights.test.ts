/**
 * The open counts of Nov 10, 2026, night (routes/public-insights.ts), which round 2 of the AI tools asks: each route's
 * answer, its bounds and its 503, with the database and Redis stood in for (the queries ran on a test Postgres).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ sql: string; bindings: unknown[] }> = []
let fail = false

vi.mock('../db/redis', () => ({
  redis: {
    scan: async () => ['0', ['osint:travel-us:ir', 'osint:travel-us:fr', 'osint:travel-us:ve', 'osint:travel-us:xx1']],
    mget: async (...keys: string[]) => keys.map(k => ({ 'osint:travel-us:ir': '4|2026-11-03', 'osint:travel-us:fr': '2|2026-06-01', 'osint:travel-us:ve': '4|2026-10-01' } as Record<string, string>)[k] ?? '9|x'),
  },
}))
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: (s: string) => s }) }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: async (_key: string, _opts: unknown, make: () => Promise<unknown>) => make() }))
vi.mock('../lib/long-query', () => ({
  longQuery: async (_seconds: number, run: (trx: unknown) => Promise<unknown>) => {
    if (fail) throw new Error('canceling statement due to statement timeout')
    return run({
      raw: async (sql: string, bindings: unknown[]) => {
        calls.push({ sql, bindings })
        if (sql.includes('title ~* ?')) {
          return { rows: [
            { id: 'a', title: 'Le détroit d\'Ormuz sous tension', status: 'pending', created_at: '2026-11-10T21:00:00Z' },
            { id: 'b', title: 'Tanker hit near the Strait of Hormuz', status: 'verified', created_at: '2026-11-10T00:00:00Z' },
            { id: 'c', title: 'Suez Canal traffic recovers', status: 'verified', created_at: '2026-11-07T00:00:00Z' },
          ] }
        }
        if (sql.includes("ARRAY['kev']")) {
          return { rows: [{ id: 'k', title: 'CVE-2026-111560: Barracuda Networks OS Command Injection', summary: 'Used.', severity: 'critical', created_at: '2026-11-09T00:00:00Z', tags: ['osint', 'cybersecurity', 'cisa', 'kev', 'vulnerability', 'cve-2026-111560', 'ransomware', 'barracuda-networks'] }] }
        }
        if (sql.includes('travel-advisory')) {
          return { rows: [{ id: 't', title: 'Iran - Level 4: Do Not Travel', created_at: '2026-11-05T00:00:00Z', url: 'https://travel.state.gov/iran', tags: ['osint', 'travel-advisory'] }, { id: 'u', title: 'FCDO advice against all travel', created_at: '2026-11-02T00:00:00Z', url: 'https://www.gov.uk/x', tags: ['travel-advice', 'uk-fcdo'] }] }
        }
        if (sql.includes('DISTINCT ON (s.story_id)')) return { rows: [{ site: 'reuters.com', firsts: '9', stories: '40' }, { site: 'unknown.example', firsts: 2, stories: '40' }] }
        if (sql.includes('AS minutes')) {
          return { rows: [5, 30, 45, 90, 600].map((m, i) => ({ story_id: `s${i}`, report_id: `r${i}`, title: `Story ${i}`, first_at: '2026-11-10T00:00:00Z', verified_at: '2026-11-10T01:00:00Z', minutes: String(m) })) }
        }
        if (sql.includes('count(*) OVER () AS total')) return { rows: [{ id: 'o', title: 'Sudan talks', status: 'verified', severity: 'medium', topic: 'conflict', country_code: 'SD', created_at: '2026-11-10T20:00:00Z', story_id: 's', total: '31' }] }
        if (sql.includes('category::text AS topic')) return { rows: [{ topic: 'conflict', reports: '120', verified: '40', before: '100' }] }
        return { rows: [] }
      },
    })
  },
}))

import Fastify from 'fastify'
import { registerPublicInsightRoutes, siteFrom, CHOKEPOINT_NAMES } from '../routes/public-insights'
import { CHOKEPOINTS } from '../lib/chokepoints'

async function app() {
  const a = Fastify()
  await a.register(registerPublicInsightRoutes, { prefix: '/api/v1/public' })
  return a
}
const get = async (url: string) => (await app()).inject({ method: 'GET', url })

beforeEach(() => { calls.length = 0; fail = false })

describe('GET /api/v1/public/chokepoints', () => {
  it('counts the reports naming each chokepoint, in other languages too, the most first, machine feeds left out', async () => {
    const res = await get('/api/v1/public/chokepoints?days=3')
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    const { data } = res.json()
    expect(data.days).toBe(3)
    expect(data.chokepoints[0]).toEqual({ id: 'hormuz', name: 'Strait of Hormuz', reports: 2, verified: 1, latest: { id: 'b', title: 'Tanker hit near the Strait of Hormuz', at: '2026-11-10T00:00:00.000Z', verified: true } })
    expect(data.chokepoints[1]).toMatchObject({ id: 'suez', reports: 1 })
    expect(data.chokepoints.at(-1).reports).toBe(0)
    expect(calls[0]!.sql).toContain("NOT (tags @> ARRAY['osint']::text[])")
    expect(calls[0]!.bindings[0]).toBe(3)
  })

  it('names every chokepoint lib/chokepoints.ts places, and only those', () => {
    expect(CHOKEPOINT_NAMES.map(c => c.id).sort()).toEqual(CHOKEPOINTS.map(c => c.id).sort())
    const hormuz = new RegExp(CHOKEPOINT_NAMES.find(c => c.id === 'hormuz')!.words, 'iu')
    for (const t of ['Strait of Hormuz', "Le détroit d'Ormuz", 'Straße von Hormus', 'مضيق هرمز', 'Ормузский пролив']) expect(hormuz.test(t), t).toBe(true)
    const dover = new RegExp(CHOKEPOINT_NAMES.find(c => c.id === 'dover')!.words, 'iu')
    expect(dover.test('Floods in the Pas-de-Calais')).toBe(false)
  })
})

describe('GET /api/v1/public/vulnerabilities', () => {
  it("reads CISA's catalogue entries with their CVE, maker and ransomware use", async () => {
    const res = await get('/api/v1/public/vulnerabilities?days=200')
    const { data } = res.json()
    expect(data.days).toBe(30)
    expect(data.vulnerabilities[0]).toMatchObject({ cve: 'CVE-2026-111560', vendor: 'barracuda-networks', ransomware: true })
  })
})

describe('GET /api/v1/public/travel-advice', () => {
  it("gives every country's US level, leaving what isn't a level out", async () => {
    const { data } = (await get('/api/v1/public/travel-advice')).json()
    expect(data.levels).toEqual([{ country: 'IR', level: 4, since: '2026-11-03' }, { country: 'FR', level: 2, since: '2026-06-01' }, { country: 'VE', level: 4, since: '2026-10-01' }])
  })

  it("gives one country's US level and its US and UK notices", async () => {
    const { data } = (await get('/api/v1/public/travel-advice?country=ir')).json()
    expect(data.us).toEqual({ country: 'IR', level: 4, since: '2026-11-03' })
    expect(data.notices.map((n: { from: string }) => n.from)).toEqual(['us', 'uk'])
    expect(calls[0]!.bindings).toEqual(['IR'])
  })
})

describe('GET /api/v1/public/first-reporters', () => {
  it('counts the stories each website was first on, with what the directory knows of it', async () => {
    const { data } = (await get('/api/v1/public/first-reporters?days=3&min_outlets=10')).json()
    expect(data).toMatchObject({ days: 3, minOutlets: 10, stories: 40 })
    expect(data.outlets[0]).toMatchObject({ site: 'reuters.com', name: 'Reuters', firsts: 9 })
    expect(data.outlets[1]).toEqual({ site: 'unknown.example', name: null, country: null, kind: null, firsts: 2 })
    expect(calls[0]!.bindings).toEqual([3, 10])
  })
})

describe('GET /api/v1/public/verification-speed', () => {
  it('gives the median time, the share within an hour and a day, and the fastest and slowest', async () => {
    const { data } = (await get('/api/v1/public/verification-speed?hours=12')).json()
    expect(data).toMatchObject({ hours: 12, verified: 5, medianMinutes: 45, withinHour: 3, withinDay: 5 })
    expect(data.fastest[0].minutes).toBe(5)
    expect(data.slowest[0].minutes).toBe(600)
    // reports two days older than the window, as a story's first report can be
    expect(calls[0]!.bindings).toEqual([60, 12])
  })
})

describe('GET /api/v1/public/topics and /outlet-reports', () => {
  it('counts the news reports by topic against the hours before', async () => {
    const { data } = (await get('/api/v1/public/topics')).json()
    expect(data.topics).toEqual([{ topic: 'conflict', reports: 120, verified: 40, before: 100 }])
    expect(calls[0]!.bindings).toEqual([24, 24, 24, 48])
  })

  it("lists one website's newest reports, its subdomains too, and refuses what isn't a website", async () => {
    const res = await get('/api/v1/public/outlet-reports?site=https://www.CNN.com/world&days=3')
    const { data } = res.json()
    expect(data).toMatchObject({ site: 'cnn.com', days: 3, total: 31 })
    expect(data.reports[0]).toMatchObject({ id: 'o', country: 'SD', storyId: 's' })
    expect(calls[0]!.bindings).toEqual([3, 'cnn.com', '%.cnn.com'])
    expect((await get('/api/v1/public/outlet-reports?site=not a site')).statusCode).toBe(400)
    expect(siteFrom('lemonde.fr')).toBe('lemonde.fr')
    expect(siteFrom('localhost')).toBeNull()
  })

  it('answers 503 when a count fails', async () => {
    fail = true
    for (const u of ['/api/v1/public/chokepoints', '/api/v1/public/topics', '/api/v1/public/first-reporters', '/api/v1/public/verification-speed']) {
      const res = await get(u)
      expect(res.statusCode, u).toBe(503)
      expect(res.json().code).toBe('SERVICE_UNAVAILABLE')
    }
  })
})
