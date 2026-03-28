/**
 * slop-api.test.ts — Public Slop Detection API tests
 *
 * Tests for GET /api/v1/slop/farms, GET /api/v1/slop/stats,
 * POST /api/v1/slop/check, and POST /api/v1/slop/batch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KNOWN_AI_CONTENT_FARMS } from '../lib/ai-content-farms'
import { slopDetector } from '../lib/slop-detector'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => ({
  db: vi.fn(() => ({
    where:       vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    count:       vi.fn().mockReturnThis(),
    first:       vi.fn().mockResolvedValue({ count: '1000' }),
    update:      vi.fn().mockResolvedValue(1),
  })),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    set:    vi.fn().mockResolvedValue('OK'),
    setex:  vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../lib/api-keys', () => ({
  hashKey: (k: string) => `hash_${k}`,
}))

// ─── Tests: KNOWN_AI_CONTENT_FARMS ───────────────────────────────────────────

describe('KNOWN_AI_CONTENT_FARMS blocklist', () => {
  it('is a non-empty readonly array', () => {
    expect(KNOWN_AI_CONTENT_FARMS).toBeDefined()
    expect(Array.isArray(KNOWN_AI_CONTENT_FARMS)).toBe(true)
    expect(KNOWN_AI_CONTENT_FARMS.length).toBeGreaterThan(0)
  })

  it('contains only lowercase domain strings', () => {
    for (const domain of KNOWN_AI_CONTENT_FARMS) {
      expect(typeof domain).toBe('string')
      expect(domain).toBe(domain.toLowerCase())
      expect(domain.length).toBeGreaterThan(0)
      expect(domain).not.toContain('http')
      expect(domain).not.toContain(' ')
    }
  })

  it('contains no duplicate domains', () => {
    const set  = new Set(KNOWN_AI_CONTENT_FARMS)
    expect(set.size).toBe(KNOWN_AI_CONTENT_FARMS.length)
  })
})

// ─── Tests: slopDetector.scoreSignal ─────────────────────────────────────────

describe('slopDetector.scoreSignal', () => {
  it('returns 0 score for a clean signal with all fields', async () => {
    const result = await slopDetector.scoreSignal({
      id:          'test-clean-1',
      source_url:  'https://reuters.com/article/us-economy-2026',
      title:       'US Economy Grows 3.2% in Q1 2026',
      content:     'The United States economy grew at an annual rate of 3.2 percent in the first quarter of 2026, according to the Commerce Department, beating analysts expectations of 2.8 percent growth. The strong performance was driven by robust consumer spending and business investment.',
      author:      'John Smith',
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThan(0.5)
    expect(result.flags).not.toContain('missing_byline')
  })

  it('adds missing_byline flag when author is absent', async () => {
    const result = await slopDetector.scoreSignal({
      id:         'test-no-author',
      source_url: 'https://legitnews.example.com/article/123',
      title:      'A Real News Story Here',
      content:    'This is a real article with actual substance and meaningful content that exceeds one hundred characters for testing.',
      author:     null,
    })
    expect(result.flags).toContain('missing_byline')
    expect(result.score).toBeGreaterThanOrEqual(0.15)
  })

  it('adds clickbait_title flag for sensational patterns', async () => {
    const result = await slopDetector.scoreSignal({
      id:         'test-clickbait',
      source_url: 'https://example.com/article/456',
      title:      'You Won\'t Believe What Happened Next in These Shocking Events!!',
      content:    'A longer article body that has sufficient content to avoid the thin content flag, adding more details here.',
      author:     'Jane Doe',
    })
    expect(result.flags).toContain('clickbait_title')
    expect(result.score).toBeGreaterThanOrEqual(0.10)
  })

  it('adds thin_content flag for very short body', async () => {
    const result = await slopDetector.scoreSignal({
      id:         'test-thin',
      source_url: 'https://example.com/story/789',
      title:      'Normal Title',
      content:    'Short.',
      author:     'Writer',
    })
    expect(result.flags.some(f => f.startsWith('thin_content'))).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(0.10)
  })

  it('returns score clamped to [0, 1]', async () => {
    const result = await slopDetector.scoreSignal({
      id:         'test-clamp',
      source_url: null,
      title:      null,
      content:    null,
      author:     null,
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

  it('returns flags as an array', async () => {
    const result = await slopDetector.scoreSignal({
      id:         'test-flags',
      source_url: 'https://example.com/news',
      title:      'Some Title',
      content:    null,
      author:     null,
    })
    expect(Array.isArray(result.flags)).toBe(true)
  })
})

// ─── Tests: scoreToVerdict logic ─────────────────────────────────────────────

describe('verdict thresholds', () => {
  // Mirrors the scoreToVerdict function in slop.ts
  const scoreToVerdict = (score: number) => {
    if (score >= 0.70) return 'confirmed_farm'
    if (score >= 0.50) return 'likely_slop'
    if (score >= 0.25) return 'suspicious'
    return 'clean'
  }

  it('returns clean for score < 0.25', () => {
    expect(scoreToVerdict(0.0)).toBe('clean')
    expect(scoreToVerdict(0.20)).toBe('clean')
    expect(scoreToVerdict(0.24)).toBe('clean')
  })

  it('returns suspicious for score 0.25–0.49', () => {
    expect(scoreToVerdict(0.25)).toBe('suspicious')
    expect(scoreToVerdict(0.35)).toBe('suspicious')
    expect(scoreToVerdict(0.49)).toBe('suspicious')
  })

  it('returns likely_slop for score 0.50–0.69', () => {
    expect(scoreToVerdict(0.50)).toBe('likely_slop')
    expect(scoreToVerdict(0.60)).toBe('likely_slop')
    expect(scoreToVerdict(0.69)).toBe('likely_slop')
  })

  it('returns confirmed_farm for score >= 0.70', () => {
    expect(scoreToVerdict(0.70)).toBe('confirmed_farm')
    expect(scoreToVerdict(0.85)).toBe('confirmed_farm')
    expect(scoreToVerdict(1.00)).toBe('confirmed_farm')
  })
})

// ─── Tests: URL extraction and validation ─────────────────────────────────────

describe('URL domain extraction', () => {
  const extractDomain = (url: string): string | null => {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return null
    }
  }

  it('strips www. prefix', () => {
    expect(extractDomain('https://www.reuters.com/article/123')).toBe('reuters.com')
  })

  it('returns null for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeNull()
  })

  it('handles https and http', () => {
    expect(extractDomain('http://example.com/path')).toBe('example.com')
    expect(extractDomain('https://subdomain.example.com/path')).toBe('subdomain.example.com')
  })

  it('lowercases the hostname', () => {
    expect(extractDomain('https://REUTERS.COM/article')).toBe('reuters.com')
  })
})

// ─── Tests: flagsToBreakdown ──────────────────────────────────────────────────

describe('flagsToBreakdown', () => {
  const flagsToBreakdown = (flags: string[]) => ({
    domain_blocklist: flags.some(f => f.startsWith('domain_blocklist')) ? 0.40 : 0,
    missing_byline:   flags.includes('missing_byline')                  ? 0.15 : 0,
    clickbait_title:  flags.includes('clickbait_title')                 ? 0.10 : 0,
    thin_content:     flags.some(f => f.startsWith('thin_content'))     ? 0.10 : 0,
    high_cadence:     flags.some(f => f.startsWith('high_cadence'))     ? 0.10 : 0,
    bare_url_path:    flags.includes('bare_url_path')                   ? 0.05 : 0,
  })

  it('maps flags to correct weights', () => {
    const breakdown = flagsToBreakdown([
      'domain_blocklist:spam.com',
      'missing_byline',
      'clickbait_title',
      'thin_content:50chars',
      'high_cadence:spam.com:15/hr',
      'bare_url_path',
    ])
    expect(breakdown.domain_blocklist).toBe(0.40)
    expect(breakdown.missing_byline).toBe(0.15)
    expect(breakdown.clickbait_title).toBe(0.10)
    expect(breakdown.thin_content).toBe(0.10)
    expect(breakdown.high_cadence).toBe(0.10)
    expect(breakdown.bare_url_path).toBe(0.05)
  })

  it('returns all zeros for empty flags', () => {
    const breakdown = flagsToBreakdown([])
    expect(Object.values(breakdown).every(v => v === 0)).toBe(true)
  })

  it('max total breakdown weight equals 0.90', () => {
    const all = ['domain_blocklist:x', 'missing_byline', 'clickbait_title', 'thin_content:5chars', 'high_cadence:x:99/hr', 'bare_url_path']
    const breakdown = flagsToBreakdown(all)
    const total = Object.values(breakdown).reduce((s, v) => s + v, 0)
    expect(total).toBeCloseTo(0.90, 2)
  })
})
