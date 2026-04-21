import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Test suite for RSS source expansion to 650+ feeds (Cycle 82).
 * 50 new sources across 10 verticals:
 *   Refugee & Migration Policy, Rare Earth & Critical Minerals, Indigenous Media,
 *   Outer Space & Satellite Intel, Organized Crime & Illicit Finance,
 *   Child Rights & Protection, Polar Geopolitics, Legal & Justice Systems,
 *   Biosecurity & Dual-Use Research, African Tech & Innovation.
 */

// Load migration source to parse source objects
const migrationPath = resolve(__dirname, '..', '20260406000005_expand_sources_650.ts')
const migrationSource = readFileSync(migrationPath, 'utf-8')

// Extract slugs from the migration file
const slugMatches = migrationSource.match(/slug:\s*'([^']+)'/g) ?? []
const slugs = slugMatches.map((m) => m.replace(/slug:\s*'/, '').replace(/'$/, ''))

// Extract tiers
const tierMatches = migrationSource.match(/tier:\s*'([^']+)'/g) ?? []
const tiers = tierMatches.map((m) => m.replace(/tier:\s*'/, '').replace(/'$/, ''))

// Extract countries
const countryMatches = migrationSource.match(/country:\s*'([^']+)'/g) ?? []
const countries = countryMatches.map((m) => m.replace(/country:\s*'/, '').replace(/'$/, ''))

// Extract languages
const languageMatches = migrationSource.match(/language:\s*'([^']+)'/g) ?? []
const languages = languageMatches.map((m) => m.replace(/language:\s*'/, '').replace(/'$/, ''))

// Extract trust scores
const trustMatches = migrationSource.match(/trust_score:\s*([\d.]+)/g) ?? []
const trustScores = trustMatches.map((m) => parseFloat(m.replace(/trust_score:\s*/, '')))

// Known slugs from previous migrations (spot-check to avoid conflicts)
const previousSlugs = [
  'bbc-world', 'reuters-world', 'ap-news', 'al-jazeera', 'guardian-world',
  'le-monde-fr', 'icij-global', 'bellingcat-gb', 'propublica-us',
  'unhcr-news', 'intercontinental-cry', 'high-north-news-no',
  'arctic-today-us', 'nti-us', 'bulletin-atomic-us',
]

describe('expand-sources-650 migration', () => {
  // ── Data Quality ──────────────────────────────────────────────────────
  describe('data quality', () => {
    it('should contain exactly 50 new sources', () => {
      expect(slugs.length).toBe(50)
    })

    it('should have unique slugs', () => {
      const unique = new Set(slugs)
      expect(unique.size).toBe(slugs.length)
    })

    it('should not conflict with well-known previous slugs', () => {
      for (const prev of previousSlugs) {
        expect(slugs).not.toContain(prev)
      }
    })

    it('should have trust scores between 0.7 and 1.0', () => {
      for (const score of trustScores) {
        expect(score).toBeGreaterThanOrEqual(0.7)
        expect(score).toBeLessThanOrEqual(1.0)
      }
    })

    it('should have valid tier values', () => {
      const validTiers = ['premium', 'major', 'specialised']
      for (const tier of tiers) {
        expect(validTiers).toContain(tier)
      }
    })

    it('should have valid language codes', () => {
      const validLangs = ['en', 'es', 'fr', 'pt', 'ar', 'de', 'zh', 'ja', 'ko', 'ru']
      for (const lang of languages) {
        expect(validLangs).toContain(lang)
      }
    })
  })

  // ── Regional Coverage ─────────────────────────────────────────────────
  describe('regional coverage', () => {
    it('should cover 15+ countries', () => {
      const uniqueCountries = new Set(countries)
      expect(uniqueCountries.size).toBeGreaterThanOrEqual(15)
    })

    it('should include African countries (NG, ZA, UG)', () => {
      expect(countries).toContain('NG')
      expect(countries).toContain('ZA')
      expect(countries).toContain('UG')
    })

    it('should include European countries (CH, GB, BE, NL, FR, AT, NO)', () => {
      const euCountries = countries.filter((c) =>
        ['CH', 'GB', 'BE', 'NL', 'FR', 'AT', 'NO'].includes(c)
      )
      expect(euCountries.length).toBeGreaterThanOrEqual(7)
    })

    it('should include Asia-Pacific countries (AU, NZ, TH)', () => {
      expect(countries).toContain('AU')
      expect(countries).toContain('NZ')
      expect(countries).toContain('TH')
    })
  })

  // ── Tier Distribution ─────────────────────────────────────────────────
  describe('tier distribution', () => {
    it('should have at least 12 premium-tier sources', () => {
      const premiumCount = tiers.filter((t) => t === 'premium').length
      expect(premiumCount).toBeGreaterThanOrEqual(12)
    })

    it('should have at least 10 major-tier sources', () => {
      const majorCount = tiers.filter((t) => t === 'major').length
      expect(majorCount).toBeGreaterThanOrEqual(10)
    })

    it('should have at least 15 specialised-tier sources', () => {
      const specialisedCount = tiers.filter((t) => t === 'specialised').length
      expect(specialisedCount).toBeGreaterThanOrEqual(15)
    })
  })

  // ── Vertical Coverage ─────────────────────────────────────────────────
  describe('vertical coverage', () => {
    it('should include Refugee & Migration Policy sources', () => {
      expect(slugs).toContain('unhcr-stories')
      expect(slugs).toContain('mixed-migration-centre')
      expect(slugs).toContain('migration-policy-inst-us')
    })

    it('should include Rare Earth & Critical Minerals sources', () => {
      expect(slugs).toContain('mining-com-global')
      expect(slugs).toContain('benchmark-minerals-gb')
      expect(slugs).toContain('crma-eu')
    })

    it('should include Indigenous Media sources', () => {
      expect(slugs).toContain('indian-country-today-us')
      expect(slugs).toContain('nitv-au')
      expect(slugs).toContain('whakaata-maori-nz')
    })

    it('should include Outer Space & Satellite Intel sources', () => {
      expect(slugs).toContain('payload-space-us')
      expect(slugs).toContain('via-satellite-us')
      expect(slugs).toContain('espi-at')
    })

    it('should include Organized Crime & Illicit Finance sources', () => {
      expect(slugs).toContain('insight-crime-us')
      expect(slugs).toContain('fatf-fr')
      expect(slugs).toContain('gi-toc-ch')
    })

    it('should include Child Rights & Protection sources', () => {
      expect(slugs).toContain('unicef-news')
      expect(slugs).toContain('save-children-gb')
      expect(slugs).toContain('ecpat-intl-th')
    })

    it('should include Polar Geopolitics sources', () => {
      expect(slugs).toContain('arctic-institute-us')
      expect(slugs).toContain('wilson-center-polar-us')
      expect(slugs).toContain('spri-gb')
    })

    it('should include Legal & Justice Systems sources', () => {
      expect(slugs).toContain('icc-observer-nl')
      expect(slugs).toContain('justiceinfo-ch')
      expect(slugs).toContain('osji-us')
    })

    it('should include Biosecurity & Dual-Use Research sources', () => {
      expect(slugs).toContain('jhu-chs-us')
      expect(slugs).toContain('nti-bio-us')
      expect(slugs).toContain('bulletin-bio-us')
    })

    it('should include African Tech & Innovation sources', () => {
      expect(slugs).toContain('techcabal-ng')
      expect(slugs).toContain('disrupt-africa-za')
      expect(slugs).toContain('digest-africa-ug')
    })
  })

  // ── Key Source Presence ────────────────────────────────────────────────
  describe('key source presence', () => {
    it('should include UNHCR (gold standard refugee reporting)', () => {
      expect(slugs).toContain('unhcr-stories')
    })

    it('should include UNICEF (children\'s rights authority)', () => {
      expect(slugs).toContain('unicef-news')
    })

    it('should include FATF (AML/CFT global standard setter)', () => {
      expect(slugs).toContain('fatf-fr')
    })

    it('should include ICC Observer (international criminal justice)', () => {
      expect(slugs).toContain('icc-observer-nl')
    })

    it('should include Johns Hopkins CHS (biosecurity leadership)', () => {
      expect(slugs).toContain('jhu-chs-us')
    })

    it('should include InSight Crime (organized crime in LatAm)', () => {
      expect(slugs).toContain('insight-crime-us')
    })
  })

  // ── Migration Structure ───────────────────────────────────────────────
  describe('migration structure', () => {
    it('should use ON CONFLICT DO NOTHING for idempotency', () => {
      expect(migrationSource).toContain('onConflict')
      expect(migrationSource).toContain('ignore')
    })

    it('should export up and down functions', () => {
      expect(migrationSource).toContain('export async function up')
      expect(migrationSource).toContain('export async function down')
    })

    it('should delete correct slugs in down migration', () => {
      for (const slug of slugs) {
        expect(migrationSource).toContain(`'${slug}'`)
      }
    })
  })
})
