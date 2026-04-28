/**
 * PULSE Publisher — core content creation and publishing engine.
 *
 * This is the heart of the PULSE system. It:
 * 1. Queries top signals from the database
 * 2. Generates editorial content via LLM
 * 3. Publishes as posts authored by @pulse
 * 4. Logs everything to pulse_publish_log
 */
import { db } from '../../db/postgres'
import { redis } from '../../db/redis'
import { PULSE_USER_ID, ContentType, RATE_LIMITS, EDITORIAL_SYSTEM_PROMPT } from './constants'
import { broadcast } from '../../ws/handler'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SignalSummary {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliability_score: number
  source_count: number
  location_name: string | null
  country_code: string | null
  created_at: Date
}

interface PublishResult {
  success: boolean
  postId?: string
  error?: string
}

interface BriefingSection {
  title: string
  content: string
}

// ─── Rate limit check ───────────────────────────────────────────────────────

async function checkRateLimit(contentType: string): Promise<boolean> {
  const limit = RATE_LIMITS[contentType]
  if (!limit) return true

  const since = new Date(Date.now() - limit.windowHours * 3600_000)
  const [row] = await db('pulse_publish_log')
    .where('content_type', contentType)
    .where('published_at', '>', since)
    .count('id as count')

  return Number(row?.count ?? 0) < limit.max
}

// ─── Signal fetchers ────────────────────────────────────────────────────────

/** Get top signals from last N hours, ranked by severity + reliability */
export async function getTopSignals(hours: number, limit = 20): Promise<SignalSummary[]> {
  const since = new Date(Date.now() - hours * 3600_000)

  return db('signals')
    .whereIn('status', ['verified', 'pending'])
    .where('created_at', '>', since)
    .orderByRaw(`
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      reliability_score DESC,
      source_count DESC
    `)
    .limit(limit)
    .select([
      'id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'source_count', 'location_name',
      'country_code', 'created_at',
    ])
}

/** Get critical signals from last N minutes (for flash briefs) */
export async function getCriticalSignals(minutes: number): Promise<SignalSummary[]> {
  const since = new Date(Date.now() - minutes * 60_000)

  return db('signals')
    .whereIn('status', ['verified', 'pending'])
    .whereIn('severity', ['critical', 'high'])
    .where('created_at', '>', since)
    .where('reliability_score', '>=', 0.7)
    .orderBy('created_at', 'desc')
    .limit(5)
    .select([
      'id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'source_count', 'location_name',
      'country_code', 'created_at',
    ])
}

// ─── Dual-LLM Content Generation ──────────────────────────────────────────
//
// Strategy: split workload across OpenAI and Anthropic to balance token usage.
//
//   OpenAI (gpt-4o-mini)  → fast, cheap tasks: flash briefs, syndication summaries,
//                           fact-check requests, social thread drafts
//   Anthropic (Claude)    → deep, nuanced tasks: daily briefings, analysis posts,
//                           editorial reviews, weekly reports
//
// If only one key is configured, all tasks go to that provider.
// If neither key exists, falls back to template-based generation.

type LLMTier = 'fast' | 'deep'

interface GenerationResult {
  text: string
  model: string
  tokens: number
  durationMs: number
  provider: 'openai' | 'anthropic' | 'template'
}

/** Call OpenAI chat completions */
async function callOpenAI(
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  model: string,
  temperature: number,
): Promise<GenerationResult> {
  const t0 = Date.now()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  const data = await res.json() as {
    choices?: Array<{ message: { content: string } }>
    usage?: { total_tokens: number }
    model?: string
    error?: { message: string; type: string }
  }

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? `HTTP ${res.status}`
    console.error(`[PULSE] OpenAI API error: ${errMsg} (model: ${model})`)
    return { text: '', model, tokens: 0, durationMs: Date.now() - t0, provider: 'openai' }
  }

  return {
    text: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? model,
    tokens: data.usage?.total_tokens ?? 0,
    durationMs: Date.now() - t0,
    provider: 'openai',
  }
}

/** Call Anthropic Messages API */
async function callAnthropic(
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  model: string,
  temperature: number,
): Promise<GenerationResult> {
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  const data = await res.json() as {
    content?: Array<{ text: string }>
    usage?: { input_tokens: number; output_tokens: number }
    model?: string
    error?: { type: string; message: string }
    type?: string
  }

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? `HTTP ${res.status}`
    console.error(`[PULSE] Anthropic API error: ${errMsg} (model: ${model})`)
    // Fall through to OpenAI if available
    if (process.env.OPENAI_API_KEY) {
      console.log('[PULSE] Falling back to OpenAI after Anthropic failure')
      const fallbackModel = process.env.PULSE_OPENAI_MODEL ?? 'gpt-4o-mini'
      return callOpenAI(prompt, systemPrompt, maxTokens, fallbackModel, temperature)
    }
    return { text: '', model, tokens: 0, durationMs: Date.now() - t0, provider: 'anthropic' }
  }

  return {
    text: data.content?.[0]?.text ?? '',
    model: data.model ?? model,
    tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    durationMs: Date.now() - t0,
    provider: 'anthropic',
  }
}

/**
 * Generate content using the dual-LLM strategy.
 *
 * @param tier - 'fast' routes to OpenAI (cheap, quick), 'deep' routes to Anthropic (nuanced)
 * @param prompt - The user prompt
 * @param systemPrompt - Override system prompt (defaults to EDITORIAL_SYSTEM_PROMPT)
 * @param maxTokens - Max generation tokens
 */
export async function generateContent(
  prompt: string,
  maxTokens = 1000,
  tier: LLMTier = 'fast',
  systemPrompt: string = EDITORIAL_SYSTEM_PROMPT,
): Promise<GenerationResult> {
  const hasOpenAI    = !!process.env.OPENAI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY

  // No keys at all — return empty so callers' quality gates reject it
  if (!hasOpenAI && !hasAnthropic) {
    console.warn('[PULSE] No LLM API keys configured — cannot generate content')
    return { text: '', model: 'template', tokens: 0, durationMs: 0, provider: 'template' }
  }

  // Temperature: lower for factual briefs, slightly higher for analysis
  const temperature = tier === 'fast' ? 0.2 : 0.35

  // Both keys available — route by tier
  if (hasOpenAI && hasAnthropic) {
    if (tier === 'fast') {
      const model = process.env.PULSE_OPENAI_MODEL ?? 'gpt-4o-mini'
      return callOpenAI(prompt, systemPrompt, maxTokens, model, temperature)
    } else {
      const model = process.env.PULSE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
      return callAnthropic(prompt, systemPrompt, maxTokens, model, temperature)
    }
  }

  // Only one key — use whichever is available
  if (hasOpenAI) {
    const model = process.env.PULSE_OPENAI_MODEL ?? 'gpt-4o-mini'
    return callOpenAI(prompt, systemPrompt, maxTokens, model, temperature)
  }

  const model = process.env.PULSE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
  return callAnthropic(prompt, systemPrompt, maxTokens, model, temperature)
}

// ─── Publishing ─────────────────────────────────────────────────────────────

/** Create a post as PULSE and log it */
async function publishPost(
  content: string,
  contentType: ContentType,
  signalIds: string[],
  metadata: Record<string, unknown> = {},
  modelInfo?: { model: string; tokens: number; durationMs: number },
): Promise<PublishResult> {
  try {
    // Rate limit check
    if (!(await checkRateLimit(contentType))) {
      return { success: false, error: `Rate limit exceeded for ${contentType}` }
    }

    // Create the post
    const [post] = await db('posts')
      .insert({
        author_id:          PULSE_USER_ID,
        post_type:          'signal',
        content,
        pulse_content_type: contentType,
        signal_id:          signalIds[0] ?? null, // Primary signal reference
        tags:               ['pulse', contentType.replace('_', '-')],
        language:           'en',
      })
      .returning('*')

    // Log publication
    await db('pulse_publish_log').insert({
      post_id:        post.id,
      content_type:   contentType,
      source_signals: signalIds,
      model_used:     modelInfo?.model ?? 'template',
      token_count:    modelInfo?.tokens ?? 0,
      generation_ms:  modelInfo?.durationMs ?? 0,
      metadata,
    })

    // Broadcast via WebSocket
    await redis.publish('wp:post.new', JSON.stringify({
      event:   'post.new',
      payload: { postId: post.id, contentType, author: 'pulse' },
      filter:  { category: 'pulse' },
    })).catch(() => {})

    return { success: true, postId: post.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Generate and publish a flash brief for a critical signal */
export async function publishFlashBrief(signal: SignalSummary): Promise<PublishResult> {
  // ── Quality gate: severity ──────────────────────────────────────────────
  // Only publish flash briefs for critical/high severity signals
  const allowedSeverities = ['critical', 'high']
  if (!allowedSeverities.includes(signal.severity)) {
    return { success: false, error: `Severity ${signal.severity} below flash brief threshold` }
  }

  // ── Quality gate: source count ──────────────────────────────────────────
  // Single-source signals are too unreliable for flash briefs
  if ((signal.source_count ?? 0) < 2) {
    return { success: false, error: `Only ${signal.source_count} source(s) — need 2+ for flash brief` }
  }

  const prompt = `Write a 2-3 sentence intelligence flash brief about this signal. DO NOT repeat the headline — add context, sourcing, and impact that the headline alone doesn't convey.

Signal: ${signal.title}
${signal.summary && signal.summary !== 'N/A' ? `Detail: ${signal.summary}` : ''}
Category: ${signal.category} | Severity: ${signal.severity} | Location: ${signal.location_name ?? 'Unknown'}
Sources: ${signal.source_count} verified | Reliability: ${signal.reliability_score}

Rules:
- Start with the key development, NOT by restating the headline verbatim
- Include "according to X sources" or name the source type (wire, institutional, OSINT)
- End with why this matters or what to watch next
- If reliability is below 0.7, note it is unconfirmed
- Keep it under 280 characters if possible (tweet-sized)
- Your output must be DIFFERENT from the signal title — add value or don't publish`

  // Flash briefs → OpenAI (fast tier): quick, cheap, high-volume
  const result = await generateContent(prompt, 200, 'fast')

  // ── Quality gate: LLM output ────────────────────────────────────────────
  // Reject empty output or output that's just the headline echoed back
  const outputText = result.text.trim()
  if (!outputText || outputText.length < 30) {
    console.warn(`[PULSE] Flash brief rejected: LLM returned empty/short output for "${signal.title}"`)
    return { success: false, error: 'LLM output too short — skipping flash brief' }
  }

  // Check if the output is just the headline repeated
  const titleNorm = signal.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const outputNorm = outputText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  if (outputNorm === titleNorm || outputNorm.startsWith(titleNorm) || titleNorm.startsWith(outputNorm)) {
    console.warn(`[PULSE] Flash brief rejected: output echoes headline for "${signal.title}"`)
    return { success: false, error: 'LLM echoed headline — no editorial value added' }
  }

  // Check word overlap — if >80% of output words are in the title, it's too similar
  const titleWords = new Set(titleNorm.split(/\s+/).filter(w => w.length > 3))
  const outputWords = outputNorm.split(/\s+/).filter(w => w.length > 3)
  if (titleWords.size > 0 && outputWords.length > 0) {
    const overlap = outputWords.filter(w => titleWords.has(w)).length
    if (overlap / outputWords.length > 0.8) {
      console.warn(`[PULSE] Flash brief rejected: >80% word overlap with headline for "${signal.title}"`)
      return { success: false, error: 'Output too similar to headline' }
    }
  }

  return publishPost(
    `[FLASH BRIEF]\n\n${result.text}\n\n— PULSE · WorldPulse AI Bureau`,
    ContentType.FLASH_BRIEF,
    [signal.id],
    { severity: signal.severity, category: signal.category, provider: result.provider },
    result,
  )
}

/** Generate and publish an analysis post connecting multiple signals */
export async function publishAnalysis(signals: SignalSummary[], topic: string): Promise<PublishResult> {
  const signalSummaries = signals.map((s, i) =>
    `${i + 1}. [${s.severity.toUpperCase()}] ${s.title} (${s.location_name ?? 'Global'}, reliability: ${s.reliability_score}, sources: ${s.source_count})`
  ).join('\n')

  const prompt = `Write an intelligence analysis post (200-400 words) connecting these related signals:

Topic: ${topic}
Signals:
${signalSummaries}

Structure: Context → Development → Impact → Assessment → What to Watch.
Include source counts and reliability scores in your analysis.`

  // Analysis → Anthropic (deep tier): nuanced, pattern-connecting, editorial
  const result = await generateContent(prompt, 600, 'deep')

  // ── Quality gate: analysis output ───────────────────────────────────────
  const analysisText = result.text.trim()
  if (!analysisText || analysisText.length < 100) {
    console.warn(`[PULSE] Analysis rejected: LLM returned empty/short output for "${topic}"`)
    return { success: false, error: 'LLM output too short for analysis — skipping' }
  }

  // Reject if the output is just signal titles echoed back
  const titleWords = signals.flatMap(s => s.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3))
  const titleWordSet = new Set(titleWords)
  const outputWords = analysisText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  if (titleWordSet.size > 0 && outputWords.length > 0) {
    const overlap = outputWords.filter(w => titleWordSet.has(w)).length
    if (overlap / outputWords.length > 0.7) {
      console.warn(`[PULSE] Analysis rejected: >70% word overlap with signal titles for "${topic}"`)
      return { success: false, error: 'Analysis too similar to signal headlines — no editorial value' }
    }
  }

  return publishPost(
    `[ANALYSIS] ${topic}\n\n${result.text}\n\n— PULSE · WorldPulse AI Bureau`,
    ContentType.ANALYSIS,
    signals.map(s => s.id),
    { topic },
    result,
  )
}

/** Generate and publish the daily briefing */
export async function publishDailyBriefing(): Promise<PublishResult> {
  const signals = await getTopSignals(24, 30)

  if (signals.length === 0) {
    return { success: false, error: 'No signals in last 24h to brief on' }
  }

  const signalList = signals.map((s, i) =>
    `${i + 1}. [${s.severity.toUpperCase()}] ${s.title}\n   Location: ${s.location_name ?? 'Global'} | Category: ${s.category} | Sources: ${s.source_count} | Reliability: ${s.reliability_score}\n   Summary: ${s.summary ?? 'N/A'}`
  ).join('\n\n')

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const prompt = `Generate the PULSE Daily Briefing for ${dateStr}.

You have ${signals.length} signals from the last 24 hours. Generate TWO sections:

SECTION 1 — EXECUTIVE SUMMARY
5-8 bullet points. Each bullet: [SEVERITY] One-sentence summary (source count).

SECTION 2 — FULL BRIEFING
600-1000 words with these sections:
- **Top Stories** (3-4 most significant developments)
- **Emerging Threats** (signals that could escalate)
- **Regional Watch** (notable regional developments)
- **Market Signals** (economic/financial indicators)
- **What to Watch Today** (forward-looking indicators)

Signals to analyze:
${signalList}`

  // Daily briefing → Anthropic (deep tier): long-form, editorial, connecting patterns
  const result = await generateContent(prompt, 2000, 'deep')

  if (!result.text || result.text.trim().length < 50) {
    return { success: false, error: 'LLM returned empty or insufficient briefing content' }
  }

  return publishPost(
    `[DAILY BRIEFING] ${dateStr}\n\n${result.text}\n\n— PULSE · WorldPulse AI Bureau`,
    ContentType.DAILY_BRIEFING,
    signals.map(s => s.id),
    { date: dateStr, signalCount: signals.length, provider: result.provider },
    result,
  )
}

/**
 * Publish a mid-day or evening briefing update.
 * Appends new developments since the morning briefing rather than regenerating.
 */
export async function publishBriefingUpdate(updateType: 'midday' | 'evening'): Promise<PublishResult> {
  const hoursSinceMorning = updateType === 'midday' ? 6 : 12
  const signals = await getTopSignals(hoursSinceMorning, 15)

  if (signals.length === 0) {
    return { success: false, error: `No new signals for ${updateType} update` }
  }

  const signalList = signals.map((s, i) =>
    `${i + 1}. [${s.severity.toUpperCase()}] ${s.title} (${s.location_name ?? 'Global'}, sources: ${s.source_count})\n   ${s.summary ?? 'N/A'}`
  ).join('\n\n')

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const label = updateType === 'midday' ? 'MID-DAY UPDATE' : 'EVENING WRAP'

  const prompt = `Generate a PULSE ${label} for ${dateStr}.

You have ${signals.length} new signals since the morning briefing. Write a concise update (200-400 words):

- **Developing Stories** — what evolved since morning
- **New Signals** — events that emerged after the morning briefing
- **Updated Assessment** — any changed risk levels or emerging patterns
- **What to Watch ${updateType === 'midday' ? 'This Afternoon' : 'Overnight'}**

Signals:
${signalList}`

  // Updates use OpenAI (fast) — they're shorter and more time-sensitive
  const result = await generateContent(prompt, 600, 'fast')

  if (!result.text || result.text.trim().length < 50) {
    return { success: false, error: 'LLM returned empty or insufficient briefing update content' }
  }

  return publishPost(
    `[${label}] ${dateStr}\n\n${result.text}\n\n— PULSE · WorldPulse AI Bureau`,
    ContentType.DAILY_BRIEFING,
    signals.map(s => s.id),
    { date: dateStr, updateType, signalCount: signals.length, provider: result.provider },
    result,
  )
}

/** Syndicate a social media post back into the feed */
export async function syndicatePost(
  platform: string,
  externalUrl: string,
  title: string,
  content: string,
  externalId?: string,
): Promise<PublishResult> {
  const platformLabels: Record<string, string> = {
    x: '𝕏', reddit: 'Reddit', linkedin: 'LinkedIn', hackernews: 'Hacker News',
  }

  const label = platformLabels[platform] ?? platform

  const postContent = `📡 FROM ${label.toUpperCase()}\n\n${title}\n\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}\n\n🔗 ${externalUrl}\n\n— PULSE · WorldPulse AI Bureau`

  const result = await publishPost(
    postContent,
    ContentType.SYNDICATED,
    [],
    { platform, externalUrl, externalId },
  )

  if (result.success && result.postId) {
    // Record syndication for engagement tracking
    await db('pulse_syndication').insert({
      platform,
      external_id:  externalId ?? null,
      external_url: externalUrl,
      post_id:      result.postId,
      title,
    }).onConflict(['platform', 'external_id']).ignore()
  }

  return result
}

/** Check for new critical signals and auto-publish flash briefs */
export async function checkAndPublishFlashBriefs(): Promise<number> {
  const recentCritical = await getCriticalSignals(15) // Last 15 minutes

  // Check which signals we've already briefed on
  const alreadyBriefed = new Set<string>()
  if (recentCritical.length > 0) {
    const existing = await db('pulse_publish_log')
      .where('content_type', ContentType.FLASH_BRIEF)
      .whereRaw(`source_signals && ARRAY[${recentCritical.map(s => `'${s.id}'`).join(',')}]::uuid[]`)
      .select('source_signals')

    for (const row of existing) {
      for (const id of (row.source_signals ?? [])) {
        alreadyBriefed.add(id)
      }
    }
  }

  let published = 0
  for (const signal of recentCritical) {
    if (alreadyBriefed.has(signal.id)) continue
    const result = await publishFlashBrief(signal)
    if (result.success) {
      published++
      // Check alert rules for matching signals
      try {
        const { matchSignalToAlertRules } = await import('../alert-matcher')
        await matchSignalToAlertRules({
          id: signal.id,
          title: signal.title,
          category: signal.category,
          severity: signal.severity,
          country_code: signal.country_code,
          region: signal.region,
          tags: signal.tags,
          reliability_score: signal.reliability_score,
        })
      } catch {
        // Non-fatal — alert matching failure shouldn't block publishing
      }
    }
  }

  return published
}

/** Get PULSE publishing stats */
export async function getPublishStats(): Promise<Record<string, unknown>> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [todayCount] = await db('pulse_publish_log')
    .where('published_at', '>', today)
    .count('id as count')

  const [totalCount] = await db('pulse_publish_log')
    .count('id as count')

  const byType = await db('pulse_publish_log')
    .where('published_at', '>', today)
    .groupBy('content_type')
    .select('content_type')
    .count('id as count')

  const [tokenUsage] = await db('pulse_publish_log')
    .where('published_at', '>', today)
    .sum('token_count as total_tokens')

  return {
    today:       Number(todayCount?.count ?? 0),
    total:       Number(totalCount?.count ?? 0),
    byType:      Object.fromEntries(byType.map(r => [r.content_type, Number(r.count)])),
    tokensToday: Number(tokenUsage?.total_tokens ?? 0),
  }
}
