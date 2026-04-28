/**
 * source-bias.test.ts
 * Unit tests for apps/api/src/lib/source-bias.ts
 *
 * Coverage:
 *  - getBiasLabel() boundary conditions
 *  - getSourceBias() for known seed domains
 *  - www prefix stripping
 *  - Unknown domain returns 'unknown' / 'low' confidence
 *  - Redis caching (set on miss, return on hit)
 *  - extractDomain() from full URLs and bare hostnames
 *  - batchGetSourceBias() deduplication and parallel lookup
 *  - Bias distribution response shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Redis before importing the module under test ──────────────────────
vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn(),
    setex: vi.fn(),
  },
}))

const { redis } = await import('../db/redis')
const redisMock = redis as { get: ReturnType<typeof vi.fn>; setex: ReturnType<typeof vi.fn> }

// ── Import after mocks are set up ─────────────────────────────────────────
import {
  getBiasLabel,
  getSourceBias,
  extractDomain,
  batchGetSourceBias,
  SEED_BIAS_MAP,
} from '../lib/source-bias'

// ── getBiasLabel ──────────────────────────────────────────────────────────

describe('getBiasLabel', () => {
  it('returns far-left for score <= -0.8', () => {
    expect(getBiasLabel(-1.0)).toBe('far-left')
    expect(getBiasLabel(-0.8)).toBe('far-left')
  })

  it('returns left for score in (-0.8, -0.4]', () => {
    expect(getBiasLabel(-0.79)).toBe('left')
    expect(getBiasLabel(-0.5)).toBe('left')
    expect(getBiasLabel(-0.4)).toBe('left')
  })

  it('returns center-left for score in (-0.4, -0.1]', () => {
    expect(getBiasLabel(-0.39)).toBe('center-left')
    expect(getBiasLabel(-0.2)).toBe('center-left')
    expect(getBiasLabel(-0.1)).toBe('center-left')
  })

  it('returns center for score in (-0.1, 0.1)', () => {
    expect(getBiasLabel(0.0)).toBe('center')
    expect(getBiasLabel(0.05)).toBe('center')
    expect(getBiasLabel(-0.09)).toBe('center')
  })

  it('returns center-right for score in [0.1, 0.4)', () => {
    expect(getBiasLabel(0.1)).toBe('center-right')
    expect(getBiasLabel(0.3)).toBe('center-right')
    expect(getBiasLabel(0.39)).toBe('center-right')
  })

  it('returns right for score in [0.4, 0.8)', () => {
    expect(getBiasLabel(0.4)).toBe('right')
    expect(getBiasLabel(0.65)).toBe('right')
    expect(getBiasLabel(0.79)).toBe('right')
  })

  it('returns far-right for score >= 0.8', () => {
    expect(getBiasLabel(0.8)).toBe('far-right')
    expect(getBiasLabel(1.0)).toBe('far-right')
  })
})

// ── extractDomain ─────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts hostname from a full URL', () => {
    expect(extractDomain('https://www.nytimes.com/article/foo')).toBe('nytimes.com')
  })

  it('strips www prefix from a bare domain', () => {
    expect(extractDomain('www.bbc.com')).toBe('bbc.com')
  })

  it('handles bare domains without www', () => {
    expect(extractDomain('reuters.com')).toBe('reuters.com')
  })

  it('lowercases the result', () => {
    expect(extractDomain('BBC.COM')).toBe('bbc.com')
  })
})

// ── getSourceBias — seed map hits ─────────────────────────────────────────

describe('getSourceBias (seed map)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate cache miss on every test
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')
  })

  it('returns left label for nytimes.com', async () => {
    const result = await getSourceBias('nytimes.com')
    expect(result.label).toBe('left')
    expect(result.confidence).toBe('high')
    expect(result.method).toBe('seed')
  })

  it('returns right label for foxnews.com', async () => {
    const result = await getSourceBias('foxnews.com')
    expect(result.label).toBe('right')
    expect(result.confidence).toBe('high')
    expect(result.method).toBe('seed')
  })

  it('returns center label for reuters.com', async () => {
    const result = await getSourceBias('reuters.com')
    expect(result.label).toBe('center')
    expect(result.confidence).toBe('high')
    expect(result.method).toBe('seed')
  })

  it('returns far-left for jacobinmag.com', async () => {
    const result = await getSourceBias('jacobinmag.com')
    expect(result.label).toBe('far-left')
  })

  it('returns far-right for infowars.com', async () => {
    const result = await getSourceBias('infowars.com')
    expect(result.label).toBe('far-right')
  })

  it('strips www prefix: www.bbc.com → bbc.com seed lookup', async () => {
    const withWww    = await getSourceBias('www.bbc.com')
    const withoutWww = await getSourceBias('bbc.com')
    expect(withWww.score).toBe(withoutWww.score)
    expect(withWww.label).toBe(withoutWww.label)
  })

  it('handles a full URL correctly', async () => {
    const result = await getSourceBias('https://www.washingtonpost.com/politics/story')
    expect(result.label).toBe('left')
    expect(result.confidence).toBe('high')
  })

  it('caches the result in Redis on a seed hit', async () => {
    await getSourceBias('reuters.com')
    expect(redisMock.setex).toHaveBeenCalledWith(
      'source-bias:reuters.com',
      expect.any(Number),
      expect.stringContaining('center'),
    )
  })
})

// ── getSourceBias — cache hit ─────────────────────────────────────────────

describe('getSourceBias (cache hit)', () => {
  it('returns cached value without seed map lookup', async () => {
    const cached = JSON.stringify({ score: 0.65, label: 'right', confidence: 'high', method: 'seed' })
    redisMock.get.mockResolvedValue(cached)

    const result = await getSourceBias('foxnews.com')
    expect(result.label).toBe('right')
    expect(result.score).toBe(0.65)
    // setex should NOT be called — we returned from cache
    expect(redisMock.setex).not.toHaveBeenCalled()
  })
})

// ── getSourceBias — unknown domain ────────────────────────────────────────

describe('getSourceBias (unknown domain)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')
  })

  it('returns unknown for an unrecognized domain', async () => {
    const result = await getSourceBias('somerandomblog-xyz.com')
    expect(result.label).toBe('unknown')
    expect(result.confidence).toBe('low')
    expect(result.method).toBe('unknown')
  })

  it('caches unknown domains with a 1-day TTL', async () => {
    await getSourceBias('notindatabase.example.org')
    expect(redisMock.setex).toHaveBeenCalledWith(
      'source-bias:notindatabase.example.org',
      86_400,
      expect.any(String),
    )
  })
})

// ── batchGetSourceBias ────────────────────────────────────────────────────

describe('batchGetSourceBias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')
  })

  it('returns a result for each input domain', async () => {
    const result = await batchGetSourceBias(['nytimes.com', 'foxnews.com', 'reuters.com'])
    expect(Object.keys(result)).toHaveLength(3)
    expect(result['nytimes.com']?.label).toBe('left')
    expect(result['foxnews.com']?.label).toBe('right')
    expect(result['reuters.com']?.label).toBe('center')
  })

  it('deduplicates identical domains', async () => {
    const result = await batchGetSourceBias(['nytimes.com', 'nytimes.com', 'nytimes.com'])
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('normalizes www prefix during batch', async () => {
    const result = await batchGetSourceBias(['www.reuters.com', 'reuters.com'])
    // Both resolve to 'reuters.com' — deduplicated to 1 key
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['reuters.com']?.label).toBe('center')
  })
})

// ── SEED_BIAS_MAP coverage ────────────────────────────────────────────────

describe('SEED_BIAS_MAP', () => {
  it('contains at least 40 domains', () => {
    expect(Object.keys(SEED_BIAS_MAP).length).toBeGreaterThanOrEqual(40)
  })

  it('all scores are within [-1, 1]', () => {
    for (const [domain, score] of Object.entries(SEED_BIAS_MAP)) {
      expect(score, `${domain} score out of range`).toBeGreaterThanOrEqual(-1)
      expect(score, `${domain} score out of range`).toBeLessThanOrEqual(1)
    }
  })
})
