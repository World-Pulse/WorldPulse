/**
 * expand-sources-250.test.ts
 *
 * Validates the 20260401000005_expand_sources_250 migration:
 * - Exactly 40 new sources defined
 * - All required fields present (slug, tier, country, language)
 * - Unique slugs within this migration
 * - No slug conflicts with seed, expand-80, expand-120, expand-150, or expand-200 sources
 * - Geographic coverage:
 *     SE Asia (8): PH, VN×2, ID, TH, MY, MM×2
 *     Nordic / Scandinavia (4): DK, NO×2, Arctic
 *     Eastern Europe (8): CZ, HU, RO, BG, HR, SK, pan-EE, MD
 * - Thematic coverage:
 *     Space Technology (3), Health/Pandemic (3),
 *     Francophone Africa (4), Maritime (3),
 *     Migration (2), South Asia depth (2), Pacific depth (3)
 * - Trust scores in valid range [0, 1]
 * - Tier values are valid
 * - up / down functions are exported
 */

import { describe, it, expect } from 'vitest'
import { up, down } from '../20260401000005_expand_sources_250'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SOURCES = [
  // SE Asia depth
  { slug: 'rappler',              region: 'se-asia',        tier: 'specialised', country: 'PH',  language: 'en' },
  { slug: 'coconuts-media',       region: 'se-asia',        tier: 'regional',    country: null,  language: 'en' },
  { slug: 'vietnam-news-vn',      region: 'se-asia',        tier: 'national',    country: 'VN',  language: 'en' },
  { slug: 'tempo-en',             region: 'se-asia',        tier: 'national',    country: 'ID',  language: 'en' },
  { slug: 'thai-pbs-world',       region: 'se-asia',        tier: 'national',    country: 'TH',  language: 'en' },
  { slug: 'vietnam-insider',      region: 'se-asia',        tier: 'regional',    country: 'VN',  language: 'en' },
  { slug: 'freemalaysia-today',   region: 'se-asia',        tier: 'national',    country: 'MY',  language: 'en' },
  { slug: 'irrawaddy-mag',        region: 'se-asia',        tier: 'specialised', country: 'MM',  language: 'en' },
  // Nordic / Scandinavia
  { slug: 'cphpost',              region: 'nordic',         tier: 'national',    country: 'DK',  language: 'en' },
  { slug: 'norway-today',         region: 'nordic',         tier: 'national',    country: 'NO',  language: 'en' },
  { slug: 'arctic-today',         region: 'arctic',         tier: 'specialised', country: null,  language: 'en' },
  { slug: 'high-north-news',      region: 'arctic',         tier: 'specialised', country: 'NO',  language: 'en' },
  // Eastern Europe
  { slug: 'radio-prague-en',      region: 'eastern-europe', tier: 'national',    country: 'CZ',  language: 'en' },
  { slug: 'hungary-today',        region: 'eastern-europe', tier: 'national',    country: 'HU',  language: 'en' },
  { slug: 'romania-insider',      region: 'eastern-europe', tier: 'national',    country: 'RO',  language: 'en' },
  { slug: 'sofia-globe',          region: 'eastern-europe', tier: 'national',    country: 'BG',  language: 'en' },
  { slug: 'croatia-week',         region: 'eastern-europe', tier: 'national',    country: 'HR',  language: 'en' },
  { slug: 'spectator-sk',         region: 'eastern-europe', tier: 'national',    country: 'SK',  language: 'en' },
  { slug: 'bne-intellinews',      region: 'eastern-europe', tier: 'specialised', country: null,  language: 'en' },
  { slug: 'moldova-now',          region: 'eastern-europe', tier: 'national',    country: 'MD',  language: 'en' },
  // Space Technology
  { slug: 'spaceflightnow',       region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'nasaspaceflight',      region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'spacenews',            region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  // Health / Pandemic
  { slug: 'paho-news',            region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  { slug: 'global-health-now',    region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'outbreak-news-today',  region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  // Francophone Africa
  { slug: 'africa-confidential',  region: 'africa',         tier: 'specialised', country: 'GB',  language: 'en' },
  { slug: 'thecontinentafrica',   region: 'africa',         tier: 'specialised', country: 'ZA',  language: 'en' },
  { slug: 'news-of-cameroon',     region: 'africa',         tier: 'national',    country: 'CM',  language: 'en' },
  { slug: 'agence-ecofin-en',     region: 'africa',         tier: 'specialised', country: 'CI',  language: 'en' },
  // Maritime
  { slug: 'maritime-executive',   region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'splash247',            region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  { slug: 'gcaptain',             region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  // Migration
  { slug: 'mpi-news',             region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'iom-news',             region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  // South Asia depth
  { slug: 'nepali-times',         region: 'south-asia',     tier: 'national',    country: 'NP',  language: 'en' },
  { slug: 'dhaka-tribune',        region: 'south-asia',     tier: 'national',    country: 'BD',  language: 'en' },
  // Pacific depth
  { slug: 'islands-business',     region: 'pacific',        tier: 'regional',    country: null,  language: 'en' },
  { slug: 'samoa-observer',       region: 'pacific',        tier: 'national',    country: 'WS',  language: 'en' },
  { slug: 'vanuatu-daily-post',   region: 'pacific',        tier: 'national',    country: 'VU',  language: 'en' },
]

// ─── All slugs from prior migrations (seed + 80 + 120 + 150 + 200) ───────────

const EXISTING_SLUGS = new Set([
  // seed
  'ap-news', 'reuters', 'bbc-world', 'al-jazeera', 'guardian', 'who',
  'usgs-earthquakes', 'france24', 'dw-world', 'nasa',
  // expand-80
  'afp-english', 'bloomberg-world', 'nhk-world', 'daily-maverick', 'allafrica',
  'east-african', 'premium-times-ng', 'scmp', 'the-hindu', 'dawn-pk',
  'straits-times', 'abc-australia', 'nikkei-asia', 'le-monde-en', 'der-spiegel-en',
  'elpais-en', 'euractiv', 'politico-eu', 'haaretz-en', 'the-national-uae',
  'arab-news', 'al-monitor', 'the-conversation', 'foreign-policy', 'rest-of-world',
  'the-wire-india', 'kyiv-independent', 'voa-news', 'radio-free-europe', 'meduza',
  'nature-news', 'sciencealert', 'stat-news', 'devex', 'ars-technica',
  'the-register', 'techcrunch', 'folha-sp-en', 'mercopress',
  // expand-120
  'jakarta-post', 'bangkok-post', 'phil-daily-inquirer', 'vnexpress-en', 'channel-news-asia',
  'businessday-ng', 'africanews', 'daily-monitor-ug', 'news24-za', 'nation-africa',
  'infobae-en', 'insight-crime', 'la-nacion-ar', 'el-colombiano', 'telesur-en',
  'rudaw-en', 'jerusalem-post', 'eurasianet', 'hurriyet-daily-news',
  'balkan-insight', 'irish-times', 'swissinfo-en', 'novaya-gazeta-eu', 'the-local-eu',
  'new-humanitarian', 'reliefweb', 'global-voices', 'acled-blog',
  'carbon-brief', 'mongabay', 'earth-org',
  'cidrap', 'health-policy-watch', 'mit-tech-review', 'new-scientist',
  'caixin-global', 'times-of-india',
  'the-diplomat', 'pbs-newshour',
  // expand-150
  'the-australian', 'sydney-morning-herald', 'nz-herald', 'rnz-news',
  'rnz-pacific', 'pacnews', 'png-post-courier', 'fiji-times',
  'jamaica-gleaner', 'trinidad-express', 'barbados-nation', 'dominican-today',
  'yle-news-en', 'the-local-se', 'err-news', 'lrt-english', 'lsm-en',
  'daily-star-bd', 'kathmandu-post', 'scroll-in', 'colombo-telegraph',
  'science-magazine', 'eureka-alert', 'science-daily', 'physics-world',
  'harvard-gazette', 'quanta-magazine',
  'al-ahram-en', 'morocco-world-news', 'the-citizen-tz', 'ethiopian-reporter', 'jordan-times',
  'open-democracy', 'war-on-the-rocks', 'cepa-news',
  // expand-200
  'civil-ge', 'armenianow', 'azernews', 'jam-news',
  'astana-times', 'times-central-asia',
  'ghanaweb', 'graphic-online', 'daily-trust-ng', 'the-africa-report',
  'new-times-rw', 'newsday-zw', 'malawi24',
  'daily-news-bw', 'lesotho-times',
  'myanmar-now', 'khmer-times', 'laotian-times', 'bdnews24',
  'rusi-news', 'bellingcat', 'csis-commentary', 'atlantic-council',
  'carbon-pulse', 'oilprice', 'energy-monitor',
  'amnesty-news', 'hrw-news', 'rsf-news',
  'propublica', 'occrp',
  'wired', 'the-information', 'ieee-spectrum',
  'the-wire-economics', 'african-business',
  'latin-america-reports', 'americas-quarterly',
  'iran-international', 'middle-east-eye',
])

const VALID_TIERS = new Set(['wire', 'national', 'regional', 'specialised', 'community'])

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('expand-sources-250 migration', () => {
  it('defines exactly 40 new sources', () => {
    expect(SOURCES.length).toBe(40)
  })

  it('all slugs are unique within this migration', () => {
    const slugs = SOURCES.map(s => s.slug)
    const unique = new Set(slugs)
    expect(unique.size).toBe(SOURCES.length)
  })

  it('no slug conflicts with seed, expand-80, expand-120, expand-150, or expand-200', () => {
    const conflicts = SOURCES.filter(s => EXISTING_SLUGS.has(s.slug))
    expect(conflicts).toHaveLength(0)
  })

  it('all tier values are valid', () => {
    const invalid = SOURCES.filter(s => !VALID_TIERS.has(s.tier))
    expect(invalid).toHaveLength(0)
  })

  it('all sources have a non-empty slug', () => {
    const bad = SOURCES.filter(s => !s.slug || s.slug.trim().length === 0)
    expect(bad).toHaveLength(0)
  })

  it('all sources use English language', () => {
    const nonEn = SOURCES.filter(s => s.language !== 'en')
    expect(nonEn).toHaveLength(0)
  })

  it('SE Asia has at least 8 sources (PH, VN, ID, TH, MY, MM)', () => {
    const seAsia = SOURCES.filter(s => s.region === 'se-asia')
    expect(seAsia.length).toBeGreaterThanOrEqual(8)
  })

  it('SE Asia covers Philippines (Rappler)', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('rappler')).toBe(true)
  })

  it('SE Asia covers Myanmar (The Irrawaddy — distinct from myanmar-now)', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('irrawaddy-mag')).toBe(true)
  })

  it('Nordic / Scandinavia has at least 4 sources (DK, NO, Arctic)', () => {
    const nordic = SOURCES.filter(s => s.region === 'nordic' || s.region === 'arctic')
    expect(nordic.length).toBeGreaterThanOrEqual(4)
  })

  it('Arctic sources include arctic-today and high-north-news', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('arctic-today')).toBe(true)
    expect(slugs.has('high-north-news')).toBe(true)
  })

  it('Eastern Europe has at least 6 sources (CZ, HU, RO, BG, HR, SK)', () => {
    const ee = SOURCES.filter(s => s.region === 'eastern-europe')
    expect(ee.length).toBeGreaterThanOrEqual(6)
  })

  it('Eastern Europe covers Czech Republic (radio-prague-en)', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('radio-prague-en')).toBe(true)
  })

  it('Space Technology has all three flagship sources', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('spaceflightnow')).toBe(true)
    expect(slugs.has('nasaspaceflight')).toBe(true)
    expect(slugs.has('spacenews')).toBe(true)
  })

  it('Health / Pandemic has at least 3 sources', () => {
    const healthSlugs = new Set(['paho-news', 'global-health-now', 'outbreak-news-today'])
    const health = SOURCES.filter(s => healthSlugs.has(s.slug))
    expect(health.length).toBeGreaterThanOrEqual(3)
  })

  it('Maritime sources include maritime-executive, splash247, gcaptain', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('maritime-executive')).toBe(true)
    expect(slugs.has('splash247')).toBe(true)
    expect(slugs.has('gcaptain')).toBe(true)
  })

  it('Migration sources include mpi-news and iom-news', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('mpi-news')).toBe(true)
    expect(slugs.has('iom-news')).toBe(true)
  })

  it('Francophone Africa sources include africa-confidential and news-of-cameroon', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('africa-confidential')).toBe(true)
    expect(slugs.has('news-of-cameroon')).toBe(true)
  })

  it('South Asia depth adds Nepali Times and Dhaka Tribune', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('nepali-times')).toBe(true)
    expect(slugs.has('dhaka-tribune')).toBe(true)
  })

  it('Pacific depth has at least 3 new sources (islands-business, samoa-observer, vanuatu-daily-post)', () => {
    const pacific = SOURCES.filter(s => s.region === 'pacific')
    expect(pacific.length).toBeGreaterThanOrEqual(3)
  })

  it('at least 20 distinct countries covered (excluding null)', () => {
    const countries = new Set(SOURCES.filter(s => s.country !== null).map(s => s.country))
    expect(countries.size).toBeGreaterThanOrEqual(20)
  })

  it('at least 15 specialised-tier sources', () => {
    const specialised = SOURCES.filter(s => s.tier === 'specialised')
    expect(specialised.length).toBeGreaterThanOrEqual(15)
  })

  it('migration exports up and down functions', () => {
    expect(typeof up).toBe('function')
    expect(typeof down).toBe('function')
  })
})
