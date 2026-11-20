/**
 * Which look found each same-story match (Nov 20, 2026, afternoon), on the status page with whether the rare-words
 * look has its counts: the confirmed share of the hours after the new looks went live didn't show the replay's gain.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { isSameStory, storyWords, RecentWordOutlets } = await import('../correlate')
const { readerTimingSummary } = await import('../../sources/news-rss')
type Candidate = Parameters<typeof isSameStory>[0]

const now = Date.now()
const at = (source_id: string, title: string, minutesAgo = 0): Candidate => ({
  id: `${source_id}-${title.length}`, title, category: 'geopolitics', severity: 'low', source_id, location_name: null, lat: null,
  lng: null, published_at: new Date(now - minutesAgo * 60_000).toISOString(), reliability_score: 0.7, tags: [],
})

describe('the look that found a match', () => {
  it('is named: most words, pieces, rare words', () => {
    const look: { name?: string } = {}
    expect(isSameStory(at('a.example', 'Flooding in Valencia kills 12 as rivers burst their banks'),
      at('b.example', 'Valencia flooding kills 12 as rivers burst banks', 30), { look })).toBe(true)
    expect(look.name).toBe('words')

    const pieces: { name?: string } = {}
    expect(isSameStory(at('a.example', '追加預算三讀　卓榮泰：感謝兩院良性互動回應民意', 90),
      at('b.example', '追加預算6076億全數通過 卓榮泰：感謝立院朝野'), { look: pieces })).toBe(true)
    expect(pieces.name).toBe('pieces')

    const a = "Beyoğlu'nda halıya sarılı ceset soruşturması. Katil zanlısı İzmir'de Yunanistan'a kaçarken yakalandı"
    const b = "Beyoğlu cinayetinde kaçış planı yarım kaldı: Şüpheli Yunanistan'a kaçarken yakalandı"
    const words = new RecentWordOutlets()
    words.add(storyWords(a), 'sabah.com.tr', now - 600_000)
    words.add(storyWords(b), 'hurriyet.com.tr', now - 600_000)
    words.ready = true
    const rare: { name?: string } = {}
    expect(isSameStory(at('sabah.com.tr', a, 30), at('hurriyet.com.tr', b), { rareWords: words, look: rare })).toBe(true)
    expect(rare.name).toBe('rare')
  })

  it("is left unset when there's no match", () => {
    const look: { name?: string } = {}
    expect(isSameStory(at('a.example', 'Indian Navy frigate visits Da Nang'), at('b.example', 'Major Boost For India-Japan Defence Ties'), { look })).toBe(false)
    expect(look.name).toBeUndefined()
  })

  it('is counted on the status page, with the rare-words counts', () => {
    const s = readerTimingSummary({ inserts: 0, insertMs: 0, correlations: 0, correlateMs: 0, dedupMs: 0 }, undefined,
      { words: 5, pieces: 2, rare: 1, second: 3 })
    expect(s.matching_looks).toEqual({ words: 5, pieces: 2, rare: 1, second: 3, rare_ready: false, rare_words: 0 })
  })
})
