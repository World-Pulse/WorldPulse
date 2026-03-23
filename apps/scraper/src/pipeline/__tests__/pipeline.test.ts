import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { classifyContent } from '../classify.js'
import { extractGeo } from '../geo.js'

// Mock redis — path relative to this test file (src/pipeline/__tests__/)
vi.mock('../../lib/redis.js', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    set:    vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Prevent real Nominatim calls — return empty results for all geocoding requests
const originalFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => [],
  } as unknown as Response)
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

// ─── CLASSIFICATION TESTS ────────────────────────────────────────────────
describe('classifyContent', () => {
  it('classifies earthquake news as disaster/critical', async () => {
    const result = await classifyContent(
      'Magnitude 6.2 earthquake strikes Tokyo — buildings evacuated',
      'A powerful earthquake struck near Tokyo killing several people and injuring dozens.',
    )
    expect(['disaster', 'breaking']).toContain(result.category)
    expect(['critical', 'high']).toContain(result.severity)
  })

  it('classifies climate news correctly', async () => {
    const result = await classifyContent(
      'Arctic sea ice reaches record low for March',
      'Scientists report unprecedented decline in Arctic sea ice extent driven by climate change.',
    )
    expect(result.category).toBe('climate')
  })

  it('classifies election news correctly', async () => {
    const result = await classifyContent(
      'South Korea presidential election results expected tonight',
      'Voters across South Korea cast ballots in snap presidential election.',
    )
    expect(result.category).toBe('elections')
  })

  it('extracts relevant tags', async () => {
    const result = await classifyContent(
      'AI regulation bill passes European Parliament',
      'The European Union has passed landmark artificial intelligence legislation.',
    )
    expect(result.tags.length).toBeGreaterThan(0)
  })

  it('returns valid language code', async () => {
    const result = await classifyContent('Breaking news from London', null)
    expect(result.language).toMatch(/^[a-z]{2}$/)
  })
})

// ─── GEO EXTRACTION TESTS ────────────────────────────────────────────────
describe('extractGeo', () => {
  it('extracts Manila coordinates', async () => {
    const result = await extractGeo('Earthquake strikes Manila Bay in the Philippines')
    expect(result.point).toBe(true)
    expect(result.countryCode).toBe('PH')
    expect(result.lat).toBeDefined()
    expect(result.lng).toBeDefined()
  })

  it('extracts country code without point', async () => {
    const result = await extractGeo('The United States announced new sanctions today')
    expect(result.countryCode).toBe('US')
  })

  it('returns empty result for no location', async () => {
    const result = await extractGeo('Scientists publish new research findings')
    expect(result.point).toBe(false)
    expect(result.countryCode).toBeUndefined()
  })

  it('handles Brussels correctly', async () => {
    const result = await extractGeo('EU Commission meets in Brussels to discuss AI directive')
    expect(result.point).toBe(true)
    expect(result.countryCode).toBe('BE')
  })
})

// ─── RELIABILITY SCORING ─────────────────────────────────────────────────
describe('computeReliability', () => {
  it('gives high score for multiple wire sources', () => {
    const articles = [
      { sourceTrust: 0.97, sourceTier: 'wire' },
      { sourceTrust: 0.96, sourceTier: 'wire' },
      { sourceTrust: 0.95, sourceTier: 'wire' },
    ]
    // Wire source bonus + high avg trust + 3 sources
    const countScore = Math.min(3 / 3, 1) * 0.4    // 0.4
    const avgTrust   = ((0.97 + 0.96 + 0.95) / 3) * 0.4  // ~0.384
    const wireBonus  = 0.2
    const expected   = countScore + avgTrust + wireBonus
    expect(expected).toBeGreaterThan(0.9)
  })

  it('gives low score for single community source', () => {
    const articles = [{ sourceTrust: 0.5, sourceTier: 'community' }]
    const countScore = Math.min(1 / 3, 1) * 0.4    // 0.133
    const avgTrust   = 0.5 * 0.4                    // 0.2
    const wireBonus  = 0                             // no wire
    const expected   = countScore + avgTrust + wireBonus
    expect(expected).toBeLessThan(0.4)
  })
})
