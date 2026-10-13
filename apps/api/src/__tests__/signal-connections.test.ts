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
}))

vi.mock('../db/postgres', () => ({
  db: {
    raw: vi.fn(async (sql: string, bindings: unknown[]) => {
      h.calls.push({ sql, bindings })
      return { rows: h.answers.shift() ?? [] }
    }),
  },
}))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: vi.fn(async () => h.stories) }))

import { signalConnections, CONNECTION_DAYS, UNRESOLVED_COUNTRY_SQL } from '../lib/signal-connections'

const PAGE = '11111111-1111-1111-1111-111111111111'
const ENTITIES = [
  { id: 'e_yemen', type: 'location', canonical_name: 'Yemen', mention_count: 500 },
  { id: 'e_ethiopia', type: 'location', canonical_name: 'Ethiopia', mention_count: 200 },
  { id: 'e_djibouti', type: 'location', canonical_name: 'Djibouti', mention_count: 50 },
]

beforeEach(() => { h.calls = []; h.answers = []; h.stories = true })

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

  it('its trade-row filter matches "Country 554" but not "Country music"', () => {
    const js = new RegExp(UNRESOLVED_COUNTRY_SQL.replace(/\\m|\\M/g, '\\b'))
    expect(js.test('Australia → Country 554 Wheat Exports: $180M 2024')).toBe(true)
    expect(js.test('Singapore → Country 0 Radioactive Materials Exports: $34M 2024')).toBe(true)
    expect(js.test('Country music star dies at 80')).toBe(false)
  })
})
