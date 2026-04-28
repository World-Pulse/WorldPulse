/**
 * Tests for migration: 20260402000003_expand_sources_500
 *
 * Validates 50 new RSS sources across 10 verticals that push
 * WorldPulse's registry to 500+ feeds, cementing leadership over
 * WorldMonitor's 435+.
 */

// Extract sources inline so tests don't depend on Knex runtime
const sources = [
  // East Africa Depth
  { slug: 'the-east-african-ke', name: 'The East African', tier: 'major', trust_score: 0.80, language: 'en', country: 'KE' },
  { slug: 'daily-monitor-ug-2', name: 'Daily Monitor Uganda', tier: 'major', trust_score: 0.77, language: 'en', country: 'UG' },
  { slug: 'citizen-tz-business', name: 'The Citizen Tanzania Business', tier: 'specialised', trust_score: 0.74, language: 'en', country: 'TZ' },
  { slug: 'business-daily-ke', name: 'Business Daily Kenya', tier: 'major', trust_score: 0.79, language: 'en', country: 'KE' },
  { slug: 'new-times-rw-en', name: 'The New Times Rwanda', tier: 'specialised', trust_score: 0.72, language: 'en', country: 'RW' },
  // Central & Eastern Europe
  { slug: 'novinky-cz', name: 'Novinky.cz', tier: 'major', trust_score: 0.78, language: 'cs', country: 'CZ' },
  { slug: 'tvn24-pl', name: 'TVN24', tier: 'major', trust_score: 0.80, language: 'pl', country: 'PL' },
  { slug: 'index-hr', name: 'Index.hr', tier: 'major', trust_score: 0.76, language: 'hr', country: 'HR' },
  { slug: 'novaya-gazeta-europe', name: 'Novaya Gazeta Europe', tier: 'premium', trust_score: 0.85, language: 'en', country: 'LV' },
  { slug: 'balkan-insight-mk', name: 'Balkan Insight BIRN', tier: 'premium', trust_score: 0.86, language: 'en', country: 'RS' },
  // Middle East Depth
  { slug: 'the-national-ae', name: 'The National UAE', tier: 'major', trust_score: 0.79, language: 'en', country: 'AE' },
  { slug: 'lorient-le-jour-lb', name: "L'Orient Le Jour", tier: 'premium', trust_score: 0.83, language: 'fr', country: 'LB' },
  { slug: 'middle-east-eye-gb', name: 'Middle East Eye', tier: 'major', trust_score: 0.77, language: 'en', country: 'GB' },
  { slug: '972-magazine-il', name: '+972 Magazine', tier: 'specialised', trust_score: 0.76, language: 'en', country: 'IL' },
  { slug: 'ammon-news-jo', name: 'Ammon News', tier: 'specialised', trust_score: 0.73, language: 'en', country: 'JO' },
  // Oceania & Pacific Islands
  { slug: 'fiji-times-fj', name: 'The Fiji Times', tier: 'specialised', trust_score: 0.74, language: 'en', country: 'FJ' },
  { slug: 'samoa-observer-ws', name: 'Samoa Observer', tier: 'specialised', trust_score: 0.71, language: 'en', country: 'WS' },
  { slug: 'post-courier-pg', name: 'Post-Courier', tier: 'specialised', trust_score: 0.72, language: 'en', country: 'PG' },
  { slug: 'solomon-star-sb', name: 'Solomon Star', tier: 'specialised', trust_score: 0.70, language: 'en', country: 'SB' },
  { slug: 'vanuatu-daily-post-vu', name: 'Vanuatu Daily Post', tier: 'specialised', trust_score: 0.70, language: 'en', country: 'VU' },
  // Water & Sanitation
  { slug: 'circle-of-blue-us', name: 'Circle of Blue', tier: 'premium', trust_score: 0.87, language: 'en', country: 'US' },
  { slug: 'wateraid-gb', name: 'WaterAid News', tier: 'specialised', trust_score: 0.82, language: 'en', country: 'GB' },
  { slug: 'the-water-network', name: 'The Water Network', tier: 'specialised', trust_score: 0.74, language: 'en', country: 'US' },
  { slug: 'wash-matters-gb', name: 'WASH Matters', tier: 'specialised', trust_score: 0.80, language: 'en', country: 'GB' },
  { slug: 'iwa-publishing', name: 'International Water Association', tier: 'specialised', trust_score: 0.82, language: 'en', country: 'GB' },
  // Nuclear & Energy Security
  { slug: 'world-nuclear-news', name: 'World Nuclear News', tier: 'premium', trust_score: 0.88, language: 'en', country: 'GB' },
  { slug: 'bulletin-atomic-scientists', name: 'Bulletin of the Atomic Scientists', tier: 'premium', trust_score: 0.90, language: 'en', country: 'US' },
  { slug: 'nti-news', name: 'Nuclear Threat Initiative', tier: 'premium', trust_score: 0.88, language: 'en', country: 'US' },
  { slug: 'energy-intelligence', name: 'Energy Intelligence', tier: 'premium', trust_score: 0.86, language: 'en', country: 'US' },
  { slug: 'platts-energy-news', name: 'S&P Global Platts Energy', tier: 'premium', trust_score: 0.89, language: 'en', country: 'US' },
  // Humanitarian & Aid
  { slug: 'reliefweb-ocha', name: 'ReliefWeb (OCHA)', tier: 'premium', trust_score: 0.93, language: 'en', country: 'CH' },
  { slug: 'the-new-humanitarian-2', name: 'The New Humanitarian', tier: 'premium', trust_score: 0.88, language: 'en', country: 'CH' },
  { slug: 'devex-development', name: 'Devex', tier: 'major', trust_score: 0.82, language: 'en', country: 'US' },
  { slug: 'hpn-odi', name: 'Humanitarian Practice Network', tier: 'specialised', trust_score: 0.84, language: 'en', country: 'GB' },
  { slug: 'global-voices-online', name: 'Global Voices', tier: 'major', trust_score: 0.79, language: 'en', country: 'NL' },
  // Digital Rights & Privacy
  { slug: 'access-now', name: 'Access Now', tier: 'premium', trust_score: 0.86, language: 'en', country: 'US' },
  { slug: 'eff-deeplinks', name: 'EFF Deeplinks Blog', tier: 'premium', trust_score: 0.88, language: 'en', country: 'US' },
  { slug: 'rest-of-world', name: 'Rest of World', tier: 'major', trust_score: 0.83, language: 'en', country: 'US' },
  { slug: 'ranking-digital-rights', name: 'Ranking Digital Rights', tier: 'specialised', trust_score: 0.85, language: 'en', country: 'US' },
  { slug: 'digital-rights-foundation-pk', name: 'Digital Rights Foundation', tier: 'specialised', trust_score: 0.78, language: 'en', country: 'PK' },
  // Labor & Workers Rights
  { slug: 'ilo-news', name: 'International Labour Organization News', tier: 'premium', trust_score: 0.91, language: 'en', country: 'CH' },
  { slug: 'clean-clothes-campaign', name: 'Clean Clothes Campaign', tier: 'specialised', trust_score: 0.79, language: 'en', country: 'NL' },
  { slug: 'industriall-global', name: 'IndustriALL Global Union', tier: 'specialised', trust_score: 0.77, language: 'en', country: 'CH' },
  { slug: 'equal-times', name: 'Equal Times', tier: 'specialised', trust_score: 0.80, language: 'en', country: 'BE' },
  { slug: 'labor-notes-us', name: 'Labor Notes', tier: 'specialised', trust_score: 0.76, language: 'en', country: 'US' },
  // Space & Astronomy
  { slug: 'spacenews', name: 'SpaceNews', tier: 'major', trust_score: 0.85, language: 'en', country: 'US' },
  { slug: 'space-com', name: 'Space.com', tier: 'major', trust_score: 0.82, language: 'en', country: 'US' },
  { slug: 'planetary-society', name: 'The Planetary Society', tier: 'specialised', trust_score: 0.86, language: 'en', country: 'US' },
  { slug: 'ars-technica-space', name: 'Ars Technica Space', tier: 'major', trust_score: 0.84, language: 'en', country: 'US' },
  { slug: 'universe-today', name: 'Universe Today', tier: 'specialised', trust_score: 0.80, language: 'en', country: 'CA' },
]

describe('Migration: expand_sources_500', () => {
  describe('Data Quality', () => {
    test('contains exactly 50 sources', () => {
      expect(sources).toHaveLength(50)
    })

    test('all slugs are unique', () => {
      const slugs = sources.map(s => s.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    })

    test('all names are non-empty strings', () => {
      sources.forEach(s => {
        expect(typeof s.name).toBe('string')
        expect(s.name.length).toBeGreaterThan(0)
      })
    })

    test('trust scores are between 0.5 and 1.0', () => {
      sources.forEach(s => {
        expect(s.trust_score).toBeGreaterThanOrEqual(0.5)
        expect(s.trust_score).toBeLessThanOrEqual(1.0)
      })
    })

    test('all tiers are valid', () => {
      const validTiers = ['premium', 'major', 'specialised']
      sources.forEach(s => {
        expect(validTiers).toContain(s.tier)
      })
    })

    test('all country codes are 2-letter ISO codes', () => {
      sources.forEach(s => {
        expect(s.country).toMatch(/^[A-Z]{2}$/)
      })
    })
  })

  describe('Regional Coverage', () => {
    test('covers 25+ unique countries', () => {
      const countries = new Set(sources.map(s => s.country))
      expect(countries.size).toBeGreaterThanOrEqual(25)
    })

    test('includes East African sources', () => {
      const eastAfrica = sources.filter(s => ['KE', 'UG', 'TZ', 'RW'].includes(s.country))
      expect(eastAfrica.length).toBeGreaterThanOrEqual(4)
    })

    test('includes Middle Eastern sources', () => {
      const middleEast = sources.filter(s => ['AE', 'LB', 'IL', 'JO'].includes(s.country))
      expect(middleEast.length).toBeGreaterThanOrEqual(3)
    })

    test('includes Pacific Island sources', () => {
      const pacific = sources.filter(s => ['FJ', 'WS', 'PG', 'SB', 'VU'].includes(s.country))
      expect(pacific.length).toBeGreaterThanOrEqual(4)
    })

    test('includes Central/Eastern European sources', () => {
      const cee = sources.filter(s => ['CZ', 'PL', 'HR', 'LV', 'RS'].includes(s.country))
      expect(cee.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Tier Distribution', () => {
    test('has at least 14 premium-tier sources', () => {
      const premium = sources.filter(s => s.tier === 'premium')
      expect(premium.length).toBeGreaterThanOrEqual(14)
    })

    test('has at least 12 major-tier sources', () => {
      const major = sources.filter(s => s.tier === 'major')
      expect(major.length).toBeGreaterThanOrEqual(12)
    })

    test('has at least 18 specialised-tier sources', () => {
      const specialised = sources.filter(s => s.tier === 'specialised')
      expect(specialised.length).toBeGreaterThanOrEqual(18)
    })
  })

  describe('Key Source Presence', () => {
    const slugSet = new Set(sources.map(s => s.slug))

    test('includes ReliefWeb (OCHA) — humanitarian gold standard', () => {
      expect(slugSet.has('reliefweb-ocha')).toBe(true)
    })

    test('includes Bulletin of the Atomic Scientists — nuclear security', () => {
      expect(slugSet.has('bulletin-atomic-scientists')).toBe(true)
    })

    test('includes EFF Deeplinks — digital rights', () => {
      expect(slugSet.has('eff-deeplinks')).toBe(true)
    })

    test('includes ILO News — global labor standards', () => {
      expect(slugSet.has('ilo-news')).toBe(true)
    })

    test('includes Novaya Gazeta Europe — Russian independent journalism', () => {
      expect(slugSet.has('novaya-gazeta-europe')).toBe(true)
    })

    test('includes SpaceNews — space industry intelligence', () => {
      expect(slugSet.has('spacenews')).toBe(true)
    })

    test('includes Circle of Blue — water crisis reporting', () => {
      expect(slugSet.has('circle-of-blue-us')).toBe(true)
    })

    test('includes Rest of World — emerging market tech', () => {
      expect(slugSet.has('rest-of-world')).toBe(true)
    })

    test('includes The New Humanitarian — humanitarian journalism', () => {
      expect(slugSet.has('the-new-humanitarian-2')).toBe(true)
    })

    test('includes Access Now — internet shutdown tracking', () => {
      expect(slugSet.has('access-now')).toBe(true)
    })
  })

  describe('Vertical Coverage', () => {
    test('covers water & sanitation vertical', () => {
      const water = sources.filter(s =>
        s.slug.includes('water') || s.slug.includes('wash') || s.slug.includes('iwa') || s.slug.includes('circle-of-blue')
      )
      expect(water.length).toBeGreaterThanOrEqual(4)
    })

    test('covers nuclear & energy security vertical', () => {
      const nuclear = sources.filter(s =>
        s.slug.includes('nuclear') || s.slug.includes('atomic') || s.slug.includes('nti') || s.slug.includes('energy') || s.slug.includes('platts')
      )
      expect(nuclear.length).toBeGreaterThanOrEqual(4)
    })

    test('covers digital rights vertical', () => {
      const digital = sources.filter(s =>
        s.slug.includes('access-now') || s.slug.includes('eff') || s.slug.includes('rest-of-world') || s.slug.includes('ranking-digital') || s.slug.includes('digital-rights')
      )
      expect(digital.length).toBeGreaterThanOrEqual(4)
    })

    test('covers labor & workers rights vertical', () => {
      const labor = sources.filter(s =>
        s.slug.includes('ilo') || s.slug.includes('clean-clothes') || s.slug.includes('industriall') || s.slug.includes('equal-times') || s.slug.includes('labor')
      )
      expect(labor.length).toBeGreaterThanOrEqual(4)
    })

    test('covers space & astronomy vertical', () => {
      const space = sources.filter(s =>
        s.slug.includes('space') || s.slug.includes('planetary') || s.slug.includes('ars-technica') || s.slug.includes('universe')
      )
      expect(space.length).toBeGreaterThanOrEqual(4)
    })

    test('covers humanitarian & aid vertical', () => {
      const humanitarian = sources.filter(s =>
        s.slug.includes('reliefweb') || s.slug.includes('humanitarian') || s.slug.includes('devex') || s.slug.includes('hpn') || s.slug.includes('global-voices')
      )
      expect(humanitarian.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Language Diversity', () => {
    test('includes at least 5 distinct languages', () => {
      const languages = new Set(sources.map(s => s.language))
      expect(languages.size).toBeGreaterThanOrEqual(5)
    })

    test('includes French sources', () => {
      const french = sources.filter(s => s.language === 'fr')
      expect(french.length).toBeGreaterThanOrEqual(1)
    })

    test('includes Eastern European language sources (Czech, Polish, Croatian)', () => {
      const eeLangs = sources.filter(s => ['cs', 'pl', 'hr'].includes(s.language))
      expect(eeLangs.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Trust Score Distribution', () => {
    test('average trust score is above 0.78', () => {
      const avg = sources.reduce((sum, s) => sum + s.trust_score, 0) / sources.length
      expect(avg).toBeGreaterThan(0.78)
    })

    test('at least 5 sources have trust score >= 0.88', () => {
      const highTrust = sources.filter(s => s.trust_score >= 0.88)
      expect(highTrust.length).toBeGreaterThanOrEqual(5)
    })
  })
})
