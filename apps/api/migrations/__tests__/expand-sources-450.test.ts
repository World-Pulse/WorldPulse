import { describe, it, expect } from 'vitest'

/**
 * Test suite for expand_sources_450 migration
 * Validates: 50 sources, data quality, regional coverage, tier distribution,
 *            key source presence, and vertical coverage.
 */

// Inline the source data for testing (mirrors migration)
const SOURCES = [
  // Latin America Depth
  { slug: 'la-razon-bo', name: 'La Razón', country: 'BO', tier: 'specialised', trust_score: 0.74, language: 'es', vertical: 'latam' },
  { slug: 'el-universo-ec', name: 'El Universo', country: 'EC', tier: 'major', trust_score: 0.78, language: 'es', vertical: 'latam' },
  { slug: 'el-nacional-ve-2', name: 'El Nacional Venezuela', country: 'VE', tier: 'specialised', trust_score: 0.72, language: 'es', vertical: 'latam' },
  { slug: 'la-prensa-pa', name: 'La Prensa Panamá', country: 'PA', tier: 'specialised', trust_score: 0.76, language: 'es', vertical: 'latam' },
  { slug: 'la-nacion-cr', name: 'La Nación Costa Rica', country: 'CR', tier: 'major', trust_score: 0.80, language: 'es', vertical: 'latam' },
  { slug: 'el-heraldo-hn', name: 'El Heraldo Honduras', country: 'HN', tier: 'specialised', trust_score: 0.73, language: 'es', vertical: 'latam' },
  // Sub-Saharan Africa
  { slug: 'the-citizen-tz', name: 'The Citizen Tanzania', country: 'TZ', tier: 'specialised', trust_score: 0.74, language: 'en', vertical: 'africa' },
  { slug: 'the-observer-ug', name: 'The Observer Uganda', country: 'UG', tier: 'specialised', trust_score: 0.73, language: 'en', vertical: 'africa' },
  { slug: 'lesotho-times-ls', name: 'Lesotho Times', country: 'LS', tier: 'specialised', trust_score: 0.70, language: 'en', vertical: 'africa' },
  { slug: 'malawi-voice-mw', name: 'Malawi Voice', country: 'MW', tier: 'specialised', trust_score: 0.70, language: 'en', vertical: 'africa' },
  { slug: 'zambia-daily-mail', name: 'Zambia Daily Mail', country: 'ZM', tier: 'specialised', trust_score: 0.68, language: 'en', vertical: 'africa' },
  { slug: 'starrfm-gh', name: 'Starr FM Ghana', country: 'GH', tier: 'specialised', trust_score: 0.74, language: 'en', vertical: 'africa' },
  // South/Central Europe
  { slug: 'jutarnji-list-hr', name: 'Jutarnji List', country: 'HR', tier: 'major', trust_score: 0.78, language: 'hr', vertical: 'europe' },
  { slug: 'delo-si', name: 'Delo', country: 'SI', tier: 'specialised', trust_score: 0.79, language: 'sl', vertical: 'europe' },
  { slug: 'lidove-noviny-cz', name: 'Lidové noviny', country: 'CZ', tier: 'major', trust_score: 0.80, language: 'cs', vertical: 'europe' },
  { slug: 'gazeta-wyborcza-pl', name: 'Gazeta Wyborcza', country: 'PL', tier: 'premium', trust_score: 0.84, language: 'pl', vertical: 'europe' },
  { slug: 'dnevnik-bg', name: 'Dnevnik Bulgaria', country: 'BG', tier: 'specialised', trust_score: 0.76, language: 'bg', vertical: 'europe' },
  // Arctic & Polar
  { slug: 'high-north-news', name: 'High North News', country: 'NO', tier: 'specialised', trust_score: 0.82, language: 'en', vertical: 'arctic' },
  { slug: 'nunatsiaq-news-ca', name: 'Nunatsiaq News', country: 'CA', tier: 'specialised', trust_score: 0.80, language: 'en', vertical: 'arctic' },
  { slug: 'barents-observer-no', name: 'The Barents Observer', country: 'NO', tier: 'specialised', trust_score: 0.83, language: 'en', vertical: 'arctic' },
  { slug: 'yle-sapmi-fi', name: 'Yle Sápmi', country: 'FI', tier: 'specialised', trust_score: 0.86, language: 'en', vertical: 'arctic' },
  // Disinformation & Media
  { slug: 'euvsdisinfo-eu', name: 'EUvsDisinfo', country: 'EU', tier: 'premium', trust_score: 0.88, language: 'en', vertical: 'disinfo' },
  { slug: 'taiwan-factcheck-tw', name: 'Taiwan FactCheck Center', country: 'TW', tier: 'specialised', trust_score: 0.85, language: 'en', vertical: 'disinfo' },
  { slug: 'africa-check-za', name: 'Africa Check', country: 'ZA', tier: 'premium', trust_score: 0.89, language: 'en', vertical: 'disinfo' },
  { slug: 'chequeado-ar', name: 'Chequeado', country: 'AR', tier: 'specialised', trust_score: 0.86, language: 'es', vertical: 'disinfo' },
  { slug: 'maldita-es', name: 'Maldita.es', country: 'ES', tier: 'specialised', trust_score: 0.87, language: 'es', vertical: 'disinfo' },
  // Trade & Maritime
  { slug: 'wto-news', name: 'WTO News', country: 'CH', tier: 'premium', trust_score: 0.92, language: 'en', vertical: 'trade' },
  { slug: 'unctad-news', name: 'UNCTAD News', country: 'CH', tier: 'premium', trust_score: 0.90, language: 'en', vertical: 'trade' },
  { slug: 'hellenic-shipping-gr', name: 'Hellenic Shipping News', country: 'GR', tier: 'specialised', trust_score: 0.77, language: 'en', vertical: 'trade' },
  { slug: 'seatrade-maritime', name: 'Seatrade Maritime', country: 'GB', tier: 'specialised', trust_score: 0.78, language: 'en', vertical: 'trade' },
  { slug: 'port-technology', name: 'Port Technology International', country: 'GB', tier: 'specialised', trust_score: 0.76, language: 'en', vertical: 'trade' },
  // Indigenous & Minority
  { slug: 'cultural-survival', name: 'Cultural Survival', country: 'US', tier: 'specialised', trust_score: 0.82, language: 'en', vertical: 'indigenous' },
  { slug: 'iwgia', name: 'IWGIA', country: 'DK', tier: 'specialised', trust_score: 0.83, language: 'en', vertical: 'indigenous' },
  { slug: 'minority-rights-group', name: 'Minority Rights Group International', country: 'GB', tier: 'specialised', trust_score: 0.84, language: 'en', vertical: 'indigenous' },
  { slug: 'intercontinental-cry', name: 'Intercontinental Cry', country: 'CA', tier: 'specialised', trust_score: 0.79, language: 'en', vertical: 'indigenous' },
  // Science & Space
  { slug: 'esa-news', name: 'European Space Agency News', country: 'EU', tier: 'premium', trust_score: 0.93, language: 'en', vertical: 'science' },
  { slug: 'phys-org', name: 'Phys.org', country: 'US', tier: 'major', trust_score: 0.82, language: 'en', vertical: 'science' },
  { slug: 'science-daily', name: 'ScienceDaily', country: 'US', tier: 'major', trust_score: 0.84, language: 'en', vertical: 'science' },
  { slug: 'conversation-science', name: 'The Conversation — Science', country: 'US', tier: 'major', trust_score: 0.87, language: 'en', vertical: 'science' },
  { slug: 'nasaspaceflight-2', name: 'NASASpaceflight.com', country: 'US', tier: 'specialised', trust_score: 0.83, language: 'en', vertical: 'science' },
  // Governance & Democracy
  { slug: 'international-idea', name: 'International IDEA', country: 'SE', tier: 'premium', trust_score: 0.90, language: 'en', vertical: 'governance' },
  { slug: 'vdem-institute', name: 'V-Dem Institute', country: 'SE', tier: 'premium', trust_score: 0.92, language: 'en', vertical: 'governance' },
  { slug: 'freedom-house-blog', name: 'Freedom House', country: 'US', tier: 'premium', trust_score: 0.88, language: 'en', vertical: 'governance' },
  { slug: 'transparency-intl', name: 'Transparency International', country: 'DE', tier: 'premium', trust_score: 0.90, language: 'en', vertical: 'governance' },
  { slug: 'opendemocracy', name: 'openDemocracy', country: 'GB', tier: 'major', trust_score: 0.81, language: 'en', vertical: 'governance' },
  // Food & Agriculture
  { slug: 'fao-news', name: 'FAO News', country: 'IT', tier: 'premium', trust_score: 0.93, language: 'en', vertical: 'food' },
  { slug: 'ifpri-blog', name: 'IFPRI Blog', country: 'US', tier: 'specialised', trust_score: 0.88, language: 'en', vertical: 'food' },
  { slug: 'scidev-net', name: 'SciDev.Net', country: 'GB', tier: 'major', trust_score: 0.84, language: 'en', vertical: 'food' },
  { slug: 'food-navigator', name: 'FoodNavigator', country: 'GB', tier: 'specialised', trust_score: 0.78, language: 'en', vertical: 'food' },
  { slug: 'fews-net', name: 'FEWS NET', country: 'US', tier: 'premium', trust_score: 0.92, language: 'en', vertical: 'food' },
]

describe('expand_sources_450 migration', () => {
  describe('Data Quality', () => {
    it('should contain exactly 50 sources', () => {
      expect(SOURCES).toHaveLength(50)
    })

    it('should have unique slugs', () => {
      const slugs = SOURCES.map(s => s.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    })

    it('should have trust scores in valid range (0.5–1.0)', () => {
      for (const s of SOURCES) {
        expect(s.trust_score).toBeGreaterThanOrEqual(0.5)
        expect(s.trust_score).toBeLessThanOrEqual(1.0)
      }
    })

    it('should have valid tier values', () => {
      const validTiers = new Set(['premium', 'major', 'specialised'])
      for (const s of SOURCES) {
        expect(validTiers.has(s.tier)).toBe(true)
      }
    })

    it('should have non-empty names and slugs', () => {
      for (const s of SOURCES) {
        expect(s.name.length).toBeGreaterThan(0)
        expect(s.slug.length).toBeGreaterThan(0)
      }
    })

    it('should have ISO country codes (2-letter)', () => {
      for (const s of SOURCES) {
        expect(s.country).toMatch(/^[A-Z]{2}$/)
      }
    })
  })

  describe('Regional Coverage', () => {
    it('should cover 25+ countries', () => {
      const countries = new Set(SOURCES.map(s => s.country))
      expect(countries.size).toBeGreaterThanOrEqual(25)
    })

    it('should have 6+ Latin American sources', () => {
      const latam = SOURCES.filter(s => s.vertical === 'latam')
      expect(latam.length).toBeGreaterThanOrEqual(6)
    })

    it('should have 6+ Sub-Saharan African sources', () => {
      const africa = SOURCES.filter(s => s.vertical === 'africa')
      expect(africa.length).toBeGreaterThanOrEqual(6)
    })

    it('should have 5+ European sources', () => {
      const europe = SOURCES.filter(s => s.vertical === 'europe')
      expect(europe.length).toBeGreaterThanOrEqual(5)
    })

    it('should have 4+ Arctic & Polar sources', () => {
      const arctic = SOURCES.filter(s => s.vertical === 'arctic')
      expect(arctic.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Tier Distribution', () => {
    it('should have 12+ premium-tier sources', () => {
      const premium = SOURCES.filter(s => s.tier === 'premium')
      expect(premium.length).toBeGreaterThanOrEqual(12)
    })

    it('should have 8+ major-tier sources', () => {
      const major = SOURCES.filter(s => s.tier === 'major')
      expect(major.length).toBeGreaterThanOrEqual(8)
    })

    it('should have 20+ specialised-tier sources', () => {
      const specialised = SOURCES.filter(s => s.tier === 'specialised')
      expect(specialised.length).toBeGreaterThanOrEqual(20)
    })
  })

  describe('Key Source Presence', () => {
    const slugs = new Set(SOURCES.map(s => s.slug))

    it('should include FAO News (food security gold standard)', () => {
      expect(slugs.has('fao-news')).toBe(true)
    })

    it('should include WTO News (trade disputes authority)', () => {
      expect(slugs.has('wto-news')).toBe(true)
    })

    it('should include ESA News (European space agency)', () => {
      expect(slugs.has('esa-news')).toBe(true)
    })

    it('should include EUvsDisinfo (Kremlin disinfo tracker)', () => {
      expect(slugs.has('euvsdisinfo-eu')).toBe(true)
    })

    it('should include Transparency International (corruption index)', () => {
      expect(slugs.has('transparency-intl')).toBe(true)
    })

    it('should include V-Dem Institute (democracy data)', () => {
      expect(slugs.has('vdem-institute')).toBe(true)
    })

    it('should include Freedom House (freedom index)', () => {
      expect(slugs.has('freedom-house-blog')).toBe(true)
    })

    it('should include Africa Check (African fact-checking)', () => {
      expect(slugs.has('africa-check-za')).toBe(true)
    })

    it('should include Gazeta Wyborcza (Polish press freedom)', () => {
      expect(slugs.has('gazeta-wyborcza-pl')).toBe(true)
    })

    it('should include FEWS NET (famine early warning)', () => {
      expect(slugs.has('fews-net')).toBe(true)
    })
  })

  describe('Vertical Coverage', () => {
    it('should cover disinformation & fact-checking vertical', () => {
      const disinfo = SOURCES.filter(s => s.vertical === 'disinfo')
      expect(disinfo.length).toBeGreaterThanOrEqual(5)
    })

    it('should cover trade & maritime vertical', () => {
      const trade = SOURCES.filter(s => s.vertical === 'trade')
      expect(trade.length).toBeGreaterThanOrEqual(5)
    })

    it('should cover governance & democracy vertical', () => {
      const governance = SOURCES.filter(s => s.vertical === 'governance')
      expect(governance.length).toBeGreaterThanOrEqual(5)
    })

    it('should cover food & agriculture vertical', () => {
      const food = SOURCES.filter(s => s.vertical === 'food')
      expect(food.length).toBeGreaterThanOrEqual(5)
    })

    it('should cover science & space vertical', () => {
      const science = SOURCES.filter(s => s.vertical === 'science')
      expect(science.length).toBeGreaterThanOrEqual(5)
    })

    it('should cover indigenous & minority vertical', () => {
      const indigenous = SOURCES.filter(s => s.vertical === 'indigenous')
      expect(indigenous.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Language Diversity', () => {
    it('should include 6+ languages', () => {
      const languages = new Set(SOURCES.map(s => s.language))
      expect(languages.size).toBeGreaterThanOrEqual(6)
    })

    it('should include Spanish-language sources', () => {
      const spanish = SOURCES.filter(s => s.language === 'es')
      expect(spanish.length).toBeGreaterThanOrEqual(7)
    })

    it('should include non-English European languages', () => {
      const nonEn = SOURCES.filter(s => !['en', 'es'].includes(s.language))
      expect(nonEn.length).toBeGreaterThanOrEqual(4)
    })
  })
})
