import { describe, it, expect } from 'vitest'

/**
 * Tests for migration: 20260406000001_expand_sources_550.ts
 *
 * Validates 50 new RSS sources across 10 verticals that bring
 * WorldPulse to 550+ curated feeds (1.26x WorldMonitor).
 */

// ─── Inline source data (mirrors migration) ─────────────────────────────────

const SOURCES = [
  // West Africa Anglophone
  { slug: 'premium-times-ng', name: 'Premium Times Nigeria', country: 'NG', language: 'en', tier: 'premium', trust_score: 0.82, vertical: 'west-africa-anglophone' },
  { slug: 'ghanaweb-gh', name: 'GhanaWeb', country: 'GH', language: 'en', tier: 'major', trust_score: 0.75, vertical: 'west-africa-anglophone' },
  { slug: 'sierra-leone-telegraph-sl', name: 'Sierra Leone Telegraph', country: 'SL', language: 'en', tier: 'specialised', trust_score: 0.72, vertical: 'west-africa-anglophone' },
  { slug: 'liberian-observer-lr', name: 'Liberian Observer', country: 'LR', language: 'en', tier: 'specialised', trust_score: 0.70, vertical: 'west-africa-anglophone' },
  { slug: 'the-gambia-standard-gm', name: 'The Standard (Gambia)', country: 'GM', language: 'en', tier: 'specialised', trust_score: 0.70, vertical: 'west-africa-anglophone' },

  // Francophone Africa
  { slug: 'jeune-afrique-fr', name: 'Jeune Afrique', country: 'FR', language: 'fr', tier: 'premium', trust_score: 0.85, vertical: 'francophone-africa' },
  { slug: 'rfi-afrique-fr', name: 'RFI Afrique', country: 'FR', language: 'fr', tier: 'premium', trust_score: 0.88, vertical: 'francophone-africa' },
  { slug: 'le-monde-afrique-fr', name: 'Le Monde Afrique', country: 'FR', language: 'fr', tier: 'premium', trust_score: 0.90, vertical: 'francophone-africa' },
  { slug: 'abidjan-net-ci', name: 'Abidjan.net', country: 'CI', language: 'fr', tier: 'major', trust_score: 0.73, vertical: 'francophone-africa' },
  { slug: 'le-faso-bf', name: 'LeFaso.net', country: 'BF', language: 'fr', tier: 'specialised', trust_score: 0.70, vertical: 'francophone-africa' },

  // Caribbean & Small Island States
  { slug: 'jamaica-gleaner-jm', name: 'Jamaica Gleaner', country: 'JM', language: 'en', tier: 'major', trust_score: 0.80, vertical: 'caribbean' },
  { slug: 'trinidad-express-tt', name: 'Trinidad Express', country: 'TT', language: 'en', tier: 'major', trust_score: 0.76, vertical: 'caribbean' },
  { slug: 'barbados-today-bb', name: 'Barbados Today', country: 'BB', language: 'en', tier: 'specialised', trust_score: 0.74, vertical: 'caribbean' },
  { slug: 'st-lucia-times-lc', name: 'St. Lucia Times', country: 'LC', language: 'en', tier: 'specialised', trust_score: 0.72, vertical: 'caribbean' },
  { slug: 'guyana-chronicle-gy', name: 'Guyana Chronicle', country: 'GY', language: 'en', tier: 'major', trust_score: 0.73, vertical: 'caribbean' },

  // Conflict & Peace Studies
  { slug: 'international-crisis-group', name: 'International Crisis Group', country: 'BE', language: 'en', tier: 'premium', trust_score: 0.92, vertical: 'conflict-peace' },
  { slug: 'prio-no', name: 'Peace Research Institute Oslo (PRIO)', country: 'NO', language: 'en', tier: 'specialised', trust_score: 0.90, vertical: 'conflict-peace' },
  { slug: 'sipri-se', name: 'Stockholm International Peace Research Institute (SIPRI)', country: 'SE', language: 'en', tier: 'premium', trust_score: 0.93, vertical: 'conflict-peace' },
  { slug: 'conciliation-resources-gb', name: 'Conciliation Resources', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.85, vertical: 'conflict-peace' },
  { slug: 'saferworld-gb', name: 'Saferworld', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.84, vertical: 'conflict-peace' },

  // Supply Chain & Trade
  { slug: 'supply-chain-dive-us', name: 'Supply Chain Dive', country: 'US', language: 'en', tier: 'major', trust_score: 0.82, vertical: 'supply-chain' },
  { slug: 'freightwaves-us', name: 'FreightWaves', country: 'US', language: 'en', tier: 'major', trust_score: 0.80, vertical: 'supply-chain' },
  { slug: 'the-loadstar-gb', name: 'The Loadstar', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.80, vertical: 'supply-chain' },
  { slug: 'journal-of-commerce-us', name: 'Journal of Commerce', country: 'US', language: 'en', tier: 'premium', trust_score: 0.88, vertical: 'supply-chain' },
  { slug: 'container-news-gb', name: 'Container News', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.76, vertical: 'supply-chain' },

  // Education & Development
  { slug: 'unesco-news', name: 'UNESCO News', country: 'FR', language: 'en', tier: 'premium', trust_score: 0.90, vertical: 'education' },
  { slug: 'university-world-news-za', name: 'University World News', country: 'ZA', language: 'en', tier: 'major', trust_score: 0.82, vertical: 'education' },
  { slug: 'times-higher-education-gb', name: 'Times Higher Education', country: 'GB', language: 'en', tier: 'premium', trust_score: 0.85, vertical: 'education' },
  { slug: 'the-pie-news-gb', name: 'The PIE News', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.78, vertical: 'education' },
  { slug: 'global-partnership-education', name: 'Global Partnership for Education', country: 'US', language: 'en', tier: 'specialised', trust_score: 0.86, vertical: 'education' },

  // Wildlife & Conservation
  { slug: 'mongabay-us', name: 'Mongabay', country: 'US', language: 'en', tier: 'premium', trust_score: 0.88, vertical: 'wildlife-conservation' },
  { slug: 'traffic-wildlife-trade', name: 'TRAFFIC', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.88, vertical: 'wildlife-conservation' },
  { slug: 'wwf-news', name: 'WWF News', country: 'US', language: 'en', tier: 'premium', trust_score: 0.86, vertical: 'wildlife-conservation' },
  { slug: 'iucn-news', name: 'IUCN News', country: 'CH', language: 'en', tier: 'premium', trust_score: 0.90, vertical: 'wildlife-conservation' },
  { slug: 'conservation-international', name: 'Conservation International', country: 'US', language: 'en', tier: 'major', trust_score: 0.85, vertical: 'wildlife-conservation' },

  // Disability & Inclusion
  { slug: 'disability-rights-intl', name: 'Disability Rights International', country: 'US', language: 'en', tier: 'specialised', trust_score: 0.82, vertical: 'disability-inclusion' },
  { slug: 'inclusive-city-maker', name: 'Inclusive City Maker', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.72, vertical: 'disability-inclusion' },
  { slug: 'leonard-cheshire-gb', name: 'Leonard Cheshire', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.80, vertical: 'disability-inclusion' },
  { slug: 'light-for-the-world-at', name: 'Light for the World', country: 'AT', language: 'en', tier: 'specialised', trust_score: 0.80, vertical: 'disability-inclusion' },
  { slug: 'intl-disability-alliance', name: 'International Disability Alliance', country: 'CH', language: 'en', tier: 'specialised', trust_score: 0.83, vertical: 'disability-inclusion' },

  // Corruption & Transparency
  { slug: 'occrp', name: 'OCCRP', country: 'NL', language: 'en', tier: 'premium', trust_score: 0.93, vertical: 'corruption-transparency' },
  { slug: 'global-witness-gb', name: 'Global Witness', country: 'GB', language: 'en', tier: 'premium', trust_score: 0.90, vertical: 'corruption-transparency' },
  { slug: 'tax-justice-network-gb', name: 'Tax Justice Network', country: 'GB', language: 'en', tier: 'specialised', trust_score: 0.85, vertical: 'corruption-transparency' },
  { slug: 'star-stolen-asset-recovery', name: 'StAR Initiative', country: 'US', language: 'en', tier: 'specialised', trust_score: 0.88, vertical: 'corruption-transparency' },
  { slug: 'anti-corruption-digest', name: 'Anti-Corruption Digest', country: 'US', language: 'en', tier: 'specialised', trust_score: 0.76, vertical: 'corruption-transparency' },

  // Artificial Intelligence
  { slug: 'stanford-ai-index', name: 'Stanford HAI AI Index', country: 'US', language: 'en', tier: 'premium', trust_score: 0.94, vertical: 'artificial-intelligence' },
  { slug: 'ai-news-gb', name: 'AI News', country: 'GB', language: 'en', tier: 'major', trust_score: 0.78, vertical: 'artificial-intelligence' },
  { slug: 'mit-tech-review-ai', name: 'MIT Technology Review — AI', country: 'US', language: 'en', tier: 'premium', trust_score: 0.92, vertical: 'artificial-intelligence' },
  { slug: 'venturebeat-ai', name: 'VentureBeat AI', country: 'US', language: 'en', tier: 'major', trust_score: 0.82, vertical: 'artificial-intelligence' },
  { slug: 'the-batch-deeplearningai', name: 'The Batch (DeepLearning.AI)', country: 'US', language: 'en', tier: 'major', trust_score: 0.88, vertical: 'artificial-intelligence' },
]

const VERTICALS = [
  'west-africa-anglophone',
  'francophone-africa',
  'caribbean',
  'conflict-peace',
  'supply-chain',
  'education',
  'wildlife-conservation',
  'disability-inclusion',
  'corruption-transparency',
  'artificial-intelligence',
]

const VALID_TIERS     = ['premium', 'major', 'specialised'] as const
const VALID_LANGUAGES = ['en', 'fr'] as const

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('expand-sources-550 — data quality', () => {
  it('contains exactly 50 sources', () => {
    expect(SOURCES).toHaveLength(50)
  })

  it('every slug is non-empty and kebab-case', () => {
    for (const s of SOURCES) {
      expect(s.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('no duplicate slugs', () => {
    const slugs = SOURCES.map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('every trust_score is between 0.5 and 1.0', () => {
    for (const s of SOURCES) {
      expect(s.trust_score).toBeGreaterThanOrEqual(0.5)
      expect(s.trust_score).toBeLessThanOrEqual(1.0)
    }
  })

  it('every tier is valid', () => {
    for (const s of SOURCES) {
      expect(VALID_TIERS).toContain(s.tier)
    }
  })

  it('every language is valid', () => {
    for (const s of SOURCES) {
      expect(VALID_LANGUAGES).toContain(s.language)
    }
  })
})

describe('expand-sources-550 — regional coverage', () => {
  it('covers all 10 verticals', () => {
    const covered = new Set(SOURCES.map(s => s.vertical))
    for (const v of VERTICALS) {
      expect(covered.has(v)).toBe(true)
    }
  })

  it('each vertical has exactly 5 sources', () => {
    for (const v of VERTICALS) {
      const count = SOURCES.filter(s => s.vertical === v).length
      expect(count).toBe(5)
    }
  })

  it('sources span 20+ unique countries', () => {
    const countries = new Set(SOURCES.map(s => s.country))
    expect(countries.size).toBeGreaterThanOrEqual(20)
  })

  it('includes both anglophone and francophone sources', () => {
    const en = SOURCES.filter(s => s.language === 'en')
    const fr = SOURCES.filter(s => s.language === 'fr')
    expect(en.length).toBeGreaterThan(0)
    expect(fr.length).toBeGreaterThan(0)
  })

  it('francophone coverage spans multiple countries', () => {
    const frCountries = new Set(SOURCES.filter(s => s.language === 'fr').map(s => s.country))
    expect(frCountries.size).toBeGreaterThanOrEqual(3)
  })
})

describe('expand-sources-550 — tier distribution', () => {
  it('has at least 10 premium-tier sources', () => {
    const premium = SOURCES.filter(s => s.tier === 'premium')
    expect(premium.length).toBeGreaterThanOrEqual(10)
  })

  it('has at least 10 major-tier sources', () => {
    const major = SOURCES.filter(s => s.tier === 'major')
    expect(major.length).toBeGreaterThanOrEqual(10)
  })

  it('premium sources have trust_score >= 0.82', () => {
    for (const s of SOURCES.filter(s => s.tier === 'premium')) {
      expect(s.trust_score).toBeGreaterThanOrEqual(0.82)
    }
  })
})

describe('expand-sources-550 — key source presence', () => {
  const slugs = new Set(SOURCES.map(s => s.slug))

  it('includes OCCRP (premier investigative journalism)', () => {
    expect(slugs.has('occrp')).toBe(true)
  })

  it('includes International Crisis Group (conflict)', () => {
    expect(slugs.has('international-crisis-group')).toBe(true)
  })

  it('includes SIPRI (arms/disarmament)', () => {
    expect(slugs.has('sipri-se')).toBe(true)
  })

  it('includes Mongabay (conservation)', () => {
    expect(slugs.has('mongabay-us')).toBe(true)
  })

  it('includes Premium Times Nigeria (W. Africa)', () => {
    expect(slugs.has('premium-times-ng')).toBe(true)
  })

  it('includes Jeune Afrique (francophone)', () => {
    expect(slugs.has('jeune-afrique-fr')).toBe(true)
  })

  it('includes Stanford HAI AI Index', () => {
    expect(slugs.has('stanford-ai-index')).toBe(true)
  })

  it('includes MIT Technology Review AI', () => {
    expect(slugs.has('mit-tech-review-ai')).toBe(true)
  })

  it('includes UNESCO News (education)', () => {
    expect(slugs.has('unesco-news')).toBe(true)
  })

  it('includes Global Witness (transparency)', () => {
    expect(slugs.has('global-witness-gb')).toBe(true)
  })
})

describe('expand-sources-550 — vertical coverage', () => {
  it('West Africa Anglophone covers NG, GH, SL, LR, GM', () => {
    const countries = SOURCES.filter(s => s.vertical === 'west-africa-anglophone').map(s => s.country)
    expect(countries).toContain('NG')
    expect(countries).toContain('GH')
    expect(countries).toContain('SL')
    expect(countries).toContain('LR')
    expect(countries).toContain('GM')
  })

  it('Caribbean covers JM, TT, BB, LC, GY', () => {
    const countries = SOURCES.filter(s => s.vertical === 'caribbean').map(s => s.country)
    expect(countries).toContain('JM')
    expect(countries).toContain('TT')
    expect(countries).toContain('BB')
    expect(countries).toContain('LC')
    expect(countries).toContain('GY')
  })

  it('Conflict & Peace includes premium-tier research institutes', () => {
    const premium = SOURCES.filter(s => s.vertical === 'conflict-peace' && s.tier === 'premium')
    expect(premium.length).toBeGreaterThanOrEqual(2)
  })

  it('AI vertical includes both academic and industry sources', () => {
    const aiSources = SOURCES.filter(s => s.vertical === 'artificial-intelligence')
    const academic = aiSources.filter(s => s.slug.includes('stanford') || s.slug.includes('mit'))
    const industry = aiSources.filter(s => s.slug.includes('venturebeat') || s.slug.includes('ai-news'))
    expect(academic.length).toBeGreaterThanOrEqual(1)
    expect(industry.length).toBeGreaterThanOrEqual(1)
  })

  it('Conservation vertical has high average trust score', () => {
    const conservation = SOURCES.filter(s => s.vertical === 'wildlife-conservation')
    const avg = conservation.reduce((sum, s) => sum + s.trust_score, 0) / conservation.length
    expect(avg).toBeGreaterThanOrEqual(0.85)
  })
})
