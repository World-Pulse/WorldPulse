import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ limits: [] as string[], queries: 0, kept: new Map<string, string>() }))

vi.mock('../../db/postgres', () => {
  const raw = vi.fn(async (sql: string) => {
    if (/^SET LOCAL statement_timeout/.test(sql)) { h.limits.push(sql); return { rows: [] } }
    h.queries++
    return { rows: [{ id: 'p1', type: 'person', name: 'Donald Trump', last24h: 80, last7d: 496, previous7d: 0 }] }
  })
  return { db: Object.assign(vi.fn(), { raw, transaction: vi.fn(async (fn: (trx: { raw: typeof raw }) => unknown) => fn({ raw })) }) }
})
vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.kept.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { h.kept.set(k, v); return 'OK' }),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))

import { directoryGroups, entityDirectory, MIN_REPORTS } from '../entity-directory'

const row = (id: string, type: string, name: string, last7d: number, last24h = 0, previous7d = 0) =>
  ({ id, type, name, last7d, last24h, previous7d })

describe('directoryGroups', () => {
  const rows = [
    row('p1', 'person', 'Donald Trump', 496, 80, 0),
    row('p2', 'person', 'Volodymyr Zelensky', 135, 20, 40),
    row('l1', 'location', 'United States', 656, 90, 200),
    row('o1', 'organisation', 'UN', 1818, 300, 2),
    row('c1', 'commodity', 'Crude oil', 102, 9, 0),
    row('e1', 'event', 'COP31', 12, 1, 0),
    row('x1', 'person', 'Thin', MIN_REPORTS - 1, 1, 0),
    row('x2', 'location', '   ', 50, 5, 0),
  ]

  it('puts people, places and organisations in their own groups, everything else in the last', () => {
    const groups = directoryGroups(rows)
    expect(groups.map(g => g.key)).toEqual(['people', 'places', 'organisations', 'more'])
    expect(groups[0].entities.map(e => e.id)).toEqual(['p1', 'p2'])
    expect(groups[1].entities.map(e => e.id)).toEqual(['l1'])
    expect(groups[2].entities.map(e => e.id)).toEqual(['o1'])
    expect(groups[3].entities.map(e => e.id)).toEqual(['c1', 'e1'])
  })

  it('leaves out entities with too few reports and blank names', () => {
    const ids = directoryGroups(rows).flatMap(g => g.entities.map(e => e.id))
    expect(ids).not.toContain('x1')
    expect(ids).not.toContain('x2')
  })

  it('compares with the 7 days before only when there were 3 or more reports then', () => {
    const [people, places, orgs] = directoryGroups(rows)
    expect(people.entities.find(e => e.id === 'p2')?.change).toBe(3.4)
    expect(people.entities.find(e => e.id === 'p1')?.change).toBeNull()
    expect(places.entities[0].change).toBe(3.3)
    expect(orgs.entities[0].change).toBeNull()
  })

  it('ranks by reports this week, then today, then name, and keeps the top of each group', () => {
    const many = [
      row('a', 'person', 'Bravo', 10, 1),
      row('b', 'person', 'Alpha', 10, 1),
      row('c', 'person', 'Charlie', 10, 5),
      row('d', 'person', 'Delta', 20, 0),
    ]
    expect(directoryGroups(many, 3)[0].entities.map(e => e.name)).toEqual(['Delta', 'Charlie', 'Alpha'])
  })

  it('trims names', () => {
    expect(directoryGroups([row('a', 'person', '  Ana Brnabić ', 5)])[0].entities[0].name).toBe('Ana Brnabić')
  })
})

describe('entityDirectory (Oct 15, 2026: its pass took over 5 s and /entities answered 500)', () => {
  it('gives the pass two minutes, keeps the directory, and serves the kept one', async () => {
    const first = await entityDirectory()
    expect(first.groups[0].entities.map(e => e.name)).toEqual(['Donald Trump'])
    expect(h.limits.map(s => s.split(';')[0])).toEqual(["SET LOCAL statement_timeout = '120s'"])
    expect([...h.kept.keys()]).toEqual(['kg:api:directory:v2'])
    const again = await entityDirectory()
    expect(h.queries).toBe(1)
    expect(again).toEqual(first)
  })
})
