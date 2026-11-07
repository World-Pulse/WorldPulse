/**
 * Place-finding accuracy, Nov 6, 2026, evening (Devon: "just focus on more coverage and better accuracy"). A hand check
 * of 120 random stories placed at a spot found 5 wrong and 6 doubtful; each case below is one of them, or a story of
 * the same day's 13,761 that the fixes for them moved. Headlines are real ones of Nov 6.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../../sources/news-rss'
import { placeFromText, findGazetteerPlace } from '../geo'
import { withLocalNames } from '../local-names'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))
const country = (text: string) => placeFromText(text).countryCode ?? null
const inLanguage = (text: string, language: string) => placeFromText(withLocalNames(text, language)).countryCode ?? null

describe('a hand-kept name that is also an everyday word is read only as written', () => {
  it('is not found in lower case', () => {
    expect(country('La Met Gala presenta un nuevo tema tras la controversia con Galliano')).not.toBe('GH')   // Tema
    expect(country('Želimo da budemo prvi i puno toga naučimo')).not.toBe('PE')                          // Puno
    expect(country('Mburret me 85 mijë vende pune, ndërsa mbi 250 mijë qytetarë')).not.toBe('IN')         // Pune
    expect(country('Polícia diz que os suspeitos mataram o homem à beira da estrada')).toBeNull()       // Mataram, Beira
    expect(country('El presidente decidió dar el paso')).not.toBe('US')                                 // El Paso
    expect(country('The port said in a statement that ships were waiting')).not.toBe('EG')              // Port Said
    expect(country('Le détroit d’Ormuz reste fermé')).not.toBe('US')                                    // Detroit
  })

  it('is found with its capital, and in capitals only in a dateline', () => {
    expect(country('Floods in Tema port')).toBe('GH')
    expect(country('CARACAS, Venezuela (AP) — Opposition leaders met on Friday')).toBe('VE')
    expect(at('nst-malaysia', 'Scarlett Johansson on her role', 'LOS ANGELES: Scarlett Johansson might be used to superhero films').countryCode).toBe('US')
    expect(country('Gates Foundation faces reckoning over AGRA')).not.toBe('IN')
  })
})

describe('a name written without accents is read with them', () => {
  it('finds the place and shows it as the story writes it', () => {
    expect(placeFromText('Una riña entre detenidos en una unidad judicial de Bogotá deja un muerto')).toMatchObject({ countryCode: 'CO', name: 'Bogotá' })
    expect(country('Lluvias en São Paulo')).toBe('BR')
    expect(country('Un Tunisien jugé à Montréal pour avoir tué sa femme')).toBe('CA')
  })

  it('but not inside a person\'s name, nor ñ for n', () => {
    expect(at('el-dia-do', 'Fallece Aleida Sofía Silvestre Sosa, esposa del juez de la Suprema Corte').countryCode).not.toBe('BG')
    expect(at('el-universal-mx', 'Frida Sofía niega que Alejandra Guzmán la haya visitado').countryCode).not.toBe('BG')
    expect(at('ahora-eg-gq', 'Hallan sin vida a Octavio Ondó Oyono Angono tras dos días de búsqueda en Bata').countryCode).toBe('GQ')
    expect(at('tvn-panama', 'Grietas y hundimiento ponen en riesgo a usuarios de la vía hacia Hato Montaña').countryCode).not.toBe('US')
  })
})

describe("world cities in the feeds' languages", () => {
  it('reads French, Spanish, Portuguese, Italian and German names', () => {
    expect(inLanguage('Luis Gnecco llegaría a Londres como agregado cultural', 'es')).toBe('GB')
    expect(inLanguage('Moscou saisit les actifs russes de Japan Tobacco', 'fr')).toBe('RU')
    expect(inLanguage('Gabon-Chine : à Pékin, Oligui Nguema ouvre la chasse aux investissements', 'fr')).toBe('CN')
    expect(inLanguage('Manifestantes invadem centro de dados em Amesterdão', 'pt')).toBe('NL')
    expect(inLanguage('Mais dois navios em chamas no Estreito de Ormuz', 'pt')).toBe('IR')
    expect(inLanguage('Vertice a Lisbona sulla difesa europea', 'it')).toBe('PT')
    expect(inLanguage('Shopping-Trip nach Mailand für 2 Personen gewinnen', 'de')).toBe('IT')
  })

  it('leaves a figure of speech and a neighbourhood alone', () => {
    expect(at('kleine-zeitung-at', '„Ein magisches Mekka“: Grazer Bar unter Europas Top 111 gelistet').countryCode).not.toBe('SA')
    expect(at('el-universal-mx', '5 actividades para este fin de semana en la Roma y la Condesa').countryCode).not.toBe('IT')
  })
})

describe("an outlet's own town of the same name", () => {
  it('comes before another country\'s, unless the text names that country', () => {
    expect(at('tvn-panama', 'MOP acondiciona espacio provisional para los bomberos de Santiago tras daños').countryCode).toBe('PA')
    expect(at('jamaica-gleaner', 'Distraction danger - Custos of Manchester urges Scouts movement to rethink youth').countryCode).toBe('JM')
    expect(at('el-dia-do', 'Muere en Santiago el cineasta Sebastián Lelio, orgullo de Chile').countryCode).toBe('CL')
  })
})

describe('benchmarks, an exchange, a company and the straits', () => {
  it('are no towns', () => {
    expect(country('West Texas Intermediate was trading at $91.24 per barrel')).not.toBe('US')
    expect(country('Brent crude rose 1.6 percent')).not.toBe('GB')
    expect(country('AngloGold Ashanti plans US$900m mine expansion')).not.toBe('GH')
    expect(at('nst-malaysia', 'Oil price slide hits Bursa energy stocks').countryCode).toBe('MY')
    expect(country('Bursa Malaysia closes higher')).not.toBe('TR')
    expect(country('Earthquake shakes Bursa')).toBe('TR')
  })

  it('places the straits in the news', () => {
    expect(placeFromText('Two tankers strike mines in Strait of Hormuz: IRGC Navy')).toMatchObject({ countryCode: 'IR', name: 'Strait of Hormuz' })
    expect(placeFromText('Bab al-Mandab ship traffic shows signs of recovery')).toMatchObject({ countryCode: 'YE', name: 'Bab el-Mandeb' })
    expect(findGazetteerPlace('Drone attack near the Kerch bridge')?.coords.country).toBe('UA')
  })
})
