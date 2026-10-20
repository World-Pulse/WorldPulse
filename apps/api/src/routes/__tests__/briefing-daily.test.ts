/**
 * GET /api/v1/briefing/daily (the Daily Briefing page's stories; plan 9,
 * Oct 20, 2026): the day's stories, each event once, with outlet counts,
 * instead of the 20 most severe single reports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { ListedStory } from '../../lib/story-list'

const h = vi.hoisted(() => ({
  top: vi.fn(),
  between: vi.fn(),
  leadIds: [] as string[],
}))

vi.mock('../stories', () => ({ topStories: h.top, storiesBetween: h.between }))
vi.mock('../../lib/briefing-generator', () => ({ generateDailyBriefing: vi.fn() }))
vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../../db/postgres', () => ({
  db: vi.fn(() => ({
    whereIn: (_c: string, ids: string[]) => {
      h.leadIds = ids
      return { select: async () => ids.map(id => ({ id, summary: `Summary of ${id}`, reliability_score: '0.8', country_code: 'SD' })) }
    },
  })),
}))

import { registerBriefingDailyRoutes } from '../briefing'

const story = (n: number, over: Partial<ListedStory> = {}): ListedStory => ({
  id: `story-${n}`, leadId: `lead-${n}`, title: `Story ${n}`, category: 'conflict', place: 'Sudan', severity: 'high', size: 5,
  outlets: ['aljazeera.com', 'bbc.co.uk', 'reuters.com'], outletCount: 3, firstSeenAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z', verifiedAt: '2026-10-20T09:00:00.000Z', ...over,
})

async function app() {
  const a = Fastify({ logger: false })
  await a.register(registerBriefingDailyRoutes, { prefix: '/api/v1/briefing' })
  return a
}

describe('GET /api/v1/briefing/daily', () => {
  beforeEach(() => {
    h.top.mockReset()
    h.between.mockReset()
    h.top.mockResolvedValue([
      story(1, { outletCount: 112, outlets: ['a.com', 'b.com'] }),
      story(2, { category: 'geopolitics', place: 'Oslo', verifiedAt: null, outletCount: 2 }),
      story(3, { category: 'sports', severity: 'low', title: 'Cup final' }),          // not news: left out
      story(4, { category: 'other', severity: 'medium', title: 'Fairground accident kills 3' }), // medium counts
    ])
  })

  it("lists the day's stories with their outlet counts, each event once, grouped by category", async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/briefing/daily' })
    expect(res.statusCode).toBe(200)
    expect(h.top).toHaveBeenCalledWith(24, 80)
    const d = res.json().data
    expect(d.headline_count).toBe(3)
    expect(d.sections.map((s: { category: string }) => s.category)).toEqual(['conflict', 'geopolitics', 'other'])
    expect(d.sections[0].signals[0]).toMatchObject({
      id: 'lead-1', story_id: 'story-1', title: 'Story 1', summary: 'Summary of lead-1', reliability_score: 0.8, country_code: 'SD',
      source_count: 112, outlet_count: 112, outlets: ['a.com', 'b.com'], verified: true, location_name: 'Sudan',
    })
    expect(d.sections[1].signals[0]).toMatchObject({ verified: false, outlet_count: 2 })
    expect(d.top_locations[0]).toEqual({ location_name: 'Sudan', count: 2 })
    expect(d.severity_breakdown).toEqual({ critical: 0, high: 2, medium: 1, low: 0 })
  })

  it('picks a category from the same stories, and shows at most 20', async () => {
    h.top.mockResolvedValue(Array.from({ length: 30 }, (_, i) => story(i + 1)))
    const all = (await (await app()).inject({ method: 'GET', url: '/api/v1/briefing/daily' })).json().data
    expect(all.headline_count).toBe(20)
    h.top.mockResolvedValue([story(1), story(2, { category: 'climate' })])
    const climate = (await (await app()).inject({ method: 'GET', url: '/api/v1/briefing/daily?category=climate' })).json().data
    expect(climate.sections).toHaveLength(1)
    expect(climate.sections[0].signals[0].id).toBe('lead-2')
  })

  it("ranks a past day's stories over that day only", async () => {
    h.between.mockResolvedValue([story(9)])
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/briefing/daily?date=2026-10-19' })
    expect(res.statusCode).toBe(200)
    const [from, to, limit] = h.between.mock.calls[0]!
    expect((from as Date).toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect((to as Date).toISOString()).toBe('2026-10-19T23:59:59.999Z')
    expect(limit).toBe(80)
    expect(res.json().data.date).toBe('2026-10-19')
  })

  it('refuses a day that does not exist', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/briefing/daily?date=2026-13-45' })).statusCode).toBe(400)
    expect((await a.inject({ method: 'GET', url: '/api/v1/briefing/daily?date=yesterday' })).statusCode).toBe(400)
  })
})
