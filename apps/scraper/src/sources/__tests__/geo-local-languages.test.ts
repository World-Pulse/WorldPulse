/**
 * Sources round 6 (Oct 31, 2026): every country's capital by name, the two countries no pattern named
 * (Saint Kitts and Nevis, Saint Vincent and the Grenadines), place names in the ten languages the reader
 * added for the 18 countries that had no outlet (local-names.ts), and words that only look like a place.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { mentionedCountries } = await import('../../pipeline/geo')
const { LOCAL_NAMES, withLocalNames } = await import('../../pipeline/local-names')

const outlet = (language: string, countryCode = 'GB') =>
  ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode, language }) as never
const placed = (title: string, language = 'en', countryCode = 'GB') => inferGeo(title, '', outlet(language, countryCode))

describe('capitals by name', () => {
  const cases: Array<[string, string, string]> = [
    ['Thousands protest in Budapest over new media law', 'Budapest', 'HU'],
    ['Prague court jails ex-minister', 'Prague', 'CZ'],
    ['Talks in Zagreb end without deal', 'Zagreb', 'HR'],
    ['Floods hit Sarajevo suburbs', 'Sarajevo', 'BA'],
    ['Bucharest mayor resigns', 'Bucharest', 'RO'],
    ['Sofia airport closed by fog', 'Sofia', 'BG'],
    ['Ljubljana hosts summit', 'Ljubljana', 'SI'],
    ['Podgorica police raid', 'Podgorica', 'ME'],
    ['Pristina and Belgrade agree on energy deal', 'Pristina', 'XK'],
    ['Vaduz bank fined', 'Vaduz', 'LI'],
    ['Nuuk airport opens new runway', 'Nuuk', 'GL'],
    ['Paramaribo flooding', 'Paramaribo', 'SR'],
    ['Bandar Seri Begawan water outage', 'Bandar Seri Begawan', 'BN'],
    ['Majuro king tide', 'Majuro', 'MH'],
    ['Funafuti sea wall', 'Funafuti', 'TV'],
    ['South Tarawa drought', 'Tarawa', 'KI'],
    ['Basseterre shooting', 'Basseterre', 'KN'],
    ['Tunis protest', 'Tunis', 'TN'],
    ['Port of Spain shooting', 'Port of Spain', 'TT'],
    ['New dam for Brasília', 'Brasília', 'BR'],
    ['Lome port strike', 'Lomé', 'TG'],
  ]
  it.each(cases)('%s → %s', (title, name, code) => {
    expect(placed(title)).toMatchObject({ locationName: name, countryCode: code })
  })

  it("reads an Ecuadorian outlet's Santo Domingo as Santo Domingo de los Tsáchilas", () => {
    expect(placed('Cinco muertos en la vía Quinindé – Santo Domingo', 'es', 'EC')).toMatchObject({ locationName: 'Santo Domingo de los Tsáchilas', countryCode: 'EC' })
    expect(placed('Gobierno congela precios en Santo Domingo', 'es', 'DO')).toMatchObject({ locationName: 'Santo Domingo', countryCode: 'DO' })
    expect(placed('Incendio en San Salvador de Jujuy', 'es', 'AR').countryCode).toBe('AR')
  })

  it('leaves out capitals that are mostly other places, names or words', () => {
    for (const title of ['Victoria police charge man', 'Kingston upon Thames council', 'San Jose fire', 'La Paz hurricane warning',
      'Wellington boots sales', 'Praia lotada no feriado', 'Nassau County budget']) {
      expect(['SC', 'JM', 'CR', 'BO', 'NZ', 'CV', 'BS'], title).not.toContain(placed(title).countryCode)
    }
    expect(placed('Sofia Coppola film premieres').countryCode).toBeNull()
  })

  it('names Saint Kitts and Nevis and Saint Vincent, but not St Vincent\'s hospitals', () => {
    expect(mentionedCountries('St Kitts PM calls election')).toEqual(['KN'])
    expect(mentionedCountries('Saint Kitts and Nevis budget')).toEqual(['KN'])
    expect(mentionedCountries('St Vincent volcano alert')).toEqual(['VC'])
    expect(mentionedCountries('Saint Vincent and the Grenadines votes')).toEqual(['VC'])
    expect(mentionedCountries("St Vincent's Hospital strike")).toEqual([])
    expect(mentionedCountries('St Vincent de Paul appeal')).toEqual([])
  })
})

describe('place names in the languages added in round 6', () => {
  const cases: Array<[string, string, string, string]> = [
    // [headline, language, outlet's country, country found]
    ['Österreich und Deutschland einigen sich', 'de', 'AT', 'AT'],
    ['Wien: Brand in Favoriten', 'de', 'AT', 'AT'],
    ['Weißes Haus droht mit Zöllen', 'de', 'AT', 'US'],
    ['Island wählt neues Parlament', 'de', 'LI', 'IS'],
    ['Kanzler reist nach Frankreich', 'de', 'AT', 'FR'],
    ['La Francia vota', 'it', 'SM', 'FR'],
    ['Incidente sulla strada per Rimini', 'it', 'SM', 'IT'],
    ['Vlada Crne Gore i Srbija', 'sr', 'ME', 'ME'],
    ['SAD uvode sankcije Rusiji', 'sr', 'ME', 'US'],
    ['Požar u Nikšiću', 'sr', 'ME', 'ME'],
    ['Kurti takon homologun e Malit të Zi', 'sq', 'XK', 'ME'],
    ['Protestë në Prishtinë', 'sq', 'XK', 'XK'],
    ['SHBA-të paralajmërojnë Serbinë', 'sq', 'XK', 'US'],
    ['Vlada Slovenije in Hrvaška', 'sl', 'SI', 'SI'],
    ['ZDA in Kitajska', 'sl', 'SI', 'US'],
    ['Nesreča v Mariboru', 'sl', 'SI', 'SI'],
    ['Guvernul Republicii Moldova și Rusia', 'ro', 'MD', 'MD'],
    ['Explozie la Bălți', 'ro', 'MD', 'MD'],
    ['SUA trimit ajutor', 'ro', 'MD', 'US'],
    ['Ajutor pentru Ucraina', 'ro', 'MD', 'UA'],
    ['Tiraspolul cere gaz', 'ro', 'MD', 'MD'],
    ['Grønlands regering mødes med Danmark', 'da', 'GL', 'GL'],
    ['Ny lufthavn i Ilulissat', 'da', 'GL', 'GL'],
    ['Nederland stuurt hulp', 'nl', 'SR', 'NL'],
    ['Amerika Syarikat dan Jepun', 'ms', 'BN', 'US'],
    ['Banjir di Kuala Belait', 'ms', 'BN', 'BN'],
    ['Espanya i França', 'ca', 'AD', 'ES'],
    ['Accident a Escaldes-Engordany', 'ca', 'AD', 'AD'],
  ]
  it.each(cases)('%s (%s) is in %s', (title, language, home, code) => {
    expect(placed(title, language, home).countryCode).toBe(code)
  })

  it('reads a word as a place only in its own language', () => {
    // "Francia" is France in Italian, a first name in Spanish (Colombia's vice-president)
    expect(placed('Francia Márquez habla', 'es', 'CO').countryCode).not.toBe('FR')
    // "Island" is Iceland in Danish and German, not in English
    expect(placed('Island ferry delayed', 'en').countryCode).toBeNull()
    expect(withLocalNames('Island og Norge', 'en')).toBe('Island og Norge')
  })

  it('turns every local name into a place the place-finder knows', () => {
    for (const [language, rules] of Object.entries(LOCAL_NAMES)) {
      for (const [pattern, as] of rules) {
        if (as === '…' || as === 'and') continue
        // (a place, a country, or a leader's or institution's seat: "White House", "Kremlin")
        expect(placed(as).countryCode, `${language}: ${pattern.source} → ${as}`).not.toBeNull()
      }
    }
  })
})

describe('words that only look like a place', () => {
  const cases: Array<[string, string]> = [
    ['Il governo usa i fondi per i mali della sanità', 'it'],
    ['In tutti i modi possibili', 'it'],
    ['Mali broj turista ove godine', 'sr'],
    ['Zjarr në mali i Sharrit', 'sq'],
    ['Mali podjetniki se pritožujejo', 'sl'],
    ['El gobierno usa nuevas medidas', 'es'],
    ['Los precios irán subiendo', 'es'],
    ['Receta de chile relleno', 'es'],
    ['Un debate maduro', 'es'],
    ['O preço do peru subiu', 'pt'],
    ['Os juros irão cair', 'pt'],
    ['Trumpf streicht Stellen', 'de'],
    ['Frans-Guyana grens dicht', 'nl'],
  ]
  it.each(cases)('%s (%s) names no place', (title, language) => {
    expect(placed(title, language).countryCode).toBeNull()
  })

  it('still finds the place when it is written as one', () => {
    expect(placed('Elecciones en Chile', 'es', 'PY').countryCode).toBe('CL')
    expect(placed('Irán amenaza a Israel', 'es', 'PY').countryCode).toBe('IR')
    expect(placed('Maduro habla en Caracas', 'es', 'VE').countryCode).toBe('VE')
    expect(placed('Golpe di stato in Mali', 'it', 'SM').countryCode).toBe('ML')
    expect(placed('Gli USA rispondono', 'it', 'SM').countryCode).toBe('US')
    expect(placed('Modi incontra Meloni', 'it', 'SM').countryCode).toBe('IN')
  })
})
