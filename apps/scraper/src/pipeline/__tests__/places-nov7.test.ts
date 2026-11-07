/**
 * Places Natural Earth lacks (scripts/places/make_gazetteer.py's EXTRA_PLACES), found on Nov 7, 2026 in two days'
 * stories the map couldn't place: Kenya's counties, Nepal's new provinces and some districts, Kerala's districts and its
 * new name, Thane and Howrah, towns of the news; Nigeria's "Plateau" for its own outlets; and French names of countries
 * and US states. Headlines are real ones of Nov 6 and 7.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../../sources/news-rss'
import { placeFromText, homePlaceFromText } from '../geo'
import { withLocalNames } from '../local-names'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const country = (text: string) => placeFromText(text).countryCode ?? null
const inLanguage = (text: string, language: string) => placeFromText(withLocalNames(text, language)).countryCode ?? null

describe('places Natural Earth lacks', () => {
  it("Kenya's counties", () => {
    expect(placeFromText('Orengo Condemns Attack on Kalonzo’s Team in Migori')).toMatchObject({ countryCode: 'KE', name: 'Migori' })
    expect(country('West Pokot Assembly Speaker Among Nine Charged Over Sh260mn SACCO Loss')).toBe('KE')
    expect(country("Horror as woman's body found stuffed in sack at Sasumua Dam in Nyandarua")).toBe('KE')
    expect(country("Floods cut roads in Murang'a and Uasin Gishu")).toBe('KE')
    // Busia is Uganda's too: Kenya's outlets read their own
    expect(homePlaceFromText('Traders protest in Busia', 'KE')?.countryCode).toBe('KE')
  })

  it("Nepal's provinces and districts, Kerala's, India's cities", () => {
    expect(country('NCP ministers prepare to resign from Madhesh government')).toBe('NP')
    expect(country('4.2-magnitude earthquake hits Humla')).toBe('NP')
    expect(country('Land ownership certificates distributed to 17 families in Chitwan')).toBe('NP')
    expect(placeFromText('Number of polling stations in Keralam increases by 216')).toMatchObject({ countryCode: 'IN', name: 'Keralam' })
    expect(placeFromText('RPF seizes 6 kg of ganja worth ₹3 lakh at Thrissur railway station').name).toBe('Thrissur')
    expect(placeFromText('Maoist with ₹10 Lakh Bounty Arrested in Thane').name).toBe('Thane')
    expect(country('Fire at a factory in Howrah')).toBe('IN')
  })

  it('towns of the news', () => {
    expect(country('Trump confirms new US strikes on Iran’s Qeshm Island')).toBe('IR')
    expect(country('Three bodies found in Teknaf hills amid ongoing joint operation')).toBe('BD')
    expect(country('Najib returns to Kajang Prison after AGC calls for house arrest deferment')).toBe('MY')
    expect(country('Russia Used Oleshky Truce to Reinforce Front')).toBe('UA')
    expect(country('Suspected "Shahed" Drone Found on Bulgarian Beach Near Shabla')).toBe('BG')
    expect(country('UN Warns of Rising Security Risks in Abyei')).toBe('SD')
    expect(country('Streets packed with cars as residents meet with President Japarov in Sokuluk')).toBe('KG')
    expect(country('Environment Minister Pledges Probe Into Toxic Metal Discovery In Grand Bahama')).toBe('BS')
  })
})

describe("a Nigerian outlet's Plateau", () => {
  it('is Plateau State', () => {
    expect(inferGeo('Soldiers rescue three abducted women in Plateau', '', src('punch-nigeria'))).toMatchObject({ countryCode: 'NG', locationName: 'Plateau' })
    expect(country('Bitcoin prices plateau after the rally')).toBeNull()
  })
})

describe('French names of countries and US states', () => {
  it('are read in French stories', () => {
    expect(inLanguage('Décès à 52 ans du réalisateur chilien oscarisé Sebastián Lelio, au Chili', 'fr')).toBe('CL')
    expect(inLanguage('Le père de Meghan Markle arrêté en Floride', 'fr')).toBe('US')
    expect(inLanguage('Le gouverneur de Californie commue les peines', 'fr')).toBe('US')
    expect(inLanguage('Élections au Salvador : Bukele réélu', 'fr')).toBe('SV')
    expect(inLanguage('La Suède invoque la menace russe', 'fr')).toBe('SE')
  })
})
