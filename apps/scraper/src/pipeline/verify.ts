/**
 * Signal Verification Engine
 *
 * Multi-layer verification:
 * 1. Cross-source corroboration
 * 2. Temporal consistency check
 * 3. Geographic plausibility
 * 4. LLM fact extraction & contradiction detection
 * 5. Multi-model AI consensus (Claude secondary pass for uncertain signals)
 * 6. Community expert review queue
 *
 * Oct 11, 2026 (in-house plan): with a Claude key the AI fact-check runs on
 * Claude, within the spending cap (lib/claude.ts), and only for stories that
 * matter: two or more reports to cross-check, or a high or critical one. The
 * OpenAI check and the Claude second opinion stay for setups with both keys.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { askClaude, claudeConfigured as claudeKeySet, whyNoAnswer } from '../lib/claude'
import { LLM_MODEL } from '../lib/llm-models'
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
  status:             SignalStatus
  score:              number
  reasons:            string[]
  checkTypes:         string[]
  /** True when both primary LLM and Claude consensus checks agree on the signal's validity */
  consensus_verified: boolean
}

export async function verifySignal(
  signal:   { id: string; severity: string; category: string },
  articles: ArticleGroup[],
): Promise<VerificationResult> {
  // With a Claude key the fact-check is Claude's (in-house); OpenAI only without one
  const claudeFirst        = claudeKeySet()
  const llmConfigured      = !claudeFirst && !!(process.env.LLM_API_URL || process.env.OPENAI_API_KEY)
  const claudeConfigured   = !!process.env.ANTHROPIC_API_KEY

  const checks = await Promise.allSettled([
    checkCrossSource(articles),
    checkTemporalConsistency(articles),
    checkSourceDiversity(articles),
    checkWirePresence(articles),
    ...(llmConfigured ? [checkLLMFactConsistency(signal, articles)] : []),
    ...(claudeFirst && worthAFactCheck(signal, articles) ? [checkClaudeFactConsistency(signal, articles)] : []),
  ])

  const results = checks.map(c => c.status === 'fulfilled' ? c.value : null).filter(Boolean) as CheckResult[]

  // Aggregate base score
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

  let baseScore = totalWeight > 0 ? totalScore / totalWeight : 0

  // ── Multi-model consensus pass ─────────────────────────────────────────────
  // Only run Claude consensus for signals in the uncertain zone (0.3–0.7)
  // where single-model verification is most likely to be wrong.
  let consensus_verified = false
  let primaryLLMScore: number | null = null
  let claudeResult: CheckResult | null = null

  const primaryLLMCheck = results.find(r => r.type === 'llm_fact_check')
  if (primaryLLMCheck && primaryLLMCheck.weight > 0) {
    primaryLLMScore = primaryLLMCheck.score
  }

  // A second opinion only when another model gave the first (Claude-only setups ask Claude once)
  if (llmConfigured && claudeConfigured && baseScore >= 0.30 && baseScore <= 0.70) {
    try {
      claudeResult = await checkClaudeConsensus(signal, articles)

      // Blend consensus into the final score (50/50 with base)
      const consensusScore = (baseScore + claudeResult.score) / 2
      baseScore = Math.max(0, Math.min(1, consensusScore))

      reasons.push(...claudeResult.reasons)
      checkTypes.push(claudeResult.type)

      // Determine agreement: both LLMs must agree on pass/fail threshold (>= 0.5)
      if (primaryLLMScore !== null) {
        const primaryPass = primaryLLMScore >= 0.5
        const claudePass  = claudeResult.score >= 0.5
        consensus_verified = primaryPass === claudePass
      }
    } catch (err) {
      logger.warn({ err, signalId: signal.id }, 'Claude consensus check failed, skipping')
    }
  }

  const finalScore = baseScore

  // Severity-aware verification thresholds.
  // Critical/high severity signals require stronger evidence to pass as verified,
  // but get a lower dispute threshold — we surface them faster for human review
  // rather than silently discarding them.
  let verifyThreshold: number
  let disputeThreshold: number
  switch (signal.severity) {
    case 'critical':
      verifyThreshold  = 0.80 // critical claims need strong multi-source backing
      disputeThreshold = 0.20 // but surface borderline critical signals as pending, not disputed
      break
    case 'high':
      verifyThreshold  = 0.75
      disputeThreshold = 0.25
      break
    default:
      verifyThreshold  = 0.70 // slightly relaxed for medium/low — less damage from false positive
      disputeThreshold = 0.30
  }

  let status: SignalStatus
  if (finalScore >= verifyThreshold) {
    status = 'verified'
  } else if (finalScore >= disputeThreshold) {
    status = 'pending'
  } else {
    status = 'disputed'
  }

  // Log all verification results (including consensus if it ran)
  const allResults = claudeResult ? [...results, claudeResult] : results
  const logTotalWeight = allResults.reduce((s, r) => s + r.weight, 0)

  const VERIFIER_TYPE_MAP: Record<string, string> = {
    cross_source:    'cross_reference',
    temporal:        'temporal',
    source_diversity:'source_check',
    wire_presence:   'source_check',
    llm_fact_check:  'ai_analysis',
    claude_consensus:'ai_analysis',
  }

  function toVerdict(score: number): string {
    if (score >= 0.7) return 'confirmed'
    if (score >= 0.3) return 'unverified'
    return 'refuted'
  }

  db('verification_log').insert(
    allResults.map(r => ({
      signal_id:     signal.id,
      check_type:    r.type,
      verifier_type: VERIFIER_TYPE_MAP[r.type] ?? 'source_check',
      result:        status,
      verdict:       toVerdict(r.score),
      confidence:    r.score,
      score_delta:   logTotalWeight > 0 ? (r.score * r.weight) / logTotalWeight : 0,
      notes:         r.reasons.join('; '),
    }))
  ).catch(err => {
    logger.warn({ err, signalId: signal.id }, 'verification_log insert failed (non-blocking)')
  })

  logger.debug({
    signalId:           signal.id,
    finalScore:         finalScore.toFixed(2),
    status,
    checks:             checkTypes.length,
    consensus_verified,
  }, 'Signal verified')

  return { status, score: finalScore, reasons, checkTypes, consensus_verified }
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
  const uniqueTiers   = new Set(articles.map(a => a.sourceTier)).size

  // Scoring: 1 source = 0.33, 2 sources = 0.67, 3+ = 1.0
  let score = Math.min(uniqueSources / 3, 1)

  // Tier diversity bonus: sources from different tiers (wire + regional + community)
  // are far stronger evidence than multiple articles from the same tier
  if (uniqueTiers >= 3) score = Math.min(score + 0.15, 1.0)
  else if (uniqueTiers >= 2) score = Math.min(score + 0.08, 1.0)

  // High-trust source bonus: if average trust >= 0.8, bump score
  const avgTrust = articles.reduce((s, a) => s + a.sourceTrust, 0) / articles.length
  if (avgTrust >= 0.8 && uniqueSources >= 2) score = Math.min(score + 0.10, 1.0)

  return {
    type:    'cross_source',
    score,
    weight:  0.40,
    reasons: uniqueSources >= 3
      ? [`Confirmed by ${uniqueSources} independent sources across ${uniqueTiers} tier(s)`]
      : uniqueSources === 2
        ? [`Corroborated by 2 sources — moderate confidence`]
        : [`Only 1 source — pending corroboration`],
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
  const model     = LLM_MODEL

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

/**
 * Secondary verification pass using Anthropic Claude.
 * Called only when the primary verification score is in the uncertain zone (0.3–0.7).
 * Provides an independent model perspective to improve consensus accuracy.
 */
async function checkClaudeConsensus(
  signal:   { id: string; severity: string; category: string },
  articles: ArticleGroup[],
): Promise<CheckResult> {
  const summaries = articles
    .slice(0, 5)
    .map((a, i) => `Source ${i + 1} [trust=${a.sourceTrust.toFixed(2)}]: ${a.title}${a.body ? ' — ' + a.body.slice(0, 200) : ''}`)
    .join('\n')

  const systemPrompt = `You are a fact-checking assistant for a real-time global intelligence platform. Analyze the provided news article summaries and respond with ONLY valid JSON.

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

Are these articles factually consistent? Identify any contradictions or reliability concerns.`

  // Within the spending cap, on Claude's small model (lib/claude.ts)
  const reply = await askClaude({ purpose: 'factcheck', system: systemPrompt, prompt: userContent, maxTokens: 256, timeoutMs: 15_000 })
  const text = reply?.text ? jsonIn(reply.text) : null
  if (!text) throw new Error(reply ? 'Claude gave nothing readable' : `Claude gave no answer (${whyNoAnswer() ?? 'no key, the cap, or an error'})`)

  const parsed = JSON.parse(text) as {
    consistent:      boolean
    confidenceScore: number
    contradictions:  string[]
    summary:         string
  }

  const score = parsed.consistent
    ? Math.max(0.5, Math.min(1, parsed.confidenceScore))
    : Math.max(0,   Math.min(0.4, parsed.confidenceScore))

  const reasons: string[] = [`[Claude] ${parsed.summary}`]
  if (parsed.contradictions?.length > 0) {
    reasons.push(...parsed.contradictions.slice(0, 2).map(c => `[Claude] Contradiction: ${c}`))
  }

  return {
    type:    'claude_consensus',
    score,
    weight:  0,   // weight handled by the consensus blending in verifySignal
    reasons,
  }
}

/** Stories worth an AI fact-check: two or more reports to cross-check, or a high or critical one */
export function worthAFactCheck(signal: { severity: string }, articles: ArticleGroup[]): boolean {
  return articles.length >= 2 || signal.severity === 'high' || signal.severity === 'critical'
}

/** The first JSON object in a reply (Claude may wrap it in a code fence) */
export function jsonIn(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : null
}

export const FACT_CHECK_SYSTEM = `You are the fact-checker of WorldPulse, a global news service. You get one or more reports of the same story.
With several reports, check whether they agree on the facts: what happened, where, when, who, and how many.
With one report, check whether its claims are stated as confirmed facts or are unverified: claims by one side, rumours, an unnamed source.
Answer with only this JSON:
{"consistent": true or false, "confidence": how sure you are of that verdict, 0.0 to 1.0, "problems": ["each contradiction or unverified claim, briefly"], "summary": "one sentence"}`

/**
 * The fact-check on Claude (in-house plan, Oct 11, 2026): Claude's small
 * model cross-checks the reports (or judges a single report's claims) within
 * the spending cap. Weighted like the old OpenAI check; without an answer it
 * counts for nothing and the other checks decide.
 */
async function checkClaudeFactConsistency(
  signal:   { id: string; severity: string; category: string },
  articles: ArticleGroup[],
): Promise<CheckResult> {
  const reports = articles
    .slice(0, 5)
    .map((a, i) => `Report ${i + 1} [source trust ${a.sourceTrust.toFixed(2)}]: ${a.title}${a.body ? ' — ' + a.body.replace(/\s+/g, ' ').slice(0, 300) : ''}`)
    .join('\n')
  const reply = await askClaude({
    purpose:   'factcheck',
    system:    FACT_CHECK_SYSTEM,
    prompt:    `Category: ${signal.category}, severity: ${signal.severity}\n\n${reports}`,
    maxTokens: 300,
    timeoutMs: 20_000,
  })
  try {
    const text = reply?.text ? jsonIn(reply.text) : null
    if (!text) throw new Error('no answer')
    const parsed = JSON.parse(text) as { consistent?: boolean; confidence?: number; problems?: string[]; summary?: string }
    const confidence = Number(parsed.confidence)
    const sure = Number.isFinite(confidence) ? confidence : 0.5
    const score = parsed.consistent === true ? Math.max(0.5, Math.min(1, sure)) : Math.max(0, Math.min(0.4, 1 - sure))
    const reasons = [`[Claude] ${String(parsed.summary ?? '').slice(0, 300)}`]
    for (const problem of (parsed.problems ?? []).slice(0, 3)) reasons.push(`[Claude] ${String(problem).slice(0, 200)}`)
    return { type: 'llm_fact_check', score, weight: 0.30, reasons }
  } catch {
    if (reply) logger.warn({ signalId: signal.id }, 'Claude fact-check answer unreadable, skipping')
    return { type: 'llm_fact_check', score: 0.5, weight: 0, reasons: ['AI fact-check unavailable'] }
  }
}

async function checkWirePresence(articles: ArticleGroup[]): Promise<CheckResult> {
  const wireServices        = articles.filter(a => a.sourceTier === 'wire')
  const institutionalSources = articles.filter(a => a.sourceTier === 'institutional')
  // OSINT institutional feeds (USGS, WHO, IAEA, CISA, etc.) are as authoritative
  // as wire services for their specific domains — treat them equivalently
  const authoritativeCount  = wireServices.length + institutionalSources.length

  let score: number
  let reasons: string[]

  if (authoritativeCount >= 3) {
    score = 1.0
    reasons = [`${authoritativeCount} authoritative sources (${wireServices.length} wire + ${institutionalSources.length} institutional)`]
  } else if (authoritativeCount >= 2) {
    score = 0.85
    reasons = [`${authoritativeCount} authoritative sources — high confidence`]
  } else if (authoritativeCount === 1) {
    score = 0.70
    reasons = [wireServices.length > 0 ? '1 wire service confirmed' : '1 institutional source confirmed']
  } else {
    // No wire or institutional — check if there are high-trust regional sources
    const highTrustCount = articles.filter(a => a.sourceTrust >= 0.7).length
    score = highTrustCount >= 2 ? 0.45 : 0.25
    reasons = highTrustCount >= 2
      ? [`No wire/institutional sources, but ${highTrustCount} high-trust sources`]
      : ['No authoritative sources yet — awaiting wire/institutional coverage']
  }

  return {
    type:    'wire_presence',
    score,
    weight:  0.25,
    reasons,
  }
}
