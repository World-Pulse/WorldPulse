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

/** Fixed section IDs for the 7-section briefing structure */
export const BRIEFING_SECTION_IDS = [
  'threat_assessment',
  'geopolitical_pulse',
  'economic_trade',
  'maritime_intelligence',
  'climate_disaster',
  'cyber_tech',
  'what_to_watch',
] as const
export type BriefingSectionId = typeof BRIEFING_SECTION_IDS[number]

export interface BriefingSection {
  id: BriefingSectionId
  title: string
  body: string          // 2-6 sentence narrative for this section
  severity: string      // overall severity for this section: critical|high|medium|low|info
  signal_count: number  // how many signals informed this section
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
  sections: BriefingSection[]
  /** @deprecated Use sections instead — kept for backward compat */
  key_developments: BriefingDevelopment[]
  category_breakdown: CategoryBreakdown[]
  geographic_hotspots: GeographicHotspot[]
  /** @deprecated Use sections[0] (Threat Assessment) */
  threat_assessment: string
  /** @deprecated Use sections[6] (What to Watch) */
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

export const SECTION_TITLES: Record<BriefingSectionId, string> = {
  threat_assessment:     'Threat Assessment',
  geopolitical_pulse:    'Geopolitical Pulse',
  economic_trade:        'Economic & Trade',
  maritime_intelligence: 'Maritime Intelligence',
  climate_disaster:      'Climate & Disaster',
  cyber_tech:            'Cyber & Tech',
  what_to_watch:         'What to Watch',
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
  const result = await db('signals')
    .where('created_at', '>=', since)
    .count('id as count')
    .first() as { count: string | number } | undefined
  return Number(result?.count ?? 0)
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

  return `You are PULSE, the senior intelligence analyst for WorldPulse — an open-source global intelligence network.
Generate a structured Daily Intelligence Briefing from the following data collected over the last 24 hours.

TOTAL SIGNALS PROCESSED: ${totalSignals}

TOP SIGNALS BY SEVERITY & RELIABILITY:
${signalList}

EVENT CLUSTERS (cross-source correlated events):
${clusterList}

CATEGORY BREAKDOWN:
${categoryList}

GEOGRAPHIC HOTSPOTS:
${hotspotList}

Your briefing MUST follow a FIXED 7-SECTION structure. Every section gets content, even on quiet days (minimum 2 sentences per section). This consistency is critical — readers develop a habit of checking the same structure daily.

Generate a JSON response with EXACTLY this structure (no markdown, pure JSON):
{
  "executive_summary": "2-3 sentence overview of the global intelligence picture",
  "sections": {
    "threat_assessment": {
      "body": "2-4 sentences. Overall global threat posture: active conflicts, terrorism alerts, military escalations. What keeps the watch floor awake tonight.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "geopolitical_pulse": {
      "body": "2-4 sentences. Diplomatic shifts, elections, sanctions, regime changes, alliance moves, UN/NATO/EU actions.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "economic_trade": {
      "body": "2-4 sentences. Markets, trade disputes, supply chain disruptions, commodity shocks, central bank moves, sanctions impact on commerce.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "maritime_intelligence": {
      "body": "2-4 sentences. Chokepoint status (Suez, Hormuz, Malacca, Bab el-Mandeb), carrier strike group movements, piracy, dark shipping / sanctions evasion, port disruptions. This section is MANDATORY even if few maritime signals exist — use any shipping, naval, or trade signal.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "climate_disaster": {
      "body": "2-4 sentences. Natural disasters, extreme weather, climate policy, environmental crises, wildfire, flood, drought, earthquake alerts.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "cyber_tech": {
      "body": "2-4 sentences. Cyber attacks, data breaches, critical infrastructure threats, AI developments, technology regulation, internet outages.",
      "severity": "critical|high|medium|low",
      "signal_count": number
    },
    "what_to_watch": {
      "body": "2-4 sentences. Forward-looking: what situations could escalate in the next 24-72 hours, scheduled events (elections, summits, hearings, launches), developing stories to monitor.",
      "severity": "medium|low",
      "signal_count": 0
    }
  },
  "key_developments": [
    {
      "headline": "Short headline",
      "detail": "1-2 sentence detail",
      "severity": "critical|high|medium",
      "category": "category name",
      "signal_count": number
    }
  ]
}

IMPORTANT RULES:
- Include 3-7 key_developments prioritized by severity and impact
- EVERY section must have content (2+ sentences). On quiet days, note the absence of significant activity
- Maritime Intelligence is mandatory — use ANY available military, shipping, economy, or trade signals
- Be factual, concise, and analytical. No sensationalism
- Do NOT include any text outside the JSON object`
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
        const anthropicText = data.content[0]?.text
        if (anthropicText) return { text: anthropicText, model: 'anthropic' }
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
        const openaiText = data.choices[0]?.message.content
        if (openaiText) return { text: openaiText, model: 'openai' }
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
        const geminiText = data.candidates[0]?.content.parts[0]?.text
        if (geminiText) return { text: geminiText, model: 'gemini' }
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
        const openrouterText = data.choices[0]?.message.content
        if (openrouterText) return { text: openrouterText, model: 'openrouter' }
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
): { executive_summary: string; sections: BriefingSection[]; key_developments: BriefingDevelopment[]; threat_assessment: string; outlook: string } {
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

  // Build 7 fixed sections from extractive data
  const byCategory = (cats: string[]) => signals.filter(s => cats.includes(s.category))
  const sectionSeverity = (sigs: BriefingSignal[]) => {
    if (sigs.some(s => s.severity === 'critical')) return 'critical'
    if (sigs.some(s => s.severity === 'high')) return 'high'
    if (sigs.length > 0) return 'medium'
    return 'low'
  }
  const summaryFor = (sigs: BriefingSignal[], fallback: string) => {
    if (sigs.length === 0) return fallback
    return sigs.slice(0, 3).map(s => s.title).join('. ') + '.'
  }

  const conflictSignals = byCategory(['conflict', 'military', 'security'])
  const geopolSignals = byCategory(['geopolitics', 'elections'])
  const econSignals = byCategory(['economy', 'finance'])
  const maritimeSignals = signals.filter(s => s.category === 'military' || s.category === 'maritime' || (s.category === 'economy' && (s.title.toLowerCase().includes('ship') || s.title.toLowerCase().includes('port') || s.title.toLowerCase().includes('maritime'))))
  const climateSignals = byCategory(['climate', 'disaster', 'weather'])
  const cyberSignals = byCategory(['technology', 'security'])

  const sections: BriefingSection[] = [
    { id: 'threat_assessment', title: SECTION_TITLES.threat_assessment, body: threat_assessment + ` ${conflictSignals.length} conflict/military signals detected.`, severity: sectionSeverity(conflictSignals), signal_count: conflictSignals.length },
    { id: 'geopolitical_pulse', title: SECTION_TITLES.geopolitical_pulse, body: summaryFor(geopolSignals, 'No significant geopolitical developments in this period. Diplomatic channels remain active.'), severity: sectionSeverity(geopolSignals), signal_count: geopolSignals.length },
    { id: 'economic_trade', title: SECTION_TITLES.economic_trade, body: summaryFor(econSignals, 'Markets and trade flows remain within normal parameters. No major disruptions reported.'), severity: sectionSeverity(econSignals), signal_count: econSignals.length },
    { id: 'maritime_intelligence', title: SECTION_TITLES.maritime_intelligence, body: summaryFor(maritimeSignals, 'Major chokepoints operating normally. No significant piracy or dark shipping alerts in this period.'), severity: sectionSeverity(maritimeSignals), signal_count: maritimeSignals.length },
    { id: 'climate_disaster', title: SECTION_TITLES.climate_disaster, body: summaryFor(climateSignals, 'No major natural disasters or extreme weather events in this period. Standard monitoring continues.'), severity: sectionSeverity(climateSignals), signal_count: climateSignals.length },
    { id: 'cyber_tech', title: SECTION_TITLES.cyber_tech, body: summaryFor(cyberSignals, 'Cyber threat landscape remains at baseline. No major breaches or critical infrastructure incidents reported.'), severity: sectionSeverity(cyberSignals), signal_count: cyberSignals.length },
    { id: 'what_to_watch', title: SECTION_TITLES.what_to_watch, body: outlook, severity: 'medium', signal_count: 0 },
  ]

  return { executive_summary, sections, key_developments, threat_assessment, outlook }
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
  let sections: BriefingSection[]
  let key_developments: BriefingDevelopment[]
  let threat_assessment: string
  let outlook: string
  let model: string

  const emptySections: BriefingSection[] = BRIEFING_SECTION_IDS.map(id => ({
    id,
    title: SECTION_TITLES[id],
    body: 'No data available for this period.',
    severity: 'low',
    signal_count: 0,
  }))

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
      sections: emptySections,
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
        sections?: Record<string, { body: string; severity: string; signal_count: number }>
        key_developments: BriefingDevelopment[]
        // Legacy fields
        threat_assessment?: string
        outlook?: string
      }
      executive_summary = parsed.executive_summary

      // Parse 7-section structure from LLM response
      if (parsed.sections) {
        sections = BRIEFING_SECTION_IDS.map(id => ({
          id,
          title: SECTION_TITLES[id],
          body: parsed.sections![id]?.body ?? 'No significant activity in this domain.',
          severity: parsed.sections![id]?.severity ?? 'low',
          signal_count: parsed.sections![id]?.signal_count ?? 0,
        }))
      } else {
        // LLM returned old format — build sections from extractive as fallback
        const extractive = buildExtractiveBriefing(signals, clusters, categories, totalSignals)
        sections = extractive.sections
      }

      key_developments = parsed.key_developments ?? []
      // Backward compat: extract from sections if available
      threat_assessment = parsed.threat_assessment ?? sections.find(s => s.id === 'threat_assessment')?.body ?? ''
      outlook = parsed.outlook ?? sections.find(s => s.id === 'what_to_watch')?.body ?? ''
    } catch (parseErr) {
      logger.warn({ parseErr }, 'Failed to parse LLM briefing response, falling back to extractive')
      const extractive = buildExtractiveBriefing(signals, clusters, categories, totalSignals)
      executive_summary = extractive.executive_summary
      sections = extractive.sections
      key_developments = extractive.key_developments
      threat_assessment = extractive.threat_assessment
      outlook = extractive.outlook
      model = 'extractive'
    }
  } else {
    const extractive = buildExtractiveBriefing(signals, clusters, categories, totalSignals)
    executive_summary = extractive.executive_summary
    sections = extractive.sections
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
    sections,
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
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch briefing history')
    return []
  }
}