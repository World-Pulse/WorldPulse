/**
 * briefing-generator.ts — AI-powered Daily Intelligence Briefing
 *
 * Generates a comprehensive daily intelligence briefing by:
 *   1. Querying the top signals from the last 24h by severity + reliability
 *   2. Pulling recent event clusters from the correlation engine
 *   3. Computing category distribution and geographic hotspots
 *   4. Sending the aggregated intelligence to the LLM for narrative synthesis
 *   5. Caching the result in Redis (TTL 4h) for fast retrieval
 *
 * Uses the same multi-LLM priority chain as signal-summary.ts.
 * No competitor (Ground News, Shadowbroker, Crucix) has automated briefings.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'

// ─── Config ──────────────────────────────────────────────────────────────────
const BRIEFING_CACHE_TTL  = 60 * 60 * 4   // 4 hours
const BRIEFING_CACHE_KEY  = 'briefing:daily:'
const BRIEFING_HISTORY_KEY = 'briefing:history'
const MAX_SIGNALS_FOR_LLM = 30
const MAX_CLUSTERS_FOR_LLM = 10
const SEVERITY_ORDER: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface BriefingSignal {
  id: string
  title: string
  category: string
  severity: string
  reliability_score: number
  location_name: string | null
  country_code: string | null
  source_domain: string | null
  created_at: string
}

export interface BriefingCluster {
  cluster_id: string
  signal_count: number
  correlation_type: string
  correlation_score: number
  categories: string[]
  severity: string
}

export interface CategoryBreakdown {
  category: string
  count: number
  critical_count: number
  high_count: number
}

export interface GeographicHotspot {
  country_code: string
  location_name: string | null
  signal_count: number
  avg_severity_score: number
}

export interface DailyBriefing {
  id: string
  date: string
  generated_at: string
  model: string
  period_hours: number
  total_signals: number
  total_clusters: number
  executive_summary: string
  key_developments: BriefingDevelopment[]
  category_breakdown: CategoryBreakdown[]
  geographic_hotspots: GeographicHotspot[]
  threat_assessment: string
  outlook: string
  top_signals: BriefingSignal[]
}

export interface BriefingDevelopment {
  headline: string
  detail: string
  severity: string
  category: string
  signal_count: number
}

// ─── Data Collection ─────────────────────────────────────────────────────────

async function getTopSignals(hours: number): Promise<BriefingSignal[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const rows = await db('signals')
    .select('id', 'title', 'category', 'severity', 'reliability_score',
            'location_name', 'country_code', 'source_domain', 'created_at')
    .where('created_at', '>=', since)
    .whereIn('severity', ['critical', 'high', 'medium'])
    .where('reliability_score', '>=', 0.5)
    .orderByRaw(`
      CASE severity
        WHEN 'critical' THEN 5
        WHEN 'high' THEN 4
        WHEN 'medium' THEN 3
        ELSE 1
      END DESC,
      reliability_score DESC
    `)
    .limit(MAX_SIGNALS_FOR_LLM)
  return rows as BriefingSignal[]
}

async function getTotalSignalCount(hours: number): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const [{ count }] = await db('signals')
    .where('created_at', '>=', since)
    .count('id as count')
  return Number(count)
}

async function getCategoryBreakdown(hours: number): Promise<CategoryBreakdown[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const rows = await db('signals')
    .select('category')
    .count('id as count')
    .countDistinct(db.raw("CASE WHEN severity = 'critical' THEN id END as critical_count"))
    .countDistinct(db.raw("CASE WHEN severity = 'high' THEN id END as high_count"))
    .where('created_at', '>=', since)
    .groupBy('category')
    .orderBy('count', 'desc')
    .limit(15)
  return rows.map((r: Record<string, unknown>) => ({
    category: String(r.category ?? 'unknown'),
    count: Number(r.count),
    critical_count: Number(r.critical_count ?? 0),
    high_count: Number(r.high_count ?? 0),
  }))
}

async function getGeographicHotspots(hours: number): Promise<GeographicHotspot[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const rows = await db('signals')
    .select('country_code', 'location_name')
    .count('id as signal_count')
    .avg(db.raw(`
      CASE severity
        WHEN 'critical' THEN 5
        WHEN 'high' THEN 4
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 2
        ELSE 1
      END as avg_severity_score
    `))
    .where('created_at', '>=', since)
    .whereNotNull('country_code')
    .groupBy('country_code', 'location_name')
    .orderByRaw('count(id) DESC')
    .limit(10)
  return rows.map((r: Record<string, unknown>) => ({
    country_code: String(r.country_code),
    location_name: r.location_name ? String(r.location_name) : null,
    signal_count: Number(r.signal_count),
    avg_severity_score: Math.round(Number(r.avg_severity_score ?? 0) * 100) / 100,
  }))
}

async function getRecentClusters(): Promise<BriefingCluster[]> {
  try {
    // Scan Redis for recent event clusters from the correlation engine
    const clusterKeys: string[] = []
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'cluster:*', 'COUNT', 50)
      cursor = next
      clusterKeys.push(...keys)
    } while (cursor !== '0' && clusterKeys.length < 50)

    const clusters: BriefingCluster[] = []
    for (const key of clusterKeys.slice(0, MAX_CLUSTERS_FOR_LLM)) {
      try {
        const raw = await redis.get(key)
        if (!raw) continue
        const data = JSON.parse(raw)
        clusters.push({
          cluster_id: key.replace('cluster:', ''),
          signal_count: Number(data.signalCount ?? data.signals?.length ?? 0),
          correlation_type: String(data.correlationType ?? 'unknown'),
          correlation_score: Number(data.correlationScore ?? 0),
          categories: Array.isArray(data.categories) ? data.categories : [],
          severity: String(data.severity ?? 'medium'),
        })
      } catch {
        // Skip malformed cluster data
      }
    }
    return clusters.sort((a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
    )
  } catch {
    return []
  }
}

// ─── LLM Briefing Generation ─────────────────────────────────────────────────

function buildBriefingPrompt(
  signals: BriefingSignal[],
  clusters: BriefingCluster[],
  categories: CategoryBreakdown[],
  hotspots: GeographicHotspot[],
  totalSignals: number,
): string {
  const signalList = signals.slice(0, 20).map(s =>
    `- [${s.severity.toUpperCase()}] ${s.title} (${s.category}, ${s.location_name ?? 'global'}, reliability: ${(s.reliability_score * 100).toFixed(0)}%)`
  ).join('\n')

  const clusterList = clusters.length > 0
    ? clusters.map(c =>
        `- Cluster: ${c.signal_count} signals, type: ${c.correlation_type}, severity: ${c.severity}, categories: ${c.categories.join(', ')}`
      ).join('\n')
    : 'No correlated event clusters detected in this period.'

  const categoryList = categories.map(c =>
    `- ${c.category}: ${c.count} signals (${c.critical_count} critical, ${c.high_count} high)`
  ).join('\n')

  const hotspotList = hotspots.map(h =>
    `- ${h.country_code}${h.location_name ? ` (${h.location_name})` : ''}: ${h.signal_count} signals, avg severity: ${h.avg_severity_score}`
  ).join('\n')

  return `You are an intelligence analyst for WorldPulse, an open-source global intelligence network.
Generate a Daily Intelligence Briefing from the following data collected over the last 24 hours.

TOTAL SIGNALS PROCESSED: ${totalSignals}

TOP SIGNALS BY SEVERITY & RELIABILITY:
${signalList}

EVENT CLUSTERS (cross-source correlated events):
${clusterList}

CATEGORY BREAKDOWN:
${categoryList}

GEOGRAPHIC HOTSPOTS:
${hotspotList}

Generate a JSON response with EXACTLY this structure (no markdown, pure JSON):
{
  "executive_summary": "2-3 sentence overview of the global intelligence picture",
  "key_developments": [
    {
      "headline": "Short headline",
      "detail": "1-2 sentence detail",
      "severity": "critical|high|medium",
      "category": "category name",
      "signal_count": number
    }
  ],
  "threat_assessment": "1-2 sentences on overall global threat level and trending direction",
  "outlook": "1-2 sentences on what to watch in the next 24-48 hours"
}

Include 3-7 key developments, prioritized by severity and impact. Be factual and concise.
Do NOT include any text outside the JSON object.`
}

async function generateWithLLM(prompt: string): Promise<{ text: string; model: string }> {
  // Priority 1: Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> }
        return { text: data.content[0].text, model: 'anthropic' }
      }
    } catch (err) {
      logger.warn({ err }, 'Briefing: Anthropic call failed, trying next provider')
    }
  }

  // Priority 2: OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> }
        return { text: data.choices[0].message.content, model: 'openai' }
      }
    } catch (err) {
      logger.warn({ err }, 'Briefing: OpenAI call failed, trying next provider')
    }
  }

  // Priority 3: Gemini
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2000 },
          }),
        },
      )
      if (res.ok) {
        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
        return { text: data.candidates[0].content.parts[0].text, model: 'gemini' }
      }
    } catch (err) {
      logger.warn({ err }, 'Briefing: Gemini call failed, trying next provider')
    }
  }

  // Priority 4: OpenRouter
  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    try {
      const model = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.2-3b-instruct:free'
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> }
        return { text: data.choices[0].message.content, model: 'openrouter' }
      }
    } catch (err) {
      logger.warn({ err }, 'Briefing: OpenRouter call failed, trying next provider')
    }
  }

  // Priority 5: Ollama
  const ollamaUrl = process.env.OLLAMA_URL
  if (ollamaUrl) {
    try {
      const model = process.env.OLLAMA_MODEL ?? 'llama3.2'
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
      })
      if (res.ok) {
        const data = await res.json() as { response: string }
        return { text: data.response, model: 'ollama' }
      }
    } catch (err) {
      logger.warn({ err }, 'Briefing: Ollama call failed')
    }
  }

  // Fallback: extractive summary
  return { text: '', model: 'extractive' }
}

function buildExtractiveBriefing(
  signals: BriefingSignal[],
  clusters: BriefingCluster[],
  categories: CategoryBreakdown[],
  totalSignals: number,
): { executive_summary: string; key_developments: BriefingDevelopment[]; threat_assessment: string; outlook: string } {
  const criticalSignals = signals.filter(s => s.severity === 'critical')
  const highSignals = signals.filter(s => s.severity === 'high')

  const executive_summary = `WorldPulse processed ${totalSignals} signals in the last 24 hours across ${categories.length} categories. ${criticalSignals.length} critical and ${highSignals.length} high-severity signals detected${clusters.length > 0 ? `, with ${clusters.length} correlated event clusters identified` : ''}.`

  const key_developments: BriefingDevelopment[] = signals.slice(0, 5).map(s => ({
    headline: s.title,
    detail: `${s.category} signal from ${s.source_domain ?? 'unknown source'}, reliability ${(s.reliability_score * 100).toFixed(0)}%.`,
    severity: s.severity,
    category: s.category,
    signal_count: 1,
  }))

  const topCategory = categories[0]?.category ?? 'general'
  const threat_assessment = criticalSignals.length >= 3
    ? `Elevated threat level with ${criticalSignals.length} critical signals. Primary concern: ${topCategory}.`
    : `Moderate threat level. ${totalSignals} signals processed with ${criticalSignals.length} critical events.`

  const outlook = `Monitor ${topCategory} signals for escalation. ${clusters.length > 0 ? `${clusters.length} active event clusters may develop further.` : 'No cross-source clusters detected — situation appears decentralized.'}`

  return { executive_summary, key_developments, threat_assessment, outlook }
}

// ─── Main Generator ──────────────────────────────────────────────────────────

export async function generateDailyBriefing(hours: number = 24): Promise<DailyBriefing> {
  const dateKey = new Date().toISOString().slice(0, 10)
  const cacheKey = `${BRIEFING_CACHE_KEY}${dateKey}:${hours}h`

  // Check cache first
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      logger.info({ dateKey, hours }, 'Returning cached daily briefing')
      return JSON.parse(cached) as DailyBriefing
    }
  } catch {
    // Cache miss, generate fresh
  }

  logger.info({ dateKey, hours }, 'Generating fresh daily briefing')

  // Collect intelligence data in parallel
  const [signals, totalSignals, categories, hotspots, clusters] = await Promise.all([
    getTopSignals(hours),
    getTotalSignalCount(hours),
    getCategoryBreakdown(hours),
    getGeographicHotspots(hours),
    getRecentClusters(),
  ])

  let executive_summary: string
  let key_developments: BriefingDevelopment[]
  let threat_assessment: string
  let outlook: string
  let model: string

  if (signals.length === 0) {
    // No signals to brief on
    return {
      id: `briefing-${dateKey}-${hours}h`,
      date: dateKey,
      generated_at: new Date().toISOString(),
      model: 'none',
      period_hours: hours,
      total_signals: 0,
      total_clusters: 0,
      executive_summary: 'No signals were collected in this period. Systems may be offline or no events occurred.',
      key_developments: [],
      category_breakdown: [],
      geographic_hotspots: [],
      threat_assessment: 'Unable to assess — no data available.',
      outlook: 'Resume monitoring when signal collection is operational.',
      top_signals: [],
    }
  }

  // Try LLM generation
  const prompt = buildBriefingPrompt(signals, clusters, categories, hotspots, totalSignals)
  const llmResult = await generateWithLLM(prompt)
  model = llmResult.model

  if (llmResult.text && model !== 'extractive') {
    try {
      // Parse JSON from LLM response (handle markdown code fences)
      let jsonText = llmResult.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '')
      }
      const parsed = JSON.parse(jsonText) as {
        executive_summary: string
        key_developments: BriefingDevelopment[]
        threat_assessment: string
        outlook: string
      }
      executive_summary = parsed.executive_summary
      key_developments = parsed.key_developments ?? []
      threat_assessment = parsed.threat_assessment
      outlook = parsed.outlook
    } catch (parseErr) {
      logger.warn({ parseErr }, 'Failed to parse LLM briefing response, falling back to extractive')
      const extractive = buildExtractiveBriefing(signals, clusters, categories, totalSignals)
      executive_summary = extractive.executive_summary
      key_developments = extractive.key_developments
      threat_assessment = extractive.threat_assessment
      outlook = extractive.outlook
      model = 'extractive'
    }
  } else {
    const extractive = buildExtractiveBriefing(signals, clusters, categories, totalSignals)
    executive_summary = extractive.executive_summary
    key_developments = extractive.key_developments
    threat_assessment = extractive.threat_assessment
    outlook = extractive.outlook
    model = 'extractive'
  }

  const briefing: DailyBriefing = {
    id: `briefing-${dateKey}-${hours}h`,
    date: dateKey,
    generated_at: new Date().toISOString(),
    model,
    period_hours: hours,
    total_signals: totalSignals,
    total_clusters: clusters.length,
    executive_summary,
    key_developments,
    category_breakdown: categories,
    geographic_hotspots: hotspots,
    threat_assessment,
    outlook,
    top_signals: signals.slice(0, 10),
  }

  // Cache the briefing
  try {
    await redis.setex(cacheKey, BRIEFING_CACHE_TTL, JSON.stringify(briefing))
    // Store in history list (keep last 30 briefings)
    await redis.lpush(BRIEFING_HISTORY_KEY, JSON.stringify({
      id: briefing.id,
      date: briefing.date,
      generated_at: briefing.generated_at,
      total_signals: briefing.total_signals,
      total_clusters: briefing.total_clusters,
      model: briefing.model,
    }))
    await redis.ltrim(BRIEFING_HISTORY_KEY, 0, 29)
  } catch (err) {
    logger.warn({ err }, 'Failed to cache daily briefing')
  }

  logger.info({
    dateKey,
    model,
    totalSignals,
    clusters: clusters.length,
    developments: key_developments.length,
  }, 'Daily briefing generated successfully')

  return briefing
}

export async function getBriefingHistory(): Promise<Array<{
  id: string
  date: string
  generated_at: string
  total_signals: number
  total_clusters: number
  model: string
}>> {
  try {
    const items = await redis.lrange(BRIEFING_HISTORY_KEY, 0, 29)
    return items.map(item => JSON.parse(item))
  } catch {
    return []
  }
}
