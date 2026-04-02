import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth } from '../middleware/auth'
import { z } from 'zod'
import { sendError } from '../lib/errors'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedClaim {
  id: string
  text: string
  type: 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive'
  confidence: number        // 0-1: how confident we are this IS a checkable claim
  verificationScore: number // 0-1: cross-reference confidence (1 = strongly supported)
  status: 'verified' | 'disputed' | 'unverified' | 'mixed'
  sources: VerificationSource[]
  context: string           // surrounding sentence/paragraph
  entities: string[]        // named entities mentioned
  extractedAt: string
}

interface VerificationSource {
  name: string
  slug: string
  url: string | null
  trustScore: number
  agrees: boolean
  snippet: string | null
}

interface ClaimExtractionResult {
  signalId: string
  signalTitle: string
  totalClaims: number
  verifiedCount: number
  disputedCount: number
  unverifiedCount: number
  mixedCount: number
  overallCredibility: number  // 0-1 weighted score
  claims: ExtractedClaim[]
  extractedAt: string
  cachedUntil: string | null
}

// ─── Claim extraction patterns ───────────────────────────────────────────────

const CLAIM_PATTERNS: Array<{ pattern: RegExp; type: ExtractedClaim['type'] }> = [
  // Statistical claims: numbers, percentages, metrics
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:\d+(?:\.\d+)?%|\d{1,3}(?:,\d{3})+|\d+\s*(?:million|billion|trillion|thousand|hundred))\b[^.!?]*[.!?])/gi, type: 'statistical' },
  // Attribution: "X said/claimed/stated/reported/announced"
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:said|claimed|stated|reported|announced|confirmed|denied|warned|revealed|disclosed|alleged)\b[^.!?]*[.!?])/gi, type: 'attribution' },
  // Causal: "because/caused by/resulted in/led to/due to"
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:because|caused by|resulted? in|led to|due to|attributed to|as a result of|contributed to)\b[^.!?]*[.!?])/gi, type: 'causal' },
  // Predictive: "will/expected to/likely to/forecast/projected"
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:will|expected to|likely to|forecast|projected|predicted|anticipated|estimated to)\b[^.!?]*[.!?])/gi, type: 'predictive' },
  // Factual: definitive assertions with "is/are/was/were" + noun phrases
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:is the (?:first|largest|smallest|most|least|only|highest|lowest)|has been|was found|are considered|officially)\b[^.!?]*[.!?])/gi, type: 'factual' },
]

// Named entity extraction (simplified — production would use NER model)
const ENTITY_PATTERNS = [
  /\b(?:President|Prime Minister|CEO|Minister|Secretary|Director|General|Ambassador)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
  /\b(?:United States|United Kingdom|European Union|United Nations|NATO|WHO|IMF|World Bank)\b/g,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g, // Multi-word proper nouns
]

function extractEntities(text: string): string[] {
  const entities = new Set<string>()
  for (const pattern of ENTITY_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern.source, pattern.flags))
    for (const match of matches) {
      const entity = match[0].trim()
      if (entity.length > 2 && entity.length < 80) {
        entities.add(entity)
      }
    }
  }
  return [...entities].slice(0, 10) // cap at 10 entities per claim
}

function extractClaims(text: string): Array<{ text: string; type: ExtractedClaim['type']; context: string; entities: string[] }> {
  const seen = new Set<string>()
  const claims: Array<{ text: string; type: ExtractedClaim['type']; context: string; entities: string[] }> = []

  for (const { pattern, type } of CLAIM_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const claimText = match[1]?.trim() || match[0].trim()
      // Skip very short or very long "claims"
      if (claimText.length < 20 || claimText.length > 500) continue
      // Dedup by normalised text
      const normalised = claimText.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(normalised)) continue
      seen.add(normalised)

      claims.push({
        text: claimText,
        type,
        context: text.substring(
          Math.max(0, (match.index ?? 0) - 100),
          Math.min(text.length, (match.index ?? 0) + claimText.length + 100),
        ),
        entities: extractEntities(claimText),
      })
    }
  }

  return claims.slice(0, 50) // cap at 50 claims per signal
}

// ─── Cross-reference verification ────────────────────────────────────────────

async function crossReferenceClaim(
  claimText: string,
  signalSourceSlug: string | null,
): Promise<{ score: number; status: ExtractedClaim['status']; sources: VerificationSource[] }> {
  // Find other signals with overlapping content/entities
  const keywords = claimText
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 8)

  if (keywords.length === 0) {
    return { score: 0.5, status: 'unverified', sources: [] }
  }

  const tsQuery = keywords.map(k => `${k}:*`).join(' & ')

  try {
    const corroborating = await db.raw(`
      SELECT DISTINCT
        s.id,
        s.title,
        s.url,
        src.name AS source_name,
        src.slug AS source_slug,
        src.trust_score,
        ts_headline('english', s.content, to_tsquery('english', ?), 'MaxWords=30,MinWords=10') AS snippet
      FROM signals s
      LEFT JOIN sources src ON s.source_id = src.id
      WHERE s.search_vector @@ to_tsquery('english', ?)
        AND (src.slug IS NULL OR src.slug != ?)
      ORDER BY src.trust_score DESC NULLS LAST
      LIMIT 10
    `, [tsQuery, tsQuery, signalSourceSlug ?? ''])

    const sources: VerificationSource[] = (corroborating.rows ?? []).map((row: {
      source_name: string | null
      source_slug: string | null
      url: string | null
      trust_score: number | null
      snippet: string | null
    }) => ({
      name: row.source_name ?? 'Unknown',
      slug: row.source_slug ?? 'unknown',
      url: row.url,
      trustScore: row.trust_score ?? 0.5,
      agrees: true, // simplified — full impl would do semantic similarity
      snippet: row.snippet,
    }))

    // Score based on number and trust of corroborating sources
    const weightedSum = sources.reduce((sum, src) => sum + src.trustScore * (src.agrees ? 1 : -0.5), 0)
    const maxPossible = sources.length * 1.0
    const score = maxPossible > 0
      ? Math.min(1, Math.max(0, 0.3 + (weightedSum / maxPossible) * 0.7))
      : 0.5

    let status: ExtractedClaim['status'] = 'unverified'
    if (sources.length >= 3 && score >= 0.7) status = 'verified'
    else if (sources.length >= 2 && score >= 0.5) status = 'mixed'
    else if (sources.some(s => !s.agrees)) status = 'disputed'

    return { score, status, sources }
  } catch {
    // If full-text search fails (missing column, etc.), return unverified
    return { score: 0.5, status: 'unverified', sources: [] }
  }
}

// ─── Cache helpers ───────────────────────────────────────────────────────────
const CLAIMS_CACHE_TTL = 600 // 10 minutes
const CLAIMS_CACHE_PREFIX = 'claims:v1:'

// ─── Route registration ─────────────────────────────────────────────────────

const ClaimExtractSchema = z.object({
  signalId: z.string().uuid(),
})

const ClaimSearchSchema = z.object({
  q: z.string().min(1).max(500).optional(),
  status: z.enum(['verified', 'disputed', 'unverified', 'mixed']).optional(),
  type: z.enum(['factual', 'statistical', 'attribution', 'causal', 'predictive']).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const registerClaimsRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── GET /api/v1/claims/extract/:signalId ─────────────────────────────────
  // Extract and verify claims from a specific signal
  fastify.get<{
    Params: { signalId: string }
  }>('/extract/:signalId', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {
    const parsed = ClaimExtractSchema.safeParse(request.params)
    if (!parsed.success) {
      return sendError(reply, 400, 'Invalid signal ID', parsed.error.flatten())
    }

    const { signalId } = parsed.data
    const cacheKey = `${CLAIMS_CACHE_PREFIX}${signalId}`

    // Check cache first
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        const result = JSON.parse(cached) as ClaimExtractionResult
        result.cachedUntil = new Date(Date.now() + CLAIMS_CACHE_TTL * 1000).toISOString()
        return reply.send(result)
      }
    } catch { /* cache miss, proceed */ }

    // Fetch signal content
    const signal = await db('signals')
      .select('id', 'title', 'content', 'summary', 'source_id')
      .where('id', signalId)
      .first()

    if (!signal) {
      return sendError(reply, 404, 'Signal not found')
    }

    // Get source info for cross-ref exclusion
    let sourceSlug: string | null = null
    if (signal.source_id) {
      const source = await db('sources').select('slug').where('id', signal.source_id).first()
      sourceSlug = source?.slug ?? null
    }

    const fullText = [signal.title, signal.content, signal.summary].filter(Boolean).join('. ')
    const rawClaims = extractClaims(fullText)

    // Cross-reference each claim
    const claims: ExtractedClaim[] = await Promise.all(
      rawClaims.map(async (raw, idx) => {
        const { score, status, sources } = await crossReferenceClaim(raw.text, sourceSlug)
        return {
          id: `${signalId}-claim-${idx}`,
          text: raw.text,
          type: raw.type,
          confidence: Math.min(1, 0.5 + raw.entities.length * 0.05 + (raw.text.length > 50 ? 0.1 : 0)),
          verificationScore: score,
          status,
          sources,
          context: raw.context,
          entities: raw.entities,
          extractedAt: new Date().toISOString(),
        }
      }),
    )

    // Compute overall credibility
    const totalWeight = claims.reduce((sum, c) => sum + c.confidence, 0)
    const overallCredibility = totalWeight > 0
      ? claims.reduce((sum, c) => sum + c.verificationScore * c.confidence, 0) / totalWeight
      : 0.5

    const result: ClaimExtractionResult = {
      signalId,
      signalTitle: signal.title,
      totalClaims: claims.length,
      verifiedCount: claims.filter(c => c.status === 'verified').length,
      disputedCount: claims.filter(c => c.status === 'disputed').length,
      unverifiedCount: claims.filter(c => c.status === 'unverified').length,
      mixedCount: claims.filter(c => c.status === 'mixed').length,
      overallCredibility,
      claims,
      extractedAt: new Date().toISOString(),
      cachedUntil: new Date(Date.now() + CLAIMS_CACHE_TTL * 1000).toISOString(),
    }

    // Cache the result
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', CLAIMS_CACHE_TTL)
    } catch { /* non-fatal */ }

    return reply.send(result)
  })

  // ─── GET /api/v1/claims/recent ────────────────────────────────────────────
  // Get recently extracted claims across all signals (for the claims dashboard)
  fastify.get<{
    Querystring: z.infer<typeof ClaimSearchSchema>
  }>('/recent', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {
    const parsed = ClaimSearchSchema.safeParse(request.query)
    if (!parsed.success) {
      return sendError(reply, 400, 'Invalid query parameters', parsed.error.flatten())
    }

    const { status, type, limit, offset } = parsed.data
    const cacheKey = `${CLAIMS_CACHE_PREFIX}recent:${status ?? 'all'}:${type ?? 'all'}:${limit}:${offset}`

    // Check cache
    try {
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))
    } catch { /* miss */ }

    // Fetch recent signals with content
    let query = db('signals')
      .select('id', 'title', 'content', 'summary', 'source_id', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(50) // process last 50 signals

    const signals = await query

    const allClaims: Array<ExtractedClaim & { signalId: string; signalTitle: string }> = []

    for (const signal of signals) {
      const fullText = [signal.title, signal.content, signal.summary].filter(Boolean).join('. ')
      const rawClaims = extractClaims(fullText)

      let sourceSlug: string | null = null
      if (signal.source_id) {
        const source = await db('sources').select('slug').where('id', signal.source_id).first()
        sourceSlug = source?.slug ?? null
      }

      for (let idx = 0; idx < Math.min(rawClaims.length, 5); idx++) {
        const raw = rawClaims[idx]!
        const { score, status: claimStatus, sources } = await crossReferenceClaim(raw.text, sourceSlug)
        const claim: ExtractedClaim & { signalId: string; signalTitle: string } = {
          id: `${signal.id}-claim-${idx}`,
          signalId: signal.id,
          signalTitle: signal.title,
          text: raw.text,
          type: raw.type,
          confidence: Math.min(1, 0.5 + raw.entities.length * 0.05 + (raw.text.length > 50 ? 0.1 : 0)),
          verificationScore: score,
          status: claimStatus,
          sources,
          context: raw.context,
          entities: raw.entities,
          extractedAt: signal.created_at,
        }
        allClaims.push(claim)
      }
    }

    // Filter
    let filtered = allClaims
    if (status) filtered = filtered.filter(c => c.status === status)
    if (type) filtered = filtered.filter(c => c.type === type)

    // Sort by confidence desc, then verification score
    filtered.sort((a, b) => b.confidence - a.confidence || b.verificationScore - a.verificationScore)

    const result = {
      total: filtered.length,
      offset,
      limit,
      claims: filtered.slice(offset, offset + limit),
      summary: {
        verified: allClaims.filter(c => c.status === 'verified').length,
        disputed: allClaims.filter(c => c.status === 'disputed').length,
        unverified: allClaims.filter(c => c.status === 'unverified').length,
        mixed: allClaims.filter(c => c.status === 'mixed').length,
        total: allClaims.length,
      },
    }

    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 120) // 2 min cache for recent
    } catch { /* non-fatal */ }

    return reply.send(result)
  })

  // ─── GET /api/v1/claims/stats ─────────────────────────────────────────────
  // Aggregate claim verification statistics
  fastify.get('/stats', {
    preHandler: [optionalAuth],
  }, async (_request, reply) => {
    const cacheKey = `${CLAIMS_CACHE_PREFIX}stats`

    try {
      const cached = await redis.get(cacheKey)
      if (cached) return reply.send(JSON.parse(cached))
    } catch { /* miss */ }

    // Count signals processed in last 24h
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()

    const [signalCount] = await db('signals')
      .where('created_at', '>=', dayAgo)
      .count('* as count')

    const [totalSignals] = await db('signals').count('* as count')

    // Count sources by trust tier
    const sourceTiers = await db('sources')
      .select(db.raw(`
        CASE
          WHEN trust_score >= 0.8 THEN 'high_trust'
          WHEN trust_score >= 0.5 THEN 'medium_trust'
          ELSE 'low_trust'
        END AS tier
      `))
      .count('* as count')
      .groupBy('tier')

    const tierMap: Record<string, number> = {}
    for (const row of sourceTiers) {
      tierMap[row.tier as string] = Number(row.count)
    }

    const stats = {
      signalsLast24h: Number((signalCount as { count: string | number }).count),
      totalSignals: Number((totalSignals as { count: string | number }).count),
      sourceTrustDistribution: {
        highTrust: tierMap['high_trust'] ?? 0,
        mediumTrust: tierMap['medium_trust'] ?? 0,
        lowTrust: tierMap['low_trust'] ?? 0,
      },
      claimTypesSupported: ['factual', 'statistical', 'attribution', 'causal', 'predictive'],
      verificationEngine: {
        version: '1.0.0',
        method: 'multi-source-cross-reference',
        patternsCount: CLAIM_PATTERNS.length,
        maxClaimsPerSignal: 50,
        cacheTtlSeconds: CLAIMS_CACHE_TTL,
      },
      updatedAt: new Date().toISOString(),
    }

    try {
      await redis.set(cacheKey, JSON.stringify(stats), 'EX', 300)
    } catch { /* non-fatal */ }

    return reply.send(stats)
  })
}
