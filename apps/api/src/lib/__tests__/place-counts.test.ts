import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── A query-builder stand-in that records what was asked ───────────────────

const calls: Array<[string, unknown[]]> = []
let rows: Array<{ location_name: unknown; n: unknown }> = []

function query() {
  const q: Record<string, unknown> = {}
  for (const m of ['whereNotNull', 'select', 'count', 'groupBy', 'where', 'whereIn']) {
    q[m] = (...args: unknown[]) => { calls.push([m, args]); return q }
  }
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject)
  return q
}

const dbFn = vi.fn((table: string) => { calls.push(['table', [table]]); return query() })
vi.mock('../../db/postgres', () => ({ get db() { return dbFn } }))

import { placeCounts, countFor, clearPlaceCounts, type PlaceCounts } from '../place-counts'

beforeEach(() => {
  calls.length = 0
  dbFn.mockClear()
  clearPlaceCounts()
  rows = [
    { location_name: 'Khartoum, Sudan', n: '12' },
    { location_name: 'Sudan', n: 30 },
    { location_name: 'South Sudan', n: '7' },
    { location_name: 'Gaza', n: '41' },
  ]
})

describe('placeCounts', () => {
  it('counts reports per place in one grouped query, names in lowercase', async () => {
    const counts = await placeCounts()
    expect(counts).toEqual([['khartoum, sudan', 12], ['sudan', 30], ['south sudan', 7], ['gaza', 41]])
    expect(dbFn).toHaveBeenCalledTimes(1)
    expect(calls).toContainEqual(['table', ['signals']])
    expect(calls).toContainEqual(['groupBy', ['location_name']])
    expect(calls.find(c => c[0] === 'where')).toBeUndefined()
    expect(calls.find(c => c[0] === 'whereIn')).toBeUndefined()
  })

  it('limits to the last days and to categories when asked', async () => {
    const before = Date.now()
    await placeCounts({ days: 30, categories: ['health', 'climate'] })
    const where = calls.find(c => c[0] === 'where')
    expect(where?.[1][0]).toBe('created_at')
    expect(where?.[1][1]).toBe('>')
    const since = Date.parse(String(where?.[1][2]))
    expect(before - since).toBeGreaterThanOrEqual(30 * 86_400_000 - 1_000)
    expect(before - since).toBeLessThanOrEqual(30 * 86_400_000 + 1_000)
    expect(calls).toContainEqual(['whereIn', ['category', ['health', 'climate']]])
  })

  it('keeps the counts for 10 minutes, apart for each kind of count', async () => {
    await placeCounts({ days: 30 })
    await placeCounts({ days: 30 })
    expect(dbFn).toHaveBeenCalledTimes(1)
    await placeCounts({ categories: ['health'] })
    expect(dbFn).toHaveBeenCalledTimes(2)
  })

  it('treats a count that is not a number as 0', async () => {
    rows = [{ location_name: 'Gaza', n: null }]
    expect(await placeCounts()).toEqual([['gaza', 0]])
  })

  it('passes a database error on (the routes then show the list without counts)', async () => {
    dbFn.mockImplementationOnce(() => { throw new Error('connection refused') })
    await expect(placeCounts()).rejects.toThrow('connection refused')
  })
})

describe('countFor', () => {
  const counts: PlaceCounts = [['khartoum, sudan', 12], ['sudan', 30], ['south sudan', 7], ['gaza', 41]]

  it('adds up every place name that contains the place, as ILIKE %place% did', () => {
    expect(countFor(counts, 'Sudan')).toBe(49)
    expect(countFor(counts, 'South Sudan')).toBe(7)
    expect(countFor(counts, 'Khartoum')).toBe(12)
  })

  it('ignores case and surrounding spaces', () => {
    expect(countFor(counts, '  GAZA ')).toBe(41)
  })

  it('is 0 for an unknown or empty place', () => {
    expect(countFor(counts, 'Lima')).toBe(0)
    expect(countFor(counts, '   ')).toBe(0)
    expect(countFor([], 'Gaza')).toBe(0)
  })
})
