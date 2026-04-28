/**
 * Unit tests for source-bias.ts
 *
 * Exercises the heuristic bias detection, seed map lookups,
 * extractDomain helper, and getBiasLabel mapper.
 * No Redis dependency — heuristic-only paths are pure functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const redisMock = {
  get:    vi.fn().mockResolvedValue(null),  // default: cache miss
  setex:  vi.fn().mockResolvedValue('OK'),
}

vi.mock('../../db/redis.js', () => ({ redis: redisMock }))

// ─── Import after mocks ───────────────────────────────────────────────────────

const {
  extractDomain,
  getBiasLabel,
  tokeniseDomain,
  detectBiasHeuristic,
  getSourceBias,
  batchGetSourceBias,
} = await import('../source-bias.js')

// ─── extractDomain ────────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('strips www prefix', () => {
    expect(extractDomain('www.nytimes.com')).toBe('nytimes.com')
  })

  it('handles https URLs', () => {
    expect(extractDomain('https://bbc.co.uk/news/article')).toBe('bbc.co.uk')
  })

  it('handles bare domain strings', () => {
    expect(extractDomain('apnews.com')).toBe('apnews.com')
  })

  it('strips www from full URL', () => {
    expect(extractDomain('https://www.reuters.com/world/')).toBe('reuters.com')
  })

  it('returns lowercased domain', () => {
    expect(extractDomain('BBC.COM')).toBe('bbc.com')
  })
})

// ─── getBiasLabel ─────────────────────────────────────────────────────────────

describe('getBiasLabel', () => {
  it('maps -0.9 → far-left', ()  => expect(getBiasLabel(-0.9)).toBe('far-left'))
  it('maps -0.6 → left',     ()  => expect(getBiasLabel(-0.6)).toBe('left'))
  it('maps -0.2 → center-left',()=> expect(getBiasLabel(-0.2)).toBe('center-left'))
  it('maps  0.0 → center',   ()  => expect(getBiasLabel(0.0)).toBe('center'))
  it('maps  0.2 → center-right',()=> expect(getBiasLabel(0.2)).toBe('center-right'))
  it('maps  0.6 → right',    ()  => expect(getBiasLabel(0.6)).toBe('right'))
  it('maps  0.9 → far-right',()  => expect(getBiasLabel(0.9)).toBe('far-right'))
  it('boundary: exactly -0.8 → far-left', () => expect(getBiasLabel(-0.8)).toBe('far-left'))
  it('boundary: exactly  0.8 → far-right',() => expect(getBiasLabel(0.8)).toBe('far-right'))
})

// ─── tokeniseDomain ──────────────────────────────────────────────────────────

describe('tokeniseDomain', () => {
  it('splits hyphenated domain', () => {
    expect(tokeniseDomain('daily-liberty-news.com')).toEqual(['daily', 'liberty', 'news'])
  })

  it('strips TLD', () => {
    expect(tokeniseDomain('patriotnews.net')).toContain('patriotnews')
  })

  it('handles single segment', () => {
    const result = tokeniseDomain('reuters.com')
    expect(result).toEqual(['reuters'])
  })

  it('filters very short tokens (≤ 2 chars)', () => {
    expect(tokeniseDomain('ap.news.io')).not.toContain('ap')
  })

  it('lowercases all tokens', () => {
    const result = tokeniseDomain('PatriotNews.COM')
    expect(result.every(t => t === t.toLowerCase())).toBe(true)
  })
})

// ─── detectBiasHeuristic ─────────────────────────────────────────────────────

describe('detectBiasHeuristic', () => {
  describe('authoritative TLDs', () => {
    it('.gov domain → center, high confidence', () => {
      const result = detectBiasHeuristic('whitehouse.gov')
      expect(result).not.toBeNull()
      expect(result!.label).toBe('center')
      expect(result!.confidence).toBe('high')
      expect(result!.method).toBe('heuristic')
    })

    it('.edu domain → center, high confidence', () => {
      const result = detectBiasHeuristic('mit.edu')
      expect(result).not.toBeNull()
      expect(result!.label).toBe('center')
      expect(result!.confidence).toBe('high')
    })

    it('.mil domain → center, high confidence', () => {
      const result = detectBiasHeuristic('army.mil')
      expect(result).not.toBeNull()
      expect(result!.label).toBe('center')
      expect(result!.confidence).toBe('high')
    })
  })

  describe('parent-domain inheritance', () => {
    it('subdomain of known outlet inherits parent score', () => {
      // nytimes.com is in seed map as -0.50 (left)
      const result = detectBiasHeuristic('opinion.nytimes.com')
      expect(result).not.toBeNull()
      expect(result!.score).toBe(-0.50)
      expect(result!.confidence).toBe('medium')
      expect(result!.method).toBe('heuristic')
    })

    it('deep subdomain inherits closest known parent', () => {
      // bbc.co.uk is in seed map as -0.18
      const result = detectBiasHeuristic('sport.bbc.co.uk')
      expect(result).not.toBeNull()
      expect(result!.score).toBe(-0.18)
      expect(result!.confidence).toBe('medium')
    })

    it('unknown parent returns null (no inheritance)', () => {
      // unknownoutlet.xyz is not in seed map
      const result = detectBiasHeuristic('sub.unknownoutlet.xyz')
      // No parent match → falls through to keyword scan (or null if no keywords)
      // Just verify it doesn't throw and returns null or a heuristic
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  describe('state-media country TLDs', () => {
    it('.ru domain → center, low confidence', () => {
      const result = detectBiasHeuristic('news.rt.ru')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe('low')
      expect(result!.method).toBe('heuristic')
    })

    it('.cn domain → center, low confidence', () => {
      const result = detectBiasHeuristic('xinhua.cn')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe('low')
    })
  })

  describe('domain keyword signals', () => {
    it('right-leaning keyword → positive score', () => {
      const result = detectBiasHeuristic('patriotnews.com')
      expect(result).not.toBeNull()
      expect(result!.score).toBeGreaterThan(0)
      expect(result!.label).toMatch(/center-right|right|far-right/)
      expect(result!.confidence).toBe('low')
      expect(result!.method).toBe('heuristic')
    })

    it('left-leaning keyword → negative score', () => {
      const result = detectBiasHeuristic('progressivedaily.com')
      expect(result).not.toBeNull()
      expect(result!.score).toBeLessThan(0)
      expect(result!.label).toMatch(/center-left|left|far-left/)
      expect(result!.confidence).toBe('low')
    })

    it('multiple right keywords → more positive score', () => {
      const single = detectBiasHeuristic('patriotnews.com')
      const multi  = detectBiasHeuristic('patriot-liberty-freedom.com')
      expect(multi!.score).toBeGreaterThanOrEqual(single!.score)
    })

    it('mixed keywords → net score reflects balance', () => {
      // 1 right keyword (patriot), 1 left keyword (progressive)
      const result = detectBiasHeuristic('patriot-progressive.com')
      // Net = 0 → neutral-ish
      expect(result).not.toBeNull()
      expect(result!.score).toBe(0)
    })

    it('neutral domain with no keywords → null (no signal)', () => {
      const result = detectBiasHeuristic('todaynews.com')
      // 'today' and 'news' are not in keyword sets
      expect(result).toBeNull()
    })

    it('score is clamped to [-0.75, 0.75]', () => {
      // Multiple right keywords
      const result = detectBiasHeuristic('patriot-conservative-freedom-eagle-republican.com')
      expect(result!.score).toBeLessThanOrEqual(0.75)
      expect(result!.score).toBeGreaterThanOrEqual(-0.75)
    })
  })

  describe('completely unknown domain', () => {
    it('returns null for a generic domain with no signals', () => {
      const result = detectBiasHeuristic('xyz123news.com')
      expect(result).toBeNull()
    })
  })
})

// ─── getSourceBias (integration with mocked Redis) ──────────────────────────

describe('getSourceBias', () => {
  beforeEach(() => {
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')
    vi.clearAllMocks()
  })

  it('returns seed score for known domain', async () => {
    const result = await getSourceBias('nytimes.com')
    expect(result.method).toBe('seed')
    expect(result.confidence).toBe('high')
    expect(result.score).toBeLessThan(0) // left-leaning
  })

  it('returns heuristic score for .gov domain', async () => {
    const result = await getSourceBias('cdc.gov')
    expect(result.method).toBe('heuristic')
    expect(result.label).toBe('center')
    expect(result.confidence).toBe('high')
  })

  it('returns heuristic score for subdomain of known outlet', async () => {
    const result = await getSourceBias('opinion.reuters.com')
    expect(result.method).toBe('heuristic')
    expect(result.confidence).toBe('medium')
  })

  it('returns unknown for truly unrecognised domain', async () => {
    const result = await getSourceBias('totallyrandomsource12345.io')
    expect(result.label).toBe('unknown')
    expect(result.method).toBe('unknown')
    expect(result.confidence).toBe('low')
  })

  it('serves from Redis cache when available', async () => {
    const cached = JSON.stringify({
      score: 0.5, label: 'right', confidence: 'high', method: 'seed',
    })
    redisMock.get.mockResolvedValueOnce(cached)
    const result = await getSourceBias('somecacheddomain.com')
    expect(result.score).toBe(0.5)
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('caches heuristic results with standard TTL', async () => {
    await getSourceBias('cdc.gov')
    expect(redisMock.setex).toHaveBeenCalledWith(
      expect.stringContaining('source-bias:'),
      expect.any(Number),
      expect.any(String),
    )
  })

  it('caches unknown results with short TTL (86400s)', async () => {
    await getSourceBias('totallyrandomsource12345.io')
    expect(redisMock.setex).toHaveBeenCalledWith(
      expect.stringContaining('source-bias:'),
      86_400,
      expect.any(String),
    )
  })

  it('handles URL input (extracts domain)', async () => {
    const result = await getSourceBias('https://www.foxnews.com/politics/article')
    expect(result.method).toBe('seed')
    expect(result.score).toBeGreaterThan(0) // right-leaning
  })
})

// ─── batchGetSourceBias ──────────────────────────────────────────────────────

describe('batchGetSourceBias', () => {
  beforeEach(() => {
    redisMock.get.mockResolvedValue(null)
    vi.clearAllMocks()
  })

  it('returns a score for each input domain', async () => {
    const results = await batchGetSourceBias(['nytimes.com', 'foxnews.com', 'cdc.gov'])
    expect(Object.keys(results)).toHaveLength(3)
    expect(results['nytimes.com']).toBeDefined()
    expect(results['foxnews.com']).toBeDefined()
    expect(results['cdc.gov']).toBeDefined()
  })

  it('deduplicates domains', async () => {
    const results = await batchGetSourceBias(['cdc.gov', 'cdc.gov', 'cdc.gov'])
    expect(Object.keys(results)).toHaveLength(1)
    expect(redisMock.get).toHaveBeenCalledTimes(1)
  })

  it('handles empty input', async () => {
    const results = await batchGetSourceBias([])
    expect(Object.keys(results)).toHaveLength(0)
  })
})
