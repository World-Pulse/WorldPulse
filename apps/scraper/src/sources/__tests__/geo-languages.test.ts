/**
 * Places in French, Spanish and Portuguese (round 5, Oct 21, 2026): the
 * place-finder knew countries by their English names only, so 91 of 119
 * names in those languages placed nothing ("Sénégal", "États-Unis",
 * "Moçambique"), and the feeds in those languages get no home pin. Also a
 * Brazzaville outlet's bare "Congo" and a Mauritian outlet's "Maurice".
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { mentionedCountries, withHomeNames, countryPin } = await import('../../pipeline/geo')
const { INTL_COUNTRY_NAMES } = await import('../../pipeline/country-names-intl')

const names = (text: string) => mentionedCountries(text)
const outlet = (countryCode: string) => ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode }) as never

describe('country names in French, Spanish and Portuguese', () => {
  const cases: Array<[string, string]> = [
    ['Sénégal', 'SN'], ['Algérie', 'DZ'], ['Maroc', 'MA'], ['Mauritanie', 'MR'], ['Tunisie', 'TN'], ['Libye', 'LY'],
    ['Égypte', 'EG'], ['Tchad', 'TD'], ['Cameroun', 'CM'], ['Bénin', 'BJ'], ['Libéria', 'LR'], ['Gambie', 'GM'],
    ['Éthiopie', 'ET'], ['Érythrée', 'ER'], ['Somalie', 'SO'], ['Ouganda', 'UG'], ['Tanzanie', 'TZ'], ['Zambie', 'ZM'],
    ['Namibie', 'NA'], ['Afrique du Sud', 'ZA'], ['Nigéria', 'NG'], ['Centrafrique', 'CF'], ['Cap-Vert', 'CV'],
    ['Haïti', 'HT'], ['Nouvelle-Calédonie', 'NC'], ['Liban', 'LB'], ['Syrie', 'SY'], ['Irak', 'IQ'], ['Israël', 'IL'],
    ['Arabie saoudite', 'SA'], ['Turquie', 'TR'], ['Allemagne', 'DE'], ['Espagne', 'ES'], ['États-Unis', 'US'],
    ['Royaume-Uni', 'GB'], ['Chine', 'CN'], ['Russie', 'RU'], ['Belgique', 'BE'], ['Suisse', 'CH'], ['Italie', 'IT'],
    ['Grèce', 'GR'], ['Japon', 'JP'], ['Inde', 'IN'], ['Brésil', 'BR'], ['Mexique', 'MX'], ['Pologne', 'PL'],
    ['Corée du Nord', 'KP'], ['Indonésie', 'ID'], ['Pérou', 'PE'],
    ['España', 'ES'], ['Alemania', 'DE'], ['Rusia', 'RU'], ['Reino Unido', 'GB'], ['México', 'MX'], ['Perú', 'PE'],
    ['Haití', 'HT'], ['República Dominicana', 'DO'], ['Panamá', 'PA'], ['Estados Unidos', 'US'], ['EE.UU.', 'US'], ['Japón', 'JP'],
    ['Moçambique', 'MZ'], ['Brasil', 'BR'], ['Espanha', 'ES'], ['Alemanha', 'DE'], ['Rússia', 'RU'], ['França', 'FR'],
  ]
  it.each(cases)('%s is %s', (name, code) => {
    expect(names(`Actualités : ${name} aujourd'hui`)).toContain(code)
  })

  it('reads demonyms in French', () => {
    expect(names('Le président sénégalais reçoit son homologue malien')).toEqual(['SN', 'ML'])
    expect(names("L'armée burkinabè annonce un bilan")).toEqual(['BF'])
    expect(names('Les autorités nigériennes ferment la frontière')).toEqual(['NE'])   // Niger, not Nigeria
  })

  it('tells the Guineas apart', () => {
    expect(names('Élection en Guinée')).toEqual(['GN'])
    expect(names('Guinée-Bissau : le président dissout le parlement')).toEqual(['GW'])
    expect(names('Guiné-Bissau: eleições adiadas')).toEqual(['GW'])
    expect(names('La Guinée équatoriale signe un accord')).toEqual(['GQ'])
    expect(names('Un ministre équato-guinéen limogé')).toEqual(['GQ'])
    expect(names('Papouasie-Nouvelle-Guinée : séisme')).toEqual(['PG'])
  })

  it('tells the Sudans and the Congos apart', () => {
    expect(names('Combats au Soudan')).toEqual(['SD'])
    expect(names('Le Soudan du Sud reporte les élections')).toEqual(['SS'])
    expect(names('République du Congo : la présidentielle fixée')).toEqual(['CG'])
    expect(names('República del Congo: elecciones')).toEqual(['CG'])
    expect(names('RDC : nouveaux combats près de Goma')).toEqual(['CD'])
    expect(names('République démocratique du Congo : bilan')).toEqual(['CD'])
  })

  it("leaves English text and everyday words alone", () => {
    expect(names('Maurice Tillet wins the award')).toEqual([])
    expect(names('Real Madrid gana la liga')).toEqual([])
    expect(names('Francia Márquez visits Cali')).not.toContain('FR')
    expect(names('New Mexico governor signs the bill')).not.toContain('MX')
    expect(names('Nuevo México aprueba la ley')).not.toContain('MX')
    expect(names("South Sudan's army retakes the town")).toEqual(['SS'])
    expect(names('English is the lingua franca of the talks')).toEqual([])
  })

  it('names only countries that have a map point', () => {
    for (const [, code] of INTL_COUNTRY_NAMES) expect(countryPin(code), code).not.toBeNull()
  })
})

describe("an outlet's own country at home", () => {
  it("reads a Brazzaville outlet's bare Congo as the Republic of the Congo", () => {
    expect(names(withHomeNames('Congo/Elections : le vote fixé au 22 mars', 'CG'))).toEqual(['CG'])
    expect(inferGeo('Le Congo adhère à l’Atidi', '', outlet('CG')).countryCode).toBe('CG')
    // ...but not when the text names the other Congo
    expect(names(withHomeNames('Le Congo et la RDC signent un accord', 'CG'))).toContain('CD')
    // ...and only for Brazzaville outlets
    expect(inferGeo('Congo : combats dans le Nord-Kivu', '', outlet('CD')).countryCode).toBe('CD')
  })

  it("reads a Mauritian outlet's Maurice as Mauritius", () => {
    expect(inferGeo('Maurice : le budget adopté', '', outlet('MU')).countryCode).toBe('MU')
    expect(names(withHomeNames('Maurice : le budget adopté', 'FR'))).toEqual([])
    expect(names("Sommet à l'île Maurice")).toEqual(['MU'])
  })
})
