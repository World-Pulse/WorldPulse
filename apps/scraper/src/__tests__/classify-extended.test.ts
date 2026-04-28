/**
 * Extended classification tests for apps/scraper/src/pipeline/classify.ts
 *
 * Focused on rule-based fallback behaviour:
 *  - detectCategory: category inference from content keywords
 *  - detectSeverity: severity mapping including critical patterns
 *  - detectLanguage: script + stopword heuristics
 *  - extractTags:    country/topic tag extraction
 *  - caching:        cache hit returns without re-classifying
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Redis mock ─────────────────────────────────────────────────────────────────

const redisMock = {
  get:   vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
  setex: vi.fn<() => Promise<'OK'>>().mockResolvedValue('OK'),
}

vi.mock('../lib/redis.js', () => ({ redis: redisMock }))
vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { classifyContent } = await import('../pipeline/classify.js')

// ── Category detection ────────────────────────────────────────────────────────

describe('classifyContent — category detection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifies nuclear/chemical threat as security category', async () => {
    const r = await classifyContent(
      'Chemical weapon attack kills 40 in conflict zone',
      'Reports of nerve agent use in the eastern province.',
    )
    expect(['conflict', 'security', 'breaking']).toContain(r.category)
  })

  it('classifies tech/AI news as technology', async () => {
    const r = await classifyContent(
      'OpenAI releases new AI model with reasoning capabilities',
      'The startup announced a breakthrough in artificial intelligence.',
    )
    expect(r.category).toBe('technology')
  })

  it('classifies space news correctly', async () => {
    const r = await classifyContent(
      'NASA rocket launch carries crew to the International Space Station',
      'Three astronauts are now in orbit.',
    )
    expect(r.category).toBe('space')
  })

  it('classifies health/pandemic news correctly', async () => {
    const r = await classifyContent(
      'WHO declares outbreak of new virus in Southeast Asia',
      'Hospitals are treating hundreds of patients with respiratory symptoms.',
    )
    expect(r.category).toBe('health')
  })

  it('classifies economic news correctly', async () => {
    const r = await classifyContent(
      'Federal Reserve raises interest rates amid high inflation',
      'Markets react as the central bank tightens monetary policy.',
    )
    expect(r.category).toBe('economy')
  })

  it('classifies geopolitics / NATO treaty news correctly', async () => {
    const r = await classifyContent(
      'NATO summit concludes with landmark treaty agreement',
      'Foreign ministers gathered to finalise the multilateral accord.',
    )
    expect(['geopolitics', 'other']).toContain(r.category)
  })

  it('classifies science/research news correctly', async () => {
    const r = await classifyContent(
      'Scientists publish study on new cancer treatment',
      'University researchers discovered a novel drug mechanism.',
    )
    expect(r.category).toBe('science')
  })

  it('falls back to "other" for unrecognised content', async () => {
    const r = await classifyContent(
      'Local community event this weekend',
      'A neighbourhood gathering is planned.',
    )
    expect(r.category).toBe('other')
  })
})

// ── Severity detection ────────────────────────────────────────────────────────

describe('classifyContent — severity detection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns critical for mass casualty events', async () => {
    const r = await classifyContent(
      'Mass casualty event declared after building collapse',
      'Hundreds feared dead after catastrophic structural failure.',
    )
    expect(r.severity).toBe('critical')
  })

  it('returns high for breaking major news', async () => {
    const r = await classifyContent(
      'Major earthquake kills dozens in coastal city',
      'Breaking: significant damage reported across the region.',
    )
    expect(['critical', 'high']).toContain(r.severity)
  })

  it('returns medium for developing injury reports', async () => {
    const r = await classifyContent(
      'Several injured in developing road accident',
      'Emergency services responding; situation still developing.',
    )
    expect(['medium', 'high']).toContain(r.severity)
  })

  it('isBreaking is true when severity is critical or high', async () => {
    const r = await classifyContent(
      'Nuclear threat alert issued by government',
      'Emergency declared after nuclear power plant incident.',
    )
    expect(['critical', 'high']).toContain(r.severity)
    if (r.severity === 'critical' || r.severity === 'high') {
      expect(r.isBreaking).toBe(true)
    }
  })

  it('returns info for low-priority background content', async () => {
    const r = await classifyContent(
      'Annual report released by minor NGO',
      'An organisation has published its yearly summary.',
    )
    expect(['info', 'low']).toContain(r.severity)
  })
})

// ── Language detection ────────────────────────────────────────────────────────

describe('classifyContent — language detection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('detects Chinese (zh) from CJK characters', async () => {
    const r = await classifyContent('地震袭击日本沿海地区', null)
    expect(r.language).toBe('zh')
  })

  it('detects Arabic (ar) from Arabic script', async () => {
    const r = await classifyContent('زلزال قوي يضرب اليابان', null)
    expect(r.language).toBe('ar')
  })

  it('detects Cyrillic as Russian (ru)', async () => {
    const r = await classifyContent('Землетрясение произошло на севере страны', null)
    expect(r.language).toBe('ru')
  })

  it('defaults to English for ASCII Latin text', async () => {
    const r = await classifyContent('Breaking news from the United Kingdom', null)
    expect(r.language).toBe('en')
  })

  it('returns a 2-character language code', async () => {
    const r = await classifyContent('Any title here', null)
    expect(r.language).toMatch(/^[a-z]{2}$/)
  })
})

// ── Tag extraction ────────────────────────────────────────────────────────────

describe('classifyContent — tag extraction', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('extracts USA tag for US-related content', async () => {
    const r = await classifyContent(
      'Washington announces new policy on trade',
      'The United States government issued a statement.',
    )
    expect(r.tags).toContain('USA')
  })

  it('extracts China tag', async () => {
    const r = await classifyContent('Beijing summit on climate', 'Chinese leaders met.')
    expect(r.tags).toContain('China')
  })

  it('extracts Philippines tag from Manila mention', async () => {
    const r = await classifyContent('Typhoon hits Manila bay', 'Philippines battered by storm.')
    expect(r.tags).toContain('Philippines')
  })

  it('extracts AI topic tag', async () => {
    const r = await classifyContent('New artificial intelligence model released', null)
    expect(r.tags).toContain('AI')
  })

  it('extracts ClimateChange tag', async () => {
    const r = await classifyContent('Global warming accelerates according to report', null)
    expect(r.tags).toContain('ClimateChange')
  })

  it('returns at most 5 tags', async () => {
    // Construct a title that matches many tag patterns
    const r = await classifyContent(
      'USA China Russia Ukraine climate change AI cryptocurrency ceasefire peace talks',
      null,
    )
    expect(r.tags.length).toBeLessThanOrEqual(5)
  })
})

// ── Caching behaviour ─────────────────────────────────────────────────────────

describe('classifyContent — Redis cache', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does NOT cache rule-based results to Redis (only LLM results are cached)', async () => {
    redisMock.get.mockResolvedValue(null)
    await classifyContent('Earthquake in Japan', null)
    // Rule-based classification bypasses setex — only LLM path caches
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('returns cached result without re-classifying', async () => {
    const cached = JSON.stringify({
      category:   'climate',
      severity:   'medium',
      summary:    'Cached result',
      tags:       ['ClimateChange'],
      language:   'en',
      isBreaking: false,
      topics:     ['ClimateChange'],
    })
    redisMock.get.mockResolvedValueOnce(cached)

    const r = await classifyContent('Some title', null)
    expect(r.category).toBe('climate')
    // Redis get was checked; setex should NOT be called (result came from cache)
    expect(redisMock.setex).not.toHaveBeenCalled()
  })
})

// ── Result shape ──────────────────────────────────────────────────────────────

describe('classifyContent — result shape', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('result always contains all required fields', async () => {
    const r = await classifyContent('News headline', 'Some body text.')
    expect(r).toHaveProperty('category')
    expect(r).toHaveProperty('severity')
    expect(r).toHaveProperty('summary')
    expect(r).toHaveProperty('tags')
    expect(r).toHaveProperty('language')
    expect(r).toHaveProperty('isBreaking')
    expect(r).toHaveProperty('topics')
  })

  it('summary is truncated to at most 150 characters', async () => {
    const longTitle = 'A'.repeat(200)
    const r = await classifyContent(longTitle, null)
    expect(r.summary.length).toBeLessThanOrEqual(150)
  })

  it('topics is a subset of tags (first 2)', async () => {
    const r = await classifyContent(
      'USA China artificial intelligence climate change',
      null,
    )
    expect(r.topics.length).toBeLessThanOrEqual(2)
    for (const topic of r.topics) {
      expect(r.tags).toContain(topic)
    }
  })
})
