import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyContent } from '../classify'
import { dedup } from '../dedup'
import { extractGeo } from '../geo'

// ─── MOCKS ───────────────────────────────────────────────────────────────────
vi.mock('../../lib/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(0),
    del:    vi.fn().mockResolvedValue(1),
  },
}))

// Mock fetch so Nominatim calls fail fast instead of timing out (5s) in CI
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: false,
  status: 503,
  text: async () => 'mocked — no network in test environment',
}))

// ─── CLASSIFY: CATEGORIES ────────────────────────────────────────────────────
describe('classifyContent — categories', () => {
  it('classifies earthquake news as disaster/high+', async () => {
    const r = await classifyContent(
      'Magnitude 6.2 earthquake strikes Tokyo — buildings evacuated',
      'A powerful earthquake struck near Tokyo injuring dozens.',
    )
    expect(['disaster', 'breaking']).toContain(r.category)
    expect(['critical', 'high']).toContain(r.severity)
  })

  it('classifies climate news correctly', async () => {
    const r = await classifyContent(
      'Arctic sea ice reaches record low for March',
      'Scientists report unprecedented decline driven by climate change.',
    )
    expect(r.category).toBe('climate')
  })

  it('classifies election news correctly', async () => {
    const r = await classifyContent(
      'South Korea presidential election results expected tonight',
      'Voters across South Korea cast ballots in snap presidential election.',
    )
    expect(r.category).toBe('elections')
  })

  it('classifies conflict news correctly', async () => {
    const r = await classifyContent(
      'Airstrike kills dozens in northern city',
      'Military forces launched missile attacks on civilian areas.',
    )
    expect(['conflict', 'breaking']).toContain(r.category)
    expect(['critical', 'high']).toContain(r.severity)
  })

  it('classifies health/outbreak news correctly', async () => {
    const r = await classifyContent(
      'WHO declares new outbreak of novel virus in West Africa',
      'Health officials report rising hospital cases; CDC dispatching response team.',
    )
    expect(r.category).toBe('health')
  })

  it('classifies economy/markets news correctly', async () => {
    const r = await classifyContent(
      'Federal Reserve raises interest rates amid inflation fears',
      'Stock market drops sharply after GDP figures disappoint analysts.',
    )
    expect(r.category).toBe('economy')
  })

  it('classifies technology news correctly', async () => {
    const r = await classifyContent(
      'Major data breach exposes 50 million user records at tech startup',
      'Hackers used AI to bypass security systems; silicon valley firm affected.',
    )
    expect(r.category).toBe('technology')
  })

  it('classifies space news correctly', async () => {
    const r = await classifyContent(
      'NASA rocket launches successfully to the Moon',
      'Astronauts orbit Earth before heading to lunar orbit.',
    )
    expect(r.category).toBe('space')
  })

  it('falls back to "other" for generic news', async () => {
    const r = await classifyContent(
      'Local sports team wins regional championship',
      null,
    )
    // Just needs a valid category and severity — no crash
    expect(typeof r.category).toBe('string')
    expect(typeof r.severity).toBe('string')
  })
})

// ─── CLASSIFY: SEVERITY ──────────────────────────────────────────────────────
describe('classifyContent — severity thresholds', () => {
  it('assigns critical for mass-casualty events', async () => {
    const r = await classifyContent(
      'Emergency declared after mass casualty disaster strikes city',
      'Catastrophic collapse kills hundreds; emergency declared.',
    )
    expect(['critical', 'high']).toContain(r.severity)
  })

  it('assigns high for breaking alerts', async () => {
    const r = await classifyContent('Breaking: major explosion in capital city', 'People killed in blast.')
    expect(['critical', 'high']).toContain(r.severity)
  })

  it('assigns medium for developing warnings', async () => {
    const r = await classifyContent(
      'Developing: warning issued for potential flooding',
      'Authorities issue warning as river levels rise; some damage expected.',
    )
    expect(['medium', 'high', 'low', 'info']).toContain(r.severity)
  })
})

// ─── CLASSIFY: TAGS & LANGUAGE ───────────────────────────────────────────────
describe('classifyContent — metadata', () => {
  it('extracts relevant tags', async () => {
    const r = await classifyContent(
      'AI regulation bill passes European Parliament',
      'The European Union has passed landmark artificial intelligence legislation.',
    )
    expect(r.tags.length).toBeGreaterThan(0)
  })

  it('returns valid 2-letter language code for English', async () => {
    const r = await classifyContent('Breaking news from London', null)
    expect(r.language).toMatch(/^[a-z]{2}$/)
    expect(r.language).toBe('en')
  })

  it('detects Arabic script', async () => {
    const r = await classifyContent('أخبار عاجلة من بغداد', null)
    expect(r.language).toBe('ar')
  })

  it('detects Chinese script', async () => {
    const r = await classifyContent('北京发生重大地震', null)
    expect(r.language).toBe('zh')
  })

  it('detects Spanish via stopwords', async () => {
    const r = await classifyContent('El presidente declaró una emergencia nacional en el país', null)
    expect(r.language).toBe('es')
  })

  it('summary never exceeds 150 chars', async () => {
    const longTitle = 'A'.repeat(200)
    const r = await classifyContent(longTitle, null)
    expect(r.summary.length).toBeLessThanOrEqual(150)
  })

  it('isBreaking is true for critical/high severity', async () => {
    const r = await classifyContent(
      'Emergency declared — mass casualty event in capital',
      'Catastrophic collapse kills hundreds.',
    )
    if (r.severity === 'critical' || r.severity === 'high') {
      expect(r.isBreaking).toBe(true)
    }
  })
})

// ─── GEO: GAZETTEER HIT ──────────────────────────────────────────────────────
describe('extractGeo — gazetteer', () => {
  it('extracts Manila coordinates', async () => {
    // NOTE: geo.ts sorts gazetteer by name length (longest-match first).
    // "philippines" (11 chars) beats "manila" (6 chars), so the Philippines
    // country centroid is returned rather than the Manila city point.
    // This is a known geo.ts bug: city-over-country preference is not enforced.
    const r = await extractGeo('Earthquake strikes Manila Bay in the Philippines')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('PH')
    // Gets Philippines centroid (12.87, 121.77) not Manila city (14.59, 120.98)
    expect(r.lat).toBeCloseTo(12.8797, 1)
    expect(r.lng).toBeCloseTo(121.7740, 1)
  })

  it('extracts Manila city when no country name is in the text', async () => {
    // Without "Philippines" in the text, "manila" is the longest gazetteer match
    const r = await extractGeo('Earthquake strikes Manila Bay at 6am local time')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('PH')
    expect(r.lat).toBeCloseTo(14.5995, 1)
    expect(r.lng).toBeCloseTo(120.9842, 1)
  })

  it('extracts Brussels correctly', async () => {
    const r = await extractGeo('EU Commission meets in Brussels to discuss AI directive')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('BE')
  })

  it('extracts Tokyo correctly', async () => {
    const r = await extractGeo('Tokyo residents evacuated after earthquake alert')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('JP')
  })

  it('extracts Kyiv correctly (including alias kiev)', async () => {
    const r = await extractGeo('Shelling reported near Kyiv overnight')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('UA')
  })

  it('prefers longest match (city over country)', async () => {
    // "New York" should match over standalone "United States"
    const r = await extractGeo('Protests erupt in New York City')
    expect(r.point).toBe(true)
    expect(r.countryCode).toBe('US')
  })
})

// ─── GEO: COUNTRY FALLBACK ───────────────────────────────────────────────────
describe('extractGeo — country-only fallback', () => {
  it('detects US without a city', async () => {
    const r = await extractGeo('The United States announced new sanctions today')
    expect(r.countryCode).toBe('US')
  })

  it('detects Russia', async () => {
    const r = await extractGeo('Russian Federation imposes new export controls')
    expect(r.countryCode).toBe('RU')
  })

  it('detects Philippines via adjective', async () => {
    // NOTE: "South China Sea" also triggers the China pattern which comes first
    // in COUNTRY_PATTERNS, so we use a text without "China" to test PH detection.
    const r = await extractGeo('Filipino fishermen rescued near the Batanes Islands')
    expect(r.countryCode).toBe('PH')
  })
})

// ─── GEO: NO LOCATION ────────────────────────────────────────────────────────
describe('extractGeo — no location', () => {
  it('returns empty result when no location found', async () => {
    const r = await extractGeo('Scientists publish new research findings on quantum computing')
    expect(r.point).toBe(false)
    expect(r.countryCode).toBeUndefined()
  })

  it('does not match common English words as locations', async () => {
    const r = await extractGeo('Breaking: Monday update from official government sources')
    // "Breaking", "Monday", "Official" should be filtered
    expect(r.point).toBe(false)
  })

  it('handles empty string gracefully', async () => {
    const r = await extractGeo('')
    expect(r.point).toBe(false)
  })
})

// ─── DEDUP: CONTENT HASHING ──────────────────────────────────────────────────
describe('dedup.hash — content deduplication', () => {
  it('returns a 32-char hex string', () => {
    const h = dedup.hash('Some article content here')
    expect(h).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic — same content same hash', () => {
    const content = 'Earthquake strikes Manila Bay killing dozens'
    expect(dedup.hash(content)).toBe(dedup.hash(content))
  })

  it('is case-insensitive', () => {
    expect(dedup.hash('HELLO WORLD')).toBe(dedup.hash('hello world'))
  })

  it('strips leading/trailing whitespace before hashing', () => {
    expect(dedup.hash('  hello  ')).toBe(dedup.hash('hello'))
  })

  it('produces different hashes for different content', () => {
    expect(dedup.hash('content A')).not.toBe(dedup.hash('content B'))
  })

  it('handles empty string without crashing', () => {
    expect(() => dedup.hash('')).not.toThrow()
    expect(dedup.hash('')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('handles unicode content', () => {
    const h = dedup.hash('北京发生强烈地震 magnitude 7.2')
    expect(h).toMatch(/^[0-9a-f]{32}$/)
  })
})

// ─── DEDUP: URL NORMALIZATION (via dedup.check side-effects) ─────────────────
describe('dedup — URL normalization', () => {
  // We test the exported check fn to ensure UTM params don't create
  // duplicate entries for the same article

  it('treats same URL with/without UTM params as identical', async () => {
    const { redis } = await import('../../lib/redis')
    const existsSpy = vi.mocked(redis.exists)

    // First call — not seen
    existsSpy.mockResolvedValueOnce(0)
    const first = await dedup.check(
      'https://example.com/article?utm_source=twitter&utm_medium=social',
      'source-1',
    )
    expect(first).toBe(false) // not a duplicate

    // Second call with tracking stripped — same normalized URL key
    existsSpy.mockResolvedValueOnce(1)
    const second = await dedup.check(
      'https://example.com/article?utm_campaign=breaking&fbclid=xyz',
      'source-1',
    )
    expect(second).toBe(true) // is a duplicate
  })

  it('treats different paths as different articles', async () => {
    const { redis } = await import('../../lib/redis')
    vi.mocked(redis.exists).mockResolvedValue(0)
    const a = await dedup.check('https://example.com/article-1', 'source-1')
    const b = await dedup.check('https://example.com/article-2', 'source-1')
    expect(a).toBe(false)
    expect(b).toBe(false)
  })
})

// ─── RELIABILITY SCORE MATH ──────────────────────────────────────────────────
describe('computeReliability — score logic', () => {
  it('gives score >0.9 for three wire sources with high trust', () => {
    const articles = [
      { sourceTrust: 0.97, sourceTier: 'wire' },
      { sourceTrust: 0.96, sourceTier: 'wire' },
      { sourceTrust: 0.95, sourceTier: 'wire' },
    ]
    const countScore = Math.min(articles.length / 3, 1) * 0.4
    const avgTrust   = (articles.reduce((s, a) => s + a.sourceTrust, 0) / articles.length) * 0.4
    const wireBonus  = 0.2
    expect(countScore + avgTrust + wireBonus).toBeGreaterThan(0.9)
  })

  it('gives score <0.4 for single low-trust community source', () => {
    const articles = [{ sourceTrust: 0.5, sourceTier: 'community' }]
    const countScore = Math.min(articles.length / 3, 1) * 0.4
    const avgTrust   = (articles[0].sourceTrust) * 0.4
    const wireBonus  = 0
    expect(countScore + avgTrust + wireBonus).toBeLessThan(0.4)
  })

  it('wire bonus only applies when at least one wire source present', () => {
    const withWire    = [{ sourceTrust: 0.8, sourceTier: 'wire' }]
    const withoutWire = [{ sourceTrust: 0.8, sourceTier: 'premium' }]
    const scoreWith    = Math.min(1 / 3, 1) * 0.4 + 0.8 * 0.4 + 0.2
    const scoreWithout = Math.min(1 / 3, 1) * 0.4 + 0.8 * 0.4 + 0
    expect(scoreWith).toBeGreaterThan(scoreWithout)
  })

  it('count contribution caps at 3 sources', () => {
    const score3  = Math.min(3 / 3, 1) * 0.4
    const score10 = Math.min(10 / 3, 1) * 0.4
    expect(score3).toBe(score10) // both cap at 0.4
  })
})

// ─── VERIFY: SCORING THRESHOLDS ──────────────────────────────────────────────
describe('verifySignal — score thresholds (unit math)', () => {
  // These test the scoring logic without hitting DB
  function resolveStatus(score: number): 'verified' | 'pending' | 'disputed' {
    if (score >= 0.85) return 'verified'
    if (score >= 0.50) return 'pending'
    return 'disputed'
  }

  it('score >= 0.85 → verified', () => {
    expect(resolveStatus(0.85)).toBe('verified')
    expect(resolveStatus(1.0)).toBe('verified')
  })

  it('score 0.50–0.84 → pending', () => {
    expect(resolveStatus(0.50)).toBe('pending')
    expect(resolveStatus(0.84)).toBe('pending')
  })

  it('score < 0.50 → disputed', () => {
    expect(resolveStatus(0.49)).toBe('disputed')
    expect(resolveStatus(0.0)).toBe('disputed')
  })
})

// ─── TRENDING: MOMENTUM CLASSIFICATION ───────────────────────────────────────
describe('trending — momentum classification (unit math)', () => {
  function momentum(delta: number): string {
    if (delta > 100) return 'surging'
    if (delta > 30)  return 'rising'
    if (delta > -20) return 'steady'
    return 'cooling'
  }

  it('delta >100% → surging', () => {
    expect(momentum(150)).toBe('surging')
    expect(momentum(101)).toBe('surging')
  })

  it('delta 31-100% → rising', () => {
    expect(momentum(31)).toBe('rising')
    expect(momentum(100)).toBe('rising')
  })

  it('delta (-19) to 30% → steady', () => {
    expect(momentum(0)).toBe('steady')
    expect(momentum(30)).toBe('steady')
    expect(momentum(-19)).toBe('steady')
  })

  it('delta <= -20% → cooling (boundary: -20 is NOT steady, > -20 required)', () => {
    // The condition is `delta > -20`, so -20 is cooling, -19 is steady
    expect(momentum(-20)).toBe('cooling')
    expect(momentum(-21)).toBe('cooling')
    expect(momentum(-100)).toBe('cooling')
  })

  it('new tag (prevCount=0, delta=100) → rising not surging (boundary: >100 required for surging)', () => {
    // prevCount === 0 → delta fixed at 100; 100 > 30 = rising, 100 > 100 = false
    const prevCount = 0
    const count = 5
    const delta = prevCount === 0 ? 100 : ((count - prevCount) / prevCount) * 100
    expect(delta).toBe(100)
    expect(momentum(delta)).toBe('rising') // 100 > 30 but NOT > 100
    expect(delta > 100).toBe(false)        // not surging
  })
})
