/**
 * More of one story's reports matched (Nov 20, 2026; Devon, 10:18 AM: the brain "still needs help on matching
 * multiple sources in a verification", its lowest part: 19% of 30 days' reports confirmed by 2+ outlets). Of the 13
 * hours' 30,319 reports, the search had found nearly every pair the rules accept (3,194 of 3,361 both verified); the
 * rules themselves turned down many: Chinese, Japanese and Thai headlines read in overlapping pieces, and headlines
 * of one story worded differently that share few words, but rare ones.
 */
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'whereNot', 'orderBy', 'limit']) b[m] = () => b
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

const { isSameStory, storyWords, RecentWordOutlets, warmRecentWords } = await import('../correlate')
type Candidate = Parameters<typeof isSameStory>[0]

const now = Date.now()
const at = (source_id: string, title: string, minutesAgo = 0, category = 'geopolitics'): Candidate => ({
  id: `${source_id}-${title.length}`, title, category, severity: 'low', source_id, location_name: null, lat: null, lng: null,
  published_at: new Date(now - minutesAgo * 60_000).toISOString(), reliability_score: 0.7, tags: [],
})

describe('Chinese, Japanese and Thai headlines, read in pieces', () => {
  it('are one story from 6 pieces in common and a fifth of all', () => {
    for (const [a, b] of [
      ['追加預算三讀　卓榮泰：感謝兩院良性互動回應民意', '追加預算6076億全數通過 卓榮泰：感謝立院朝野'],
      ['故宮設置光電板爭議　經濟部：僅普查、未強制要求', '發函故宮問設光電板惹議 賴建信：僅普查未強制 有提注意文資'],
      ['片山大臣「非常に遺憾」報告徴求命令も　楽天証券の顧客情報漏えい恐れ', '楽天証券の情報漏えい遺憾　金融相、再発防止策を確認'],
      ['八潮市の道路陥没事故　裁判に訴えられた埼玉県「責任認める」　損害賠償額は争う姿勢', '八潮市道路陥没の損害賠償訴訟　県側は責任認める一方で損害額争う姿勢　さいたま地裁第1回口頭弁論'],
      ["'เอกนิติ' บุกกระทรวงคลังญี่ปุ่นยกระดับความร่วมมือการค้า - ลงทุน พร้อมจับมือ LINE ใช้ AI ปั้น SME ไทย", '‘เอกนิติ’ จับมือ LINE ประกาศ 3 แผนใหญ่ ใช้ AI ยกระดับ ‘SME’ ไทย'],
    ]) expect(isSameStory(at('one.example', a!, 90), at('two.example', b!))).toBe(true)
  })

  it('still keep two stories apart', () => {
    // a lightning outage on one line, a resumed service on another
    expect(isSameStory(at('one.example', 'えちぜん鉄道・勝山永平寺線で落雷による停電、一時運転見合わせ　永平寺口駅～勝山駅間、11月20日午前'),
      at('two.example', '【運転再開】秋田新幹線、一時運転見合わせ'))).toBe(false)
    // English is read as before
    expect(isSameStory(at('one.example', 'Indian Navy frigate visits Da Nang to boost defence cooperation'),
      at('two.example', 'Major Boost For India-Japan Defence Ties'))).toBe(false)
  })
})

describe('the rare-words look', () => {
  const beyoglu = [
    "Beyoğlu'nda halıya sarılı ceset soruşturması. Katil zanlısı İzmir'de Yunanistan'a kaçarken yakalandı",
    "Beyoğlu cinayetinde kaçış planı yarım kaldı: Şüpheli Yunanistan'a kaçarken yakalandı",
  ] as const
  const counted = (titles: Array<[string, string]>, minutesAgo = 10) => {
    const words = new RecentWordOutlets()
    for (const [outlet, title] of titles) words.add(storyWords(title), outlet, now - minutesAgo * 60_000)
    words.ready = true
    return words
  }

  it('matches two wordings of one story whose shared words few outlets used', () => {
    const a = at('sabah.com.tr', beyoglu[0], 30)
    const b = at('hurriyet.com.tr', beyoglu[1])
    const words = counted([['sabah.com.tr', beyoglu[0]], ['hurriyet.com.tr', beyoglu[1]]])
    expect(isSameStory(a, b)).toBe(false)
    expect(isSameStory(a, b, { rareWords: words })).toBe(true)
  })

  it("doesn't when the shared words are the day's topic, more than 6 hours apart, or before the counts are in", () => {
    const a = at('sabah.com.tr', beyoglu[0], 30)
    const b = at('hurriyet.com.tr', beyoglu[1])
    // six more outlets used the same words: the day's topic, not what singles the story out
    const busy = counted([['sabah.com.tr', beyoglu[0]], ['hurriyet.com.tr', beyoglu[1]],
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(o => [`${o}.example`, "Beyoğlu: Yunanistan'a kaçarken yakalandı"] as [string, string])])
    expect(isSameStory(a, b, { rareWords: busy })).toBe(false)
    const words = counted([['sabah.com.tr', beyoglu[0]], ['hurriyet.com.tr', beyoglu[1]]])
    expect(isSameStory(at('sabah.com.tr', beyoglu[0], 7 * 60), b, { rareWords: words })).toBe(false)
    const cold = counted([['sabah.com.tr', beyoglu[0]], ['hurriyet.com.tr', beyoglu[1]]])
    cold.ready = false
    expect(isSameStory(a, b, { rareWords: cold })).toBe(false)
  })

  it("keeps two stories apart that share only the night's common words, or name two places", () => {
    // the Lviv and Kyiv attacks of one night: "attack", "took the lives", "people" were in many outlets' headlines
    const lviv = 'Атака рф на Львів 20 листопада забрала життя двох людей, семеро поранено'
    const kyiv = 'Київ: російська атака забрала життя трьох людей (оновлено)'
    const night = counted([['a.example', lviv], ['b.example', kyiv],
      ...['c', 'd', 'e', 'f', 'g', 'h'].map(o => [`${o}.example`, 'Атака забрала життя людей'] as [string, string])])
    expect(isSameStory(at('a.example', lviv, 60), at('b.example', kyiv), { rareWords: night })).toBe(false)
    // power cuts in Odesa and in Kyiv
    const odesa = 'Odesa Trams, Trolleybuses Halt as Russian Strike Cuts Power to the City Network'
    const kyivPower = 'Russian Strike Cuts Power to Trams and Trolleybuses in Five Kyiv Districts'
    const words = counted([['a.example', odesa], ['b.example', kyivPower]])
    expect(isSameStory(at('a.example', odesa, 60), at('b.example', kyivPower), { rareWords: words })).toBe(false)
  })

  it('counts each outlet once, for 12 hours, and forgets the rest', () => {
    const words = new RecentWordOutlets()
    words.add(['cipoll', '@IT'], 'one.example', now - 13 * 60 * 60_000)
    words.add(['cipoll'], 'two.example', now - 60_000)
    words.add(['cipoll'], 'two.example', now)
    expect(words.outlets('cipoll', now)).toBe(1)
    expect(words.outlets('@IT', now)).toBe(0)  // countries aren't counted
    for (const o of ['c', 'd', 'e', 'f', 'g', 'h', 'i']) words.add(['cipoll'], `${o}.example`, now)
    expect(words.outlets('cipoll', now)).toBe(6)  // up to one more than the most a rare word has
    words.add(['stale'], 'one.example', now - 13 * 60 * 60_000)
    words.prune(now)
    expect(words.outlets('stale', now)).toBe(0)
    expect(words.size).toBe(1)
  })

  it('is filled from the last 12 hours at start', async () => {
    h.rows = [
      { title: beyoglu[0], source_id: null, first_url: 'https://www.sabah.com.tr/x', published_at: new Date(now - 3_600_000).toISOString() },
      { title: beyoglu[1], source_id: null, first_url: 'https://www.hurriyet.com.tr/y', published_at: new Date(now - 60_000).toISOString() },
    ]
    const words = new RecentWordOutlets()
    expect(await warmRecentWords(words)).toBe(2)
    expect(words.ready).toBe(true)
    expect(words.outlets('beyogl')).toBe(2)
  })
})

describe('the rare-words look and Vietnamese', () => {
  it('is not for Vietnamese headlines, whose words are syllables', () => {
    // the summit's results and the lottery's results
    const a = 'Kết quả hội nghị thượng đỉnh ba bên Mỹ - Nga - Trung Quốc tại miền Trung'
    const b = 'Kết quả xổ số miền Trung hôm nay: đặc biệt trúng lớn'
    const words = new RecentWordOutlets()
    words.add(storyWords(a), 'one.example', now - 60_000)
    words.add(storyWords(b), 'two.example', now)
    words.ready = true
    expect(isSameStory(at('one.example', a, 30), at('two.example', b), { rareWords: words })).toBe(false)
  })
})

describe("Vietnamese's little words", () => {
  it('are not story words', () => {
    const words = storyWords('Khi công viên trở thành nền tảng của đời sống đô thị')
    expect([...words].some(w => ['khi', 'cua'].includes(w))).toBe(false)
    expect(words.has('vien')).toBe(true)
  })
})
