/**
 * Tests for Multi-Model AI Consensus Verification
 *
 * Verifies the Claude secondary pass logic added to verify.ts:
 * - Consensus only runs for uncertain scores (0.3–0.7)
 * - consensus_verified reflects model agreement
 * - Score blending stays within [0, 1]
 * - Graceful fallback when Claude is unavailable
 *
 * Since Oct 11, 2026 (in-house plan, verify.ts), with a Claude key Claude IS the
 * fact-check, asked once and only for stories that matter (two or more reports,
 * or a high or critical one: verify-claude.test.ts). The second-opinion pass
 * runs only after a self-hosted model's check, which a Claude key turns off, so
 * these tests now pin that Claude isn't asked twice (plan LR6, Oct 23, 2026).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── DB mock ─────────────────────────────────────────────────────────────────

// Implementations given to vi.fn() itself: vi.restoreAllMocks() (after each test) puts a mock back
// to that, and would leave a .mockResolvedValue() mock answering undefined
const dbInsertMock = vi.fn(async () => [])
const dbTableMock  = vi.fn(() => ({ insert: dbInsertMock }))

vi.mock('../../lib/postgres.js', () => ({ db: dbTableMock }))

// ── Redis mock ───────────────────────────────────────────────────────────────

vi.mock('../../lib/redis.js', () => ({
  redis: {
    get:   vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
  },
}))

// ── Logger mock ──────────────────────────────────────────────────────────────

vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Import system under test ─────────────────────────────────────────────────

const { verifySignal } = await import('../verify.js')

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeArticle(overrides: {
  sourceId?:    string
  sourceTrust?: number
  sourceTier?:  string
  title?:       string
} = {}) {
  return {
    sourceId:    overrides.sourceId    ?? 'src-1',
    sourceTrust: overrides.sourceTrust ?? 0.55,
    sourceTier:  overrides.sourceTier  ?? 'mainstream',
    title:       overrides.title       ?? 'Moderate reliability headline',
    url:         'https://example.com/article',
  }
}

/** Single mid-trust source → score lands in uncertain zone 0.3–0.7 */
const uncertainArticles = [makeArticle()]

/** Three wire sources → score reliably >= 0.75 (verified) */
const verifiedArticles = [
  makeArticle({ sourceId: 'ap',     sourceTrust: 0.97, sourceTier: 'wire' }),
  makeArticle({ sourceId: 'reuters', sourceTrust: 0.96, sourceTier: 'wire' }),
  makeArticle({ sourceId: 'afp',    sourceTrust: 0.95, sourceTier: 'wire' }),
]

const signal = { id: 'sig-consensus-1', severity: 'medium', category: 'geopolitics' }

/** Build a valid Anthropic Messages API response */
function mockClaudeResponse(consistent: boolean, confidenceScore: number) {
  return {
    ok:   true,
    json: async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          consistent,
          confidenceScore,
          contradictions: [],
          summary:        consistent ? 'Sources align on key facts.' : 'Conflicting claims detected.',
        }),
      }],
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-model consensus — activation window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    // No OpenAI configured so primary LLM check is skipped
    delete process.env.OPENAI_API_KEY
    delete process.env.LLM_API_URL
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    vi.restoreAllMocks()
  })

  it('does NOT call Claude API when score is above 0.70 (verified zone)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok:   true,
      json: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    } as unknown as Response)

    await verifySignal(signal, verifiedArticles)

    const anthropicCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('anthropic.com'),
    )
    expect(anthropicCall).toBeUndefined()
  })

  it('asks Claude no second opinion on an uncertain single report (Claude is the fact-check itself, for stories that matter)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockClaudeResponse(true, 0.75) as unknown as Response,
    )

    const result = await verifySignal(signal, uncertainArticles)

    const anthropicCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('anthropic.com'),
    )
    expect(anthropicCall).toBeUndefined()
    expect(result.checkTypes).not.toContain('claude_consensus')
  })

  it('does NOT call Claude API when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockClaudeResponse(true, 0.8) as unknown as Response,
    )

    const result = await verifySignal(signal, uncertainArticles)

    const anthropicCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('anthropic.com'),
    )
    expect(anthropicCall).toBeUndefined()
    // consensus_verified should be false without a second model
    expect(result.consensus_verified).toBe(false)
  })
})

describe('Multi-model consensus — consensus_verified flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY  = 'test-anthropic-key'
    process.env.OPENAI_API_KEY     = 'test-openai-key'
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    vi.restoreAllMocks()
  })

  it('consensus_verified stays false with a Claude key, even when the checks agree (no second model is asked)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('anthropic.com')) {
        return mockClaudeResponse(true, 0.8) as unknown as Response
      }
      // OpenAI primary check — consistent, high confidence
      return {
        ok:   true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            consistent: true, confidenceScore: 0.75,
            contradictions: [], summary: 'All sources agree.',
          }) } }],
        }),
      } as unknown as Response
    })

    const result = await verifySignal(signal, uncertainArticles)
    expect(result.consensus_verified).toBe(false)
  })

  it('consensus_verified=false when models disagree (one pass, one fail)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('anthropic.com')) {
        // Claude says: inconsistent, low confidence
        return mockClaudeResponse(false, 0.3) as unknown as Response
      }
      // OpenAI says: consistent, high confidence
      return {
        ok:   true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            consistent: true, confidenceScore: 0.85,
            contradictions: [], summary: 'Sources align.',
          }) } }],
        }),
      } as unknown as Response
    })

    const result = await verifySignal(signal, uncertainArticles)
    expect(result.consensus_verified).toBe(false)
  })

  it('consensus_verified=false when no primary LLM is configured', async () => {
    delete process.env.OPENAI_API_KEY

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockClaudeResponse(true, 0.8) as unknown as Response,
    )

    const result = await verifySignal(signal, uncertainArticles)
    expect(result.consensus_verified).toBe(false)
  })
})

describe('Multi-model consensus — score blending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.LLM_API_URL
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    vi.restoreAllMocks()
  })

  it('final score is always in [0, 1] range after consensus blending', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockClaudeResponse(true, 1.0) as unknown as Response,
    )

    const result = await verifySignal(signal, uncertainArticles)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

})

describe('Multi-model consensus — checkTypes and DB logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.LLM_API_URL
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    vi.restoreAllMocks()
  })

  it('verification_log gets a row per check, and none for a consensus pass that didn\'t run', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockClaudeResponse(true, 0.8) as unknown as Response,
    )

    const result = await verifySignal(signal, uncertainArticles)

    const [rows] = dbInsertMock.mock.calls[0] as [Array<Record<string, unknown>>]
    expect(rows.map(r => r['check_type'])).toEqual(result.checkTypes)
    expect(rows.every(r => r['signal_id'] === signal.id)).toBe(true)
    expect(rows.find(r => r['check_type'] === 'claude_consensus')).toBeUndefined()
  })

  it('checkTypes does NOT include claude_consensus when score is above 0.70', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok:   true,
      json: async () => ({}),
    } as unknown as Response)

    const result = await verifySignal(signal, verifiedArticles)

    expect(result.checkTypes).not.toContain('claude_consensus')
    fetchSpy.mockRestore()
  })

  it('gracefully handles Claude API failure without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const result = await verifySignal(signal, uncertainArticles)

    // Should still return a valid result
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('score')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    // Consensus should not be marked verified on failure
    expect(result.consensus_verified).toBe(false)
  })
})
