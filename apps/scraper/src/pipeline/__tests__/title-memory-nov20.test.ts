/**
 * The headline-word search in memory (Nov 20, 2026, evening): the database's word search took 0.6 to 2 s of a
 * report's 1.1 to 3.5 s of matching on the busy server. The day's headlines are kept in memory, split as the
 * database splits them, and looked up with the same search words as prefixes, ranked as the database ranks them;
 * replayed on 13 hours of reports it confirmed as many (5,361 against 5,362).
 */
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: 0, calls: 0 }))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'whereNot', 'whereIn', 'orderBy', 'limit']) b[m] = () => b
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      h.calls++
      if (h.fail > 0) { h.fail--; return Promise.reject(new Error('canceling statement due to statement timeout')).then(res, rej) }
      return Promise.resolve(h.rows).then(res, rej)
    }
    return b
  }
  return { db: Object.assign(vi.fn(() => builder()), { raw: vi.fn((sql: string) => ({ sql })) }), pgPool: { query: vi.fn() } }
})
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { RecentTitles, warmRecentTitles, searchWords, titleTokens } = await import('../correlate')
const { readerTimingSummary } = await import('../../sources/news-rss')

const now = Date.now()
const HOUR = 60 * 60_000

describe('the headline-word search in memory', () => {
  it('finds the reports whose words start with the search words, the most matched first', () => {
    const titles = new RecentTitles()
    titles.add('a', 'Russian drone attack on Kyiv kills three', now - HOUR)
    titles.add('b', 'Kyiv attacked overnight: three killed in drone strike', now - 2 * HOUR)
    titles.add('c', 'Football: Dynamo Kyiv win the cup', now - HOUR)
    titles.add('d', 'Gold prices fall for a third day', now - HOUR)
    const found = titles.search(searchWords('Three killed as Russian drones attack Kyiv'), now, 'self')
    expect(found[0]).toBe('a')
    expect(found).toContain('b')
    expect(found[found.length - 1]).toBe('c')
    expect(found).not.toContain('d')
  })

  it('splits a headline as the database does, lower case', () => {
    expect(titleTokens("Trump's Tariffs: 25% on EU cars")).toEqual(['trump', 's', 'tariffs', '25', 'on', 'eu', 'cars'])
    expect(titleTokens('追加預算6076億全數通過 卓榮泰：感謝立院朝野')).toEqual(['追加預算6076億全數通過', '卓榮泰', '感謝立院朝野'])
  })

  it('reads Korean from 2 syllables and the scripts of India from 2 letters, as the search words start', () => {
    const titles = new RecentTitles()
    titles.add('ko', '정부는 오늘 대책을 발표했다', now - HOUR)
    titles.add('hi', 'दिल्ली में भारी बारिश, कई इलाकों में जलभराव', now - HOUR)
    expect(titles.search(['정부'], now)).toEqual(['ko'])
    expect(titles.search(['दिल'], now)).toEqual(['hi'])
  })

  it('leaves out the report itself and the reports older than the day', () => {
    const titles = new RecentTitles()
    titles.add('self', 'Flooding in Valencia', now)
    titles.add('old', 'Valencia flooding: rivers burst their banks', now - 25 * HOUR)
    titles.add('new', 'Valencia floods kill two', now - HOUR)
    expect(titles.search(['valencia'], now, 'self')).toEqual(['new'])
    titles.prune(now)
    expect(titles.size).toBe(2)
  })

  it('keeps the newest reports when a word is in more than it holds', () => {
    const titles = new RecentTitles(24 * HOUR, 3)
    for (let i = 0; i < 5; i++) titles.add(`r${i}`, `Gaza ceasefire talks, day ${i}`, now - (5 - i) * 60_000)
    // the warm-up's older report comes in last: it doesn't push out a newer one
    titles.add('older', 'Gaza ceasefire talks resume', now - 10 * HOUR)
    expect(titles.search(['gaza'], now).sort()).toEqual(['r2', 'r3', 'r4'])
  })

  it('is filled at start an hour at a time, then searched', async () => {
    h.rows = [{ id: 'budget', title: '立院三讀6076億追加預算全數過關', created_at: new Date(now - 2 * HOUR) }]
    h.fail = 1  // one hour times out once, and is read again
    h.calls = 0
    const titles = new RecentTitles()
    expect(titles.ready).toBe(false)
    await warmRecentTitles(titles, 0)
    expect(titles.ready).toBe(true)
    expect(h.calls).toBe(25)
    expect(titles.search(['立院三讀6076億追加預算全數過關'], now)).toEqual(['budget'])
  })

  it("stays off when an hour can't be read, so the database search goes on", async () => {
    h.fail = 2
    const titles = new RecentTitles()
    await expect(warmRecentTitles(titles, 0)).rejects.toThrow('statement timeout')
    expect(titles.ready).toBe(false)
    h.fail = 0
  })

  it('is counted on the status page', () => {
    const s = readerTimingSummary(undefined, { signals: 0, recentMs: 0, titleSearches: 0, titleSearchMs: 0, titleRows: 0, compareMs: 0,
      olderSearches: 0, olderSearchMs: 0, boosts: 0, boostMs: 0, pieceSearches: 0, pieceSearchMs: 0, pieceRows: 0,
      memorySearches: 10, memorySearchMs: 30, memoryRows: 400 })
    expect(s.matching).toMatchObject({ memory_searches: 10, memory_search_ms: 3, memory_rows: 40, titles_ready: false })
  })
})
