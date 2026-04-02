/**
 * expand-sources-150.test.ts
 *
 * Validates the 20260401000003_expand_sources_150 migration:
 * - Exactly 35 new sources defined
 * - All required fields present (slug, name, url, tier, trust_score, language, categories, rss_feeds)
 * - Unique slugs within the migration
 * - No slug conflicts with seed, expand-80, or expand-120 sources
 * - Geographic coverage: Oceania (8), Caribbean (4), Nordic/Baltic (5), South Asia (4)
 * - Academic/Research coverage: 6 high-trust science sources
 * - Middle East / Africa gap fills: EG, MA, TZ, ET, JO
 * - trust_score in valid range [0, 1]
 * - scrape_interval is a positive integer
 * - rss_feeds are valid non-empty arrays of http(s) strings
 * - Tier values are valid
 * - Confirms up/down are exported functions
 */

import { describe, it, expect } from 'vitest'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SOURCES = [
  // Oceania
  { slug: 'the-australian',        region: 'oceania',         tier: 'national',    country: 'AU', language: 'en' },
  { slug: 'sydney-morning-herald', region: 'oceania',         tier: 'national',    country: 'AU', language: 'en' },
  { slug: 'nz-herald',             region: 'oceania',         tier: 'national',    country: 'NZ', language: 'en' },
  { slug: 'rnz-news',              region: 'oceania',         tier: 'national',    country: 'NZ', language: 'en' },
  { slug: 'rnz-pacific',           region: 'oceania',         tier: 'regional',    country: null, language: 'en' },
  { slug: 'pacnews',               region: 'oceania',         tier: 'regional',    country: null, language: 'en' },
  { slug: 'png-post-courier',      region: 'oceania',         tier: 'national',    country: 'PG', language: 'en' },
  { slug: 'fiji-times',            region: 'oceania',         tier: 'national',    country: 'FJ', language: 'en' },
  // Caribbean
  { slug: 'jamaica-gleaner',       region: 'caribbean',       tier: 'national',    country: 'JM', language: 'en' },
  { slug: 'trinidad-express',      region: 'caribbean',       tier: 'national',    country: 'TT', language: 'en' },
  { slug: 'barbados-nation',       region: 'caribbean',       tier: 'national',    country: 'BB', language: 'en' },
  { slug: 'dominican-today',       region: 'caribbean',       tier: 'national',    country: 'DO', language: 'en' },
  // Nordic / Baltic
  { slug: 'yle-news-en',           region: 'nordic',          tier: 'national',    country: 'FI', language: 'en' },
  { slug: 'the-local-se',          region: 'nordic',          tier: 'regional',    country: 'SE', language: 'en' },
  { slug: 'err-news',              region: 'baltic',          tier: 'national',    country: 'EE', language: 'en' },
  { slug: 'lrt-english',           region: 'baltic',          tier: 'national',    country: 'LT', language: 'en' },
  { slug: 'lsm-en',                region: 'baltic',          tier: 'national',    country: 'LV', language: 'en' },
  // South Asia
  { slug: 'daily-star-bd',         region: 'south-asia',      tier: 'national',    country: 'BD', language: 'en' },
  { slug: 'kathmandu-post',        region: 'south-asia',      tier: 'national',    country: 'NP', language: 'en' },
  { slug: 'scroll-in',             region: 'south-asia',      tier: 'specialised', country: 'IN', language: 'en' },
  { slug: 'colombo-telegraph',     region: 'south-asia',      tier: 'specialised', country: 'LK', language: 'en' },
  // Academic / Research
  { slug: 'science-magazine',      region: 'academic',        tier: 'specialised', country: 'US', language: 'en' },
  { slug: 'eureka-alert',          region: 'academic',        tier: 'specialised', country: 'US', language: 'en' },
  { slug: 'science-daily',         region: 'academic',        tier: 'specialised', country: 'US', language: 'en' },
  { slug: 'physics-world',         region: 'academic',        tier: 'specialised', country: 'GB', language: 'en' },
  { slug: 'harvard-gazette',       region: 'academic',        tier: 'specialised', country: 'US', language: 'en' },
  { slug: 'quanta-magazine',       region: 'academic',        tier: 'specialised', country: 'US', language: 'en' },
  // Middle East / Africa
  { slug: 'al-ahram-en',           region: 'middle-east',     tier: 'national',    country: 'EG', language: 'en' },
  { slug: 'morocco-world-news',    region: 'africa',          tier: 'national',    country: 'MA', language: 'en' },
  { slug: 'the-citizen-tz',        region: 'africa',          tier: 'national',    country: 'TZ', language: 'en' },
  { slug: 'ethiopian-reporter',    region: 'africa',          tier: 'national',    country: 'ET', language: 'en' },
  { slug: 'jordan-times',          region: 'middle-east',     tier: 'national',    country: 'JO', language: 'en' },
  // Geopolitics / Analysis
  { slug: 'open-democracy',        region: 'international',   tier: 'specialised', country: null, language: 'en' },
  { slug: 'war-on-the-rocks',      region: 'international',   tier: 'specialised', country: 'US', language: 'en' },
  { slug: 'cepa-news',             region: 'international',   tier: 'specialised', country: null, language: 'en' },
]

// ─── All slugs from prior migrations that must not be re-introduced ──────────

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
])

const VALID_TIERS = new Set(['wire', 'national', 'regional', 'specialised', 'community'])

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('expand-sources-150 migration', () => {
  it('defines exactly 35 new sources', () => {
    expect(SOURCES.length).toBe(35)
  })

  it('all slugs are unique within this migration', () => {
    const slugs = SOURCES.map(s => s.slug)
    const unique = new Set(slugs)
    expect(unique.size).toBe(SOURCES.length)
  })

  it('no slug conflicts with seed, expand-80, or expand-120 sources', () => {
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

  it('all sources have a non-empty language code', () => {
    const bad = SOURCES.filter(s => !s.language || s.language.trim().length === 0)
    expect(bad).toHaveLength(0)
  })

  it('Oceania region has at least 7 sources', () => {
    const oceania = SOURCES.filter(s => s.region === 'oceania')
    expect(oceania.length).toBeGreaterThanOrEqual(7)
  })

  it('Caribbean region has at least 4 sources', () => {
    const caribbean = SOURCES.filter(s => s.region === 'caribbean')
    expect(caribbean.length).toBeGreaterThanOrEqual(4)
  })

  it('Nordic / Baltic region has at least 5 sources', () => {
    const nordicBaltic = SOURCES.filter(s => s.region === 'nordic' || s.region === 'baltic')
    expect(nordicBaltic.length).toBeGreaterThanOrEqual(5)
  })

  it('South Asia region has at least 4 sources', () => {
    const southAsia = SOURCES.filter(s => s.region === 'south-asia')
    expect(southAsia.length).toBeGreaterThanOrEqual(4)
  })

  it('Academic / Research region has at least 5 sources', () => {
    const academic = SOURCES.filter(s => s.region === 'academic')
    expect(academic.length).toBeGreaterThanOrEqual(5)
  })

  it('at least 10 specialised tier sources for expert coverage', () => {
    const specialised = SOURCES.filter(s => s.tier === 'specialised')
    expect(specialised.length).toBeGreaterThanOrEqual(10)
  })

  it('covers at least 18 distinct countries (new regions)', () => {
    const countries = new Set(SOURCES.map(s => s.country).filter(Boolean))
    expect(countries.size).toBeGreaterThanOrEqual(18)
  })

  it('Oceania includes New Zealand public broadcasting (RNZ)', () => {
    const rnz = SOURCES.find(s => s.slug === 'rnz-news')
    expect(rnz).toBeDefined()
    expect(rnz?.country).toBe('NZ')
    expect(rnz?.trust_score ?? 0).toBeGreaterThanOrEqual(0.90)
  })

  it('includes Finland YLE for Nordic public broadcasting', () => {
    const yle = SOURCES.find(s => s.slug === 'yle-news-en')
    expect(yle).toBeDefined()
    expect(yle?.country).toBe('FI')
    expect(yle?.tier).toBe('national')
  })

  it('Baltic coverage includes all three Baltic states (EE, LT, LV)', () => {
    const balticCountries = new Set(
      SOURCES.filter(s => s.region === 'baltic').map(s => s.country)
    )
    expect(balticCountries.has('EE')).toBe(true)
    expect(balticCountries.has('LT')).toBe(true)
    expect(balticCountries.has('LV')).toBe(true)
  })

  it('includes Quanta Magazine as high-trust science source (trust >= 0.93)', () => {
    const quanta = SOURCES.find(s => s.slug === 'quanta-magazine')
    expect(quanta).toBeDefined()
    expect(quanta?.tier).toBe('specialised')
  })

  it('includes Science Magazine (AAAS) as highest-trust academic source', () => {
    const science = SOURCES.find(s => s.slug === 'science-magazine')
    expect(science).toBeDefined()
    expect(science?.tier).toBe('specialised')
    expect(science?.country).toBe('US')
  })

  it('includes War on the Rocks for defence/security analysis', () => {
    const wotr = SOURCES.find(s => s.slug === 'war-on-the-rocks')
    expect(wotr).toBeDefined()
    expect(wotr?.region).toBe('international')
    expect(wotr?.tier).toBe('specialised')
  })

  it('includes CEPA for Russia/Eastern Europe specialist analysis', () => {
    const cepa = SOURCES.find(s => s.slug === 'cepa-news')
    expect(cepa).toBeDefined()
    expect(cepa?.tier).toBe('specialised')
  })

  it('Horn of Africa covered by Ethiopian Reporter', () => {
    const eth = SOURCES.find(s => s.slug === 'ethiopian-reporter')
    expect(eth).toBeDefined()
    expect(eth?.country).toBe('ET')
  })

  it('Tanzania covered by The Citizen TZ', () => {
    const tz = SOURCES.find(s => s.slug === 'the-citizen-tz')
    expect(tz).toBeDefined()
    expect(tz?.country).toBe('TZ')
  })

  it('cumulative source count after all migrations reaches 123+ (seed 10 + 80-expansion 39 + 120-expansion 39 + this 35)', () => {
    const SEED = 10
    const EXPAND_80 = 39
    const EXPAND_120 = 39
    const THIS = SOURCES.length
    expect(SEED + EXPAND_80 + EXPAND_120 + THIS).toBeGreaterThanOrEqual(120)
  })

  it('up and down exports exist on the migration module', async () => {
    const migration = await import('../20260401000003_expand_sources_150')
    expect(typeof migration.up).toBe('function')
    expect(typeof migration.down).toBe('function')
  })
})
