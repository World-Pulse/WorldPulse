/**
 * One story's page data, GET /api/v1/stories/:id. Its outlet count now reads
 * every report's links, as the home page's story list does: until Oct 11 it
 * read each report's first link only, so the Riyadh story said 51 outlets on
 * its signal page and 55 on the home page. It also lists the outlets, so the
 * number can be checked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  sql: '',
  bindings: [] as unknown[],
  rows: [] as Array<Record<string, unknown>>,
  storyOf: null as string | null,
}))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => ({
  db: Object.assign(
    vi.fn(() => ({ where: () => ({ first: async () => (h.storyOf ? { story_id: h.storyOf } : undefined) }) })),
    {
      schema: { hasColumn: vi.fn(async () => true) },
      raw: vi.fn(async (sql: string, bindings: unknown[]) => {
        h.sql = sql
        h.bindings = bindings
        return { rows: h.rows }
      }),
    },
  ),
}))

import { registerStoryRoutes } from '../stories'

const STORY = '11111111-1111-4111-8111-111111111111'
const SIGNAL = '22222222-2222-4222-8222-222222222222'

function member(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: SIGNAL, title: 'Twelve killed in attack on airport in Riyadh', status: 'verified', severity: 'high',
    category: 'conflict', reliability_score: '0.9', location_name: 'Riyadh',
    original_urls: ['https://www.aljazeera.com/a', 'https://apnews.com/b'],
    created_at: '2026-10-10T15:00:00Z', verified_at: '2026-10-10T16:00:00Z',
    position: 1, from_end: 2, total: 2, first_verified: '2026-10-10T16:00:00Z',
    outlets: 3, outlet_names: ['aljazeera.com', 'apnews.com', 'cbsnews.com'],
    ...over,
  }
}

async function get(id: string) {
  const app = Fastify({ logger: false })
  await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
  return app.inject({ method: 'GET', url: `/api/v1/stories/${id}` })
}

describe('GET /api/v1/stories/:id', () => {
  beforeEach(() => {
    h.storyOf = STORY
    h.rows = [
      member({}),
      member({ id: '33333333-3333-4333-8333-333333333333', position: 2, from_end: 1, original_urls: ['https://www.bbc.co.uk/c'], created_at: '2026-10-10T15:30:00Z' }),
    ]
  })

  it('counts the outlets in every report\'s links and lists them A to Z', async () => {
    const res = await get(SIGNAL)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ storyId: STORY, size: 2, outlets: 3, outletNames: ['aljazeera.com', 'apnews.com', 'cbsnews.com'] })
    expect(data.signals.map((s: { outlet: string }) => s.outlet)).toEqual(['aljazeera.com', 'bbc.co.uk'])
    // every link of every report, not just each report's first
    expect(h.sql).toMatch(/unnest\(s\.original_urls\)/)
    expect(h.sql).not.toMatch(/original_urls\[1\]/)
    expect(h.sql).toMatch(/array_agg\(host ORDER BY host\)/)
    // the story and its window go to Postgres as bindings, twice each scope
    expect(h.bindings).toEqual([STORY, STORY, STORY, STORY, 10, 40, SIGNAL])
  })

  it("reads Postgres's text form of the names, and never counts fewer than it names", async () => {
    h.rows = [member({ outlets: null, outlet_names: '{aljazeera.com,apnews.com}' })]
    const data = (await get(SIGNAL)).json().data
    expect(data.outletNames).toEqual(['aljazeera.com', 'apnews.com'])
    expect(data.outlets).toBe(2)
  })

  it('answers 404 for a story with no reports, and 400 for a malformed id', async () => {
    h.rows = []
    expect((await get(SIGNAL)).statusCode).toBe(404)
    expect((await get('not-a-uuid')).statusCode).toBe(400)
  })
})
