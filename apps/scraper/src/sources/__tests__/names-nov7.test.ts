/**
 * Stories the map couldn't place on Nov 6 and 7, 2026: Spanish and Portuguese names of countries the place-finder didn't
 * read (country-names-intl.ts), Mexico City and the State of Mexico as Mexican outlets write them (geo.ts), and
 * Paraguay's three national outlets, whose own news names no place (news-rss.ts HOME_PIN_SOURCES). Headlines are real
 * ones of those two days, but for the two marked as written for the test.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'
import { placeFromText } from '../../pipeline/geo'
import { withLocalNames } from '../../pipeline/local-names'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const inLanguage = (text: string, language: string) => placeFromText(withLocalNames(text, language)).countryCode ?? null

describe('Spanish and Portuguese names of countries', () => {
  it('are read', () => {
    expect(inLanguage('Accidente de autobús deja dos muertos en Francia, entre ellos una niña de 7 años', 'es')).toBe('FR')
    expect(inLanguage('Azerbaiyán busca ampliar el intercambio comercial', 'es')).toBe('AZ')
    expect(inLanguage('Elecciones en Suecia: la ultraderecha facilita un gobierno de centroderecha', 'es')).toBe('SE')
    expect(inLanguage('Inglaterra anuncia su lista para el Mundial', 'es')).toBe('GB')
    expect(inLanguage('Cheias no Quénia deixam milhares de desalojados', 'pt')).toBe('KE')
    expect(inLanguage('Junta militar de Mianmar adia eleições', 'pt')).toBe('MM')
  })

  it('but not Francia Márquez (written for the test)', () => {
    expect(inLanguage('Francia Márquez anuncia su candidatura', 'es')).toBeNull()
  })
})

describe('Mexico City and the State of Mexico', () => {
  it('as Mexican outlets write them', () => {
    expect(placeFromText('Incidencia delictiva en Central de Abasto de CDMX baja 8%: SSC; reportan 69 casos en octubre'))
      .toMatchObject({ countryCode: 'MX', name: 'Mexico City' })
    expect(placeFromText('Tormenta y granizo azotan al Edomex; zona de La Marquesa se pinta de blanco'))
      .toMatchObject({ countryCode: 'MX', name: 'State of Mexico' })
  })
})

describe("Paraguay's national outlets", () => {
  it('pin their own news at home', () => {
    expect(inferGeo('Por unanimidad, Congreso destituye a Peña tras colapso de ueno', '', src('la-nacion-py')).countryCode).toBe('PY')
    expect(inferGeo('Santiago Peña destituido: es el primer Presidente echado por unanimidad', '', src('abc-color-py')).countryCode).toBe('PY')
    // its summary's "Colorado" (the governing party; this summary written for the test) had pinned it in Colorado, US
    expect(inferGeo('Cartes ubica a Antonio Barrios en la Vicepresidencia', 'El Partido Colorado definió su candidato.', src('el-nacional-py')).countryCode).toBe('PY')
  })
})
