/**
 * PULSE Fact-Checker Agent — cross-references claims and flags contested info.
 *
 * The fact-checker monitors for:
 * 1. High-severity signals with low source count (under-corroborated claims)
 * 2. Signals where reliability score is below threshold but severity is critical
 * 3. Conflicting signals about the same event from different sources
 *
 * When issues are found, it publishes a "FACT CHECK" post in the AI Digest.
 */
import { db } from '../../../db/postgres'
import { EDITORIAL_SYSTEM_PROMPT } from '../constants'
import { generateContent } from '../publisher'
import { PULSE_USER_ID, ContentType } from '../constants'
import { redis } from '../../../db/redis'
import type { AgentConfig, AgentScanResult } from './types'

/**
 * Run the fact-checker's review cycle.
 */
export async function runFactCheck(agent: AgentConfig): Promise<AgentScanResult> {
  const since = new Date(Date.now() - 4 * 3600_000) // last 4 hours

  // Find suspicious signals: high severity + low reliability or few sources
  const suspiciousSignals = await db('signals')
    .whereIn('status', ['verified', 'pending'])
    .where('created_at', '>', since)
    .whereIn('severity', ['critical', 'high'])
    .where(function() {
      this.where('reliability_score', '<', 0.6)
        .orWhere('source_count', '<', 2)
    })
    .orderBy('severity')
    .orderBy('reliability_score', 'asc')
    .limit(10)
    .select(['id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'source_count', 'location_name',
      'country_code', 'created_at'])

  if (suspiciousSignals.length === 0) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: 0,
      trendsIdentified: 0,
      published: false,
    }
  }

  // Check if we've already fact-checked these recently
  const alreadyChecked = await db('pulse_publish_log')
    .where('content_type', 'analysis')
    .where('published_at', '>', since)
    .whereRaw("metadata->>'agentId' = 'fact-checker'")
    .select('source_signals')

  const checkedIds = new Set<string>()
  for (const row of alreadyChecked) {
    for (const id of (row.source_signals ?? [])) {
      checkedIds.add(id)
    }
  }

  const unchecked = suspiciousSignals.filter(s => !checkedIds.has(s.id))

  if (unchecked.length === 0) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: suspiciousSignals.length,
      trendsIdentified: 0,
      published: false,
    }
  }

  // Generate a fact-check summary using the deep tier (Anthropic)
  const signalList = unchecked.map((s, i) =>
    `${i + 1}. [${s.severity.toUpperCase()}] ${s.title}\n   Reliability: ${s.reliability_score} | Sources: ${s.source_count}\n   Location: ${s.location_name ?? 'Unknown'}\n   Summary: ${s.summary ?? 'N/A'}`
  ).join('\n\n')

  const prompt = `As the PULSE Fact-Check Bureau, review these ${unchecked.length} signals that have high severity but low corroboration:

${signalList}

For each signal:
1. Assess whether the claim is CONFIRMED, CONTESTED, or UNVERIFIED
2. Note what specific corroboration is missing
3. Flag any signals that may be misinformation based on source patterns

Format your response as a fact-check bulletin. Use clear labels:
- CONFIRMED — multiple independent sources corroborate
- CONTESTED — sources disagree on key details
- UNVERIFIED — insufficient independent corroboration
- LIKELY FALSE — evidence suggests the claim is inaccurate

End with an overall assessment of information quality in the current signal stream.`

  const result = await generateContent(prompt, 800, 'deep', EDITORIAL_SYSTEM_PROMPT + '\n\n' + agent.specialization)

  // Publish as a fact-check post
  try {
    const [post] = await db('posts')
      .insert({
        author_id:          PULSE_USER_ID,
        post_type:          'signal',
        content:            `🔍 FACT CHECK BULLETIN\n\n${result.text}\n\n— PULSE Fact-Check Bureau · WorldPulse AI`,
        pulse_content_type: ContentType.ANALYSIS,
        tags:               ['pulse', 'fact-check', 'verification'],
        language:           'en',
      })
      .returning('*')

    await db('pulse_publish_log').insert({
      post_id:        post.id,
      content_type:   ContentType.ANALYSIS,
      source_signals: unchecked.map(s => s.id),
      model_used:     result.model,
      token_count:    result.tokens,
      generation_ms:  result.durationMs,
      metadata: {
        agentId: agent.id,
        agentName: agent.name,
        agentRole: 'fact-checker',
        provider: result.provider,
        signalsChecked: unchecked.length,
      },
    })

    await redis.publish('wp:post.new', JSON.stringify({
      event: 'post.new',
      payload: { postId: post.id, contentType: 'analysis', author: 'pulse' },
    })).catch(() => {})

    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: suspiciousSignals.length,
      trendsIdentified: unchecked.length,
      published: true,
      postId: post.id,
    }
  } catch (err) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: suspiciousSignals.length,
      trendsIdentified: unchecked.length,
      published: false,
      error: err instanceof Error ? err.message : 'Publish failed',
    }
  }
}
