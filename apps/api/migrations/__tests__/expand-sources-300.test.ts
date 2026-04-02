/**
 * Tests for migration 20260401000006_expand_sources_300.ts
 * Validates the 50 new RSS sources for correctness, uniqueness, and coverage.
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Extract sources from migration file ──────────────────────────────────────
const migrationPath = path.resolve(__dirname, '../20260401000006_expand_sources_300.ts')
const migrationText = fs.readFileSync(migrationPath, 'utf-8')

interface MigrationSource {
  slug: string
  name: string
  tier: string
  trust_score: number
  language: string
  country: string
  categories: string
  rss_feeds: string
  scrape_interval: number
  active: boolean
}

// Parse sources from the const array in the migration
function extractSources(): MigrationSource[] {
  const sources: MigrationSource[] = []
  const slugMatches    = migrationText.match(/slug:\s*'([^']+)'/g) ?? []
  const nameMatches    = migrationText.match(/name:\s*'([^']+)'/g) ?? []
  const tierMatches    = migrationText.match(/tier:\s*'([^']+)'/g) ?? []
  const trustMatches   = migrationText.match(/trust_score:\s*([\d.]+)/g) ?? []
  const langMatches    = migrationText.match(/language:\s*'([^']+)'/g) ?? []
  const countryMatches = migrationText.match(/country:\s*'([^']+)'/g) ?? []
  const catMatches     = migrationText.match(/categories:\s*JSON\.stringify\((\[[^\]]+\])\)/g) ?? []
  const intervalMatches = migrationText.match(/scrape_interval:\s*(\d+)/g) ?? []

  for (let i = 0; i < slugMatches.length; i++) {
    sources.push({
      slug:            slugMatches[i]?.replace(/slug:\s*'([^']+)'/, '$1') ?? '',
      name:            nameMatches[i]?.replace(/name:\s*'([^']+)'/, '$1') ?? '',
      tier:            tierMatches[i]?.replace(/tier:\s*'([^']+)'/, '$1') ?? '',
      trust_score:     parseFloat(trustMatches[i]?.replace(/trust_score:\s*/, '') ?? '0'),
      language:        langMatches[i]?.replace(/language:\s*'([^']+)'/, '$1') ?? '',
      country:         countryMatches[i]?.replace(/country:\s*'([^']+)'/, '$1') ?? '',
      categories:      catMatches[i]?.replace(/categories:\s*JSON\.stringify\(/, '').replace(/\)$/, '') ?? '[]',
      rss_feeds:       '[]',
      scrape_interval: parseInt(intervalMatches[i]?.replace(/scrape_interval:\s*/, '') ?? '600'),
      active:          true,
    })
  }
  return sources
}

const sources = extractSources()

// ── Load slugs from prior migrations to detect conflicts ─────────────────────
function loadPriorSlugs(): Set<string> {
  const migrationsDir = path.resolve(__dirname, '..')
  const allSlugs = new Set<string>()
  const priorFiles = [
    '20260401000001_expand_sources_80.ts',
    '20260401000002_expand_sources_120.ts',
    '20260401000003_expand_sources_150.ts',
    '20260401000004_expand_sources_200.ts',
    '20260401000005_expand_sources_250.ts',
  ]
  for (const file of priorFiles) {
    try {
      const text = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      const matches = text.match(/slug:\s*'([^']+)'/g) ?? []
      for (const m of matches) {
        allSlugs.add(m.replace(/slug:\s*'([^']+)'/, '$1'))
      }
    } catch {
      // File may not exist in test env — skip
    }
  }
  return allSlugs
}

const priorSlugs = loadPriorSlugs()

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Migration: expand_sources_300 (50 new sources)', () => {

  it('defines exactly 50 sources', () => {
    expect(sources.length).toBe(50)
  })

  it('all slugs are unique within this migration', () => {
    const slugSet = new Set(sources.map(s => s.slug))
    expect(slugSet.size).toBe(sources.length)
  })

  it('no slug conflicts with prior migrations', () => {
    const conflicts = sources.filter(s => priorSlugs.has(s.slug))
    expect(conflicts.map(c => c.slug)).toEqual([])
  })

  it('all sources have non-empty name and slug', () => {
    for (const s of sources) {
      expect(s.slug.length).toBeGreaterThan(0)
      expect(s.name.length).toBeGreaterThan(0)
    }
  })

  it('all trust_scores are between 0.5 and 1.0', () => {
    for (const s of sources) {
      expect(s.trust_score).toBeGreaterThanOrEqual(0.5)
      expect(s.trust_score).toBeLessThanOrEqual(1.0)
    }
  })

  it('all tiers are valid (premium, specialised, regional)', () => {
    const validTiers = new Set(['premium', 'specialised', 'regional', 'community'])
    for (const s of sources) {
      expect(validTiers.has(s.tier)).toBe(true)
    }
  })

  it('all scrape_intervals are positive and reasonable (300–3600)', () => {
    for (const s of sources) {
      expect(s.scrape_interval).toBeGreaterThanOrEqual(300)
      expect(s.scrape_interval).toBeLessThanOrEqual(3600)
    }
  })

  // ── Regional coverage assertions ──────────────────────────────────────────
  it('includes 5+ Pacific Island sources', () => {
    const pacific = sources.filter(s => ['FJ', 'WS', 'SB', 'VU', 'PG'].includes(s.country))
    expect(pacific.length).toBeGreaterThanOrEqual(5)
  })

  it('includes 5+ Caribbean sources', () => {
    const caribbean = sources.filter(s => ['JM', 'TT', 'BB', 'HT', 'DM'].includes(s.country))
    expect(caribbean.length).toBeGreaterThanOrEqual(5)
  })

  it('includes 4+ Balkan sources', () => {
    const balkans = sources.filter(s => ['XK', 'MK', 'ME', 'AL'].includes(s.country))
    expect(balkans.length).toBeGreaterThanOrEqual(4)
  })

  it('includes 4+ Nordic sources', () => {
    const nordics = sources.filter(s => ['FI', 'SE', 'IS'].includes(s.country) || s.slug === 'arctic-today')
    expect(nordics.length).toBeGreaterThanOrEqual(4)
  })

  it('includes 6+ East European sources', () => {
    const ee = sources.filter(s => ['UA', 'CZ', 'SK', 'RO', 'HU'].includes(s.country) || s.slug === 'bne-intellinews')
    expect(ee.length).toBeGreaterThanOrEqual(6)
  })

  it('includes 4+ Francophone Africa sources', () => {
    const franco = sources.filter(s =>
      s.slug.includes('rfi') || s.slug.includes('monde-afrique') ||
      s.slug.includes('abidjan') || s.slug.includes('jeune-afrique')
    )
    expect(franco.length).toBeGreaterThanOrEqual(4)
  })

  it('includes 5+ Space/Defence sources', () => {
    const defence = sources.filter(s =>
      s.slug.includes('spacenews') || s.slug.includes('defense') ||
      s.slug.includes('war-zone') || s.slug.includes('breaking-defense') ||
      s.slug.includes('janes')
    )
    expect(defence.length).toBeGreaterThanOrEqual(5)
  })

  it('includes 5+ Maritime/Trade sources', () => {
    const maritime = sources.filter(s =>
      s.slug.includes('maritime') || s.slug.includes('gcaptain') ||
      s.slug.includes('splash') || s.slug.includes('tradewinds') ||
      s.slug.includes('lloyds')
    )
    expect(maritime.length).toBeGreaterThanOrEqual(5)
  })

  it('includes 5+ Think Tank sources', () => {
    const tanks = sources.filter(s =>
      s.slug.includes('brookings') || s.slug.includes('chatham') ||
      s.slug.includes('carnegie') || s.slug.includes('rand') ||
      s.slug.includes('iiss')
    )
    expect(tanks.length).toBeGreaterThanOrEqual(5)
  })

  it('includes 5+ Fact-Check / Disinfo sources', () => {
    const factcheck = sources.filter(s =>
      s.slug.includes('poynter') || s.slug.includes('snopes') ||
      s.slug.includes('full-fact') || s.slug.includes('afp-factcheck') ||
      s.slug.includes('irex')
    )
    expect(factcheck.length).toBeGreaterThanOrEqual(5)
  })

  it('covers 20+ distinct countries', () => {
    const countries = new Set(sources.map(s => s.country))
    expect(countries.size).toBeGreaterThanOrEqual(20)
  })

  it('has 8+ premium-tier sources', () => {
    const premium = sources.filter(s => s.tier === 'premium')
    expect(premium.length).toBeGreaterThanOrEqual(8)
  })

  it('has 10+ specialised-tier sources', () => {
    const specialised = sources.filter(s => s.tier === 'specialised')
    expect(specialised.length).toBeGreaterThanOrEqual(10)
  })

  // ── Key source presence checks ────────────────────────────────────────────
  it('includes Kyiv Post', () => {
    expect(sources.some(s => s.slug === 'kyiv-post')).toBe(true)
  })

  it('includes Janes (IISS defence)', () => {
    expect(sources.some(s => s.slug === 'janes-defence')).toBe(true)
  })

  it('includes Brookings', () => {
    expect(sources.some(s => s.slug === 'brookings')).toBe(true)
  })

  it('includes AFP Fact Check', () => {
    expect(sources.some(s => s.slug === 'afp-factcheck')).toBe(true)
  })

  it('includes Lloyd\'s List', () => {
    expect(sources.some(s => s.slug === 'lloyds-list')).toBe(true)
  })

  it('down() slug array matches source count', () => {
    // Extract slugs from the down() function
    const downMatch = migrationText.match(/const slugs = \[([\s\S]*?)\]/)
    if (downMatch) {
      const downSlugs = (downMatch[1]?.match(/'([^']+)'/g) ?? []).map(s => s.replace(/'/g, ''))
      expect(downSlugs.length).toBe(50)
    }
  })
})
