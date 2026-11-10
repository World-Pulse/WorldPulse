/**
 * Sermitsiaq.AG, Greenland's second outlet (Nov 9, 2026; Devon, 10:12 PM: "Check these sources for Greenland"): the
 * last of the four outlets held back on their terms on Nov 6 (Devon: "1 go in anyway"), which waited for its feed's
 * address. In Danish, about 8 in 10 of its stories Greenland's own and the rest world news from the wires, so the
 * reader learned the Danish words those name their places with (local-names.ts). Headlines from its feed on Nov 9.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, skippedLink } = await import('../news-rss')

const src = NEWS_SOURCE_REGISTRY.find(s => s.id === 'sermitsiaq-gl')!
const at = (title: string, description = '') => inferGeo(title, description, src)

describe('Sermitsiaq.AG (Nov 9, 2026)', () => {
  it("is Greenland's second outlet, in Danish, read once", () => {
    expect(src).toMatchObject({ countryCode: 'GL', language: 'da', feedUrl: 'https://www.sermitsiaq.ag/?lab_viewport=rss' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('sermitsiaq.ag'))).toHaveLength(1)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'GL').map(s => s.id).sort()).toEqual(['naalakkersuisut-gl', 'sermitsiaq-gl'])
  })

  it('skips its paid posts', () => {
    expect(skippedLink(src, 'https://www.sermitsiaq.ag/sponsoreret-indhold/nye-bilmaerker-pa-vej-til-gronland/2440912')).toBe(true)
    expect(skippedLink(src, 'https://www.sermitsiaq.ag/samfund/atassut-forlader-koalitionen/2445631')).toBe(false)
  })

  it("pins Greenland's own stories at home, or at the town they name", () => {
    expect(HOME_PIN_SOURCES.has(src.id)).toBe(true)
    expect(at('Atassut forlader koalitionen - Jens-Frederik Nielsen er skuffet', 'Atassut er trådt ud af Naalakkersuisut.'))
      .toMatchObject({ countryCode: 'GL', locationName: 'Nuuk, Greenland' })
    expect(at('Rejegigant mangler at fiske betydelig del af kvote i år').countryCode).toBe('GL')
    expect(at('Rejsende afsløret med kokain', 'Toldere fandt søndag kokain på en rejsende, der kom med fly fra Danmark.').countryCode).toBe('GL')
    expect(at('Ittoqqortoormiit vil ikke følge Vestkystens tidszone').locationName).toBe('Ittoqqortoormiit')
    expect(at('Oleeraq Nielsen er ikke ramt af guldfeberen i Sydgrønland. Han er imod den').countryCode).toBe('GL')
  })

  it('puts its wire stories where they name, in Danish too', () => {
    expect(at('Trump hævder at midtvejsvalg var præget af svindel').countryCode).toBe('US')
    expect(at('Amerikanske aktiemarkeder stabiliserer sig efter store fald').countryCode).toBe('US')
    expect(at('Demokratisk senatskandidat lægger sag an mod Alaskas valgmyndighed').countryCode).toBe('US')
    expect(at('Nvidia-topchef erkender utroskab – Kina afviser mistanke om kinesisk spionage').countryCode).toBe('CN')
    expect(at('Israels regering godkender våbenhvile').countryCode).toBe('IL')
    expect(at('Topmøde i Peking').countryCode).toBe('CN')
  })

  it("keeps Greenland's stories about other countries' people at home", () => {
    // a visit to Greenland is Greenland's ("besøger", visits), as is what happens in it ("i", in)
    expect(at('Amerikanske politikere besøger Grønland').countryCode).toBe('GL')
    expect(at('Kinesisk selskab vil have mine i Sydgrønland').countryCode).toBe('GL')
    expect(at('Amerikansk konsulat i Nuuk udvides').locationName).toBe('Nuuk')
    // an envoy's country is not where the story is
    expect(at('Indisk ambassadør på besøg').countryCode).toBe('GL')
    expect(at('Ny amerikansk konsul').countryCode).toBe('GL')
  })
})
