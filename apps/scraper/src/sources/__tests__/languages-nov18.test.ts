/**
 * Six more languages the place-finder reads (Nov 18, 2026): Turkish, Polish, Hungarian, Czech, Indonesian and
 * Ukrainian (local-names.ts), so feeds in them can be added without their stories landing at the outlet's home
 * or nowhere. Headlines written as those outlets write them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')

const outlet = (language: string, countryCode: string) =>
  ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode, language }) as never
const placed = (title: string, language: string, home: string) => inferGeo(title, '', outlet(language, home)).countryCode

describe('six more languages (Nov 18, 2026)', () => {
  it('reads Turkish names with their endings', () => {
    expect(placed("Rusya'dan Ukrayna'ya yeni saldırı: 12 ölü", 'tr', 'TR')).toBe('UA')
    expect(placed("Gazze'de ateşkes görüşmeleri Kahire'de sürüyor", 'tr', 'TR')).toMatch(/PS|EG/)
    expect(placed("İzmir'de 5,1 büyüklüğünde deprem", 'tr', 'TR')).toBe('TR')
    expect(placed("ABD'nin Ankara Büyükelçisi Dışişleri'ne çağrıldı", 'tr', 'TR')).toMatch(/US|TR/)
  })

  it('reads Polish names in their cases', () => {
    expect(placed('Atak dronów na Kijów, w Warszawie alarm', 'pl', 'PL')).toMatch(/UA|PL/)
    expect(placed('Wybory w Niemczech: CDU prowadzi', 'pl', 'PL')).toBe('DE')
    expect(placed('Powódź we Wrocławiu, ewakuacja mieszkańców', 'pl', 'PL')).toBe('PL')
    // "dania" (dishes) is not Denmark
    expect(withLocalNames('Nowe dania w menu', 'pl')).toBe('Nowe dania w menu')
  })

  it('reads Hungarian names with their joined endings', () => {
    expect(placed('Tüntetés Budapesten a sajtótörvény ellen', 'hu', 'HU')).toBe('HU')
    expect(placed('Orosz rakéták csapódtak be Kijevben', 'hu', 'HU')).toBe('UA')
    // "kínál" (offers) and "iránt" (towards) are not China or Iran
    expect(withLocalNames('Új árakat kínál a bolt, bizalom iránt', 'hu')).toBe('Új árakat kínál a bolt, bizalom iránt')
  })

  it('reads Czech names in their cases', () => {
    expect(placed('Povodně v Brně, v Praze zasedá krizový štáb', 'cs', 'CZ')).toBe('CZ')
    expect(placed('Ruský útok na Ukrajinu: zničena elektrárna', 'cs', 'CZ')).toBe('UA')
  })

  it('reads Indonesian names', () => {
    expect(placed('Jepang dan Korea Selatan gelar latihan militer bersama', 'id', 'ID')).toMatch(/JP|KR/)
    expect(placed('Banjir rendam Jakarta, ribuan warga mengungsi', 'id', 'ID')).toBe('ID')
    expect(placed('Presiden AS kunjungi Tiongkok pekan depan', 'id', 'ID')).toMatch(/US|CN/)
  })

  it('reads Ukrainian names in their cases', () => {
    expect(placed('Удар по Харкову: загинули троє людей', 'uk', 'UA')).toBe('UA')
    expect(placed('Польща закрила кордон з Білоруссю', 'uk', 'UA')).toMatch(/PL|BY/)
    // "суми" (sums) is not Sumy
    expect(withLocalNames('великі суми грошей', 'uk')).toBe('великі суми грошей')
  })
})
