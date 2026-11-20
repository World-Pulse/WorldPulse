/**
 * The same-story search for Chinese, Japanese and Thai headlines (Nov 20, 2026, afternoon): the database's word index
 * keeps a run of characters written without spaces as one word, so the search found another outlet's report of the
 * story only when a run started alike (35 of 119 pairs). The reader now keeps the day's pieces in memory and looks up
 * the rarest a headline shares. The two checks that came with it: a word of several pieces counts once in the
 * rare-words look, and headlines naming different cities or provinces in Chinese, Japanese or Korean are two events.
 */
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'whereNot', 'whereIn', 'orderBy', 'limit']) b[m] = () => b
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.rows).then(res, rej)
    return b
  }
  return { db: Object.assign(vi.fn(() => builder()), { raw: vi.fn((sql: string) => ({ sql })) }), pgPool: { query: vi.fn() } }
})
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { isSameStory, storyWords, RecentWordOutlets, RecentPieces, pieceWords, separateWords, warmRecentWords } = await import('../correlate')
const { readerTimingSummary } = await import('../../sources/news-rss')
type Candidate = Parameters<typeof isSameStory>[0]

const now = Date.now()
const HOUR = 60 * 60_000
const at = (source_id: string, title: string, minutesAgo = 0): Candidate => ({
  id: `${source_id}-${title.length}`, title, category: 'geopolitics', severity: 'low', source_id, location_name: null, lat: null,
  lng: null, published_at: new Date(now - minutesAgo * 60_000).toISOString(), reliability_score: 0.7, tags: [],
})
const piecesOf = (title: string) => pieceWords(storyWords(title))

// real headlines of Nov 20, 2026
const BUDGET_A = '追加預算6076億全數通過 卓榮泰：感謝立院朝野'
const BUDGET_B = '立院三讀6076億追加預算全數過關　油電凍漲至2028年'
const OTHERS = [
  '屏東枋寮鄉村長候選人「1票500元」買票 偕2樁腳收押禁見',
  '德國狼犬成惡犬攻擊3路人濺血送醫 基市府開罰飼主並收容',
  '大学生の就職内定率７３％　１０月時点、高水準続く',
  '米軍が下地島空港の使用申請　県は「屋良覚書」「西銘確認書」基づき使用自粛求める',
]

describe('the pieces search', () => {
  it('brings up the earlier report of the story among the day\'s others', () => {
    const pieces = new RecentPieces()
    OTHERS.forEach((title, i) => pieces.add(`other-${i}`, piecesOf(title), now - (i + 1) * HOUR))
    pieces.add('budget-a', piecesOf(BUDGET_A), now - 2 * HOUR)
    const found = pieces.search(piecesOf(BUDGET_B), now, 'budget-b')
    expect(found[0]).toBe('budget-a')
    expect(found).not.toContain('other-1')
  })

  it("doesn't look up pieces that more than 60 reports used, nor the report itself", () => {
    const pieces = new RecentPieces()
    // "預算" in 61 reports of the day: it singles out nothing
    for (let i = 0; i < 61; i++) pieces.add(`budget-${i}`, ['預算'], now - HOUR)
    expect(pieces.search(['預算'], now)).toEqual([])
    pieces.add('self', ['卓榮', '榮泰'], now)
    expect(pieces.search(['卓榮', '榮泰'], now, 'self')).toEqual([])
    expect(pieces.search(['卓榮', '榮泰'], now)).toEqual(['self'])
  })

  it('forgets reports older than the day', () => {
    const pieces = new RecentPieces()
    pieces.add('old', piecesOf(BUDGET_A), now - 25 * HOUR)
    expect(pieces.search(piecesOf(BUDGET_B), now)).toEqual([])
    pieces.add('new', ['油電'], now)
    pieces.prune(now)
    expect(pieces.size).toBe(1)
  })

  it('is filled at start from the warm-up rows', async () => {
    h.rows = [
      { id: 'budget-a', title: BUDGET_A, source_id: null, first_url: 'https://www.chinatimes.com/x', published_at: new Date(now - HOUR), created_at: new Date(now - HOUR) },
      { id: 'turkish', title: "Beyoğlu cinayetinde kaçış planı yarım kaldı", source_id: null, first_url: 'https://www.hurriyet.com.tr/y', published_at: new Date(now - HOUR), created_at: new Date(now - HOUR) },
    ]
    const words = new RecentWordOutlets()
    const pieces = new RecentPieces()
    expect(await warmRecentWords(words, pieces)).toBe(2)
    expect(pieces.search(piecesOf(BUDGET_B), now)).toEqual(['budget-a'])
  })

  it('is counted on the status page', () => {
    const s = readerTimingSummary(undefined, { signals: 0, recentMs: 0, titleSearches: 0, titleSearchMs: 0, titleRows: 0, compareMs: 0,
      olderSearches: 0, olderSearchMs: 0, boosts: 0, boostMs: 0, pieceSearches: 4, pieceSearchMs: 20, pieceRows: 9 })
    expect(s.matching).toMatchObject({ piece_searches: 4, piece_search_ms: 5, piece_rows: 9 })
  })
})

describe('a word of several pieces, in the rare-words look', () => {
  it('counts once', () => {
    expect(separateWords('大学生と盛岡市議会議員が意見交換', ['意見', '見交', '交換'])).toBe(1)
    expect(separateWords('蘇巧慧三重車掃 最後階段盼新北29區再走一遍', ['蘇巧', '巧慧', '三重', '車掃', '最後'])).toBe(4)
    expect(separateWords('Russians attack railway station in Lviv: two killed', ['railway', 'station', 'lviv'])).toBe(3)
  })

  const counted = (pairs: Array<[string, string]>) => {
    const words = new RecentWordOutlets()
    for (const [outlet, title] of pairs) words.add(storyWords(title), outlet, now - 600_000)
    words.ready = true
    return words
  }

  it("doesn't match two emergency landings at two airports", () => {
    const kochi = '高知空港に米軍機緊急着陸　けが人なしか、理由不明'
    const ishigaki = '【速報】石垣空港に緊急着陸した米軍オスプレイが離陸'
    const words = counted([['chunichi.co.jp', kochi], ['fnn.jp', ishigaki]])
    expect(isSameStory(at('chunichi.co.jp', kochi, 60), at('fnn.jp', ishigaki), { rareWords: words })).toBe(false)
  })

  it('still matches a story told in separate rare words', () => {
    const a = 'ピーチで８９９万件超流出　委託先で不正アクセス'
    const b = 'LCCピーチで個人情報約900万件漏洩　メール配信委託企業が不正アクセス被害　予約や運航に影響なし'
    const words = counted([['chunichi.co.jp', a], ['fnn.jp', b]])
    const look: { name?: string } = {}
    expect(isSameStory(at('chunichi.co.jp', a, 60), at('fnn.jp', b), { rareWords: words, look })).toBe(true)
    expect(look.name).toBe('rare')
  })
})

describe('cities and provinces named in Chinese, Japanese or Korean', () => {
  it('tell two events apart', () => {
    // vote buying in Pingtung and in Taitung; cryptocurrency frauds in Ehime and in Akita
    expect(isSameStory(at('chinatimes.com', '屏東枋寮鄉村長候選人「1票500元」買票 偕2樁腳收押禁見', 60),
      at('setn.com', '台東議員候選人涉賄選！每票1千或2千買票　檢聲請羈押禁見'))).toBe(false)
    expect(isSameStory(at('fnn.jp', '「マネロンで逮捕状」松山の男性が暗号資産約１７００万円相当被害　警察官と検事装い資金調査口実【愛媛】', 60),
      at('sakigake.jp', '「必ずもうかる」と誘われ…暗号資産詐取　秋田市の６０代男性、５５０万円被害'))).toBe(false)
  })

  it('let a city and its prefecture be one story, and two outlets naming the same place', () => {
    // made-up headlines: Yokohama is in Kanagawa, Osaka isn't
    const yokohama = '横浜市の大型倉庫で火災　作業員３人が煙を吸い病院に搬送'
    expect(isSameStory(at('a.example', yokohama, 60), at('b.example', '神奈川県の大型倉庫で火災　作業員３人が煙を吸い搬送'))).toBe(true)
    expect(isSameStory(at('a.example', yokohama, 60), at('b.example', '大阪市の大型倉庫で火災　作業員３人が煙を吸い搬送'))).toBe(false)
    expect(isSameStory(at('udn.com', '屏東枋寮村長候選人500元賄選 與樁腳共3人收押禁見', 60),
      at('chinatimes.com', '屏東枋寮鄉村長候選人「1票500元」買票 偕2樁腳收押禁見'))).toBe(true)
  })
})
