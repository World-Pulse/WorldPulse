/**
 * Corroboration only counts independent reports of the same story.
 *
 * On Oct 10, 2026 the correlation engine went live for the first time in months
 * and verified unrelated single-source stories that merely shared an hour and a
 * related category. These tests pin down the stricter rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const updates: Array<{ ids: string[]; data: Record<string, unknown> }> = []
  const state = { recentRows: [] as Record<string, unknown>[] }
  function builder() {
    let ids: string[] = []
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'whereNot', 'orderBy', 'limit', 'first']) b[m] = () => b
    b.whereIn = (_col: string, list: string[]) => { ids = list; return b }
    b.update = (data: Record<string, unknown>) => { updates.push({ ids, data }); return Promise.resolve(ids.length) }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(state.recentRows).then(res, rej)
    return b
  }
  return { updates, state, builder }
})

vi.mock('../../lib/postgres', () => {
  const db = Object.assign(vi.fn(() => h.builder()), { raw: vi.fn((sql: string) => ({ sql })) })
  return { db }
})
vi.mock('../../lib/redis', () => {
  const pipe = { setex: () => pipe, zadd: () => pipe, zremrangebyrank: () => pipe, exec: async () => [] }
  return { redis: { get: vi.fn(async () => null), pipeline: () => pipe } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { isSameStory, correlateSignal, type CorrelationCandidate } from '../correlate'

const now = new Date('2026-10-10T15:40:00Z')

function sig(over: Partial<CorrelationCandidate> = {}): CorrelationCandidate {
  return {
    id: 'sig-a', title: 'Magnitude 6.1 earthquake strikes off the coast of northern Japan',
    category: 'disaster', severity: 'high', source_id: 'nhk.or.jp', location_name: null,
    lat: null, lng: null, published_at: now.toISOString(), reliability_score: 0.7, tags: [],
    ...over,
  }
}

/** A stored signal row the way fetchRecentSignals reads it from the database */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sig-b', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast',
    category: 'disaster', severity: 'high', source_id: null, first_url: 'https://www.reuters.com/world/asia/x',
    location_name: null, reliability_score: 0.7, tags: [], published_at: now.toISOString(), lat: null, lng: null,
    ...over,
  }
}

describe('isSameStory', () => {
  it('matches two outlets reporting the same event', () => {
    expect(isSameStory(sig(), sig({ id: 'b', source_id: 'reuters.com',
      title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' }))).toBe(true)
  })

  it('never matches the same outlet, or an unknown one', () => {
    const other = sig({ id: 'b', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' })
    expect(isSameStory(sig(), other)).toBe(false)
    expect(isSameStory(sig(), { ...other, source_id: '' })).toBe(false)
  })

  it('does not match different stories that share a few words', () => {
    expect(isSameStory(
      sig({ title: 'Russia launches massive drone attack on Kyiv overnight', category: 'conflict' }),
      sig({ id: 'b', source_id: 'bbc.co.uk', title: 'Ukraine launches drone attack on Russian oil refinery', category: 'conflict' }),
    )).toBe(false)
    expect(isSameStory(
      sig({ title: 'Nobel peace laureate says US sanctions on ICC unacceptable', category: 'economy' }),
      sig({ id: 'b', source_id: 'aljazeera.com', title: 'Global carbon market leaders set their sights on Kigali', category: 'economy' }),
    )).toBe(false)
  })

  it('ignores short or templated headlines', () => {
    expect(isSameStory(
      sig({ title: 'Protest in Mahila, Rajasthan, India' }),
      sig({ id: 'b', source_id: 'thehindu.com', title: 'Protest in Jaipur, Rajasthan, India' }),
    )).toBe(false)
  })

  it('does not match reports far apart on the map or outside the time window', () => {
    const b = sig({ id: 'b', source_id: 'reuters.com', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' })
    expect(isSameStory(sig({ lat: 40.8, lng: 141.6 }), { ...b, lat: 33.6, lng: 130.4 })).toBe(false) // Aomori vs Fukuoka
    expect(isSameStory(sig({ lat: 40.8, lng: 141.6 }), { ...b, lat: 40.5, lng: 141.9 })).toBe(true)
    expect(isSameStory(sig(), { ...b, published_at: new Date(now.getTime() - 30 * 3600_000).toISOString() })).toBe(false)
  })
})

describe('correlateSignal corroboration', () => {
  beforeEach(() => { h.updates.length = 0 })

  it('does not boost or verify anything for merely related signals', async () => {
    h.state.recentRows = [
      row({ id: 'sig-x', title: 'Volcano on Iceland peninsula erupts again, flights unaffected', first_url: 'https://www.bbc.co.uk/news/y' }),
      row({ id: 'sig-y', title: 'Wildfire forces evacuations in southern California hills', first_url: 'https://apnews.com/z' }),
    ]
    await correlateSignal(sig())
    expect(h.updates).toEqual([])
  })

  it('boosts and verifies only the signal and its same-story report', async () => {
    h.state.recentRows = [
      row(),
      row({ id: 'sig-x', title: 'Volcano on Iceland peninsula erupts again, flights unaffected', first_url: 'https://www.bbc.co.uk/news/y' }),
    ]
    await correlateSignal(sig())
    expect(h.updates).toHaveLength(2)
    const [boost, promote] = h.updates
    expect(boost.ids).toEqual(['sig-a', 'sig-b'])
    expect(boost.data.source_count).toBe(2)
    expect(promote.ids).toEqual(['sig-a', 'sig-b'])
    expect(promote.data.status).toBe('verified')
  })
})
