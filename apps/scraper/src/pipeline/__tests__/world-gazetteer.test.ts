/**
 * The map's towns and provinces from Natural Earth (world-gazetteer.ts, Nov 6, 2026, batch 1: the 72 countries whose
 * largest towns the map knew least). Devon, Nov 6, 5:08 PM: "this should be accurate so when hotspots and everything
 * else is created they're generated accurately". Most headlines are real ones of Nov 6.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../../sources/news-rss'
import { placeFromText } from '../geo'
import { WORLD_TOWNS, HOME_TOWNS } from '../world-gazetteer'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))
const country = (text: string) => placeFromText(text).countryCode ?? null

describe('names that held another place\'s name', () => {
  it('land in their own country', () => {
    expect(country('Earthquake shakes Baja California')).toBe('MX')
    expect(country('Protest in Port-of-Spain')).toBe('TT')
    expect(country('Fire in New Amsterdam, Berbice')).toBe('GY')
    expect(country('Floods in Los Lagos region')).toBe('CL')
    expect(country('Storm in Santiago del Estero')).toBe('AR')
    expect(country('Volcano erupts in East New Britain')).toBe('PG')
    expect(country('Republika Srpska leader defies court')).toBe('BA')
    expect(country('Bandits attack Niger State village')).toBe('NG')
    expect(country('Clashes in Somali Region')).toBe('ET')
    expect(country('Shooting in San Francisco de Macorís')).toBe('DO')
    // and Spanish "los lagos" is the lakes, not Lagos
    expect(country('Los lagos de Palermo se secan')).not.toBe('NG')
  })
})

describe('a name is a whole word in any script', () => {
  it('is not found inside a word with accented letters', () => {
    // all were pinned before: "nica" in "Única", "cesis" in "Arquidiócesis", "bern" in "Sozialgräbern", "tampa" in "štampa"
    expect(at('el-comercio-ec', 'La Licencia Única de Actividades Económicas en Quito cambia').locationName).not.toMatch(/Nīca|Nica/)
    expect(at('14ymedio-cu', 'La Arquidiócesis de Camagüey recibe el segundo envío de ayuda humanitaria').countryCode).not.toBe('LV')
    expect(country('Kritik an Welser Sozialgräbern: Stadt plant Umstellung auf Urnenbestattung')).not.toBe('CH')
    expect(country('V Turčiji zaradi suma vpletenosti v investicijski škandal aretirali nekdanjo ministrico')).not.toBe('KH')
    expect(country('štampa piše o izborima')).not.toBe('US')
  })
})

describe("Natural Earth's towns and provinces", () => {
  it('are read everywhere when the name is theirs alone', () => {
    expect(country('Floods hit Pokhara')).toBe('NP')
    expect(country('Salalah port reopens')).toBe('OM')
    expect(country('Plovdiv mayor arrested')).toBe('BG')
    expect(country('Earthquake near Gyumri')).toBe('AM')
    expect(country('Bus crash near Ulaangom')).toBe('MN')
    expect(at('nation-malawi', 'Norway delegation commends preparatory classes in Salima')).toMatchObject({ countryCode: 'MW', locationName: 'Salima' })
    expect(at('la-diaria-uy', 'El jueves 19 será inaugurada la Zona Franca del Plata en Colonia del Sacramento').countryCode).toBe('UY')
  })

  it('are read as written: a word in lower case is not the town', () => {
    expect(WORLD_TOWNS['Ulaangom']).toBeDefined()
    expect(country('RPF seizes 6 kg of ganja worth ₹3 lakh at Thrissur railway station')).not.toBe('AZ')
  })

  it("keep names that are also words, people, regions or another country's places for their own country's outlets", () => {
    // Jamaica's "Mandeville" and "Kingston", Ireland's "Limerick": their own outlets' towns ...
    expect(HOME_TOWNS.JM?.['Kingston']).toBeDefined()
    expect(at('jamaica-gleaner', 'Fire in Mandeville destroys shop')).toMatchObject({ countryCode: 'JM', locationName: 'Mandeville' })
    expect(at('jamaica-gleaner', 'Murder accused who escaped police custody recaptured in Trelawny')).toMatchObject({ countryCode: 'JM', locationName: 'Trelawny' })
    expect(at('rte-news', 'Man, 18, charged with murder of Limerick grandfather')).toMatchObject({ countryCode: 'IE', locationName: 'Limerick' })
    // also when the headline names only their own country
    expect(at('frontpage-africa', 'Liberia: Lofa County University President Cites Funding, Staffing and Transport Gaps').locationName).toBe('Lofa')
    // ... and nobody else's
    expect(at('bbc-world', 'Shooting in Kingston leaves two dead').countryCode).not.toBe('JM')
    expect(at('pressafrik', 'Santé publique à Médina Yoro Foulah : un taux de prévalence du sida de 1,3 %').countryCode).not.toBe('HN')
    expect(at('balkan-insight', 'Week in Review: Between Hope and Apathy', 'EU and the Western Balkan countries agreed').countryCode).not.toBe('TM')
    expect(at('portal-analitika-me', 'FK Sutjeska: Nema štrajka u klubu, kasni samo septembarska plata').countryCode).not.toBe('MR')
    expect(at('zdg-md', 'Compensații vs. facturi. Cine va primi ajutor la contor și cine nu. De unde bani').countryCode).not.toBe('DO')
  })
})
