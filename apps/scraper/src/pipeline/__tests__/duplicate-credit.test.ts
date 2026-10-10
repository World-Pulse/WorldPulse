/**
 * A near-identical report from another outlet within 6 hours is not inserted
 * again, but it is credited to the signal that holds the event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const HELD_ID = '6f1c2a9e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  inserts: [] as unknown[],
  corroborate: vi.fn(async () => true),
}))

vi.mock('../../lib/redis', () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(0),
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...opts: string[]) => {
      if (opts.includes('NX') && h.store.has(k)) return null
      if (opts.includes('KEEPTTL') && !h.store.has(k)) return null
      h.store.set(k, v)
      return 'OK'
    }),
  },
}))
vi.mock('../../lib/postgres', () => ({
  db: vi.fn(() => ({
    insert: (data: unknown) => {
      h.inserts.push(data)
      return { returning: () => [{ id: HELD_ID, title: 'Held', category: 'disaster', severity: 'high', reliability_score: 0.8, tags: [], created_at: new Date() }] }
    },
  })),
}))
vi.mock('../correlate', () => ({
  correlateSignal: vi.fn(async () => null),
  corroborateWithDuplicate: h.corroborate,
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../health', () => ({ recordSuccess: vi.fn().mockResolvedValue(undefined) }))

import { insertAndCorrelate } from '../insert-signal'

const quake = {
  title: 'Magnitude 6.1 earthquake strikes off the coast of northern Japan',
  category: 'disaster',
  severity: 'high',
  reliability_score: 0.8,
  source_ids: [],
}

describe('duplicate reports from other outlets', () => {
  beforeEach(() => {
    h.store.clear()
    h.inserts.length = 0
    h.corroborate.mockClear()
  })

  it('stores the first report and remembers which signal holds the event', async () => {
    await insertAndCorrelate({ ...quake, original_urls: ['https://www3.nhk.or.jp/news/1'] }, { sourceId: 'gdelt', lat: 40.8, lng: 141.6 })
    await new Promise(r => setTimeout(r, 0))
    expect(h.inserts).toHaveLength(1)
    expect([...h.store.values()]).toContain(HELD_ID)
    expect(h.corroborate).not.toHaveBeenCalled()
  })

  it("credits a later outlet's duplicate to the held signal instead of inserting it", async () => {
    await insertAndCorrelate({ ...quake, original_urls: ['https://www3.nhk.or.jp/news/1'] }, { sourceId: 'gdelt' })
    await new Promise(r => setTimeout(r, 0))
    const res = await insertAndCorrelate(
      { ...quake, original_urls: ['https://www.reuters.com/world/asia/quake'] },
      { sourceId: 'gdelt', lat: 40.5, lng: 141.9 },
    )
    expect(res._skipped).toBe(true)
    expect(h.inserts).toHaveLength(1)
    expect(h.corroborate).toHaveBeenCalledWith(HELD_ID, expect.objectContaining({
      source_id: 'reuters.com',
      url: 'https://www.reuters.com/world/asia/quake',
      lat: 40.5,
      lng: 141.9,
    }))
  })

  it('skips without crediting when the holder is not known yet', async () => {
    await insertAndCorrelate({ ...quake, original_urls: ['https://a.example/1'] }, { sourceId: 'gdelt' })
    await new Promise(r => setTimeout(r, 0))
    const [eventKey] = [...h.store.keys()]
    h.store.set(eventKey, 'pending') // e.g. the first report is still being saved
    const res = await insertAndCorrelate({ ...quake, original_urls: ['https://b.example/2'] }, { sourceId: 'gdelt' })
    expect(res._skipped).toBe(true)
    expect(h.corroborate).not.toHaveBeenCalled()
  })
})
