/**
 * Nov 7, 2026 (part 9): Kraków in Spanish, Portuguese, French, Italian, German and Montenegrin ("Cracovia", "Krakova")
 * and Istanbul's "u Istanbulu" had fallen back to the country's capital or Ankara. Headlines are real ones of Nov 7.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))

describe("Kraków under other languages' names", () => {
  it('is Krakow, not Warsaw', () => {
    expect(at('los-tiempos-bo', 'Polonia: tiroteo en la Plaza Mayor de Cracovia deja cinco muertos'))
      .toMatchObject({ countryCode: 'PL', locationName: 'Krakow' })
    expect(at('aktuelno-me', 'Poljska: U domu napadača iz Krakova pronađene tri mrtve osobe'))
      .toMatchObject({ countryCode: 'PL', locationName: 'Krakow' })
  })
})

describe('Istanbul in a Montenegrin sentence', () => {
  it('is Istanbul, not Ankara', () => {
    expect(at('aktuelno-me', 'Crnogorski karatisti osvojili sedam medalja u Istanbulu'))
      .toMatchObject({ countryCode: 'TR', locationName: 'Istanbul' })
  })
})
