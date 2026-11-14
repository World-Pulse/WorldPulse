/**
 * The first weekly accuracy read (Nov 14, 2026): 200 verified stories graded by hand, 26 misplaced or without a pin.
 * These are the ones the rules now place, by the headline each outlet ran, and the ones that must stay where they were.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo, NEWS_SOURCE_REGISTRY } = await import('../news-rss')
const { placeFromText, withoutNonPlaceNames, withoutSiteSuffix } = await import('../../pipeline/geo')

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no source ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))
/** The place a headline with no outlet names (the GDELT path's first read) */
const named = (title: string) => placeFromText(withoutNonPlaceNames(withoutSiteSuffix(title), '')[0])

describe('a country named in passing is not the place', () => {
  it('an airline: Montenegro\'s fans turned away by Air Serbia are in Montenegro', () => {
    expect(at('dan-me', 'Terzić: Sramotan potez Er Srbije, navijači diskriminisani na nacionalnoj osnovi',
      'Sramotan potez Er Srbije i njenog pilota, navijači diskriminisani na nacionalnoj osnovi, kazao je Filip Terzić').countryCode).not.toBe('RS')
    expect(at('rtnk-me', 'Er Srbija: Odluka o neukrcavanju putnika donijeta iz bezbjednosnih razloga').countryCode).toBe('ME')
    expect(named('Air India crash in Ahmedabad kills dozens').name).toBe('Ahmedabad')
  })
  it('a side taken', () => {
    expect(named("Actor Nathaniel Buzolic Claims Former 'Vampire Diaries' Co-Star Is Sabotaging His Career for Being Pro-Israel").countryCode ?? null).toBeNull()
    expect(named('Pro-Russian forces shell Kharkiv overnight').countryCode).toBe('UA')
    expect(named('Anti-Japan protests spread across China').countryCode).toBe('CN')
  })
  it('where something heads, but not whom it is against', () => {
    expect(named('Sheinbaum Says No Migrant Caravan Is Moving Toward U.S. Border').countryCode ?? null).toBeNull()
    expect(named('Thousands march in Madrid against Israel').countryCode).toBe('ES')
    expect(named('WBC Maintains Sanctions Against Belarusian Boxers').countryCode).toBe('BY')
  })
  it('a trip not yet made', () => {
    expect(named('RSP lawmakers hold discussion with party president ahead of China visit').countryCode ?? null).toBeNull()
  })
  it('leaves a place the story is in', () => {
    expect(named('Trump visits China for trade talks').countryCode).toBe('CN')
    expect(named('Protests in Israel against the government enter third week').countryCode).toBe('IL')
    expect(named('Floods in Serbia leave thousands without power').countryCode).toBe('RS')
  })
})

describe('the site\'s own name after a bar', () => {
  it('is not read as a place', () => {
    expect(named('Pope stops at former diocese in Peru visit | Arkansas Democrat Gazette').countryCode).toBe('PE')
    expect(withoutSiteSuffix('Microsoft says services fully restored after global disruption - National | Globalnews.ca')).toBe('Microsoft says services fully restored after global disruption - National')
    expect(withoutSiteSuffix('Budget 2027 | What it means for farmers in Punjab | The long read of the week and its many, many parts and words, more than sixty')).toContain('Punjab')
  })
})

describe('Okinawa', () => {
  it('is its own place, not Tokyo or Washington', () => {
    for (const t of ["US Air Force captain arrested in Japan's Okinawa for alleged drunk driving", 'U.S. Air Force captain arrested in Okinawa for alleged drunk driving']) {
      const g = named(t)
      expect(g.name).toBe('Okinawa')
      expect(g.countryCode).toBe('JP')
    }
  })
})

describe('an institution names the place', () => {
  it('COP31 is in Antalya, whoever stayed away', () => {
    expect(at('punch-nigeria', 'Democrats pledge climate action at COP31 despite Trump’s absence').countryCode).toBe('TR')
  })
  it('the FAA is the United States, not the outlet\'s home', () => {
    expect(at('nation-news-bb', 'FAA orders nationwide ground stop for all flights',
      'The US Federal Aviation Administration has issued a nationwide ground stop for all departing flights this evening').countryCode).toBe('US')
  })
})

describe('a result between two national sides', () => {
  it('is where the summary says it was played', () => {
    expect(at('punch-nigeria', 'Japan stun Brazil 3-2 despite Vinicius brace',
      'Japan defeated five-time world champions Brazil 3–2 in an international friendly in Singapore on Saturday.').countryCode).toBe('SG')
  })
  it('stays with the side named first when the summary names no ground', () => {
    expect(at('punch-nigeria', 'Argentina beat Uruguay 2-1 in first game since Messi retirement',
      'Argentina won 2-1 at home on Friday in their first game since Lionel Messi retired.').countryCode).toBe('AR')
  })
})

describe('what must stay as it was', () => {
  it('a summary that names a place abroad still places a story whose headline names none', () => {
    expect(at('el-diario-bo', 'Fiscalía acusa a Peña de asociación criminal',
      'La Fiscalía de Paraguay acusó ayer por asociación criminal al expresidente Santiago Peña').countryCode).toBe('PY')
  })
  it('a worldwide outage gets no pin, in Spanish too', () => {
    expect(at('el-universal-mx', 'Microsoft restablece por completo su servicio tras caída global; reporta actualizaciones y pide disculpas').lat).toBeNull()
  })
  it('an outlet off the home list is not sent home (Dan carries world, celebrity and sport)', () => {
    expect(at('dan-me', 'Mugoša: Troškovi života svakodnevno rastu, veliki broj građana u problemima').lat).toBeNull()
    expect(at('yahoo-news-world', 'Scientists puzzled by a signal nobody can explain').lat).toBeNull()
  })
})
