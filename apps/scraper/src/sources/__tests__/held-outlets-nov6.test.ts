/**
 * The five outlets held back on terms on Nov 5 go in on Devon's call (Nov 6, 2026, 7:34 AM: "go in anyway to all
 * of them"), with LRT's Lithuanian feed beside 15min so its reports have one in the same language to match, and
 * North Press, which turns the server away, parked.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, skippedLink, thinPlaces } from '../news-rss'
import { isSameStory, type CorrelationCandidate } from '../../pipeline/correlate'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const ADDED = ['this-is-beirut-lb', '15min-lt', 'lrt-lt', 'estonian-world-ee', 'spaceflight-now', 'st-vincent-times-vc']

describe('the five held back on terms, and LRT in Lithuanian (Nov 6, 2026)', () => {
  it('are each read once, over https, from their own place and in their own language', () => {
    expect(ADDED.map(id => [src(id).countryCode, src(id).language, src(id).category])).toEqual([
      ['LB', 'en', 'geopolitics'], ['LT', 'lt', 'geopolitics'], ['LT', 'lt', 'geopolitics'],
      ['EE', 'en', 'geopolitics'], ['US', 'en', 'space'], ['VC', 'en', 'geopolitics'],
    ])
    for (const id of ADDED) {
      const s = src(id)
      expect(s.feedUrl, id).toMatch(/^https:\/\//)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.feedUrl === s.feedUrl), id).toHaveLength(1)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.id === id), id).toHaveLength(1)
      expect(s.parked, id).toBeUndefined()
    }
  })

  it('gives Lebanon, Estonia, Lithuania and Saint Vincent a second outlet', () => {
    const hosts = (code: string) => new Set(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === code && !s.parked)
      .map(s => new URL(s.feedUrl).hostname.replace(/^www\./, '')))
    for (const code of ['LB', 'EE', 'LT', 'VC']) expect(hosts(code).size, code).toBe(2)
    // still thinly covered, so their own outlets' reports are matched across two days
    for (const code of ['LB', 'EE', 'LT', 'VC']) expect(thinPlaces().includes(code), code).toBe(true)
  })

  it("reads 15min less its world section, whose places are in Lithuanian", () => {
    const fifteen = src('15min-lt')
    expect(skippedLink(fifteen, 'https://www.15min.lt/naujiena/aktualu/pasaulis/prie-tokijo-krantu-ivyko-6-1-balo-zemes-drebejimas-57-2800321')).toBe(true)
    expect(skippedLink(fifteen, 'https://www.15min.lt/naujiena/aktualu/lietuva/ministras-situacija-lietuvos-pasienyje-56-2800290')).toBe(false)
    expect(skippedLink(fifteen, 'https://www.15min.lt/naujiena/aktualu/nusikaltimaiirnelaimes/kaune-masiskai-59-2800270')).toBe(false)
    expect(skippedLink(fifteen, undefined)).toBe(false)
    // no other feed skips anything
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.skipLinks).map(s => s.id)).toEqual(['15min-lt'])
    expect(skippedLink(src('lrt-lt'), 'https://www.lrt.lt/naujienos/pasaulyje/5/1/x')).toBe(false)
  })

  it('pins the mostly-domestic ones at home, not This is Beirut (mostly the region) or Spaceflight Now', () => {
    for (const id of ['15min-lt', 'lrt-lt', 'estonian-world-ee', 'st-vincent-times-vc']) expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    for (const id of ['this-is-beirut-lb', 'spaceflight-now']) expect(HOME_PIN_SOURCES.has(id), id).toBe(false)
    expect(inferGeo('Ministras: situacija Lietuvos pasienyje su Kaliningradu šiuo metu yra ramesnė, nei buvo Lenkijoje', '', src('15min-lt')).countryCode).toBe('LT')
    expect(inferGeo('Pasienyje su Baltarusija apgręžti 38 neteisėti migrantai', '', src('lrt-lt')).countryCode).toBe('LT')
    // Lithuanian names of Lithuania's places (local-names.ts), and "palaužė" (broke down) is not Palau
    expect(inferGeo('Kaune masiškai suniokotų automobilių byla ištirta', '', src('15min-lt')).locationName).toBe('Kaunas')
    expect(inferGeo('„Rytas“ tik ketvirtajame kėlinyje palaužė Jonavos komandą', '', src('lrt-lt')).countryCode).toBe('LT')
    expect(inferGeo('Calls for Midterm Elections in SVG Spark Debate', '', src('st-vincent-times-vc')).countryCode).toBe('VC')
    expect(inferGeo('Mitchell’s NDC wins 14 of 15 seats in Grenada election', '', src('st-vincent-times-vc')).countryCode).toBe('GD')
    expect(inferGeo('Estonia to liberalise its firearms’ policies', '', src('estonian-world-ee')).countryCode).toBe('EE')
    expect(inferGeo('IDF Says It Found More Than 340 Hezbollah Weapons in Southern Lebanon', '', src('this-is-beirut-lb')).countryCode).toBe('LB')
    expect(inferGeo('Saudi-Led Coalition Intercepts Houthi Ballistic Missile Targeting Medina', '', src('this-is-beirut-lb')).countryCode).toBe('SA')
  })

  it("places a space outlet's story by its headline, not the crew's home countries", () => {
    const crew = 'NASA astronaut Anil Menon and Canadian Space Agency astronaut Joshua Kutryk successfully installed and unfurled the seventh of eight new solar panels.'
    expect(inferGeo('Spacewalking astronauts unfurl upgraded solar array to boost space station power', crew, src('spaceflight-now')).countryCode).toBeNull()
    expect(inferGeo('NASA’s Neil Gehrels Swift Observatory reenters over Western Indonesia', '', src('spaceflight-now')).countryCode).toBe('ID')
    expect(inferGeo('Spacewalking astronauts unfurl upgraded solar array', crew, src('nasa-news')).countryCode).toBeNull()
  })

  it("matches 15min's and LRT's reports of one story, and keeps different ones apart", () => {
    const now = new Date('2026-11-06T12:00:00Z').toISOString()
    const report = (over: Partial<CorrelationCandidate>): CorrelationCandidate => ({
      id: 'a', title: '', category: 'geopolitics', severity: 'medium', source_id: '15min.lt', location_name: 'Vilnius, Lithuania',
      lat: 54.69, lng: 25.28, published_at: now, reliability_score: 0.76, tags: ['lt', 'lithuania'], ...over,
    })
    const lrt = (title: string) => report({ id: 'b', title, source_id: 'lrt.lt', tags: ['lt', 'lithuania', 'public-broadcaster'] })
    expect(isSameStory(
      report({ title: 'Ministras: situacija Lietuvos pasienyje su Kaliningradu šiuo metu yra ramesnė, nei buvo Lenkijoje' }),
      lrt('Ministras: situacija pasienyje su Kaliningradu šiuo metu yra ramesnė, nei buvo Lenkijoje'),
    )).toBe(true)
    expect(isSameStory(
      report({ title: 'Kaune masiškai suniokotų automobilių byla ištirta: viena įtariamoji nepilnametė' }),
      lrt('Teismui perduota kvaišalus pašto ženkluose slėpusio vyro byla'),
      { secondLook: { busy: new Set() } },
    )).toBe(false)
    expect(isSameStory(
      report({ title: 'Nausėda interviu Vokietijos žiniasklaidai įvertino Putino planą: „Aš jais nepasitikiu“' }),
      lrt('Nausėda atsisako detalizuoti grėsmes pasienyje: šnekėdami per daug darome priešui paslaugą'),
      { secondLook: { busy: new Set() } },
    )).toBe(false)
  })

  it('parks North Press, which turns the server away (Oct 21 and Nov 6), so it is tried once a day', () => {
    expect(src('north-press-sy').parked).toMatch(/turns the server away \(HTTP 403\), Oct 21 and Nov 6, 2026/)
    expect(src('syria-direct').parked).toBeUndefined()
  })
})
