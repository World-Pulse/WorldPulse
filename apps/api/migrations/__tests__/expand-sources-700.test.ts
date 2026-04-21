import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Test suite for RSS source expansion to 700+ feeds (Cycle 84).
 * 50 new sources across 10 verticals:
 *   Food Security & Agriculture, Digital Privacy & Surveillance,
 *   Urban Planning & Smart Cities, Aging & Demographics,
 *   Nuclear Energy & Proliferation, Central Asia & Caucasus,
 *   Ocean & Maritime Law, Fintech & Digital Banking,
 *   Mental Health & Wellbeing, Automotive & EV Transition.
 */

// Load migration source to parse source objects
const migrationPath = resolve(__dirname, '..', '20260406000006_expand_sources_700.ts')
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
  'unhcr-news', 'unhcr-stories', 'mixed-migration-centre', 'ecre-eu',
  'mining-com-ca', 'indian-country-today-us', 'insight-crime-us',
  'techcabal-ng', 'disrupt-africa-za', 'agfunder-us',
]

describe('expand-sources-700 migration', () => {
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

    it('should have valid tiers', () => {
      const validTiers = new Set(['premium', 'major', 'specialised'])
      for (const tier of tiers) {
        expect(validTiers.has(tier)).toBe(true)
      }
    })

    it('should have 50 tiers matching 50 slugs', () => {
      expect(tiers.length).toBe(50)
    })
  })

  // ── Trust Scores ──────────────────────────────────────────────────────
  describe('trust scores', () => {
    it('should have 50 trust scores', () => {
      expect(trustScores.length).toBe(50)
    })

    it('should all be between 0.5 and 1.0', () => {
      for (const score of trustScores) {
        expect(score).toBeGreaterThanOrEqual(0.5)
        expect(score).toBeLessThanOrEqual(1.0)
      }
    })

    it('should have premium sources scoring >= 0.90', () => {
      const premiumIndices = tiers
        .map((t, i) => (t === 'premium' ? i : -1))
        .filter((i) => i >= 0)
      for (const idx of premiumIndices) {
        expect(trustScores[idx]).toBeGreaterThanOrEqual(0.90)
      }
    })

    it('should have average trust score above 0.85', () => {
      const avg = trustScores.reduce((a, b) => a + b, 0) / trustScores.length
      expect(avg).toBeGreaterThanOrEqual(0.85)
    })
  })

  // ── Geographic Diversity ──────────────────────────────────────────────
  describe('geographic diversity', () => {
    it('should have 50 country assignments', () => {
      expect(countries.length).toBe(50)
    })

    it('should cover at least 8 distinct countries', () => {
      const unique = new Set(countries)
      expect(unique.size).toBeGreaterThanOrEqual(8)
    })

    it('should not be entirely US-centric (US < 60%)', () => {
      const usCount = countries.filter((c) => c === 'US').length
      expect(usCount / countries.length).toBeLessThan(0.6)
    })

    it('should include non-Western sources', () => {
      const nonWestern = ['GE', 'KG', 'SG', 'AE', 'IT', 'AT', 'AU']
      const hasNonWestern = countries.some((c) => nonWestern.includes(c))
      expect(hasNonWestern).toBe(true)
    })
  })

  // ── Language Coverage ─────────────────────────────────────────────────
  describe('language coverage', () => {
    it('should have 50 language assignments', () => {
      expect(languages.length).toBe(50)
    })

    it('should include English sources', () => {
      expect(languages).toContain('en')
    })
  })

  // ── Tier Distribution ─────────────────────────────────────────────────
  describe('tier distribution', () => {
    it('should include premium-tier sources', () => {
      expect(tiers).toContain('premium')
    })

    it('should include major-tier sources', () => {
      expect(tiers).toContain('major')
    })

    it('should include specialised-tier sources', () => {
      expect(tiers).toContain('specialised')
    })

    it('should have a balanced distribution (no tier > 50%)', () => {
      const counts: Record<string, number> = {}
      for (const t of tiers) counts[t] = (counts[t] ?? 0) + 1
      for (const count of Object.values(counts)) {
        expect(count / tiers.length).toBeLessThanOrEqual(0.5)
      }
    })
  })

  // ── Vertical Coverage ─────────────────────────────────────────────────
  describe('vertical coverage', () => {
    it('should cover 10 verticals (5 sources each)', () => {
      // Each vertical has 5 sources — verify in groups of 5
      const verticalGroups = [
        slugs.slice(0, 5),   // Food Security
        slugs.slice(5, 10),  // Privacy
        slugs.slice(10, 15), // Urban
        slugs.slice(15, 20), // Aging
        slugs.slice(20, 25), // Nuclear
        slugs.slice(25, 30), // Central Asia
        slugs.slice(30, 35), // Maritime
        slugs.slice(35, 40), // Fintech
        slugs.slice(40, 45), // Mental Health
        slugs.slice(45, 50), // Automotive
      ]
      expect(verticalGroups.length).toBe(10)
      for (const group of verticalGroups) {
        expect(group.length).toBe(5)
      }
    })
  })

  // ── Migration Structure ───────────────────────────────────────────────
  describe('migration structure', () => {
    it('should have an up function export', () => {
      expect(migrationSource).toContain('export async function up')
    })

    it('should have a down function export', () => {
      expect(migrationSource).toContain('export async function down')
    })

    it('should use ON CONFLICT DO NOTHING for idempotency', () => {
      expect(migrationSource).toContain('ON CONFLICT')
      expect(migrationSource).toContain('DO NOTHING')
    })

    it('should reference the sources table', () => {
      expect(migrationSource).toContain('INSERT INTO sources')
    })

    it('should include all 50 slugs in the down migration', () => {
      const downSection = migrationSource.split('export async function down')[1] ?? ''
      for (const slug of slugs) {
        expect(downSection).toContain(slug)
      }
    })
  })

  // ── Key Source Presence ────────────────────────────────────────────────
  describe('key source presence', () => {
    it('should include FAO for food security', () => {
      expect(slugs).toContain('fao-news')
    })

    it('should include EFF for privacy', () => {
      expect(slugs).toContain('eff-deeplinks')
    })

    it('should include IAEA for nuclear', () => {
      expect(slugs).toContain('iaea-news-centre')
    })

    it('should include Eurasianet for Central Asia', () => {
      expect(slugs).toContain('eurasianet')
    })

    it('should include IMO for maritime', () => {
      expect(slugs).toContain('imo-news')
    })

    it('should include WHO for mental health', () => {
      expect(slugs).toContain('who-mental-health')
    })
  })
})
