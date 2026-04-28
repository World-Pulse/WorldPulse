/**
 * slop-detector.test.ts — Unit tests for AI content farm heuristic scorer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../db/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

// Import AFTER mocks are set up
import { SlopDetector } from '../lib/slop-detector'
import { redis } from '../db/redis'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeDetector() {
  return new SlopDetector()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SlopDetector.scoreSignal', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no cache hit
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(redis.incr).mockResolvedValue(1)
  })

  it('returns score 0 and empty flags for a clean, high-quality signal', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:          'clean-001',
      source_url:  'https://reuters.com/world/breaking-story-2026',
      title:       'World Leaders Convene to Discuss Climate Policy',
      content:     'Representatives from 45 nations gathered in Geneva today to discuss binding climate commitments ahead of COP32. The summit is expected to last three days.',
      author:      'Sarah Johnson',
    })

    expect(result.score).toBe(0)
    expect(result.flags).toHaveLength(0)
    expect(result.cached).toBe(false)
  })

  it('adds WEIGHT_BLOCKLIST (0.40) when domain is in AI content farm blocklist', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:         'slop-001',
      source_url: 'https://dailytrendingnews.net/some-article',
      title:      'Breaking news update from the world',
      content:    'This is a short article about current events unfolding globally today.',
      author:     'Staff Reporter',
    })

    expect(result.flags).toContain('domain_blocklist:dailytrendingnews.net')
    expect(result.score).toBeGreaterThanOrEqual(0.40)
  })

  it('adds WEIGHT_NO_BYLINE (0.15) when author is missing', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:         'nob-001',
      source_url: 'https://legitimatenews.com/article',
      title:      'Senate Passes Infrastructure Amendment',
      content:    'The Senate voted 58-42 today to pass a major amendment to the infrastructure spending bill, adding $120 billion for broadband expansion.',
      author:     '',
    })

    expect(result.flags).toContain('missing_byline')
    expect(result.score).toBeGreaterThanOrEqual(0.15)
  })

  it('adds WEIGHT_NO_BYLINE when author is null', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:      'nob-002',
      title:   'Local Elections Update',
      content: 'Officials report turnout of 62% in the municipal elections held yesterday across three districts.',
      author:  null,
    })

    expect(result.flags).toContain('missing_byline')
  })

  it('adds WEIGHT_CLICKBAIT (0.10) for clickbait title patterns', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:      'click-001',
      title:   "You Won't Believe What This Senator Said About Healthcare!!",
      content: 'A senator made controversial remarks during a committee hearing.',
      author:  'Editor',
    })

    expect(result.flags).toContain('clickbait_title')
    expect(result.score).toBeGreaterThanOrEqual(0.10)
  })

  it('adds thin_content penalty for very short body (< 100 chars)', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:      'thin-001',
      title:   'Trade Deal Signed',
      content: 'A new deal.',
      author:  'John Doe',
    })

    expect(result.flags.some(f => f.startsWith('thin_content:'))).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(0.10)
  })

  it('does NOT penalize for thin_content when content is empty (no content provided)', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:      'nocontent-001',
      title:   'Breaking: Major Earthquake',
      author:  'Reuters Staff',
    })

    expect(result.flags.some(f => f.startsWith('thin_content:'))).toBe(false)
  })

  it('clamps score to maximum 1.0 when multiple heuristics trigger', async () => {
    const detector = makeDetector()
    vi.mocked(redis.incr).mockResolvedValue(15) // High cadence
    const result = await detector.scoreSignal({
      id:         'max-001',
      source_url: 'https://dailytrendingnews.net/', // blocklist + bare URL
      title:      "You Won't Believe This SHOCKING Breaking News!!",
      content:    'Quick update.',
      author:     '',  // no byline
    })

    expect(result.score).toBe(1.0)
    expect(result.score).toBeLessThanOrEqual(1.0)
  })

  it('returns cached result with cached=true on Redis cache hit', async () => {
    const cachedResult = { score: 0.55, flags: ['missing_byline'], cached: false }
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedResult))

    const detector = makeDetector()
    const result = await detector.scoreSignal({ id: 'cached-001', author: '' })

    expect(result.cached).toBe(true)
    expect(result.score).toBe(0.55)
    expect(result.flags).toContain('missing_byline')
    // Should NOT re-score or call incr
    expect(redis.incr).not.toHaveBeenCalled()
  })

  it('adds bare_url_path flag when URL has no meaningful path', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:         'bare-001',
      source_url: 'https://news-example.com/',
      title:      'News Update',
      content:    'A longer paragraph of content that exceeds one hundred characters to avoid the thin content penalty being applied to this test.',
      author:     'Test Author',
    })

    expect(result.flags).toContain('bare_url_path')
    expect(result.score).toBeGreaterThanOrEqual(0.05)
  })

  it('identifies a high-confidence AI slop signal (score >= 0.7)', async () => {
    const detector = makeDetector()
    const result = await detector.scoreSignal({
      id:         'highslop-001',
      source_url: 'https://morningtidings.com/',  // blocklist + bare URL
      title:      'Top 10 Shocking Facts You Must Know Today',
      content:    'Read more here.',
      author:     null,
    })

    expect(result.score).toBeGreaterThanOrEqual(0.7)
  })

  it('invalidateCache deletes the Redis key', async () => {
    const detector = makeDetector()
    await detector.invalidateCache('del-001')
    expect(redis.del).toHaveBeenCalledWith('slop-score:del-001')
  })
})
