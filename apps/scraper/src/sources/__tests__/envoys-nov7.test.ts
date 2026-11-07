/**
 * An embassy, an ambassador or an envoy is where the story says it is, not in its own country (geo.ts
 * withoutEnvoyCountries; Nov 7, 2026: of two days' 114 headlines about envoys, 25 sat in the envoy's country).
 * Headlines are real ones of Nov 6 and 7, but for the two marked as written for the test.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'
import { withoutEnvoyCountries } from '../../pipeline/geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const country = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id)).countryCode

describe("an envoy's own country", () => {
  it('is not where the story is', () => {
    expect(country('nile-post-ug', 'Chinese Embassy Pledges More Support for Vulnerable Communities')).toBe('UG')
    expect(country('myjoyonline-gh', 'US Embassy explains how Ghanaians can secure emergency visa interviews')).toBe('GH')
    expect(country('khabarhub-en', 'South Korean Ambassador pays courtesy call on President Paudel')).toBe('NP')
    expect(country('shabait-er', 'President Isaias Afwerki Meets Chinese Special Envoy')).toBe('ER')
    expect(country('euronews-albania', 'President Begaj meets Ohad Kaynar, Accepts Credentials of Israel’s New Ambassador')).toBe('AL')
    expect(country('el-pulso-hn', 'Presidente del Congreso y funcionarios de embajada de EEUU abordan prioridades compartidas')).toBe('HN')
  })

  it('so the place the text names is read', () => {
    expect(country('euronews-albania', 'Dutch Ambassador to Albania: Media Freedom Requires Attention, Violence at Protests Has Shocked Us')).toBe('AL')
    expect(country('3news-gh', 'Ghana’s Ambassador to the US Victor Smith narrates how his son is bullied in the US')).toBe('US')
    expect(country('sknis-kn', 'Embassy of Saint Kitts and Nevis Thanks Taichung City Government’s Cultural Bureau for Historic Participation')).toBe('TW')
    expect(country('maldives-voice-mv', 'Maldives’ new ambassador to Viet Nam presents credentials')).toBe('VN')
    expect(inferGeo('Chinese consulate in Melbourne demands justice after fatal stabbing of delivery worker', '', src('scmp-world')))
      .toMatchObject({ countryCode: 'AU', locationName: 'Melbourne' })
    expect(country('azertac-en', 'Azerbaijani Embassy in Tajikistan marks Victory Day')).toBe('TJ')
    expect(country('kyiv-independent', "Trump meets Russian envoy in Washington ahead of Ukraine peace talks, claims 'big, beautiful agreement' coming")).toBe('US')
  })

  it('is blanked only before or after the word for an envoy', () => {
    expect(withoutEnvoyCountries('L’ambassade du Royaume-Uni à Djibouti, célèbre le 78e anniversaire du roi Charles III'))
      .toBe('L’ambassade du             à Djibouti, célèbre le 78e anniversaire du roi Charles III')
    expect(withoutEnvoyCountries('Embajada de Japón celebrará este domingo el festival')).not.toMatch(/Japón/)
    // an envoy for a country, a country before a comma, and "Election Commission of India" are left as written
    // (the first two written for the test)
    for (const text of ["Trump's Ukraine envoy Kellogg says talks are moving", 'Flights to Lebanon suspended, embassy says',
      'Election Commission of India announces dates']) expect(withoutEnvoyCountries(text)).toBe(text)
  })
})
