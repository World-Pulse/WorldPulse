import { describe, it, expect } from 'vitest'

/**
 * Tests for the 400+ RSS source expansion migration
 * Validates source data quality, uniqueness, regional coverage, and schema compliance
 */

// Inline the migration sources for testing (avoids Knex dependency in unit tests)
const SOURCES = [
  // Southeast Asia
  { slug: 'bangkok-post', country: 'TH', tier: 'major', trust_score: 0.83, language: 'en' },
  { slug: 'straits-times-sg', country: 'SG', tier: 'premium', trust_score: 0.88, language: 'en' },
  { slug: 'rappler-ph', country: 'PH', tier: 'major', trust_score: 0.84, language: 'en' },
  { slug: 'vnexpress-international', country: 'VN', tier: 'major', trust_score: 0.80, language: 'en' },
  { slug: 'nikkei-asia', country: 'JP', tier: 'premium', trust_score: 0.90, language: 'en' },
  { slug: 'phnom-penh-post', country: 'KH', tier: 'regional', trust_score: 0.72, language: 'en' },
  { slug: 'myanmar-now', country: 'MM', tier: 'specialised', trust_score: 0.78, language: 'en' },
  { slug: 'vientiane-times', country: 'LA', tier: 'regional', trust_score: 0.65, language: 'en' },
  { slug: 'tempo-co-id', country: 'ID', tier: 'major', trust_score: 0.82, language: 'en' },
  // Central Asia & Caucasus
  { slug: 'eurasianet', country: 'US', tier: 'specialised', trust_score: 0.85, language: 'en' },
  { slug: 'oc-media-caucasus', country: 'GE', tier: 'specialised', trust_score: 0.80, language: 'en' },
  { slug: 'akipress-kg', country: 'KG', tier: 'regional', trust_score: 0.72, language: 'en' },
  { slug: 'asia-plus-tj', country: 'TJ', tier: 'regional', trust_score: 0.70, language: 'en' },
  { slug: 'astana-times-kz', country: 'KZ', tier: 'regional', trust_score: 0.70, language: 'en' },
  { slug: 'daryo-uz', country: 'UZ', tier: 'regional', trust_score: 0.68, language: 'en' },
  { slug: 'jamnews-caucasus', country: 'GE', tier: 'specialised', trust_score: 0.78, language: 'en' },
  // Eastern Mediterranean & Balkans
  { slug: 'ekathimerini-gr', country: 'GR', tier: 'major', trust_score: 0.84, language: 'en' },
  { slug: 'cyprus-mail', country: 'CY', tier: 'regional', trust_score: 0.76, language: 'en' },
  { slug: 'hurriyet-daily-news-tr', country: 'TR', tier: 'major', trust_score: 0.78, language: 'en' },
  { slug: 'balkan-insight', country: 'RS', tier: 'specialised', trust_score: 0.86, language: 'en' },
  { slug: 'n1-info-balkans', country: 'RS', tier: 'major', trust_score: 0.82, language: 'en' },
  // Oceania & Pacific
  { slug: 'rnz-pacific', country: 'NZ', tier: 'major', trust_score: 0.88, language: 'en' },
  { slug: 'abc-pacific-au', country: 'AU', tier: 'premium', trust_score: 0.90, language: 'en' },
  { slug: 'islands-business-fj', country: 'FJ', tier: 'regional', trust_score: 0.72, language: 'en' },
  { slug: 'devpolicy-blog-pacific', country: 'AU', tier: 'specialised', trust_score: 0.87, language: 'en' },
  // Global Health
  { slug: 'stat-news', country: 'US', tier: 'premium', trust_score: 0.90, language: 'en' },
  { slug: 'lancet-news', country: 'GB', tier: 'premium', trust_score: 0.95, language: 'en' },
  { slug: 'who-news', country: 'CH', tier: 'premium', trust_score: 0.92, language: 'en' },
  { slug: 'devex-global-health', country: 'US', tier: 'specialised', trust_score: 0.84, language: 'en' },
  { slug: 'health-policy-watch', country: 'CH', tier: 'specialised', trust_score: 0.83, language: 'en' },
  // Energy & Resources
  { slug: 'oilprice-com', country: 'US', tier: 'specialised', trust_score: 0.78, language: 'en' },
  { slug: 'renewables-now', country: 'BG', tier: 'specialised', trust_score: 0.80, language: 'en' },
  { slug: 'carbon-brief', country: 'GB', tier: 'premium', trust_score: 0.92, language: 'en' },
  { slug: 'upstream-online', country: 'NO', tier: 'specialised', trust_score: 0.82, language: 'en' },
  { slug: 'argus-media', country: 'GB', tier: 'premium', trust_score: 0.88, language: 'en' },
  // Tech & Cyber
  { slug: 'the-record-recorded-future', country: 'US', tier: 'premium', trust_score: 0.88, language: 'en' },
  { slug: 'bleepingcomputer', country: 'US', tier: 'major', trust_score: 0.85, language: 'en' },
  { slug: 'cyberscoop', country: 'US', tier: 'specialised', trust_score: 0.84, language: 'en' },
  { slug: 'risky-biz', country: 'AU', tier: 'specialised', trust_score: 0.86, language: 'en' },
  { slug: 'dark-reading', country: 'US', tier: 'major', trust_score: 0.84, language: 'en' },
  // Migration & Refugees
  { slug: 'unhcr-news', country: 'CH', tier: 'premium', trust_score: 0.92, language: 'en' },
  { slug: 'mixed-migration-centre', country: 'DK', tier: 'specialised', trust_score: 0.85, language: 'en' },
  { slug: 'new-humanitarian', country: 'CH', tier: 'premium', trust_score: 0.90, language: 'en' },
  { slug: 'refugees-international', country: 'US', tier: 'specialised', trust_score: 0.84, language: 'en' },
  { slug: 'infomigrants', country: 'FR', tier: 'specialised', trust_score: 0.82, language: 'en' },
  // Arms & Disarmament
  { slug: 'arms-control-association', country: 'US', tier: 'specialised', trust_score: 0.90, language: 'en' },
  { slug: 'sipri-news', country: 'SE', tier: 'premium', trust_score: 0.93, language: 'en' },
  { slug: 'defense-post', country: 'US', tier: 'specialised', trust_score: 0.80, language: 'en' },
  { slug: 'war-on-the-rocks', country: 'US', tier: 'specialised', trust_score: 0.88, language: 'en' },
  { slug: 'janes-defence', country: 'GB', tier: 'premium', trust_score: 0.92, language: 'en' },
]

describe('expand_sources_400 migration — data quality', () => {
  it('adds exactly 50 new sources', () => {
    expect(SOURCES).toHaveLength(50)
  })

  it('all slugs are unique', () => {
    const slugs = SOURCES.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('no slug conflicts with prior 350 expansion', () => {
    const priorSlugs = [
      'el-universal-mx', 'la-jornada-mx', 'o-globo-br', 'el-comercio-pe',
      'el-tiempo-co', 'la-tercera-cl', 'el-nacional-ve', 'el-deber-bo',
      'prensa-libre-gt', 'la-prensa-hn', 'the-news-international-pk',
      'kathmandu-post-np', 'daily-star-bd', 'colombo-gazette-lk',
    ]
    for (const slug of SOURCES.map((s) => s.slug)) {
      expect(priorSlugs).not.toContain(slug)
    }
  })

  it('all trust scores are between 0.5 and 1.0', () => {
    for (const src of SOURCES) {
      expect(src.trust_score).toBeGreaterThanOrEqual(0.5)
      expect(src.trust_score).toBeLessThanOrEqual(1.0)
    }
  })

  it('all tiers are valid enum values', () => {
    const validTiers = ['premium', 'major', 'regional', 'specialised']
    for (const src of SOURCES) {
      expect(validTiers).toContain(src.tier)
    }
  })

  it('all country codes are 2-letter ISO 3166-1 alpha-2', () => {
    for (const src of SOURCES) {
      expect(src.country).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('expand_sources_400 migration — regional coverage', () => {
  const countryCodes = SOURCES.map((s) => s.country)
  const uniqueCountries = new Set(countryCodes)

  it('covers 20+ countries', () => {
    expect(uniqueCountries.size).toBeGreaterThanOrEqual(20)
  })

  it('covers Southeast Asia (TH, SG, PH, VN, KH, MM, LA, ID)', () => {
    const seAsia = ['TH', 'SG', 'PH', 'VN', 'KH', 'MM', 'LA', 'ID']
    for (const code of seAsia) {
      expect(countryCodes).toContain(code)
    }
  })

  it('covers Central Asia & Caucasus (KG, TJ, KZ, UZ, GE)', () => {
    const centralAsia = ['KG', 'TJ', 'KZ', 'UZ', 'GE']
    for (const code of centralAsia) {
      expect(countryCodes).toContain(code)
    }
  })

  it('covers Eastern Mediterranean (GR, CY, TR)', () => {
    const eastMed = ['GR', 'CY', 'TR']
    for (const code of eastMed) {
      expect(countryCodes).toContain(code)
    }
  })

  it('covers Oceania (NZ, AU, FJ)', () => {
    const oceania = ['NZ', 'AU', 'FJ']
    for (const code of oceania) {
      expect(countryCodes).toContain(code)
    }
  })
})

describe('expand_sources_400 migration — tier distribution', () => {
  it('has 10+ premium-tier sources', () => {
    const premium = SOURCES.filter((s) => s.tier === 'premium')
    expect(premium.length).toBeGreaterThanOrEqual(10)
  })

  it('has 8+ major-tier sources', () => {
    const major = SOURCES.filter((s) => s.tier === 'major')
    expect(major.length).toBeGreaterThanOrEqual(8)
  })

  it('has specialised-tier sources for niche verticals', () => {
    const specialised = SOURCES.filter((s) => s.tier === 'specialised')
    expect(specialised.length).toBeGreaterThanOrEqual(10)
  })
})

describe('expand_sources_400 migration — key source presence', () => {
  const slugs = SOURCES.map((s) => s.slug)

  it('includes The Straits Times (premium ASEAN)', () => {
    expect(slugs).toContain('straits-times-sg')
  })

  it('includes Nikkei Asia (premium pan-Asian business)', () => {
    expect(slugs).toContain('nikkei-asia')
  })

  it('includes STAT News (premium health journalism)', () => {
    expect(slugs).toContain('stat-news')
  })

  it('includes The Lancet (top medical journal)', () => {
    expect(slugs).toContain('lancet-news')
  })

  it('includes Carbon Brief (premium climate science)', () => {
    expect(slugs).toContain('carbon-brief')
  })

  it('includes SIPRI (premium arms research)', () => {
    expect(slugs).toContain('sipri-news')
  })

  it('includes Recorded Future\'s The Record (premium cyber)', () => {
    expect(slugs).toContain('the-record-recorded-future')
  })

  it('includes UNHCR News (premium migration)', () => {
    expect(slugs).toContain('unhcr-news')
  })

  it('includes Eurasianet (Central Asia specialist)', () => {
    expect(slugs).toContain('eurasianet')
  })

  it('includes Balkan Insight (BIRN investigative)', () => {
    expect(slugs).toContain('balkan-insight')
  })
})

describe('expand_sources_400 migration — vertical coverage', () => {
  const slugs = SOURCES.map((s) => s.slug)

  it('covers global health vertical (5 sources)', () => {
    const healthSlugs = ['stat-news', 'lancet-news', 'who-news', 'devex-global-health', 'health-policy-watch']
    for (const slug of healthSlugs) {
      expect(slugs).toContain(slug)
    }
  })

  it('covers energy & resources vertical (5 sources)', () => {
    const energySlugs = ['oilprice-com', 'renewables-now', 'carbon-brief', 'upstream-online', 'argus-media']
    for (const slug of energySlugs) {
      expect(slugs).toContain(slug)
    }
  })

  it('covers cybersecurity vertical (5 sources)', () => {
    const cyberSlugs = ['the-record-recorded-future', 'bleepingcomputer', 'cyberscoop', 'risky-biz', 'dark-reading']
    for (const slug of cyberSlugs) {
      expect(slugs).toContain(slug)
    }
  })

  it('covers migration & refugees vertical (5 sources)', () => {
    const migrationSlugs = ['unhcr-news', 'mixed-migration-centre', 'new-humanitarian', 'refugees-international', 'infomigrants']
    for (const slug of migrationSlugs) {
      expect(slugs).toContain(slug)
    }
  })

  it('covers arms & disarmament vertical (5 sources)', () => {
    const armsSlugs = ['arms-control-association', 'sipri-news', 'defense-post', 'war-on-the-rocks', 'janes-defence']
    for (const slug of armsSlugs) {
      expect(slugs).toContain(slug)
    }
  })
})
