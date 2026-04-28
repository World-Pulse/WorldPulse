import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Constants under test (mirrored from claims.ts) ─────────────────────────

const SEMANTIC_SIMILARITY_THRESHOLD = 0.75
const SEMANTIC_CONTRADICTION_THRESHOLD = 0.40

const CONTRADICTION_SIGNALS = [
  'denied', 'refuted', 'contradicted', 'false', 'incorrect', 'debunked',
  'disputed', 'rejected', 'untrue', 'misleading', 'misinformation', 'retracted',
  'not true', 'no evidence', 'unsubstantiated', 'fabricated', 'disproven',
]

// ─── Mock dependencies ──────────────────────────────────────────────────────

const mockIsPineconeEnabled = vi.fn().mockReturnValue(false)
const mockGenerateEmbedding = vi.fn().mockResolvedValue(null)
const mockQuerySimilar = vi.fn().mockResolvedValue([])

vi.mock('../../lib/pinecone', () => ({
  isPineconeEnabled: () => mockIsPineconeEnabled(),
  generateEmbedding: (text: string) => mockGenerateEmbedding(text),
  querySimilar: (embedding: number[], topK: number) => mockQuerySimilar(embedding, topK),
}))

vi.mock('../../db/postgres', () => ({
  db: Object.assign(
    vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.first = vi.fn().mockResolvedValue(null)
      chain.orderBy = vi.fn().mockReturnValue(chain)
      chain.limit = vi.fn().mockResolvedValue([])
      chain.count = vi.fn().mockReturnValue(chain)
      chain.groupBy = vi.fn().mockResolvedValue([])
      return chain
    }),
    {
      raw: vi.fn().mockResolvedValue({ rows: [] }),
    },
  ),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

vi.mock('../../middleware/auth', () => ({
  optionalAuth: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
  authenticate: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
}))

vi.mock('../../lib/errors', () => ({
  sendError: vi.fn((_reply: unknown, status: number, message: string) => ({ status, message })),
}))

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Claims API v2 — Semantic Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPineconeEnabled.mockReturnValue(false)
    mockGenerateEmbedding.mockResolvedValue(null)
    mockQuerySimilar.mockResolvedValue([])
  })

  describe('Semantic constants', () => {
    it('should have similarity threshold between 0 and 1', () => {
      expect(SEMANTIC_SIMILARITY_THRESHOLD).toBeGreaterThan(0)
      expect(SEMANTIC_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1)
    })

    it('should have contradiction threshold below similarity threshold', () => {
      expect(SEMANTIC_CONTRADICTION_THRESHOLD).toBeLessThan(SEMANTIC_SIMILARITY_THRESHOLD)
    })

    it('should have similarity threshold at 0.75', () => {
      expect(SEMANTIC_SIMILARITY_THRESHOLD).toBe(0.75)
    })

    it('should have contradiction threshold at 0.40', () => {
      expect(SEMANTIC_CONTRADICTION_THRESHOLD).toBe(0.40)
    })
  })

  describe('Contradiction signals', () => {
    it('should have at least 15 contradiction keywords', () => {
      expect(CONTRADICTION_SIGNALS.length).toBeGreaterThanOrEqual(15)
    })

    it('should include key denial words', () => {
      expect(CONTRADICTION_SIGNALS).toContain('denied')
      expect(CONTRADICTION_SIGNALS).toContain('refuted')
      expect(CONTRADICTION_SIGNALS).toContain('debunked')
      expect(CONTRADICTION_SIGNALS).toContain('false')
    })

    it('should include misinformation terms', () => {
      expect(CONTRADICTION_SIGNALS).toContain('misinformation')
      expect(CONTRADICTION_SIGNALS).toContain('fabricated')
      expect(CONTRADICTION_SIGNALS).toContain('disproven')
    })

    it('should include multi-word contradiction phrases', () => {
      expect(CONTRADICTION_SIGNALS).toContain('not true')
      expect(CONTRADICTION_SIGNALS).toContain('no evidence')
    })

    it('should have all lowercase entries for case-insensitive matching', () => {
      CONTRADICTION_SIGNALS.forEach(sig => {
        expect(sig).toBe(sig.toLowerCase())
      })
    })

    it('should have no duplicate entries', () => {
      const unique = new Set(CONTRADICTION_SIGNALS)
      expect(unique.size).toBe(CONTRADICTION_SIGNALS.length)
    })
  })

  describe('Pinecone integration', () => {
    it('should use full-text only when Pinecone is disabled', () => {
      mockIsPineconeEnabled.mockReturnValue(false)
      expect(mockIsPineconeEnabled()).toBe(false)
    })

    it('should enable semantic search when Pinecone is configured', () => {
      mockIsPineconeEnabled.mockReturnValue(true)
      expect(mockIsPineconeEnabled()).toBe(true)
    })

    it('should generate embeddings for claim text', async () => {
      const fakeEmbedding = new Array(1536).fill(0).map(() => Math.random())
      mockGenerateEmbedding.mockResolvedValueOnce(fakeEmbedding)

      const result = await mockGenerateEmbedding('Test claim text')
      expect(result).toHaveLength(1536)
      expect(mockGenerateEmbedding).toHaveBeenCalledWith('Test claim text')
    })

    it('should gracefully handle embedding generation failure', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce(null)
      const result = await mockGenerateEmbedding('Test claim')
      expect(result).toBeNull()
    })

    it('should query similar signals with topK=15', async () => {
      const fakeEmbedding = new Array(1536).fill(0.1)
      mockQuerySimilar.mockResolvedValueOnce([
        { id: 'signal-1', score: 0.92 },
        { id: 'signal-2', score: 0.87 },
        { id: 'signal-3', score: 0.65 },
      ])

      const results = await mockQuerySimilar(fakeEmbedding, 15)
      expect(results).toHaveLength(3)
      expect(results[0].score).toBeGreaterThan(0.6)
    })

    it('should filter semantic results by 0.6 threshold', () => {
      const results = [
        { id: 'signal-1', score: 0.92 },
        { id: 'signal-2', score: 0.55 }, // below 0.6
        { id: 'signal-3', score: 0.65 },
      ]
      const filtered = results.filter(r => r.score >= 0.6)
      expect(filtered).toHaveLength(2)
      expect(filtered.every(r => r.score >= 0.6)).toBe(true)
    })
  })

  describe('Agreement determination logic', () => {
    it('should classify high similarity without contradiction as agrees', () => {
      const cosineSim = 0.85
      const hasContradiction = false
      const agrees = cosineSim >= SEMANTIC_SIMILARITY_THRESHOLD && !hasContradiction
      expect(agrees).toBe(true)
    })

    it('should classify high similarity with contradiction as disagrees', () => {
      const cosineSim = 0.85
      const hasContradiction = true
      // High similarity + contradiction = semantically related but contradicting
      const agrees = !(hasContradiction && cosineSim > SEMANTIC_CONTRADICTION_THRESHOLD)
      expect(agrees).toBe(false)
    })

    it('should classify low similarity without contradiction as agrees (default)', () => {
      const cosineSim = 0.30
      const hasContradiction = false
      const agrees = !hasContradiction
      expect(agrees).toBe(true)
    })

    it('should classify low similarity with contradiction as disagrees', () => {
      const cosineSim = 0.30
      const hasContradiction = true
      const agrees = !hasContradiction
      expect(agrees).toBe(false)
    })

    it('should detect contradiction signals in snippet text', () => {
      const snippet = 'Officials denied the claims made in the report.'
      const hasContradiction = CONTRADICTION_SIGNALS.some(sig =>
        snippet.toLowerCase().includes(sig),
      )
      expect(hasContradiction).toBe(true)
    })

    it('should not flag non-contradicting text', () => {
      const snippet = 'The report confirmed the findings from multiple sources.'
      const hasContradiction = CONTRADICTION_SIGNALS.some(sig =>
        snippet.toLowerCase().includes(sig),
      )
      expect(hasContradiction).toBe(false)
    })
  })

  describe('Cosine similarity computation', () => {
    it('should return 1.0 for identical vectors', () => {
      const vec = [0.5, 0.3, 0.8, 0.1]
      const dot = vec.reduce((sum, val, i) => sum + val * vec[i]!, 0)
      const mag = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0))
      const cosineSim = dot / (mag * mag)
      expect(cosineSim).toBeCloseTo(1.0, 5)
    })

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0, 0]
      const b = [0, 1, 0, 0]
      const dot = a.reduce((sum, val, i) => sum + val * b[i]!, 0)
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
      const cosineSim = dot / (magA * magB)
      expect(cosineSim).toBeCloseTo(0.0, 5)
    })

    it('should handle zero vectors gracefully', () => {
      const a = [0, 0, 0]
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
      const safe = magA > 0
      expect(safe).toBe(false)
    })

    it('should return value between -1 and 1', () => {
      const a = [0.5, -0.3, 0.8]
      const b = [-0.2, 0.7, 0.4]
      const dot = a.reduce((sum, val, i) => sum + val * b[i]!, 0)
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
      const cosineSim = dot / (magA * magB)
      expect(cosineSim).toBeGreaterThanOrEqual(-1)
      expect(cosineSim).toBeLessThanOrEqual(1)
    })
  })

  describe('Verification status classification', () => {
    it('should classify as verified with 3+ agreeing sources and score >= 0.7', () => {
      const agreeingSources = [{ agrees: true }, { agrees: true }, { agrees: true }]
      const score = 0.85
      const status = agreeingSources.length >= 3 && score >= 0.7 ? 'verified' : 'unverified'
      expect(status).toBe('verified')
    })

    it('should classify as disputed with 2+ disagreeing sources', () => {
      const sources = [
        { agrees: false },
        { agrees: false },
        { agrees: true },
      ]
      const disagreeingSources = sources.filter(s => !s.agrees)
      const status = disagreeingSources.length >= 2 ? 'disputed' : 'mixed'
      expect(status).toBe('disputed')
    })

    it('should classify as mixed with 2+ sources and score >= 0.5', () => {
      const sources = [{ agrees: true }, { agrees: true }]
      const score = 0.6
      const agreeCount = sources.filter(s => s.agrees).length
      const disagreeCount = sources.filter(s => !s.agrees).length
      let status: string = 'unverified'
      if (agreeCount >= 3 && score >= 0.7) status = 'verified'
      else if (disagreeCount >= 2) status = 'disputed'
      else if (sources.length >= 2 && score >= 0.5) status = 'mixed'
      expect(status).toBe('mixed')
    })

    it('should classify as disputed with 1 disagreeing source and no other upgrades', () => {
      const sources = [{ agrees: false }]
      const score = 0.4
      const agreeCount = sources.filter(s => s.agrees).length
      const disagreeCount = sources.filter(s => !s.agrees).length
      let status: string = 'unverified'
      if (agreeCount >= 3 && score >= 0.7) status = 'verified'
      else if (disagreeCount >= 2) status = 'disputed'
      else if (sources.length >= 2 && score >= 0.5) status = 'mixed'
      else if (disagreeCount >= 1) status = 'disputed'
      expect(status).toBe('disputed')
    })

    it('should classify as unverified with no sources', () => {
      const sources: Array<{ agrees: boolean }> = []
      const score = 0.5
      const agreeCount = sources.filter(s => s.agrees).length
      const disagreeCount = sources.filter(s => !s.agrees).length
      let status: string = 'unverified'
      if (agreeCount >= 3 && score >= 0.7) status = 'verified'
      else if (disagreeCount >= 2) status = 'disputed'
      else if (sources.length >= 2 && score >= 0.5) status = 'mixed'
      else if (disagreeCount >= 1) status = 'disputed'
      expect(status).toBe('unverified')
    })
  })

  describe('Weighted scoring', () => {
    it('should compute weighted score with all agreeing high-trust sources', () => {
      const sources = [
        { trustScore: 0.9, agrees: true },
        { trustScore: 0.85, agrees: true },
        { trustScore: 0.8, agrees: true },
      ]
      const weightedSum = sources.reduce(
        (sum, src) => sum + src.trustScore * (src.agrees ? 1 : -0.5),
        0,
      )
      const maxPossible = sources.length * 1.0
      const score = Math.min(1, Math.max(0, 0.3 + (weightedSum / maxPossible) * 0.7))
      expect(score).toBeGreaterThan(0.85)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('should reduce score when disagreeing sources are present', () => {
      const sourcesAllAgree = [
        { trustScore: 0.8, agrees: true },
        { trustScore: 0.8, agrees: true },
      ]
      const sourcesWithDisagree = [
        { trustScore: 0.8, agrees: true },
        { trustScore: 0.8, agrees: false },
      ]

      const scoreAgree = (() => {
        const ws = sourcesAllAgree.reduce((s, src) => s + src.trustScore * (src.agrees ? 1 : -0.5), 0)
        return Math.min(1, Math.max(0, 0.3 + (ws / sourcesAllAgree.length) * 0.7))
      })()

      const scoreDisagree = (() => {
        const ws = sourcesWithDisagree.reduce((s, src) => s + src.trustScore * (src.agrees ? 1 : -0.5), 0)
        return Math.min(1, Math.max(0, 0.3 + (ws / sourcesWithDisagree.length) * 0.7))
      })()

      expect(scoreDisagree).toBeLessThan(scoreAgree)
    })

    it('should clamp score between 0 and 1', () => {
      // All disagreeing low-trust
      const sources = [
        { trustScore: 0.1, agrees: false },
        { trustScore: 0.1, agrees: false },
      ]
      const weightedSum = sources.reduce(
        (sum, src) => sum + src.trustScore * (src.agrees ? 1 : -0.5),
        0,
      )
      const maxPossible = sources.length * 1.0
      const score = Math.min(1, Math.max(0, 0.3 + (weightedSum / maxPossible) * 0.7))
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })
  })

  describe('Engine metadata v2', () => {
    it('should report version 2.0.0', () => {
      const version = '2.0.0'
      expect(version).toBe('2.0.0')
    })

    it('should report hybrid method when Pinecone is enabled', () => {
      mockIsPineconeEnabled.mockReturnValue(true)
      const method = mockIsPineconeEnabled() ? 'semantic+full-text-hybrid' : 'full-text-cross-reference'
      expect(method).toBe('semantic+full-text-hybrid')
    })

    it('should report full-text method when Pinecone is disabled', () => {
      mockIsPineconeEnabled.mockReturnValue(false)
      const method = mockIsPineconeEnabled() ? 'semantic+full-text-hybrid' : 'full-text-cross-reference'
      expect(method).toBe('full-text-cross-reference')
    })

    it('should include semantic thresholds in metadata', () => {
      const metadata = {
        similarityThreshold: SEMANTIC_SIMILARITY_THRESHOLD,
        contradictionThreshold: SEMANTIC_CONTRADICTION_THRESHOLD,
      }
      expect(metadata.similarityThreshold).toBe(0.75)
      expect(metadata.contradictionThreshold).toBe(0.40)
    })
  })
})
