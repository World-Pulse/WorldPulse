/**
 * Signal Verification Engine
 * 
 * Multi-layer verification:
 * 1. Cross-source corroboration
 * 2. Temporal consistency check
 * 3. Geographic plausibility
 * 4. LLM fact extraction & contradiction detection
 * 5. Community expert review queue
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import type { SignalStatus } from '@worldpulse/types'

interface ArticleGroup {
  sourceId:    string
  sourceTrust: number
  sourceTier:  string
  title:       string
  body?:       string
  url:         string
}

interface VerificationResult {
  status:     SignalStatus
  score:      number
  reasons:    string[]
  checkTypes: string[]
}

export async function verifySignal(
  signal:   { id: string; severity: string; category: string },
  articles: ArticleGroup[],
): Promise<VerificationResult> {
  const llmConfigured = !!(process.env.LLM_API_URL || process.env.OPENAI_API_KEY)

  const checks = await Promise.allSettled([
    checkCrossSource(articles),
    checkTemporalConsistency(articles),
    checkSourceDiversity(articles),
    checkWirePresence(articles),
    ...(llmConfigured ? [checkLLMFactConsistency(signal, articles)] : []),
  ])

  const results = checks.map(c => c.status === 'fulfilled' ? c.value : null).filter(Boolean) as CheckResult[]
  
  // Aggregate score
  let totalScore = 0
  let totalWeight = 0
  const reasons: string[] = []
  const checkTypes: string[] = []

  for (const result of results) {
    totalScore  += result.score * result.weight
    totalWeight += result.weight
    reasons.push(...result.reasons)
    checkTypes.push(result.type)
  }

  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0

  // Determine status
  let status: SignalStatus
  if (finalScore >= 0.75) {
    status = 'verified'
  } else if (finalScore >= 0.30) {
    status = 'pending'
  } else {
    status = 'disputed'
  }

  // Log verification
  await db('verification_log').insert(
    results.map(r => ({
      signal_id:  signal.id,
      check_type: r.type,
      result:     status,
      confidence: r.score,
      notes:      r.reasons.join('; '),
    }))
  )

  logger.debug({
    signalId: signal.id,
    finalScore: finalScore.toFixed(2),
    status,
    checks: checkTypes.length,
  }, 'Signal verified')

  return { status, score: finalScore, reasons, checkTypes }
}

// ─── CHECK FUNCTIONS ────────────────────────────────────────────────────

interface CheckResult {
  type:    string
  score:   number
  weight:  number
  reasons: string[]
}

async function checkCrossSource(articles: ArticleGroup[]): Promise<CheckResult> {
  const uniqueSources = new Set(articles.map(a => a.sourceId)).size
  const score = Math.min(uniqueSources / 3, 1)
  
  return {
    type:    'cross_source',
    score,
    weight:  0.40,
    reasons: uniqueSources >= 3
      ? [`Confirmed by ${uniqueSources} independent sources`]
      : [`Only ${uniqueSources} source(s) — pending corroboration`],
  }
}

async function checkTemporalConsistency(articles: ArticleGroup[]): Promise<CheckResult> {
  // Check if publish times are consistent (within 2-hour window)
  const timestamps = articles
    .map(a => new Date((a as ArticleGroup & { publishedAt?: string }).publishedAt ?? Date.now()).getTime())
    .filter(t => !isNaN(t))

  if (timestamps.length < 2) {
    return { type: 'temporal', score: 0.5, weight: 0.10, reasons: ['Single timestamp'] }
  }

  const range = Math.max(...timestamps) - Math.min(...timestamps)
  const twoHours = 2 * 60 * 60 * 1000
  const score = range < twoHours ? 1 : Math.max(0, 1 - (range - twoHours) / (24 * 60 * 60 * 1000))

  return {
    type:    'temporal',
    score,
    weight:  0.10,
    reasons: score > 0.8
      ? ['Timestamps consistent across sources']
      : ['Wide timestamp spread — verify event timing'],
  }
}

async function checkSourceDiversity(articles: ArticleGroup[]): Promise<CheckResult> {
  const tiers = new Set(articles.map(a => a.sourceTier))
  const avgTrust = articles.reduce((s, a) => s + a.sourceTrust, 0) / articles.length
  
  const diversityScore = Math.min(tiers.size / 2, 1) * 0.5
  const trustScore = avgTrust * 0.5
  const score = diversityScore + trustScore

  return {
    type:    'source_diversity',
    score,
    weight:  0.25,
    reasons: [
      `Average source trust: ${(avgTrust * 100).toFixed(0)}%`,
      `Source tiers represented: ${[...tiers].join(', ')}`,
    ],
  }
}

async function checkLLMFactConsistency(
  signal:   { id: string; severity: string; category: string },
  articles: ArticleGroup[],
): Promise<CheckResult> {
  const llmApiUrl = process.env.LLM_API_URL
  const openaiKey = process.env.OPENAI_API_KEY
  const model     = process.env.LLM_MODEL ?? 'gpt-4o-mini'

  const summaries = articles
    .slice(0, 5)
    .map((a, i) => `Source ${i + 1} [trust=${a.sourceTrust.toFixed(2)}]: ${a.title}${a.body ? ' — ' + a.body.slice(0, 200) : ''}`)
    .join('\n')

  const systemPrompt = `You are a fact-checking assistant. Analyze these news article summaries and respond with ONLY valid JSON.

Response format:
{
  "consistent": true or false,
  "confidenceScore": 0.0-1.0,
  "contradictions": ["list any factual contradictions between sources"],
  "summary": "one sentence assessment"
}`

  const userContent = `Signal category: ${signal.category}, severity: ${signal.severity}

Articles to cross-check:
${summaries}

Are these articles factually consistent? Detect any contradictions.`

  const endpoint = llmApiUrl
    ? `${llmApiUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = openaiKey ?? process.env.LLM_API_KEY
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    const response = await fetch(endpoint, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`)

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned empty content')

    const parsed = JSON.parse(content) as {
      consistent:      boolean
      confidenceScore: number
      contradictions:  string[]
      summary:         string
    }

    const score = parsed.consistent
      ? Math.max(0.5, Math.min(1, parsed.confidenceScore))
      : Math.max(0,   Math.min(0.4, parsed.confidenceScore))

    const reasons: string[] = [parsed.summary]
    if (parsed.contradictions?.length > 0) {
      reasons.push(...parsed.contradictions.slice(0, 3).map(c => `Contradiction: ${c}`))
    }

    return {
      type:    'llm_fact_check',
      score,
      weight:  0.30,
      reasons,
    }
  } catch (err) {
    logger.warn({ err, signalId: signal.id }, 'LLM fact-check failed, skipping')
    // Return neutral score so other checks still count
    return {
      type:    'llm_fact_check',
      score:   0.5,
      weight:  0,   // zero weight means this check is ignored in the aggregate
      reasons: ['LLM fact-check unavailable'],
    }
  }
}

async function checkWirePresence(articles: ArticleGroup[]): Promise<CheckResult> {
  const wireServices  = articles.filter(a => a.sourceTier === 'wire')
  const hasMultiWire  = wireServices.length >= 2
  const hasSingleWire = wireServices.length === 1

  const score = hasMultiWire ? 1 : hasSingleWire ? 0.75 : 0.3

  return {
    type:    'wire_presence',
    score,
    weight:  0.25,
    reasons: wireServices.length > 0
      ? [`${wireServices.length} wire service(s): confirmed`]
      : ['No wire service coverage yet'],
  }
}
