/**
 * The newer news reader's side of "one report per article" (H-0014, Oct 20,
 * 2026): insertAndCorrelate with articleUrl claims the article's address, so
 * an article the older reader stores (or is storing) isn't stored again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const HELD = '6f1c2a9e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const NEW_ID = '0b7e2c1a-1111-4222-8333-944445555666'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  inserts: [] as unknown[],
  failInsert: false,
  corroborate: vi.fn(async () => true),
}))

vi.mock('../../lib/redis', () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(0),
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...opts: Array<string | number>) => {
      if (opts.includes('NX') && h.store.has(k)) return null
      if (opts.includes('KEEPTTL') && !h.store.has(k)) return null
      h.store.set(k, v)
      return 'OK'
    }),
    del: vi.fn(async (k: string) => (h.store.delete(k) ? 1 : 0)),
  },
}))
vi.mock('../../lib/postgres', () => ({
  db: vi.fn(() => ({
    insert: (data: unknown) => {
      if (h.failInsert) throw new Error('insert failed')
      h.inserts.push(data)
      return { returning: () => [{ id: NEW_ID, title: 'Stored', category: 'politics', severity: 'medium', reliability_score: 0.7, tags: [], created_at: new Date() }] }
    },
  })),
}))
vi.mock('../correlate', () => ({
  correlateSignal: vi.fn(async () => null),
  corroborateWithDuplicate: h.corroborate,
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../health', () => ({ recordSuccess: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../entity-graph', () => ({ processSignalForKnowledgeGraph: vi.fn(), extractEntitiesRuleBased: () => ({ entities: [] }), upsertEntityNode: vi.fn() }))
vi.mock('../fingerprints', () => ({ fingerprintSignal: vi.fn() }))
vi.mock('../signal-columns', async (orig) => ({ ...(await orig<typeof import('../signal-columns')>()), signalsHavePublishedAt: async () => false }))

import { insertAndCorrelate } from '../insert-signal'
import { dedup } from '../dedup'

const LINK = 'https://www.dw.com/en/bulgaria-seeks-suspects-in-germany-after-starlink-sabotage/a-74100000'
const report = (title: string, url = LINK) => ({ title, category: 'politics', severity: 'medium', reliability_score: 0.7, source_ids: [], original_urls: [url] })

describe('one report per article, the newer reader', () => {
  beforeEach(() => {
    h.store.clear()
    h.inserts.length = 0
    h.failInsert = false
    h.corroborate.mockClear()
    h.corroborate.mockResolvedValue(true)
  })

  it("doesn't store an article the other reader holds, and doesn't count it as another outlet", async () => {
    const c = await dedup.claimArticle(LINK)          // the older reader stored it
    await dedup.rememberArticle(c!.key, HELD)
    const res = await insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })
    expect(res._skipped).toBe(true)
    expect(h.inserts).toHaveLength(0)
    expect(h.corroborate).not.toHaveBeenCalled()
  })

  it("doesn't store an article the other reader is storing right now", async () => {
    await dedup.claimArticle(LINK)
    const res = await insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })
    expect(res._skipped).toBe(true)
    expect(h.inserts).toHaveLength(0)
  })

  it('stores a new article and remembers the report, so a second copy is not stored', async () => {
    const first = await insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })
    expect(first.id).toBe(NEW_ID)
    expect((await dedup.claimArticle(LINK))?.seen).toBe(NEW_ID)
    // the same article again, under another category and through another feed's tags
    const again = await insertAndCorrelate({ ...report('Bulgaria seeks suspects in Germany after Starlink sabotage', `${LINK}?maca=en-rss-en-world-4025-rdf`), category: 'security' }, { sourceId: 'dw-europe', articleUrl: `${LINK}?utm_source=rss` })
    expect(again._skipped).toBe(true)
    expect(h.inserts).toHaveLength(1)
  })

  it('without an article address (sensor and alert sources), two reports with one link are both stored', async () => {
    await insertAndCorrelate(report('Magnitude 5.1 earthquake near Izmir', 'https://earthquake.usgs.gov/map'), { sourceId: 'usgs' })
    await insertAndCorrelate(report('Wildfire spreads north of Valencia', 'https://earthquake.usgs.gov/map'), { sourceId: 'usgs' })
    expect(h.inserts).toHaveLength(2)
  })

  it('lets go of the claim when the insert fails, so the article can still be stored', async () => {
    h.failInsert = true
    await expect(insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })).rejects.toThrow('insert failed')
    expect((await dedup.claimArticle(LINK))?.seen).toBeNull()
  })

  it("a duplicate of another outlet's report that corroborates it leaves its article with that report", async () => {
    // another outlet's report of the event, held as HELD
    const ev = await dedup.claimCrossSource('Bulgaria seeks suspects in Germany after Starlink sabotage', 'politics')
    await dedup.rememberCrossSource(ev.key, HELD)
    const res = await insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })
    expect(res._skipped).toBe(true)
    expect(h.corroborate).toHaveBeenCalledWith(HELD, expect.objectContaining({ url: LINK }))
    expect((await dedup.claimArticle(LINK))?.seen).toBe(HELD)
  })

  it("one that doesn't corroborate it lets its article go, so the other reader may still store it", async () => {
    h.corroborate.mockResolvedValue(false)
    const ev = await dedup.claimCrossSource('Bulgaria seeks suspects in Germany after Starlink sabotage', 'politics')
    await dedup.rememberCrossSource(ev.key, HELD)
    await insertAndCorrelate(report('Bulgaria seeks suspects in Germany after Starlink sabotage'), { sourceId: 'dw-world', articleUrl: LINK })
    expect((await dedup.claimArticle(LINK))?.seen).toBeNull()
  })
})
