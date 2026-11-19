/**
 * The second-outlet search in the newer languages (Nov 18, 2026; Devon, 10:51 PM: "proceed with 1-3"): Japanese,
 * Chinese, Korean, Greek, Persian, Urdu and Thai reports were all rated low, because no severity rules read them, so
 * the search (medium and above) never looked for their second outlet: 0 of 44 Japanese, 1 of 40 Chinese and 0 of 18
 * Greek reports were verified that day. GDELT's translated list is now read in these languages too (its 03:45 UTC
 * file of Nov 19 held 355 Chinese, 18 Japanese, 15 Greek, 8 Urdu and 5 Korean articles).
 */
import { describe, it, expect, vi } from 'vitest'
import type { HeldReport } from '../second-outlet'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties } = await import('../severity-languages')
const { otherOutlets, waitingQuery } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES, siteOf } = await import('../gdelt-articles')

describe('severity in Japanese, Chinese, Korean, Greek, Persian, Urdu and Thai', () => {
  it('counts the dead and injured', () => {
    expect(foreignCasualties('大分県で土砂崩れ、3人死亡 5人けが', 'ja')).toMatchObject({ dead: 3, injured: 5 })
    expect(foreignCasualties('死者は少なくとも１２人に', 'ja')?.dead).toBe(12)
    expect(foreignCasualties('台湾花莲6.1级地震造成2人死亡、30人受伤', 'zh')).toMatchObject({ dead: 2, injured: 30 })
    expect(foreignCasualties('巴基斯坦爆炸事件死亡人數升至27', 'zh')?.dead).toBe(27)
    expect(foreignCasualties('화재로 4명 숨지고 12명 부상', 'ko')).toMatchObject({ dead: 4, injured: 12 })
    expect(foreignCasualties('Σεισμός στην Κρήτη: 3 νεκροί και 15 τραυματίες', 'el')).toMatchObject({ dead: 3, injured: 15 })
    expect(foreignCasualties('انفجار در بندرعباس؛ ۱۲ نفر کشته شدند', 'fa')?.dead).toBe(12)
    expect(foreignCasualties('کوہاٹ میں حملہ، 8 پولیس اہلکار شہید', 'ur')?.dead).toBe(8)
    expect(foreignCasualties('รถบัสตกเหว เสียชีวิต 9 ราย บาดเจ็บ 20 ราย', 'th')).toMatchObject({ dead: 9, injured: 20 })
  })

  it('rates serious news above low', () => {
    expect(rateSeverity('大分県で土砂崩れ、3人死亡', null, 'disaster', 'ja')).not.toBe('low')
    expect(rateSeverity('イスラエル軍がガザを空爆', null, 'conflict', 'ja')).toBe('high')
    expect(rateSeverity('黎巴嫩南部遭以色列空襲', null, 'conflict', 'zh')).toBe('high')
    expect(rateSeverity('北 미사일 발사…합참 "동해상으로"', null, 'conflict', 'ko')).toBe('medium')
    expect(rateSeverity('Διαδηλώσεις στην Αθήνα για τα Τέμπη', null, 'politics', 'el')).toBe('medium')
    expect(rateSeverity('حمله پهپادی به پالایشگاه', null, 'conflict', 'fa')).toBe('medium')
    expect(rateSeverity('کراچی میں دھماکہ', null, 'security', 'ur')).toBe('high')
    expect(rateSeverity('ชุมนุมประท้วงหน้าทำเนียบรัฐบาล', null, 'politics', 'th')).toBe('medium')
  })

  it("leaves everyday news low, and doesn't read a power cut or a goal as a death or a shooting", () => {
    expect(rateSeverity('新商品の発売日が決定', null, 'technology', 'ja')).toBe('low')
    expect(rateSeverity('台北國際書展明年2月登場', null, 'culture', 'zh')).toBe('low')
    expect(rateSeverity('ไฟดับหลายพื้นที่ในกรุงเทพฯ', null, 'other', 'th')).toBe('low')
    expect(rateSeverity('ยิงประตูชัยนาทีสุดท้าย', null, 'sports', 'th')).toBe('low')
    expect(rateSeverity('Νέο μουσείο στη Θεσσαλονίκη', null, 'culture', 'el')).toBe('low')
  })
})

describe('the second-outlet search in these languages', () => {
  it("reads GDELT's translated list in them", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({ zho: 'zh', jpn: 'ja', kor: 'ko', ell: 'el', fas: 'fa', urd: 'ur', tha: 'th' })
  })

  it('takes their waiting reports', () => {
    const { sql } = waitingQuery([], new Date('2026-11-19T04:00:00Z'))
    for (const lang of ['ja', 'zh', 'ko', 'el', 'fa', 'ur', 'th']) expect(sql).toContain(`'${lang}'`)
  })

  const AT = new Date('2026-11-18T10:00:00Z')
  const LATER = new Date(AT.getTime() + 3 * 3_600_000)
  const held = (over: Partial<HeldReport>): HeldReport => ({
    id: 'sig', title: '', category: 'disaster', severity: 'medium', published_at: AT, original_urls: [], source_ids: [],
    location_name: null, lat: null, lng: null, tags: ['news', 'rss'], ...over,
  })
  const article = (url: string, title: string, lang: string) =>
    ({ url, title, site: siteOf(new URL(url).hostname), at: new Date(AT.getTime() + 2 * 3_600_000), lang })

  it("finds a Chinese report's second outlet in Chinese, not in another language", () => {
    const tw = held({
      id: 'sig-tw', language: 'zh', title: '花蓮外海6.1級地震 造成2人死亡30人受傷',
      original_urls: ['https://udn.com/news/story/123'], location_name: 'Hualien, Taiwan', lat: 23.98, lng: 121.6,
    })
    expect(otherOutlets(tw, [article('https://www.cna.com.tw/news/123', '花蓮外海6.1級地震 2人死亡30人受傷 多棟建築受損', 'zh')], LATER)
      .map(f => f.site)).toEqual(['cna.com.tw'])
    expect(otherOutlets(tw, [article('https://www.cna.com.tw/news/124', '花蓮外海6.1級地震 2人死亡30人受傷 多棟建築受損', 'ja')], LATER)).toEqual([])
  })
})

describe('the first Persian and Swahili feeds', () => {
  it('reads VOA Persian and HabariLEO, labelled state media below 0.6', async () => {
    const { NEWS_SOURCE_REGISTRY } = await import('../../sources/news-rss')
    const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))
    expect(byId.get('voa-persian')).toMatchObject({ language: 'fa', countryCode: 'IR', biasLabel: 'state-media' })
    expect(byId.get('habarileo-tz')).toMatchObject({ language: 'sw', countryCode: 'TZ', biasLabel: 'state-media' })
    for (const id of ['voa-persian', 'habarileo-tz']) expect(byId.get(id)!.reliability).toBeLessThan(0.6)
    expect(new Set(NEWS_SOURCE_REGISTRY.map(s => s.id)).size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
})

describe('Swahili place names', () => {
  it('reads them in English for the place-finder', async () => {
    const { withLocalNames } = await import('../local-names')
    expect(withLocalNames('Rais wa Marekani akutana na viongozi wa Afrika Kusini', 'sw')).toContain('United States')
    expect(withLocalNames('Rais wa Marekani akutana na viongozi wa Afrika Kusini', 'sw')).toContain('South Africa')
    expect(withLocalNames('Mvua kubwa Dar es Salaam', 'sw')).toContain('Dar es Salaam')
  })
})
