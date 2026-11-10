/**
 * What a hand check of 120 random stories found on Nov 8, 2026 (part 12): a title's place ("Duchess of Edinburgh"), a
 * place joined to who backs, flags or is based somewhere ("Pakistan-based group", "Liberia-flagged tanker"), a pest
 * read as Prague, a Panamanian market read as Somalia's Merca, a foreign league pinned at an Arabic outlet's home, and
 * names the reader didn't know (Batam, Lausanne in Italian, North Macedonia's towns in Albanian, Lima's districts).
 * Headlines are real ones of Nov 7 and 8, but for the made-up checks of each rule.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'
import { withoutNonPlaceNames } from '../../pipeline/geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))

describe("a title's place", () => {
  it('is not where the story is', () => {
    expect(at('dhaka-tribune', 'Duchess of Edinburgh due Monday', 'She previously visited Bangladesh in 2017 Details').countryCode).toBe('BD')
    expect(at('bdnews24', 'Duchess of Edinburgh to visit Bangladesh').countryCode).toBe('BD')
    expect(at('bbc-world', 'Duke of Edinburgh Award ceremony held in Kampala')).toMatchObject({ countryCode: 'UG', locationName: 'Kampala' })
  })
})

describe('a place joined to who backs, leads, flags or made something', () => {
  it('gives way to the place the text names, or to none', () => {
    expect(at('bbc-world', 'Liberia-flagged tanker struck off Yemen coast').countryCode).toBe('YE')
    expect(at('bbc-world', 'Iran-backed Houthis attack ship in Red Sea').countryCode).not.toBe('IR')
    expect(at('bbc-world', 'Saudi-led coalition strikes Sanaa')).toMatchObject({ countryCode: 'YE', locationName: 'Sanaa' })
    expect(at('forbes-money', 'Netflix Surfs Oscar Animated Feature Race With French-Made ‘In Waves’').countryCode).not.toBe('FR')
  })

  it("but a person's name is not a place: Trump-backed, Modi-led", () => {
    expect(at('oilprice-com', 'Trump-Backed Trade Corridor Advances Despite Geopolitical Resistance').countryCode).toBe('US')
    expect(at('bbc-world', 'Modi-led government cuts fuel tax').countryCode).toBe('IN')
  })
})

describe('where someone is from or something is based', () => {
  it('gives way to another place the headline or the summary names', () => {
    expect(at('le360-en', 'Who is Gadi Eisenkot, the Moroccan-born former Israeli army chief chosen to form Israel’s next government?').countryCode).toBe('IL')
    expect(at('bbc-world', 'London-based charity warns of famine', 'The group said children were dying in Darfur')).toMatchObject({ countryCode: 'SD', locationName: 'Darfur' })
    expect(at('bbc-world', 'New York-based group sues over Kenya election').countryCode).toBe('KE')
  })

  it("alone, is abroad only when it is abroad from the outlet's own country", () => {
    expect(at('times-of-india', '‘They lack courage as we are Maharana Pratap descendants’: BJP MLA claims Pakistan-based group threatened to kill him').countryCode).toBe('IN')
    expect(at('jamaica-gleaner', 'Mount Alvernia High principal denies canteen food made students ill', 'The principal of the Montego Bay-based school said')).toMatchObject({ countryCode: 'JM', locationName: 'Montego Bay' })
  })

  it('keeps the text the same length', () => {
    const [head, body] = withoutNonPlaceNames('Liberia-flagged tanker hit', 'A Duchess of Edinburgh visit', 'GB')
    expect(head).toBe('       -flagged tanker hit')
    expect(body).toBe('A Duchess of           visit')
  })
})

describe('words that only look like a place', () => {
  it('are not', () => {
    // Portuguese "praga" is a pest; the city still reads after "em" or before a colon
    expect(at('observador-pt', 'Praga devasta 90% da castanha na Terceira').countryCode).not.toBe('CZ')
    expect(at('observador-pt', 'Cimeira europeia em Praga termina sem acordo').countryCode).toBe('CZ')
    expect(at('tvn-panama', 'Casos de malaria afectan las ventas y reducen la afluencia de compradores en Merca Panamá').countryCode).toBe('PA')
  })
})

describe('a foreign league in an Arabic outlet at home', () => {
  it("is the league's country", () => {
    expect(at('al-watan-sy-ar', 'البايرن ودورتموند يصران على الصدارة في البوندسليغا').countryCode).toBe('DE')
    expect(at('al-watan-sy-ar', 'آرسنال يعزز صدارته للبريميرليغ').countryCode).toBe('GB')
  })
})

describe('names the reader did not know', () => {
  it('are read', () => {
    expect(at('antara-en', 'Malaysian held in Batam over suspected armed robbery', 'Police in Batam, Riau Islands Province, have detained a Malaysian national')).toMatchObject({ countryCode: 'ID', locationName: 'Batam' })
    expect(at('scmp-world', 'Indonesians furious as Batam data centres drain taps').countryCode).toBe('ID')
    expect(at('san-marino-rtv', 'La Federazione Sammarinese all’European Athletics Convention di Losanna')).toMatchObject({ countryCode: 'CH', locationName: 'Lausanne' })
    expect(at('portalb-mk', 'Në Kumanovë u shënua 81-vjetori i Ansamblit “Bajram Shabani” me koncert festiv')).toMatchObject({ countryCode: 'MK', locationName: 'Kumanovo' })
    expect(at('lajmi-net-xk', 'Shqiptarët në Luginën e Preshevës votojnë për Këshillin Kombëtar Shqiptar').countryCode).toBe('RS')
    expect(at('rpp-noticias', 'Comas: bomberos confinan incendio que se produjo en un edificio de siete pisos')).toMatchObject({ countryCode: 'PE', locationName: 'Lima' })
    expect(at('the-hindu-national', 'YSRCP wins key ZPTC seats in Saluru')).toMatchObject({ countryCode: 'IN', locationName: 'Saluru' })
  })
})

describe("a country's people before a person: where someone is from is not where the story is (Nov 9)", () => {
  it('blanks "Chinese agent" but keeps the place a story names', () => {
    const [h] = withoutNonPlaceNames('FBI looks at Nvidia CEO over affair with alleged Chinese agent', '')
    expect(h).not.toMatch(/Chinese/)
    expect(at('bbc-world', 'Chinese nationals kidnapped in Lagos')).toMatchObject({ countryCode: 'NG' })
    expect(at('bbc-world', 'Chinese forces hold drills near Taiwan').countryCode).toBe('CN')
    expect(at('bbc-world', 'Paris tourists stranded as flights cancelled').countryCode).toBe('FR')
  })
})
