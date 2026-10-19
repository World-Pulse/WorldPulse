import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SignalSummaryInput } from '../signal-summary'

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../../db/redis', () => {
  // The Claude spending cap (lib/claude.ts) reads and counts in Redis too
  const chain: Record<string, unknown> = {}
  for (const op of ['incrby', 'expire', 'hincrby', 'hset', 'hdel']) chain[op] = () => chain
  chain.exec = async () => []
  return {
    redis: {
      get:   vi.fn(),
      setex: vi.fn(),
      del:   vi.fn(),
      mget:  vi.fn(async () => [null, null]),
      multi: vi.fn(() => chain),
      // the day's summary count (Oct 19, 2026)
      incr:   vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    },
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeSample = (overrides: Partial<SignalSummaryInput> = {}): SignalSummaryInput => ({
  id:       'sig-001',
  title:    'Major earthquake strikes coastal region, 6.8 magnitude',
  summary:  'A powerful earthquake struck the coastal region late Friday.',
  body:     'Rescue teams have been deployed. At least 12 people confirmed injured. Aftershocks continue.',
  category: 'disaster',
  severity: 'high',
  tags:     ['earthquake', 'disaster', 'rescue'],
  language: 'en',
  ...overrides,
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('generateSignalSummary', () => {
  let redis: { get: ReturnType<typeof vi.fn>; setex: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset all LLM env vars
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OLLAMA_URL
    const redisMod = await import('../../db/redis')
    redis = redisMod.redis as unknown as typeof redis
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns cached summary when Redis hit', async () => {
    const cached = {
      text:        'Cached AI summary text.',
      model:       'anthropic' as const,
      generatedAt: '2026-03-22T00:00:00Z',
    }
    redis.get.mockResolvedValueOnce(JSON.stringify(cached))

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result).toEqual(cached)
    expect(redis.get).toHaveBeenCalledWith('signal-ai-summary:sig-001')
    // Should NOT attempt LLM when cache hits
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('falls back to extractive summary when no LLM configured', async () => {
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('extractive')
    expect(result.text).toBeTruthy()
    expect(result.text.length).toBeGreaterThan(10)
    expect(result.generatedAt).toBeTruthy()
    // An extractive summary is never kept: it would stand in for the AI one (Oct 19, 2026)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('extractive fallback uses existing summary field when present', async () => {
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    const { generateSignalSummary } = await import('../signal-summary')
    const input = makeSample({ summary: 'A powerful earthquake struck the coastal region late Friday.' })
    const result = await generateSignalSummary(input)

    expect(result.model).toBe('extractive')
    expect(result.text).toContain('earthquake struck')
  })

  it('extractive fallback uses title when summary and body are null', async () => {
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    const { generateSignalSummary } = await import('../signal-summary')
    const input = makeSample({ summary: null, body: null })
    const result = await generateSignalSummary(input)

    expect(result.model).toBe('extractive')
    expect(result.text).toContain(input.title)
  })

  it('appends severity + category context to extractive summary', async () => {
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample({ category: 'disaster', severity: 'high' }))

    expect(result.text).toContain('HIGH')
    expect(result.text).toContain('disaster')
  })

  it('returns extractive fallback (no cache) when LLM fails', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-invalid'
    redis.get.mockResolvedValueOnce(null)
    // Mock fetch to simulate LLM failure
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('extractive')
    // Should NOT cache when LLM fails (allow retry)
    expect(redis.setex).not.toHaveBeenCalled()

    delete process.env.GEMINI_API_KEY
  })

  it('invalidateSummaryCache deletes the Redis key', async () => {
    redis.del.mockResolvedValueOnce(1)

    const { invalidateSummaryCache } = await import('../signal-summary')
    await invalidateSummaryCache('sig-001')

    expect(redis.del).toHaveBeenCalledWith('signal-ai-summary:sig-001')
  })

  it('refreshSignalSummary invalidates cache then regenerates', async () => {
    redis.del.mockResolvedValueOnce(1)
    // After invalidation, get returns null (cache miss)
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    const { refreshSignalSummary } = await import('../signal-summary')
    const result = await refreshSignalSummary(makeSample())

    expect(redis.del).toHaveBeenCalledWith('signal-ai-summary:sig-001')
    expect(result.model).toBe('extractive')
  })

  it('uses Anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Anthropic generated summary.' }],
      }),
    } as unknown as Response)

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('anthropic')
    expect(result.text).toBe('Anthropic generated summary.')
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toContain('anthropic.com')

    delete process.env.ANTHROPIC_API_KEY
  })

  it('uses Gemini when GEMINI_API_KEY is set (no Anthropic/OpenAI)', async () => {
    process.env.GEMINI_API_KEY = 'AIza-test-key'
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Gemini generated summary.' }] } }],
      }),
    } as unknown as Response)

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('gemini')
    expect(result.text).toBe('Gemini generated summary.')
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toContain('generativelanguage.googleapis.com')

    delete process.env.GEMINI_API_KEY
  })

  it('uses OpenRouter when OPENROUTER_API_KEY is set (no higher-priority provider)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'OpenRouter generated summary.' } }],
      }),
    } as unknown as Response)

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('openrouter')
    expect(result.text).toBe('OpenRouter generated summary.')
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toContain('openrouter.ai')

    delete process.env.OPENROUTER_API_KEY
  })

  it('Anthropic takes priority over Gemini when both keys set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    process.env.GEMINI_API_KEY    = 'gemini-test'
    redis.get.mockResolvedValueOnce(null)
    redis.setex.mockResolvedValueOnce('OK')

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Anthropic wins priority.' }],
      }),
    } as unknown as Response)

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('anthropic')
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toContain('anthropic.com')

    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
  })

  it('never calls OpenAI, even when an OpenAI key is set', async () => {
    process.env.OPENAI_API_KEY = 'unused-key'
    redis.get.mockResolvedValueOnce(null)
    global.fetch = vi.fn()

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('extractive')
    expect(global.fetch).not.toHaveBeenCalled()

    delete process.env.OPENAI_API_KEY
  })
})

// ─── Oct 19, 2026: a page view never asks an AI ──────────────────────────────
describe('readSignalSummary and the day\'s limit', () => {
  let redis: { get: ReturnType<typeof vi.fn>; setex: ReturnType<typeof vi.fn>; incr: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OLLAMA_URL
    delete process.env.SUMMARY_DAILY_LIMIT
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const redisMod = await import('../../db/redis')
    redis = redisMod.redis as unknown as typeof redis
    global.fetch = vi.fn()
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    vi.restoreAllMocks()
  })

  it('a page with no summary written gets the outlet\'s own text, and no AI is asked', async () => {
    redis.get.mockResolvedValueOnce(null)
    const { readSignalSummary } = await import('../signal-summary')
    const result = await readSignalSummary(makeSample())
    expect(result.model).toBe('extractive')
    expect(result.text).toContain('earthquake struck')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
    expect(redis.incr).not.toHaveBeenCalled()
  })

  it('a page with a summary written gets it', async () => {
    const kept = { text: 'Kept AI summary.', model: 'anthropic', generatedAt: '2026-10-19T10:00:00Z' }
    redis.get.mockResolvedValueOnce(JSON.stringify(kept))
    const { readSignalSummary } = await import('../signal-summary')
    expect(await readSignalSummary(makeSample())).toEqual(kept)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('past the day\'s limit no AI is asked, and nothing is kept', async () => {
    process.env.SUMMARY_DAILY_LIMIT = '400'
    redis.get.mockResolvedValueOnce(null)
    redis.incr.mockResolvedValueOnce(401)
    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())
    expect(result.model).toBe('extractive')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('when Redis can\'t count, no AI is asked', async () => {
    redis.get.mockResolvedValueOnce(null)
    redis.incr.mockRejectedValueOnce(new Error('redis down'))
    const { generateSignalSummary } = await import('../signal-summary')
    expect((await generateSignalSummary(makeSample())).model).toBe('extractive')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('an AI summary is kept 30 days', async () => {
    redis.get.mockResolvedValueOnce(null)
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Anthropic generated summary.' }] }),
    } as unknown as Response)
    const { generateSignalSummary, SUMMARY_CACHE_TTL } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())
    expect(result.model).toBe('anthropic')
    expect(SUMMARY_CACHE_TTL).toBe(30 * 86_400)
    expect(redis.setex).toHaveBeenCalledWith('signal-ai-summary:sig-001', 30 * 86_400, expect.any(String))
  })
})

