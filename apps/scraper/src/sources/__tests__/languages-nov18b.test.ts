/**
 * Five more languages the place-finder reads (Nov 18, 2026, afternoon): Greek, Korean, Urdu, Persian and Vietnamese
 * (local-names.ts). Headlines written as those outlets write them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')

const outlet = (language: string, countryCode: string) =>
  ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode, language }) as never
const placed = (title: string, language: string, home: string) => inferGeo(title, '', outlet(language, home)).countryCode

describe('five more languages (Nov 18, 2026, afternoon)', () => {
  it('reads Greek names in their cases, with or without accents', () => {
    expect(placed('ΗΠΑ - Βενεζουέλα: Συμφωνία στρατιωτικής συνεργασίας', 'el', 'CY')).toMatch(/US|VE/)
    expect(placed('Φόνος Λευκωσία: Τα κλειστά κυκλώματα «έκαψαν» τον 20χρονο', 'el', 'CY')).toBe('CY')
    expect(placed('Σεισμός 5,2 Ρίχτερ στην Κρήτη', 'el', 'GR')).toBe('GR')
    expect(placed('Ρωσικά drones χτύπησαν το Κίεβο', 'el', 'GR')).toBe('UA')
    expect(placed('Η ΤΟΥΡΚΙΑ ΑΠΕΙΛΕΙ ΞΑΝΑ', 'el', 'GR')).toBe('TR')
    // "κινά" (moves) is not China, "καιρό" (weather) not Cairo
    expect(withLocalNames('Η αγορά κινά τα νήματα με καλό καιρό', 'el')).not.toMatch(/China|Cairo/)
  })

  it('reads Korean names with their particles', () => {
    expect(placed('제프리스, 미국 역사상 첫 흑인 하원의장 유력', 'ko', 'KR')).toBe('US')
    expect(placed('북한, 동해상으로 탄도미사일 발사', 'ko', 'KR')).toBe('KP')
    expect(placed('부산에서 국제영화제 개막', 'ko', 'US')).toBe('KR')
    // "인도적 지원" (humanitarian aid) is not India; Indonesia is not India
    expect(withLocalNames('인도적 지원 확대', 'ko')).not.toMatch(/India/)
    expect(placed('인도네시아 자카르타서 지진', 'ko', 'KR')).toBe('ID')
  })

  it('reads Urdu names', () => {
    expect(placed('کراچی کی مصروف تجارتی شاہراہ اچانک بند', 'ur', 'PK')).toBe('PK')
    expect(placed('ایران اور امریکا کے درمیان مذاکرات', 'ur', 'PK')).toMatch(/IR|US/)
    expect(placed('بھارتی فوج کی کشمیر میں کارروائی', 'ur', 'PK')).toBe('IN')
    // "بے چین" (restless) is not China
    expect(withLocalNames('عوام بے چین ہیں', 'ur')).not.toMatch(/China/)
  })

  it('reads Persian names, in either spelling of its letters', () => {
    expect(placed('روایت وال استریت ژورنال؛ ونس مسئول مذاکره با تهران شد', 'fa', 'GB')).toBe('IR')
    // Arabic ي and ك, as some Persian sites type them
    expect(placed('حمله به كابل', 'fa', 'GB')).toBe('AF')
  })

  it('reads Vietnamese names, and leaves its look-alike words alone', () => {
    expect(placed('Trung Quốc và Mỹ đàm phán thương mại', 'vi', 'VN')).toMatch(/CN|US/)
    expect(placed('Ngập lụt nghiêm trọng ở Đà Nẵng', 'vi', 'VN')).toBe('VN')
    expect(placed('Thủ tướng Đức thăm Hà Nội', 'vi', 'US')).toMatch(/DE|VN/)
    // "Pháp luật" (law), "Ý kiến" (opinion), "Mỹ Đình" (a Hanoi district) and a woman's name "Thị Nga"
    expect(withLocalNames('Pháp luật: Ý kiến về sân Mỹ Đình của bà Nguyễn Thị Nga', 'vi')).toBe('Pháp luật: Ý kiến về sân Mỹ Đình của bà Nguyễn Thị Nga')
  })
})

describe('Hindi (Nov 18, 2026)', () => {
  it('reads Hindi names, and not "चीनी" (Chinese, also sugar) as China', () => {
    expect(placed('दिल्ली में प्रदूषण से हाहाकार', 'hi', 'IN')).toBe('IN')
    expect(placed('ईरान और अमेरिका के बीच बातचीत', 'hi', 'IN')).toMatch(/IR|US/)
    expect(withLocalNames('चीनी के दाम बढ़े', 'hi')).toBe('चीनी के दाम बढ़े')
  })
})
