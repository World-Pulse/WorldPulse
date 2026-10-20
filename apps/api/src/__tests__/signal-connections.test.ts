/**
 * The story page's "Intelligence web" (lib/signal-connections.ts, Oct 12,
 * 2026): signals naming this one's own entities, recent, not the same story,
 * not unresolved trade rows. (The SQL was also run against Postgres 16 with
 * fixture rows: same-story report, 100-day-old item, "Country 554" row, a
 * two-step "via UN" item and a malformed id all stayed out.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; bindings: unknown[] }>,
  answers: [] as unknown[],
  stories: true,
  limits: [] as number[],
  slow: false,
  kept: [] as Array<{ key: string; opts: unknown }>,
}))

vi.mock('../db/postgres', () => {
  const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    h.calls.push({ sql, bindings })
    return { rows: h.answers.shift() ?? [] }
  })
  return { db: { raw } }
})
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: vi.fn(async () => h.stories) }))
// The search runs under its own time limit (lib/long-query.ts)
vi.mock('../lib/long-query', async () => {
  const { db } = await import('../db/postgres')
  return {
    longQuery: vi.fn(async (seconds: number, run: (trx: unknown) => Promise<unknown>) => {
      h.limits.push(seconds)
      if (h.slow) throw new Error('canceling statement due to statement timeout')
      return run({ raw: db.raw })
    }),
  }
})
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// Answers are kept in Redis (lib/swr-cache.ts): here, made at once and their keys noted
vi.mock('../lib/swr-cache', () => ({
  staleWhileRevalidate: vi.fn(async (key: string, opts: unknown, make: () => Promise<unknown>) => {
    h.kept.push({ key, opts })
    return make()
  }),
}))

import {
  signalConnections, signalEntities, searchedEntities, connectionsAnswer, CONNECTION_DAYS, UNRESOLVED_COUNTRY_SQL,
  BROAD_ENTITY_REPORTS, SEARCHED_ENTITIES, CONNECTION_SECONDS, CONNECTIONS_KEEP,
} from '../lib/signal-connections'

const PAGE = '11111111-1111-1111-1111-111111111111'
const ENTITIES = [
  { id: 'e_yemen', type: 'location', canonical_name: 'Yemen', mention_count: 500 },
  { id: 'e_ethiopia', type: 'location', canonical_name: 'Ethiopia', mention_count: 200 },
  { id: 'e_djibouti', type: 'location', canonical_name: 'Djibouti', mention_count: 50 },
]

beforeEach(() => { h.calls = []; h.answers = []; h.stories = true; h.limits = []; h.slow = false; h.kept = [] })

describe('signalConnections', () => {
  it('stops after one query when the signal names no entities', async () => {
    expect(await signalConnections(PAGE, 8)).toEqual({ connections: [], entities: [] })
    expect(h.calls).toHaveLength(1)
  })

  it("lists signals naming this one's own entities: recent, not this story, not unresolved trade rows", async () => {
    h.answers = [ENTITIES, [{
      id: '33333333-3333-3333-3333-333333333333', title: 'Houthis fire missiles from Yemen as Ethiopia closes border',
      summary: null, category: 'conflict', severity: 'high', status: 'pending', reliability_score: '0.6',
      location_name: 'Yemen', country_code: 'YE', tags: null, created_at: new Date('2026-10-10T12:00:00Z'), alert_tier: null,
      ids: ['e_yemen', 'e_ethiopia'], names: ['Yemen', 'Ethiopia'], types: ['location', 'location'], shared: 2,
    }]]
    const r = await signalConnections(PAGE, 8)

    const { sql, bindings } = h.calls[1]!
    expect(sql).not.toContain('entity_edges')            // no second step out
    expect(sql).toContain('make_interval(days => ?)')
    expect(sql).toContain('IS DISTINCT FROM')            // other reports of the story stay out
    expect(bindings).toEqual([['e_yemen', 'e_ethiopia', 'e_djibouti'], PAGE, expect.any(String), CONNECTION_DAYS, UNRESOLVED_COUNTRY_SQL, PAGE, 8])

    expect(r.entities.map(e => e.name)).toEqual(['Yemen', 'Ethiopia', 'Djibouti'])
    expect(r.connections).toEqual([expect.objectContaining({
      title: 'Houthis fire missiles from Yemen as Ethiopia closes border',
      reliabilityScore: 0.6,
      tags: [],
      createdAt: '2026-10-10T12:00:00.000Z',
      connectedVia: [{ id: 'e_yemen', name: 'Yemen', type: 'location' }, { id: 'e_ethiopia', name: 'Ethiopia', type: 'location' }],
      sharedEntityCount: 2,
      connectionStrength: 2 / 3,
    })])
  })

  it('works before the scraper has added story ids', async () => {
    h.stories = false
    h.answers = [ENTITIES, []]
    await signalConnections(PAGE, 5)
    expect(h.calls[1]!.sql).not.toContain('story_id')
    expect(h.calls[1]!.bindings.at(-1)).toBe(5)
    expect(h.calls[1]!.bindings).toHaveLength(6)
  })

  it('searches under its own time limit, and still names the entities when it gives up (Oct 20, 2026: 500 after 5.3 s)', async () => {
    h.answers = [ENTITIES]
    h.slow = true
    const r = await signalConnections(PAGE, 8)
    expect(h.limits).toEqual([CONNECTION_SECONDS])
    expect(CONNECTION_SECONDS).toBeLessThan(5)
    expect(r.connections).toEqual([])
    expect(r.entities.map(e => e.name)).toEqual(['Yemen', 'Ethiopia', 'Djibouti'])
  })

  it('leaves out of the search the entities nearly every report names', async () => {
    h.answers = [[
      { id: 'e_us', type: 'location', canonical_name: 'United States', mention_count: 90_000, reports: 40_000 },
      { id: 'e_trump', type: 'person', canonical_name: 'Donald Trump', mention_count: 4_368, reports: 4_368 },
      { id: 'e_zelensky', type: 'person', canonical_name: 'Volodymyr Zelensky', mention_count: 767, reports: 767 },
      { id: 'e_witkoff', type: 'person', canonical_name: 'Steve Witkoff', mention_count: 120, reports: 120 },
    ], []]
    const r = await signalConnections(PAGE, 8)
    expect(h.calls[1]!.bindings[0]).toEqual(['e_zelensky', 'e_witkoff'])
    expect(r.entities.map(e => e.name)).toEqual(['United States', 'Donald Trump', 'Volodymyr Zelensky', 'Steve Witkoff'])
    expect(r.entities[0]).not.toHaveProperty('reports')
  })

  it('its trade-row filter matches "Country 554" but not "Country music"', () => {
    const js = new RegExp(UNRESOLVED_COUNTRY_SQL.replace(/\\m|\\M/g, '\\b'))
    expect(js.test('Australia → Country 554 Wheat Exports: $180M 2024')).toBe(true)
    expect(js.test('Singapore → Country 0 Radioactive Materials Exports: $34M 2024')).toBe(true)
    expect(js.test('Country music star dies at 80')).toBe(false)
  })
})

describe('searchedEntities', () => {
  const e = (id: string, reports: number) => ({ id, reports })
  it('keeps the specific ones, most-mentioned first, at most SEARCHED_ENTITIES', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`e${i}`, 100))
    expect(searchedEntities(many)).toHaveLength(SEARCHED_ENTITIES)
    expect(searchedEntities([e('us', BROAD_ENTITY_REPORTS + 1), e('a', 50), e('b', BROAD_ENTITY_REPORTS)]).map(x => x.id)).toEqual(['a', 'b'])
  })
  it('searches the two narrowest when every entity is broad', () => {
    expect(searchedEntities([e('us', 40_000), e('trump', 4_368), e('china', 9_000)]).map(x => x.id)).toEqual(['trump', 'china'])
  })
})

describe('signalEntities', () => {
  it('names the entities with one quick query, without the search', async () => {
    h.answers = [ENTITIES]
    expect((await signalEntities(PAGE)).map(e => e.name)).toEqual(['Yemen', 'Ethiopia', 'Djibouti'])
    expect(h.calls).toHaveLength(1)
    expect(h.limits).toEqual([])
  })
})

describe('connectionsAnswer (GET /signals/:id/connections)', () => {
  it('answers the entities alone for the story page, kept, without the search', async () => {
    h.answers = [ENTITIES]
    const a = await connectionsAnswer(PAGE, 1, 'entities')
    expect(a).toEqual({ connections: [], entities: expect.arrayContaining([expect.objectContaining({ name: 'Yemen' })]), count: 0 })
    expect(h.calls).toHaveLength(1)
    expect(h.kept).toEqual([{ key: `signals:entities:v1:${PAGE}`, opts: CONNECTIONS_KEEP }])
  })

  it('keeps the connections per signal and limit', async () => {
    h.answers = [ENTITIES, []]
    const a = await connectionsAnswer(PAGE, 8)
    expect(a.count).toBe(0)
    expect(a.entities).toHaveLength(3)
    expect(h.kept[0]!.key).toBe(`signals:connections:v1:${PAGE}:8`)
    expect(CONNECTIONS_KEEP.freshSeconds).toBe(600)
  })
})
