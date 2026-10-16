import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/postgres', () => ({ db: { raw: vi.fn() } }))

import { buildEntityLinks, type EntityHit } from '../entity-links'

let n = 0
const hit = (story: string, eid: string, name: string, over: Partial<EntityHit> = {}): EntityHit => ({
  eid, name, type: 'person', sid: `${story}-s${n++}`, story,
  title: `headline of ${story}`, category: 'conflict', created_at: '2026-10-15T10:00:00Z',
  location_name: null, country_code: null, severity: 'high', source_count: 1, ...over,
})

describe('buildEntityLinks', () => {
  it('links stories that share two specific entities, rarest first', () => {
    const hits = [
      hit('A', 'e1', 'Houthis', { type: 'organisation' }), hit('A', 'e2', 'Aden', { type: 'location' }),
      hit('B', 'e1', 'Houthis', { type: 'organisation', created_at: '2026-10-15T12:00:00Z' }), hit('B', 'e2', 'Aden', { type: 'location', created_at: '2026-10-15T12:00:00Z' }),
      hit('C', 'e1', 'Houthis', { type: 'organisation' }),
    ]
    const { links } = buildEntityLinks(hits)
    expect(links).toHaveLength(1)
    expect(links[0]!.a.story).toBe('A')
    expect(links[0]!.b.story).toBe('B')
    expect(links[0]!.shared_entities).toEqual(['Aden', 'Houthis'])
    expect(links[0]!.hours_apart).toBe(2)
  })

  it('ignores entities named in too many stories', () => {
    const hits: EntityHit[] = []
    for (let i = 0; i < 30; i++) {
      hits.push(hit(`S${i}`, 'us', 'United States', { type: 'location' }), hit(`S${i}`, 'trump', 'Donald Trump'))
    }
    expect(buildEntityLinks(hits).links).toHaveLength(0)
  })

  it('accepts one named person only these two stories mention', () => {
    const hits = [hit('A', 'kz', 'Katie Zacharia'), hit('B', 'kz', 'Katie Zacharia'), hit('C', 'other', 'Someone Else')]
    expect(buildEntityLinks(hits).links).toHaveLength(1)
    const places = [hit('A', 'k', 'Kozhikode', { type: 'location' }), hit('B', 'k', 'Kozhikode', { type: 'location' })]
    expect(buildEntityLinks(places).links).toHaveLength(0)
  })

  it('makes cause → effect chains only from a known category pair, in time order', () => {
    const t1 = '2026-10-15T08:00:00Z', t2 = '2026-10-15T20:00:00Z'
    const hits = [
      hit('A', 'e1', 'Strait of Hormuz', { type: 'location', category: 'conflict', created_at: t1 }), hit('A', 'e2', 'IRGC', { type: 'organisation', category: 'conflict', created_at: t1 }),
      hit('B', 'e1', 'Strait of Hormuz', { type: 'location', category: 'security', created_at: t2 }), hit('B', 'e2', 'IRGC', { type: 'organisation', category: 'security', created_at: t2 }),
    ]
    const { chains } = buildEntityLinks(hits, { causalPairs: [['conflict', 'security', 'conflict_escalation']] })
    expect(chains).toHaveLength(1)
    expect(chains[0]!.cause.category).toBe('conflict')
    expect(chains[0]!.effect.category).toBe('security')
    expect(chains[0]!.delay_hours).toBe(12)
    expect(chains[0]!.shared_entities).toContain('IRGC')
    expect(buildEntityLinks(hits, { causalPairs: [['security', 'conflict', 'x']] }).chains).toHaveLength(0)
  })

  it('reads a story as one, with its best-reported headline', () => {
    const hits = [
      hit('A', 'e1', 'X Corp', { type: 'organisation', title: 'small', source_count: 1 }),
      hit('A', 'e2', 'Y Org', { type: 'organisation', title: 'big', source_count: 5 }),
      hit('B', 'e1', 'X Corp', { type: 'organisation' }), hit('B', 'e2', 'Y Org', { type: 'organisation' }),
    ]
    const { links } = buildEntityLinks(hits)
    expect(links[0]!.a.title).toBe('big')
    expect(links[0]!.a.outlets).toBe(5)
  })
})
