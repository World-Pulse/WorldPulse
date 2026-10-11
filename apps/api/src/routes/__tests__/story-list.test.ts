/**
 * The home page's "Developing Stories" (plan 12e, Oct 11, 2026): it read event
 * threads, which ranked a death-row case, an F1 sprint and an op-ed marked
 * "critical" at the top with 0 sources each. It now lists the stories most
 * outlets are reporting, from the scraper's story links.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  sql: '',
  bindings: [] as unknown[],
  rows: [] as Array<Record<string, unknown>>,
  setex: vi.fn(async () => 'OK'),
  get: vi.fn(async () => null as string | null),
}))

vi.mock('../../db/redis', () => ({ redis: { get: h.get, setex: h.setex } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    schema: { hasColumn: vi.fn(async () => true) },
    raw: vi.fn(async (sql: string, bindings: unknown[]) => {
      h.sql = sql
      h.bindings = bindings
      return { rows: h.rows }
    }),
  }),
}))

import { registerStoryRoutes } from '../stories'
import {
  rankStories, sameEvent, storyScore, looksLikeEventTemplate, tidyHeadline, textArray, headlineWords,
  type StoryCandidate,
} from '../../lib/story-list'

const NOW = Date.parse('2026-10-11T07:00:00Z')
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000)

const candidate = (over: Partial<StoryCandidate> & { outlets?: string[] }): StoryCandidate => {
  const { outlets = ['aljazeera.com', 'bbc.co.uk'], ...rest } = over
  return {
    key: 'k1', leadId: 'l1', title: 'A headline long enough to read', category: 'conflict', place: null,
    severity: 'medium', size: 2, urls: outlets.map((o, i) => `https://${o}/story-${i}`),
    firstSeenAt: hoursAgo(5), updatedAt: hoursAgo(0.5), verifiedAt: null,
    ...rest,
  }
}

describe('storyScore', () => {
  it('counts outlets, weighs severity and halves every 6 hours', () => {
    const fresh = storyScore(10, 'medium', hoursAgo(0), NOW)
    expect(storyScore(10, 'medium', hoursAgo(6), NOW)).toBeCloseTo(fresh / 2)
    expect(storyScore(10, 'high', hoursAgo(0), NOW)).toBeGreaterThan(fresh)
    expect(storyScore(20, 'medium', hoursAgo(0), NOW)).toBeGreaterThan(fresh)
  })

  it('lets a serious story fewer outlets have reached beat a widely copied one', () => {
    expect(storyScore(2, 'critical', hoursAgo(0), NOW)).toBeGreaterThan(storyScore(12, 'low', hoursAgo(0), NOW))
  })
})

describe('sameEvent', () => {
  it('finds one event filed as several stories', () => {
    const lead = { title: 'Twelve killed and 300 injured in attack on airport in Saudi capital Riyadh', place: 'Riyadh' }
    expect(sameEvent(lead, { title: 'Houthis Kill 12, Injure 300+ at Riyadh Airport as Trump Weighs Strikes', place: 'Riyadh' })).toBe(true)
    expect(sameEvent(lead, { title: 'At least 12 dead in Riyadh airport attack: Saudi officials', place: 'Riyadh, Saudi Arabia' })).toBe(true)
  })

  it('keeps strikes on two different cities apart', () => {
    expect(sameEvent(
      { title: 'Russian strikes kill 5 in Kharkiv', place: 'Kharkiv, Ukraine' },
      { title: 'Russian strikes kill 12 in Odesa', place: 'Odesa, Ukraine' },
    )).toBe(false)
  })

  it('accepts a headline that names the other story\'s place', () => {
    expect(sameEvent(
      { title: "Pennsylvania mass shooting 'worst seen in 30 years' with children among dead", place: 'Erie' },
      { title: '8 killed, including 2 children, in mass shooting in northern Pennsylvania, officials say', place: 'Pennsylvania' },
    )).toBe(true)
  })

  it('keeps stories that share only a name or two apart', () => {
    expect(sameEvent(
      { title: 'Russian attacks kill 20 in Ukraine after Trump strikes diesel deal with Putin', place: 'Ukraine' },
      { title: 'Trump says Ukraine should get new President as he blames Zelenskyy', place: 'Ukraine' },
    )).toBe(false)
  })

  it('matches word forms ("killed", "kills", "killing")', () => {
    expect([...headlineWords('Killed kills killing')]).toEqual(['kill'])
  })
})

describe('headline helpers', () => {
  it("spots GDELT's event-label titles", () => {
    expect(looksLikeEventTemplate('Disapproval in Riyadh, Ar Riya?, Saudi Arabia')).toBe(true)
    expect(looksLikeEventTemplate('Armed conflict')).toBe(true)
    expect(looksLikeEventTemplate('Protesters in Paris reject pension reform')).toBe(false)
  })

  it('drops a trailing " | Site name"', () => {
    expect(tidyHeadline('Wildlife Park remains closed after man mauled to death in tiger enclosure | LBC'))
      .toBe('Wildlife Park remains closed after man mauled to death in tiger enclosure')
    expect(tidyHeadline('Short | Thing')).toBe('Short | Thing')
  })

  it('reads Postgres arrays in either form', () => {
    expect(textArray(['https://a.com/1', '', 7])).toEqual(['https://a.com/1'])
    expect(textArray('{https://a.com/1,"https://b.com/x,y"}')).toEqual(['https://a.com/1', 'https://b.com/x,y'])
    expect(textArray('{}')).toEqual([])
    expect(textArray(null)).toEqual([])
  })
})

describe('rankStories', () => {
  it('needs two outlets and a real headline', () => {
    const stories = rankStories([
      candidate({ key: 'one-outlet', outlets: ['abc.net.au', 'abc.net.au'] }),
      candidate({ key: 'template', title: 'Disapproval in Riyadh, Saudi Arabia' }),
      candidate({ key: 'ok' }),
    ], 6, NOW)
    expect(stories.map(s => s.id)).toEqual(['ok'])
    expect(stories[0]!.outletCount).toBe(2)
  })

  it('puts widely reported, serious, recent stories first, each event once', () => {
    const stories = rankStories([
      candidate({ key: 'tiger', title: 'Man dies after entering tiger enclosure at UK zoo', outlets: ['a.com', 'b.com', 'c.com'] }),
      candidate({ key: 'riyadh', title: 'Twelve killed and 300 injured in attack on airport in Saudi capital Riyadh', place: 'Riyadh',
        severity: 'high', outlets: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'] }),
      candidate({ key: 'riyadh-2', title: 'At least 12 dead in Riyadh airport attack: Saudi officials', place: 'Riyadh, Saudi Arabia',
        outlets: ['f.com', 'g.com', 'h.com', 'i.com'] }),
      candidate({ key: 'old', title: 'Yesterday\'s widely reported story about something else', updatedAt: hoursAgo(11),
        outlets: ['a.com', 'b.com', 'c.com', 'd.com'] }),
    ], 6, NOW)
    expect(stories.map(s => s.id)).toEqual(['riyadh', 'tiger', 'old'])
  })

  it('stops at the limit and sends at most 12 outlet names', () => {
    const many = Array.from({ length: 20 }, (_, i) => `outlet${i}.com`)
    const stories = rankStories([
      candidate({ key: 'a', title: 'Floods sweep through northern provinces', outlets: many }),
      candidate({ key: 'b', title: 'Central bank holds interest rates steady' }),
    ], 1, NOW)
    expect(stories).toHaveLength(1)
    expect(stories[0]!.outlets).toHaveLength(12)
    expect(stories[0]!.outletCount).toBe(20)
  })
})

describe('GET /api/v1/stories', () => {
  beforeEach(() => {
    h.get.mockResolvedValue(null)
    h.setex.mockClear()
    h.rows = [
      {
        story_key: 's-riyadh', size: 33, first_seen: '2026-10-10T20:00:00Z', newest: new Date(Date.now() - 600_000).toISOString(),
        verified_at: '2026-10-10T21:00:00Z', sev_rank: 4, place: 'Riyadh', category: 'conflict', lead_id: 'sig-1',
        title: 'Twelve killed and 300 injured in attack on airport in Saudi capital Riyadh',
        urls: ['https://www.aljazeera.com/a', 'https://www.bbc.co.uk/b', 'https://apnews.com/c'],
      },
      {
        story_key: 's-template', size: 4, first_seen: '2026-10-10T20:00:00Z', newest: new Date().toISOString(),
        verified_at: null, sev_rank: 3, place: 'Riyadh', category: 'geopolitics', lead_id: 'sig-2',
        title: 'Disapproval in Riyadh, Saudi Arabia', urls: '{https://a.com/1,https://b.com/2}',
      },
    ]
  })

  it('lists stories with outlets, verification and the signal to open', async () => {
    const app = Fastify({ logger: false })
    await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/stories?hours=12&limit=5' })
    expect(res.statusCode).toBe(200)
    const { stories, hours } = res.json().data
    expect(hours).toBe(12)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({
      id: 's-riyadh', leadId: 'sig-1', severity: 'high', size: 33, place: 'Riyadh',
      outlets: ['aljazeera.com', 'bbc.co.uk', 'apnews.com'], outletCount: 3, verifiedAt: '2026-10-10T21:00:00.000Z',
    })
    // the window and the headline test go to Postgres as bindings
    expect(h.bindings[0]).toBeInstanceOf(Date)
    expect(Date.now() - (h.bindings[0] as Date).getTime()).toBeCloseTo(12 * 3_600_000, -4)
    expect(String(h.bindings[1])).toMatch(/^\^\(Public statement\|/)
    expect(h.sql).toMatch(/s\.story_id = a\.story_key/)                  // members of linked stories
    expect(h.sql).toMatch(/s\.story_id IS NULL/)                         // and single signals with several outlets
    expect(h.sql).toMatch(/cardinality\(original_urls\) >= 2/)
    expect(h.sql).toMatch(/LIMIT 600/)
    expect(h.setex).toHaveBeenCalledWith('stories:list:12:5', 120, expect.any(String))
  })

  it('answers from the cache when it can', async () => {
    h.get.mockResolvedValueOnce(JSON.stringify({ success: true, data: { stories: [], hours: 12 } }))
    const app = Fastify({ logger: false })
    await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/stories' })
    expect(res.headers['x-cache-hit']).toBe('true')
  })

  it('refuses a window over 72 hours', async () => {
    const app = Fastify({ logger: false })
    await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/stories?hours=100' })
    expect(res.statusCode).toBe(400)
  })
})

/** world-pulse.io/sitemap.xml lists one page per verified story (plan G2, Oct 11, 2026) */
describe('GET /api/v1/stories/sitemap', () => {
  beforeEach(() => {
    h.get.mockResolvedValue(null)
    h.setex.mockClear()
  })

  it('lists one page per verified story of the last 7 days, newest first', async () => {
    h.rows = [
      { id: '0b2c3d4e-0000-4000-8000-000000000001', updated: '2026-10-11T18:00:00Z' },
      { id: 'not-a-uuid', updated: '2026-10-11T17:00:00Z' },
      { id: '0b2c3d4e-0000-4000-8000-000000000002', updated: 'garbage' },
    ]
    const app = Fastify({ logger: false })
    await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/stories/sitemap' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      days: 7,
      stories: [{ id: '0b2c3d4e-0000-4000-8000-000000000001', updatedAt: '2026-10-11T18:00:00.000Z' }],
    })
    expect(h.sql).toMatch(/s\.status = 'verified'/)
    expect(h.sql).toMatch(/DISTINCT ON \(COALESCE\(s\.story_id, s\.id\)\)/)      // one page per story
    expect(Date.now() - (h.bindings[0] as Date).getTime()).toBeCloseTo(7 * 86_400_000, -4)
    expect(String(h.bindings[1])).toMatch(/^\^\(Public statement\|/)             // real headlines first
    expect(h.bindings[2]).toBe(5_000)
    expect(h.setex).toHaveBeenCalledWith('stories:sitemap:v1', 1_800, expect.any(String))
  })
})
