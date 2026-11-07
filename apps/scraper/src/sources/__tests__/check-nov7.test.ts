/**
 * What a hand check of 120 random stories found on Nov 7, 2026 (part 8): places read out of people's names, a company
 * read as Modi, "Payo Cubas" read as Cubans, and names the reader didn't know (a Burkinabè outlet's "Bobo", Buenos
 * Aires's Palermo, Qeshm in Arabic, Kyiv in Albanian). Headlines are real ones of Nov 6 and 7.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))

describe('a place right after a common given name is a surname', () => {
  it('so the person is not pinned there', () => {
    expect(at('burkina24', 'Jonathan Gambela : « Dieu vous aime, alors en retour, aimez-le » !',
      'En séjour au Burkina Faso, le chantre et pasteur congolais Jonathan Gambela sera en concert live le dimanche 8 novembre 2026, au Palais des sports de Ouaga 2000.').countryCode).toBe('BF')
    expect(at('libreinfo-bf', 'SIAO 2026 : Issa Belém, l’artisan qui reproduit les animaux de la nature en sculptures').countryCode).not.toBe('BR')
  })

  it("but a saint's town keeps its name", () => {
    expect(at('la-hora-gt', 'Bomberos Voluntarios reportan caída de avioneta en San Juan Sacatepéquez').countryCode).toBe('GT')
  })
})

describe('names that were read as the wrong thing', () => {
  it('are not', () => {
    expect(at('investing-com-news', 'MODIVO Platform Q3 2026 slides: gross margin tops 50%, EBITDA up 48%').countryCode).not.toBe('IN')
    expect(at('el-nacional-py', 'Manifestantes increpan a Payo Cubas y le reprochan haber llevado a Chaqueñito y Zenaida al Congreso').countryCode).toBe('PY')
  })
})

describe('names the reader did not know', () => {
  it('are read', () => {
    expect(at('lefaso-bf', 'Retour des orpailleurs expulsés de Guinée : Une première vague de 3 400 Burkinabè accueillie à Bobo'))
      .toMatchObject({ countryCode: 'BF', locationName: 'Bobo-Dioulasso' })
    expect(at('jo24-ar', 'سقوط صاروخين في جزيرة قشم')).toMatchObject({ countryCode: 'IR', locationName: 'Qeshm' })
    expect(at('balkanweb-al', 'Kievi nën sulmin rus me raketa balistike, dëmtohen pallatet e banimit në kryeqytetin ukrainas'))
      .toMatchObject({ countryCode: 'UA', locationName: 'Kyiv' })
    expect(at('eldiarioar', 'La Marcha del Orgullo sale a la calle después de una escalada de violencia',
      'El ataque a trabajadoras sexuales trans en Palermo marcó la previa de la manifestación.').countryCode).toBe('AR')
  })
})
