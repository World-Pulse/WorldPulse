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

/**
 * Batch 2 (Nov 6, 2026, evening): every other country's towns and provinces. Each case below was a story of the
 * day's 13,761 that the first try of batch 2 put in the wrong place.
 */
describe('batch 2: names that are no place', () => {
  it('reads no abbreviation, code or neighbour\'s name as a place', () => {
    expect(at('bloomberg-markets', 'Airbnb Moves on Revenue; DraftKings Sinks on Forecast Miss | Stock Movers').locationName).not.toBe('Mississippi')
    expect(at('theblock', 'Ark Invest buys more Coinbase as shares plunge 10% in wider market rout').locationName).not.toBe('Arkansas')
    expect(at('cooperativa-cl', 'León XIV se embarcó en Roma con destino a Sudamérica').locationName).not.toBe('Los Ríos')
    expect(at('investing-com-news', 'Hims & Hers stock climbs on direct partnership with Eli Lilly for obesity drug').countryCode).not.toBe('SY')
    expect(at('investing-com-news', 'Northland cuts Terawulf stock price target to $22.50 on market pricing').countryCode).not.toBe('NZ')
    // Natural Earth's Yahoo names: Peru's Puno was also "Callao", Uganda's Ntoroko "Bundibugyo"
    expect(at('rpp-noticias', 'Callao: asesinan a balazos a dos hombres en la avenida Atalaya')).toMatchObject({ countryCode: 'PE', locationName: 'Callao' })
    expect(at('premium-times-nigeria', 'WHO recommends two new Ebola vaccines for clinical trials as DRC battles Bundibugyo outbreak',
      'He said the Tumaini trial is designed to evaluate vaccine candidates among contacts of people confirmed to have Bundibugyo virus disease.').countryCode).toBe('CD')
  })

  it('tells a person, a gang, a rival club or a filing from a place', () => {
    expect(at('daily-maverick', 'The Honeybadger’s revenge: Former minister Dion George’s nuclear war over SA’s captive lions').locationName).not.toBe('George')
    expect(at('agencia-brasil', 'Cursos populares ajudam mulheres a retomar estudos para o Enem',
      'No caso de Zélia José dos Santos, de 72 anos, esse sonho não ficou para trás').locationName).not.toBe('Santos')
    expect(at('tela-non-st', 'A geração que sonha com a partida',
      'Formada em Ciências Farmacêuticas, Evanilde Espírito Santo concluiu os estudos em Portugal').countryCode).not.toBe('BR')
    expect(at('el-universo-ec', 'EE. UU. da 50 millones de dólares por estos tres líderes del Tren de Aragua').countryCode).not.toBe('VE')
    expect(at('yabiladi', 'Le PSG accorde une pause à Hakimi avant qu’il ne rejoigne les Lions de l’Atlas',
      'Achraf Hakimi sera absent du match de Ligue 1 contre Troyes, prévu samedi.').countryCode).not.toBe('FR')
    expect(at('allafrica', "Malawi: 'Ngora Has No Power to Deregister HRDC' - Activist Slams Watchdog").countryCode).toBe('MW')
    expect(at('eldiarioar', 'Para Lula, su triunfo electoral en Brasil y la derrota de Trump en EE.UU. son "una señal"').locationName).not.toBe('Pará')
  })
})

describe('batch 2: towns read when their country is named', () => {
  it("reads a town that shares its name, in any outlet, when the text names its country", () => {
    expect(at('bbc-world', 'Floods hit Rosario, Argentina')).toMatchObject({ countryCode: 'AR', locationName: 'Rosario' })
    expect(at('uk-fcdo', 'UK travel advice for Kenya updated: FCDO now advises against all but essential travel to Moyale').locationName).toBe('Moyale')
    // ...but not a country's name, or a first name
    expect(at('ouestaf-news', 'Nigeria : plus de 66 000 personnes se sont réfugiées au Niger et au Bénin').countryCode).toBe('NE')
    expect(at('japan-times', 'Vladimir Putin calls out nations opposing Russia’s return to international sport').locationName).not.toBe('Vladimir')
  })

  it('places the provinces and towns batch 2 added', () => {
    expect(country('Fresh fighting erupts in South Kivu')).toBe('CD')
    expect(country('Russia attacks energy infrastructure in Kirovohrad region')).toBe('UA')
    expect(country('Drone strike sets fire to refinery in Syzran')).toBe('RU')
    expect(country('Intempéries en Corse-du-Sud : deux personnes retrouvées mortes')).toBe('FR')
    expect(at('el-universal-mx', 'PAN designa a su coordinador en Sonora rumbo a 2027').locationName).toBe('Sonora')
    expect(country('Extorsión policial en Anzoátegui')).toBe('VE')
    expect(country('Dias do Jazz nas Caldas da Rainha')).toBe('PT')
    expect(at('rpp-noticias', 'Una joven falleció en choque entre un mototaxi y un automóvil en San Martín de Porres').locationName).toBe('San Martín de Porres')
  })
})
