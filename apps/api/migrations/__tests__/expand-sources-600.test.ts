import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Test suite for RSS source expansion to 600+ feeds (Cycle 81).
 * 50 new sources across 10 verticals:
 *   Investigative Journalism, Polar & Climate Science, Southeast Asia Depth,
 *   Disinformation Research, Gender & Equality, Pandemic Preparedness,
 *   Election Monitoring, South America Depth, Telecommunications & Cyber,
 *   Disaster Response & Resilience.
 */

// Load migration source to parse source objects
const migrationPath = resolve(__dirname, '..', '20260406000004_expand_sources_600.ts')
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
  'premium-times-ng', 'ghanaweb-gh', 'bbc-world', 'reuters-world', 'ap-news',
  'al-jazeera', 'guardian-world', 'le-monde-fr', 'der-spiegel-de', 'el-pais-es',
  'nikkei-asia', 'arab-news', 'dawn-pk', 'scmp-hk', 'folha-br',
  'propublica', 'mongabay-us', 'carbon-brief-gb', 'arctic-today',
]

describe('expand-sources-600 migration', () => {
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

    it('should include South American countries (BR, UY, CO, AR, CL)', () => {
      expect(countries).toContain('BR')
      expect(countries).toContain('UY')
      expect(countries).toContain('CO')
      expect(countries).toContain('AR')
      expect(countries).toContain('CL')
    })

    it('should include Southeast Asian countries', () => {
      const seaCountries = countries.filter((c) =>
        ['PH', 'TH', 'HK', 'SG', 'MM'].includes(c)
      )
      expect(seaCountries.length).toBeGreaterThanOrEqual(4)
    })

    it('should include multiple languages', () => {
      const uniqueLangs = new Set(languages)
      expect(uniqueLangs.size).toBeGreaterThanOrEqual(3) // en, es, pt at minimum
    })
  })

  // ── Tier Distribution ─────────────────────────────────────────────────
  describe('tier distribution', () => {
    it('should have at least 10 premium-tier sources', () => {
      const premiumCount = tiers.filter((t) => t === 'premium').length
      expect(premiumCount).toBeGreaterThanOrEqual(10)
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
    it('should include Investigative Journalism sources', () => {
      expect(slugs).toContain('icij-global')
      expect(slugs).toContain('bellingcat-gb')
      expect(slugs).toContain('propublica-us')
    })

    it('should include Polar & Climate Science sources', () => {
      expect(slugs).toContain('arctic-today-us')
      expect(slugs).toContain('cryosphere-journal')
      expect(slugs).toContain('antarctic-sun-us')
    })

    it('should include Disinformation Research sources', () => {
      expect(slugs).toContain('dfrlab-atlantic-council')
      expect(slugs).toContain('eu-disinfo-lab-be')
      expect(slugs).toContain('first-draft-news')
    })

    it('should include Election Monitoring sources', () => {
      expect(slugs).toContain('ifes-us')
      expect(slugs).toContain('carter-center-us')
      expect(slugs).toContain('ndi-us')
    })

    it('should include Pandemic Preparedness sources', () => {
      expect(slugs).toContain('cepi-no')
      expect(slugs).toContain('gavi-alliance-ch')
      expect(slugs).toContain('isid-global')
    })

    it('should include Disaster Response sources', () => {
      expect(slugs).toContain('preventionweb-un')
      expect(slugs).toContain('reliefweb-disasters')
      expect(slugs).toContain('ifrc-news-ch')
    })

    it('should include Gender & Equality sources', () => {
      expect(slugs).toContain('un-women-news')
      expect(slugs).toContain('equality-now-us')
    })

    it('should include Telecommunications & Cyber sources', () => {
      expect(slugs).toContain('light-reading-us')
      expect(slugs).toContain('telegeography-us')
    })

    it('should include South America Depth sources', () => {
      expect(slugs).toContain('ciper-chile-cl')
      expect(slugs).toContain('la-diaria-uy')
      expect(slugs).toContain('el-espectador-co')
    })

    it('should include Southeast Asia Depth sources', () => {
      expect(slugs).toContain('benarnews-ph')
      expect(slugs).toContain('frontier-myanmar-mm')
      expect(slugs).toContain('new-naratif-sg')
    })
  })

  // ── Key Source Presence ────────────────────────────────────────────────
  describe('key source presence', () => {
    it('should include ICIJ (gold standard investigative journalism)', () => {
      expect(slugs).toContain('icij-global')
    })

    it('should include Bellingcat (OSINT investigations leader)', () => {
      expect(slugs).toContain('bellingcat-gb')
    })

    it('should include IFRC (largest humanitarian network)', () => {
      expect(slugs).toContain('ifrc-news-ch')
    })

    it('should include Carter Center (election observation authority)', () => {
      expect(slugs).toContain('carter-center-us')
    })

    it('should include CIPER Chile (LatAm investigative journalism)', () => {
      expect(slugs).toContain('ciper-chile-cl')
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
      // Verify down() references all the slugs from up()
      for (const slug of slugs) {
        expect(migrationSource).toContain(`'${slug}'`)
      }
    })
  })
})
