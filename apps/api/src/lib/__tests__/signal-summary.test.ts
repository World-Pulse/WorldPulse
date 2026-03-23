import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SignalSummaryInput } from '../signal-summary'

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../../db/redis', () => ({
  redis: {
    get:   vi.fn(),
    setex: vi.fn(),
    del:   vi.fn(),
  },
}))

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
    // Reset env vars
    delete process.env.OPENAI_API_KEY
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
      model:       'openai' as const,
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
    // Should cache extractive result
    expect(redis.setex).toHaveBeenCalledOnce()
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
    process.env.OPENAI_API_KEY = 'sk-test-invalid'
    redis.get.mockResolvedValueOnce(null)
    // Mock fetch to simulate LLM failure
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const { generateSignalSummary } = await import('../signal-summary')
    const result = await generateSignalSummary(makeSample())

    expect(result.model).toBe('extractive')
    // Should NOT cache when LLM fails (allow retry)
    expect(redis.setex).not.toHaveBeenCalled()

    delete process.env.OPENAI_API_KEY
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
})
