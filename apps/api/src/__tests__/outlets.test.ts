/**
 * The outlet directory (plan 15, Oct 22, 2026): what each website WorldPulse
 * counts as an outlet is, by name, home country and kind, and whether a
 * government runs it (lib/outlet-directory.ts, written by
 * scripts/outlets/build-outlet-directory.py; lib/outlets.ts looks it up).
 */
import { describe, it, expect } from 'vitest'
import { OUTLET_DIRECTORY } from '../lib/outlet-directory'
import { outletOf, siteInfo, sitesOfLinks, describeSite, outletReach, outletLanguages, countryLabel, OUTLET_KIND_LABELS } from '../lib/outlets'

describe('the outlet directory', () => {
  it('holds every news feed WorldPulse reads, with a kind, a country and a name each', () => {
    const entries = Object.entries(OUTLET_DIRECTORY)
    expect(entries.length).toBeGreaterThan(500)
    for (const [site, e] of entries) {
      expect(site, site).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      expect(site.startsWith('www.'), site).toBe(false)
      expect(Object.keys(OUTLET_KIND_LABELS), site).toContain(e.kind)
      expect(e.country, site).toMatch(/^[A-Z]{2}$/)
      expect(e.name.trim().length, site).toBeGreaterThan(1)
    }
  })

  it('knows the big ones', () => {
    expect(outletOf('reuters.com')).toMatchObject({ name: 'Reuters', kind: 'agency', country: 'GB' })
    expect(outletOf('apnews.com')).toMatchObject({ name: 'AP', kind: 'agency', country: 'US' })
    expect(outletOf('tass.com')).toMatchObject({ kind: 'agency', country: 'RU', state: true })
    expect(outletOf('bbc.co.uk')).toMatchObject({ name: 'BBC', kind: 'international' })
    expect(outletOf('aljazeera.com')).toMatchObject({ name: 'Al Jazeera', kind: 'international', country: 'QA' })
    expect(outletOf('dabangasudan.org')).toMatchObject({ name: 'Radio Dabanga', kind: 'national', country: 'SD' })
    expect(outletOf('bloomberg.com')).toMatchObject({ kind: 'specialist' })
    expect(outletOf('allafrica.com')).toMatchObject({ kind: 'aggregator' })
    expect(outletOf('news.un.org')).toMatchObject({ name: 'UN News', kind: 'official' })
  })
})

describe('outletOf', () => {
  it('a subdomain stands for its website; "www." and capitals don\'t matter; unknown is null', () => {
    expect(outletOf('edition.cnn.com')).toMatchObject({ name: 'CNN', site: 'cnn.com' })
    expect(outletOf('WWW.FoxNews.com')).toMatchObject({ name: 'Fox News' })
    expect(outletOf('www1.folha.uol.com.br')).toMatchObject({ name: 'Folha de S.Paulo', country: 'BR' })
    // the nearest one wins: UN News and the UN's press releases are different outlets
    expect(outletOf('press.un.org')!.name).not.toBe(outletOf('news.un.org')!.name)
    expect(outletOf('un.org')).toBeNull()
    expect(outletOf('kvia.com')).toBeNull()
    expect(outletOf('')).toBeNull()
    expect(outletOf('com')).toBeNull()
  })
})

describe('siteInfo and describeSite', () => {
  it("each website's outlet, or unknown", () => {
    expect(siteInfo(['reuters.com', 'kvia.com'])).toEqual([
      { site: 'reuters.com', name: 'Reuters', kind: 'agency', country: 'GB', stateMedia: false },
      { site: 'kvia.com', name: null, kind: 'unknown', country: null, stateMedia: false },
    ])
    expect(describeSite('tass.com')).toBe('TASS (news agency, RU, state media)')
    expect(describeSite('kvia.com')).toBe('kvia.com')
  })

  it('the websites of links, once each, http(s) only, in order', () => {
    expect(sitesOfLinks(['https://www.bbc.co.uk/a', 'https://bbc.co.uk/b', 'ftp://x.example/c', 'not a link', 'http://Reuters.com/d'])).toEqual(['bbc.co.uk', 'reuters.com'])
    expect(sitesOfLinks(Array.from({ length: 15 }, (_, i) => `https://s${i}.example.com/`), 3)).toHaveLength(3)
  })
})

describe('outletReach (Nov 8, 2026)', () => {
  it("counts the countries a story's outlets are from, and its own country's newsrooms by name", () => {
    const sites = ['defence24.com', 'notesfrompoland.com', 'reuters.com', 'bbc.co.uk', 'aljazeera.com', 'unknown-site.example']
    expect(outletReach(sites, 'PL')).toEqual({ countries: 3, local: 2, localNames: ['Defence24', 'Notes from Poland'] })
    // any case; a story with no country has no local outlets; websites the directory doesn't know count for neither
    expect(outletReach(sites, 'pl').local).toBe(2)
    expect(outletReach(sites, null)).toEqual({ countries: 3, local: 0, localNames: [] })
    expect(outletReach(['unknown-site.example'], 'PL')).toEqual({ countries: 0, local: 0, localNames: [] })
  })

  it('names three local outlets at most, and counts them all', () => {
    const r = outletReach(['reuters.com', 'bbc.co.uk', 'theguardian.com', 'independent.co.uk', 'aljazeera.com'], 'GB')
    expect(r).toEqual({ countries: 2, local: 4, localNames: ['Reuters', 'BBC', 'The Guardian'] })
  })
})

describe('countryLabel', () => {
  it('names a country as a sentence says it', () => {
    expect(countryLabel('PL')).toBe('Poland')
    expect(countryLabel('us')).toBe('the United States')
    expect(countryLabel('US', false)).toBe('United States')
    expect(countryLabel('GB')).toBe('the United Kingdom')
    expect(countryLabel('CD')).toBe('DR Congo')
    expect(countryLabel('MM')).toBe('Myanmar')
  })
})

describe('outletLanguages (Nov 10, 2026)', () => {
  it("is the languages of a story's outlets and of its reports, each once, A to Z", () => {
    expect(outletLanguages(['14ymedio.com', '15min.lt', '1news.co.nz', 'www.1news.co.nz', 'unknown-site.example'])).toEqual(['en', 'es', 'lt'])
    expect(outletLanguages(['1news.co.nz'], ['fr', 'en', 'xx1', null, 7])).toEqual(['en', 'fr'])
    expect(outletLanguages([], [])).toEqual([])
  })
})
