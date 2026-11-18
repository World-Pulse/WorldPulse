/**
 * Japanese, Chinese and Thai (Nov 18, 2026, evening): the place-finder reads their names without word edges, and
 * story matching reads their headlines in pieces (correlate.ts cjkWords). Headlines as those outlets write them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')
const { storyWords } = await import('../../pipeline/correlate')

const outlet = (language: string, countryCode: string) =>
  ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode, language }) as never
const placed = (title: string, language: string, home: string) => inferGeo(title, '', outlet(language, home)).countryCode

describe('Japanese, Chinese and Thai (Nov 18, 2026)', () => {
  it('reads Japanese names', () => {
    expect(placed('トランプ氏、プーチン氏と19日に個別会談へ　米特使はドイツでウクライナ協議', 'ja', 'JP')).toMatch(/UA|DE|US|RU/)
    expect(placed('沖縄の負担を直視せよ', 'ja', 'US')).toBe('JP')
    expect(placed('米軍機が緊急着陸', 'ja', 'JP')).toBe('US')
    // "米" alone is rice; "中国地方" is a region of Japan
    expect(withLocalNames('新米の価格が上昇　中国地方で豊作', 'ja')).not.toMatch(/United States|China/)
  })

  it('reads Chinese names, simplified and traditional', () => {
    expect(placed('特朗普、普京和习近平星期四深圳会晤', 'zh', 'FR')).toMatch(/CN|US|RU/)
    expect(placed('台灣外長林佳龍訪問華盛頓', 'zh', 'US')).toMatch(/TW|US/)
    expect(placed('烏克蘭基輔遭俄羅斯無人機襲擊', 'zh', 'TW')).toBe('UA')
    // "美" alone is beautiful
    expect(withLocalNames('美麗的風景', 'zh')).toBe('美麗的風景')
  })

  it('reads Thai names', () => {
    expect(placed('ทหารกัมพูชายิงข้ามแดน', 'th', 'TH')).toBe('KH')
    expect(placed('น้ำท่วมเชียงใหม่ ประชาชนอพยพ', 'th', 'US')).toBe('TH')
    // "ลาวา" (lava) is not Laos
    expect(withLocalNames('ภูเขาไฟพ่นลาวา', 'th')).not.toMatch(/Laos/)
  })

  it('reads their headlines in pieces, with the countries they name', () => {
    const a = storyWords('俄羅斯無人機襲擊基輔　造成3人死亡')
    const b = storyWords('基輔遭俄羅斯無人機大規模襲擊')
    expect(a.has('@UA') && a.has('@RU')).toBe(true)
    const shared = [...a].filter(w => b.has(w) && !w.startsWith('@'))
    expect(shared).toEqual(expect.arrayContaining(['無人', '人機', '襲擊']))
    expect(storyWords('トランプ大統領が訪日').has('@US')).toBe(true)
    // the commonest pieces are not story words
    expect(storyWords('外交部表示').has('表示')).toBe(false)
  })
})
