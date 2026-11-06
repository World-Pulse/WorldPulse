/**
 * The places with one outlet of their own (Devon, Nov 6, 2026, 8:45 AM: "Look into the 30 places that still only have
 * 1 feed , what else can we add there?"): what passed, what comes back parked, and the towns the place-finder learned.
 * The rest of the 30, and what each would take: departments/research/r7-one-outlet-places-2026-11-06.md
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, PRESS_OFFICES, inferGeo, skippedLink } from '../news-rss'
import { placeFromText } from '../../pipeline/geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}

describe('the places with one outlet (Nov 6, 2026, 10 AM)', () => {
  it("adds Islands Business's news section, Fiji's second newsroom, read for the region without a home pin", () => {
    const ib = src('islands-business-pacific')
    expect(ib).toMatchObject({ countryCode: 'FJ', language: 'en', category: 'geopolitics' })
    expect(HOME_PIN_SOURCES.has(ib.id)).toBe(false)
    // its PACNEWS bulletins and partners' releases are not stories
    expect(skippedLink(ib, 'https://islandsbusiness.com/pacnews/pacnews-one-06-november-2026/')).toBe(true)
    expect(skippedLink(ib, 'https://islandsbusiness.com/partner-news/the-bilo-bar-club-celebrates/')).toBe(true)
    expect(skippedLink(ib, 'https://islandsbusiness.com/news-break/five-rescued-in-kiribati/')).toBe(false)
    expect(inferGeo('World Bank Group supports Marshall Islands to respond to El Niño and dengue outbreak', '', ib).countryCode).toBe('MH')
    // "PNG" alone is also the picture format, so the summary names the country
    expect(inferGeo('PNG public servants resign to contest 2027 national elections', 'Public servants in Papua New Guinea have resigned.', ib).countryCode).toBe('PG')
    expect(inferGeo('Pacific climate communicators gather in Rarotonga to strengthen early warnings', 'In Fiji and beyond.', ib).countryCode).toBe('CK')
    expect(inferGeo('Region pushes major big eye tuna measure', '', ib).countryCode).toBeNull()
  })

  it("adds SKNIS, St Kitts and Nevis's government information service, as a press office at home", () => {
    const sknis = src('sknis-kn')
    expect(sknis).toMatchObject({ countryCode: 'KN', biasLabel: 'state-media' })
    expect(sknis.reliability).toBeLessThan(0.6)
    expect(sknis.extraTags).toContain('state-media')
    expect(HOME_PIN_SOURCES.has('sknis-kn') && PRESS_OFFICES.has('sknis-kn')).toBe(true)
    expect(inferGeo('St. Kitts Hosts Stakeholders Readiness Workshop', '', sknis).countryCode).toBe('KN')
    expect(inferGeo('Embassy Initiative results in 15-Member U.S. Veterans Business Trade Mission to Saint Kitts and Nevis', '', sknis).countryCode).toBe('KN')
  })

  it('brings back TASR and Les Nouvelles Calédoniennes parked: the server could not read them on Oct 21', () => {
    expect(src('tasr-en')).toMatchObject({ countryCode: 'SK', language: 'en' })
    expect(src('tasr-en').parked).toMatch(/Oct 21, 2026/)
    expect(src('les-nouvelles-caledoniennes')).toMatchObject({ countryCode: 'NC', language: 'fr', feedUrl: 'https://www.lnc.nc/rss.xml' })
    expect(src('les-nouvelles-caledoniennes').parked).toMatch(/timed out on Oct 21, 2026/)
    for (const id of ['tasr-en', 'les-nouvelles-caledoniennes']) expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    // never LNC's FeedBurner feed, which carries spam
    expect(NEWS_SOURCE_REGISTRY.some(s => s.feedUrl.includes('feedburner') && /lnc|caledon/i.test(s.feedUrl))).toBe(false)
    expect(inferGeo('Boulouparis : deux blessés dans un choc frontal sur la RT1', '', src('les-nouvelles-caledoniennes')).countryCode).toBe('NC')
  })

  it("knows those places' towns, and not short names that are everyday words elsewhere", () => {
    const at = (t: string) => placeFromText(t).countryCode
    expect([at('Koror'), at('Rarotonga'), at('Lae'), at('Grand Cayman'), at('Muharraq'), at('Issyk-Kul'), at('Phuentsholing'),
      at('Prešov'), at('Zilina'), at('Carriacou'), at('Nukulaelae'), at('Abaiang'), at('La Digue'), at('Kolonia'), at("Vava'u")])
      .toEqual(['PW', 'CK', 'PG', 'KY', 'BH', 'KG', 'BT', 'SK', 'SK', 'GD', 'TV', 'KI', 'SC', 'FM', 'TO'])
    expect(at('Huelga y paro nacional de transportistas')).not.toBe('BT')
    expect(at('O acordo seria assinado amanhã')).not.toBe('BN')
    expect(at('EUA anunciam novas tarifas')).not.toBe('TO')
  })
})
