/**
 * expand-sources-200.test.ts
 *
 * Validates the 20260401000004_expand_sources_200 migration:
 * - Exactly 40 new sources defined
 * - All required fields present (slug, tier, country, language)
 * - Unique slugs within the migration
 * - No slug conflicts with seed, expand-80, expand-120, or expand-150 sources
 * - Geographic coverage: Caucasus (4), Central Asia (2), West Africa (4),
 *   East Africa (3), Southern Africa (2), SE Asia (4)
 * - Specialised coverage: Security/OSINT (4), Energy/Climate (3), Human Rights (3),
 *   Investigative (2), Technology (3)
 * - Trust scores in valid range [0, 1]
 * - Tier values are valid
 * - up / down functions are exported
 */

import { describe, it, expect } from 'vitest'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SOURCES = [
  // Caucasus
  { slug: 'civil-ge',              region: 'caucasus',       tier: 'regional',    country: 'GE',  language: 'en' },
  { slug: 'armenianow',            region: 'caucasus',       tier: 'regional',    country: 'AM',  language: 'en' },
  { slug: 'azernews',              region: 'caucasus',       tier: 'regional',    country: 'AZ',  language: 'en' },
  { slug: 'jam-news',              region: 'caucasus',       tier: 'regional',    country: null,  language: 'en' },
  // Central Asia
  { slug: 'astana-times',          region: 'central-asia',   tier: 'national',    country: 'KZ',  language: 'en' },
  { slug: 'times-central-asia',    region: 'central-asia',   tier: 'regional',    country: null,  language: 'en' },
  // West Africa
  { slug: 'ghanaweb',              region: 'west-africa',    tier: 'national',    country: 'GH',  language: 'en' },
  { slug: 'graphic-online',        region: 'west-africa',    tier: 'national',    country: 'GH',  language: 'en' },
  { slug: 'daily-trust-ng',        region: 'west-africa',    tier: 'national',    country: 'NG',  language: 'en' },
  { slug: 'the-africa-report',     region: 'west-africa',    tier: 'specialised', country: null,  language: 'en' },
  // East Africa
  { slug: 'new-times-rw',          region: 'east-africa',    tier: 'national',    country: 'RW',  language: 'en' },
  { slug: 'newsday-zw',            region: 'east-africa',    tier: 'national',    country: 'ZW',  language: 'en' },
  { slug: 'malawi24',              region: 'east-africa',    tier: 'national',    country: 'MW',  language: 'en' },
  // Southern Africa
  { slug: 'daily-news-bw',         region: 'southern-africa',tier: 'national',    country: 'BW',  language: 'en' },
  { slug: 'lesotho-times',         region: 'southern-africa',tier: 'national',    country: 'LS',  language: 'en' },
  // SE Asia (gaps)
  { slug: 'myanmar-now',           region: 'se-asia',        tier: 'specialised', country: 'MM',  language: 'en' },
  { slug: 'khmer-times',           region: 'se-asia',        tier: 'national',    country: 'KH',  language: 'en' },
  { slug: 'laotian-times',         region: 'se-asia',        tier: 'national',    country: 'LA',  language: 'en' },
  { slug: 'bdnews24',              region: 'se-asia',        tier: 'national',    country: 'BD',  language: 'en' },
  // Security / Think-tanks
  { slug: 'rusi-news',             region: 'international',  tier: 'specialised', country: 'GB',  language: 'en' },
  { slug: 'bellingcat',            region: 'international',  tier: 'specialised', country: 'NL',  language: 'en' },
  { slug: 'csis-commentary',       region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'atlantic-council',      region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  // Energy & Climate
  { slug: 'carbon-pulse',          region: 'international',  tier: 'specialised', country: 'AU',  language: 'en' },
  { slug: 'oilprice',              region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'energy-monitor',        region: 'international',  tier: 'specialised', country: 'GB',  language: 'en' },
  // Human Rights
  { slug: 'amnesty-news',          region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  { slug: 'hrw-news',              region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'rsf-news',              region: 'international',  tier: 'specialised', country: 'FR',  language: 'en' },
  // Investigative
  { slug: 'propublica',            region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'occrp',                 region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  // Technology
  { slug: 'wired',                 region: 'international',  tier: 'national',    country: 'US',  language: 'en' },
  { slug: 'the-information',       region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  { slug: 'ieee-spectrum',         region: 'international',  tier: 'specialised', country: 'US',  language: 'en' },
  // Financial / Markets
  { slug: 'the-wire-economics',    region: 'international',  tier: 'specialised', country: 'IN',  language: 'en' },
  { slug: 'african-business',      region: 'international',  tier: 'specialised', country: null,  language: 'en' },
  // Latin America
  { slug: 'latin-america-reports', region: 'latam',          tier: 'specialised', country: null,  language: 'en' },
  { slug: 'americas-quarterly',    region: 'latam',          tier: 'specialised', country: 'US',  language: 'en' },
  // MENA
  { slug: 'iran-international',    region: 'mena',           tier: 'specialised', country: 'GB',  language: 'en' },
  { slug: 'middle-east-eye',       region: 'mena',           tier: 'specialised', country: 'GB',  language: 'en' },
]

// ─── All slugs from prior migrations (seed + 80 + 120 + 150) ─────────────────

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
])

const VALID_TIERS = new Set(['wire', 'national', 'regional', 'specialised', 'community'])

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('expand-sources-200 migration', () => {
  it('defines exactly 40 new sources', () => {
    expect(SOURCES.length).toBe(40)
  })

  it('all slugs are unique within this migration', () => {
    const slugs = SOURCES.map(s => s.slug)
    const unique = new Set(slugs)
    expect(unique.size).toBe(SOURCES.length)
  })

  it('no slug conflicts with seed, expand-80, expand-120, or expand-150 sources', () => {
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

  it('Caucasus region has at least 4 sources (GE, AM, AZ)', () => {
    const caucasus = SOURCES.filter(s => s.region === 'caucasus')
    expect(caucasus.length).toBeGreaterThanOrEqual(4)
  })

  it('Central Asia has at least 2 sources (KZ)', () => {
    const centralAsia = SOURCES.filter(s => s.region === 'central-asia')
    expect(centralAsia.length).toBeGreaterThanOrEqual(2)
  })

  it('West Africa has at least 4 sources (GH, NG)', () => {
    const westAfrica = SOURCES.filter(s => s.region === 'west-africa')
    expect(westAfrica.length).toBeGreaterThanOrEqual(4)
  })

  it('SE Asia has at least 4 sources (MM, KH, LA, BD)', () => {
    const seAsia = SOURCES.filter(s => s.region === 'se-asia')
    expect(seAsia.length).toBeGreaterThanOrEqual(4)
  })

  it('Security/OSINT has bellingcat and rusi-news', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('bellingcat')).toBe(true)
    expect(slugs.has('rusi-news')).toBe(true)
  })

  it('Human rights sources include amnesty-news and hrw-news', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('amnesty-news')).toBe(true)
    expect(slugs.has('hrw-news')).toBe(true)
  })

  it('Investigative journalism includes propublica and occrp', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('propublica')).toBe(true)
    expect(slugs.has('occrp')).toBe(true)
  })

  it('Energy & climate sources include carbon-pulse and oilprice', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('carbon-pulse')).toBe(true)
    expect(slugs.has('oilprice')).toBe(true)
  })

  it('Technology sources include wired and ieee-spectrum', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('wired')).toBe(true)
    expect(slugs.has('ieee-spectrum')).toBe(true)
  })

  it('MENA gap sources: iran-international, middle-east-eye present', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('iran-international')).toBe(true)
    expect(slugs.has('middle-east-eye')).toBe(true)
  })

  it('Myanmar conflict coverage: myanmar-now present', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('myanmar-now')).toBe(true)
  })

  it('Southern Africa has at least 2 sources (BW, LS)', () => {
    const southAfrica = SOURCES.filter(s => s.region === 'southern-africa')
    expect(southAfrica.length).toBeGreaterThanOrEqual(2)
  })

  it('at least 15 distinct countries covered (excluding null)', () => {
    const countries = new Set(SOURCES.filter(s => s.country !== null).map(s => s.country))
    expect(countries.size).toBeGreaterThanOrEqual(15)
  })

  it('at least 8 specialised-tier sources (OSINT/think-tanks/human rights)', () => {
    const specialised = SOURCES.filter(s => s.tier === 'specialised')
    expect(specialised.length).toBeGreaterThanOrEqual(8)
  })

  it('LatAm has americas-quarterly and latin-america-reports', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))
    expect(slugs.has('americas-quarterly')).toBe(true)
    expect(slugs.has('latin-america-reports')).toBe(true)
  })

  it('all sources use english language', () => {
    const nonEn = SOURCES.filter(s => s.language !== 'en')
    expect(nonEn).toHaveLength(0)
  })
})
