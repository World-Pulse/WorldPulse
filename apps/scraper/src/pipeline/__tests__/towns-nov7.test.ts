/**
 * Towns two days' stories named (Nov 6 and 7, 2026) that the map didn't know (scripts/places/make_gazetteer.py
 * EXTRA_PLACES, part 7): read where the same rules say, everywhere or by their own country's outlets only. Headlines
 * are real ones of those two days, but for the one marked as written for the test.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../../sources/news-rss'
import { placeFromText, homePlaceFromText } from '../geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string) => inferGeo(title, '', src(id)).locationName

describe('towns the map lacked', () => {
  it('are read everywhere when nothing else is called so', () => {
    expect(placeFromText('BRTC bus goes up in flames in Khagrachhari')).toMatchObject({ countryCode: 'BD', name: 'Khagrachhari' })
    expect(placeFromText('Changuinola sustituye desfile del 10 de noviembre por colecta para familias')).toMatchObject({ countryCode: 'PA' })
    expect(placeFromText('Annual flamenco festival makes welcome return to Benalmádena')).toMatchObject({ countryCode: 'ES' })
    expect(placeFromText('President Ilham Aliyev attended reopening of Khankendi Stadium')).toMatchObject({ countryCode: 'AZ', name: 'Khankendi' })
  })

  it("and by their own country's outlets when they are words or other places' names too", () => {
    expect(homePlaceFromText('Salud de Puente Alto mantiene paro hasta contar con resguardo policial', 'CL')?.name).toBe('Puente Alto')
    expect(homePlaceFromText("Drame maritime à Kébémer : le bilan s'alourdit à sept morts", 'SN')?.name).toBe('Kébémer')
    expect(at('7news-belize', 'Police Report Ten Arrests, Gun and Drug Seizures in San Pedro Police Raids')).toBe('San Pedro')
    expect(at('kleine-zeitung-at', 'Babys aus den Bezirken Leibnitz und Deutschlandsberg')).toBe('Leibnitz')
    // ...not by another's (written for the test)
    expect(placeFromText('Fire destroys homes in San Pedro').countryCode).not.toBe('BZ')
  })
})
