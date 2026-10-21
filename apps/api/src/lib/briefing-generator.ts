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
import { GEMINI_MODEL, OLLAMA_MODEL } from './llm-models'
import { askClaude, CLAUDE_SMALL } from './claude'
import { signalsHaveStoryIds } from './stories'

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
  /** verified once two or more independent outlets carry the story (plans E2 and 9, Oct 21, 2026) */
  status?: string
  /** The story's independent outlets */
  source_count?: number | null
  /** The start of its summary (240 characters at most) */
  summary?: string | null
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
  /** Stories in the period: reports of one event share a story (Oct 13, 2026) */
  total_stories: number
  /** Correlation clusters (cluster:* keys): 0 since the story grouping replaced them */
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
  // One report per story: the Djibouti wreck took four of the five "key
  // developments" (Oct 13, 2026). Reports of a story share story_id.
  const storyKey = await signalsHaveStoryIds() ? 'COALESCE(story_id, id)::text' : 'id::text'
  // (signals has no source_domain column: the outlet is its first link's
  // website. Asking for one failed every briefing, Oct 13, 2026)
  const rows = await db('signals')
    .select('id', 'title', 'category', 'severity', 'reliability_score',
            'location_name', 'country_code', 'created_at', 'status', 'source_count',
            db.raw('left(summary, 240) AS summary'),
            db.raw('substring(original_urls[1] from ?) AS source_domain', ['^https?://(?:www[.])?([^/:?#]+)']),
            db.raw(`${storyKey} AS story_key`))
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
    .limit(MAX_SIGNALS_FOR_LLM * 4) as Array<BriefingSignal & { story_key?: string }>
  return onePerStory(rows).slice(0, MAX_SIGNALS_FOR_LLM)
}

/**
 * Stories first reported before the period that more outlets carried during it
 * (plan E2, "what changed overnight"): verified, one report each, the most
 * outlets first
 */
async function getGrowingStories(hours: number): Promise<BriefingSignal[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const storyKey = await signalsHaveStoryIds() ? 'COALESCE(story_id, id)::text' : 'id::text'
  const rows = await db('signals')
    .select('id', 'title', 'category', 'severity', 'reliability_score',
            'location_name', 'country_code', 'created_at', 'status', 'source_count',
            db.raw('left(summary, 240) AS summary'),
            db.raw('substring(original_urls[1] from ?) AS source_domain', ['^https?://(?:www[.])?([^/:?#]+)']),
            db.raw(`${storyKey} AS story_key`))
    .where('status', 'verified')
    .where('last_corroborated_at', '>=', since)
    .where('created_at', '<', since)
    // a story a week old that one more outlet mentions isn't what changed overnight
    .where('created_at', '>=', new Date(Date.now() - (hours + 72) * 60 * 60 * 1000).toISOString())
    .orderByRaw('coalesce(source_count, 1) DESC')
    .limit(40) as Array<BriefingSignal & { story_key?: string }>
  return onePerStory(rows).slice(0, 8)
}

const outletsOf = (s: Pick<BriefingSignal, 'source_count'>): number => Math.max(1, Number(s.source_count ?? 1) || 1)

/**
 * What the briefing is written from (plans E2 and 9, Oct 21, 2026): the
 * verified stories, most serious and most carried first; the serious reports
 * no second outlet has carried yet, said to be unconfirmed; and the stories
 * that grew during the period. Until now the writer got the most severe
 * reports with a reliability percentage, never whether a story was verified
 * or by how many outlets.
 */
export function briefingLists(signals: BriefingSignal[], growing: BriefingSignal[] = []): {
  verified: BriefingSignal[]; unconfirmed: BriefingSignal[]; growing: BriefingSignal[]
} {
  const rank = (s: BriefingSignal) => SEVERITY_ORDER[s.severity] ?? 0
  const verified = signals.filter(s => s.status === 'verified' && outletsOf(s) >= 2)
    .sort((a, b) => rank(b) - rank(a) || outletsOf(b) - outletsOf(a))
    .slice(0, 15)
  const unconfirmed = signals.filter(s => !(s.status === 'verified' && outletsOf(s) >= 2) && rank(s) >= SEVERITY_ORDER.high)
    .slice(0, 6)
  return { verified, unconfirmed, growing: growing.slice(0, 8) }
}

/** The first report of each story, in order (exported for tests) */
export function onePerStory<T extends { story_key?: string; id: string }>(rows: T[]): Array<Omit<T, 'story_key'>> {
  const seen = new Set<string>()
  const out: Array<Omit<T, 'story_key'>> = []
  for (const { story_key, ...row } of rows) {
    const key = story_key ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

async function getTotalSignalCount(hours: number): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const result = await db('signals')
    .where('created_at', '>=', since)
    .count('id as count')
    .first() as { count: string | number } | undefined
  return Number(result?.count ?? 0)
}

/** Stories reported in the last `hours`: each story once, however many outlets */
async function getTotalStoryCount(hours: number): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const key = await signalsHaveStoryIds() ? 'COALESCE(story_id, id)' : 'id'
  const result = await db('signals')
    .where('created_at', '>=', since)
    .select(db.raw(`count(DISTINCT ${key})::int AS count`))
    .first() as { count: string | number } | undefined
  return Number(result?.count ?? 0)
}

async function getCategoryBreakdown(hours: number): Promise<CategoryBreakdown[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const rows = await db('signals')
    // (count(distinct CASE … END as x) and avg(CASE … END as x) put the alias
    // inside the parentheses, which isn't SQL: every briefing failed with it)
    .select('category')
    .count('id as count')
    .select(db.raw("count(*) FILTER (WHERE severity = 'critical')::int AS critical_count"))
    .select(db.raw("count(*) FILTER (WHERE severity = 'high')::int AS high_count"))
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
    .select(db.raw(`
      avg(CASE severity
        WHEN 'critical' THEN 5
        WHEN 'high' THEN 4
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 2
        ELSE 1
      END) AS avg_severity_score
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

function reportLine(s: BriefingSignal): string {
  const n = outletsOf(s)
  const where = s.location_name ?? s.country_code ?? 'no place given'
  const summary = s.summary && !s.summary.toLowerCase().startsWith(s.title.toLowerCase().slice(0, 40))
    ? ` — ${s.summary.replace(/\s+/g, ' ').trim()}` : ''
  return `- [${s.severity.toUpperCase()} · ${n} outlet${n === 1 ? '' : 's'} · ${s.category}] ${s.title} (${where})${summary}`
}

/**
 * The writer's prompt (plans E2 and 9, Oct 21, 2026: "something an analyst
 * reads instead of Twitter"). It leads with what two or more outlets
 * verified, says what grew and what isn't confirmed yet, and asks for
 * nothing the reports don't say: the old one told the writer every section
 * was "MANDATORY", to "use ANY available" report for the maritime one and
 * to write at least two sentences on a quiet day, which invites filler. The
 * answer's shape is unchanged.
 */
export function buildBriefingPrompt(
  lists: ReturnType<typeof briefingLists>,
  categories: CategoryBreakdown[],
  hotspots: GeographicHotspot[],
  totalSignals: number,
  totalStories: number,
  hours = 24,
): string {
  const list = (items: BriefingSignal[], none: string) => (items.length ? items.map(reportLine).join('\n') : none)
  const categoryList = categories.map(c => `- ${c.category}: ${c.count} reports (${c.critical_count} critical, ${c.high_count} high)`).join('\n')
  const hotspotList = hotspots.map(h => `- ${h.country_code}${h.location_name ? ` (${h.location_name})` : ''}: ${h.signal_count} reports`).join('\n')

  return `You write WorldPulse's Daily Briefing: what happened in the last ${hours} hours, for a reader who wants the essentials without the noise. WorldPulse reads news outlets around the world and counts how many independent outlets report each story; a story is verified once two or more do.

In the last ${hours} hours: ${totalSignals} reports, ${totalStories} stories.

VERIFIED STORIES (two or more independent outlets), most serious first:
${list(lists.verified, '(none)')}

STORIES THAT GREW (first reported earlier; more outlets carried them in these ${hours} hours):
${list(lists.growing, '(none)')}

NOT YET CONFIRMED (serious reports only one outlet carries so far):
${list(lists.unconfirmed, '(none)')}

REPORTS BY TOPIC:
${categoryList || '(none)'}

PLACES WITH THE MOST REPORTS:
${hotspotList || '(none)'}

Rules:
- Use only the reports above. Never add a fact, number, name or place they don't give, and never guess at causes or at what will happen.
- Lead with verified stories. When an outlet count matters, use the one given ("verified by 7 outlets"). Call a single-outlet report unconfirmed, and never present it as established.
- Each section: one to four sentences from the reports that fit it. If none fit, write one sentence saying our reports had nothing notable on it in these ${hours} hours. Don't stretch other reports to fill a section.
- No sensationalism and no intelligence jargon; plain, exact sentences.

Sections:
- threat_assessment: armed conflict, attacks, security and crime
- geopolitical_pulse: diplomacy, governments and politics, elections, sanctions
- economic_trade: markets, trade, companies, prices
- maritime_intelligence: shipping, ports, navies, piracy at sea
- climate_disaster: disasters, extreme weather, climate
- cyber_tech: cyber attacks, internet outages, technology
- what_to_watch: only the stories that grew and events the reports themselves say are coming; no predictions

Answer with only this JSON:
{
  "executive_summary": "2 or 3 sentences: the most important verified developments and how many outlets carried them",
  "sections": {
    "<section id>": { "body": "the section's sentences", "severity": "critical|high|medium|low", "signal_count": <how many of the reports above it draws on> }
  },
  "key_developments": [
    { "headline": "a short headline", "detail": "one or two sentences", "severity": "critical|high|medium", "category": "the report's category", "signal_count": <the story's outlets> }
  ]
}
Give all seven sections, and 3 to 7 key_developments, verified stories first.`
}

async function generateWithLLM(prompt: string): Promise<{ text: string; model: string }> {
  // Priority 1: Claude, within the spending cap shared with the scraper (lib/claude.ts)
  if (process.env.ANTHROPIC_API_KEY) {
    const reply = await askClaude({
      purpose:   'briefing',
      model:     process.env.ANTHROPIC_MODEL || CLAUDE_SMALL,
      maxTokens: 2000,
      prompt,
    })
    if (reply?.text) return { text: reply.text, model: 'anthropic' }
    logger.warn('Briefing: Claude gave no answer (the spending cap or an error), trying next provider')
  }

  // Priority 2: Gemini
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const model = GEMINI_MODEL
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

  // Priority 3: OpenRouter
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

  // Priority 4: Ollama
  const ollamaUrl = process.env.OLLAMA_URL
  if (ollamaUrl) {
    try {
      const model = OLLAMA_MODEL
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

  const verifiedStories = signals.filter(s => s.status === 'verified' && outletsOf(s) >= 2)
  const executive_summary = `WorldPulse processed ${totalSignals} signals in the last 24 hours across ${categories.length} categories: ${verifiedStories.length} of the top stories were verified by two or more outlets; ${criticalSignals.length} critical and ${highSignals.length} high-severity reports${clusters.length > 0 ? `, with ${clusters.length} correlated event clusters identified` : ''}.`

  // Verified stories first, each with its outlets (plan 9, Oct 21, 2026)
  const lead = [...verifiedStories, ...signals.filter(s => !verifiedStories.includes(s))]
  const key_developments: BriefingDevelopment[] = lead.slice(0, 5).map(s => ({
    headline: s.title,
    detail: outletsOf(s) >= 2 && s.status === 'verified'
      ? `Verified by ${outletsOf(s)} outlets (${s.category}${s.location_name ? `, ${s.location_name}` : ''}).`
      : `Unconfirmed: one outlet so far, ${s.source_domain ?? 'source unknown'} (${s.category}).`,
    severity: s.severity,
    category: s.category,
    signal_count: outletsOf(s),
  }))

  const topCategory = categories[0]?.category ?? 'general'
  // Counts, not judgments: without the writer there is no one to weigh them (Oct 21, 2026)
  const threat_assessment = `${criticalSignals.length} critical and ${highSignals.length} high-severity reports among the top stories; the most reported topic: ${topCategory}.`

  const outlook = verifiedStories.length
    ? `The verified stories to follow: ${verifiedStories.slice(0, 3).map(s => s.title).join('; ')}.`
    : 'No story was verified by two or more outlets among the top reports in the period.'

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
    { id: 'threat_assessment', title: SECTION_TITLES.threat_assessment, body: threat_assessment + ` ${conflictSignals.length} conflict, military and security reports.`, severity: sectionSeverity(conflictSignals), signal_count: conflictSignals.length },
    { id: 'geopolitical_pulse', title: SECTION_TITLES.geopolitical_pulse, body: summaryFor(geopolSignals, 'Nothing notable in our reports on this in the period.'), severity: sectionSeverity(geopolSignals), signal_count: geopolSignals.length },
    { id: 'economic_trade', title: SECTION_TITLES.economic_trade, body: summaryFor(econSignals, 'Nothing notable in our reports on this in the period.'), severity: sectionSeverity(econSignals), signal_count: econSignals.length },
    { id: 'maritime_intelligence', title: SECTION_TITLES.maritime_intelligence, body: summaryFor(maritimeSignals, 'Nothing notable in our reports on this in the period.'), severity: sectionSeverity(maritimeSignals), signal_count: maritimeSignals.length },
    { id: 'climate_disaster', title: SECTION_TITLES.climate_disaster, body: summaryFor(climateSignals, 'Nothing notable in our reports on this in the period.'), severity: sectionSeverity(climateSignals), signal_count: climateSignals.length },
    { id: 'cyber_tech', title: SECTION_TITLES.cyber_tech, body: summaryFor(cyberSignals, 'Nothing notable in our reports on this in the period.'), severity: sectionSeverity(cyberSignals), signal_count: cyberSignals.length },
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
  const [signals, totalSignals, totalStories, categories, hotspots, clusters, growing] = await Promise.all([
    getTopSignals(hours),
    getTotalSignalCount(hours),
    getTotalStoryCount(hours),
    getCategoryBreakdown(hours),
    getGeographicHotspots(hours),
    getRecentClusters(),
    getGrowingStories(hours).catch(() => [] as BriefingSignal[]),
  ])
  const lists = briefingLists(signals, growing)

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
      total_stories: 0,
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
  const prompt = buildBriefingPrompt(lists, categories, hotspots, totalSignals, totalStories, hours)
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
    total_stories: totalStories,
    total_clusters: clusters.length,
    executive_summary,
    sections,
    key_developments,
    category_breakdown: categories,
    geographic_hotspots: hotspots,
    threat_assessment,
    outlook,
    // verified stories first (plan 9)
    top_signals: [...lists.verified, ...signals.filter(x => !lists.verified.includes(x))].slice(0, 10),
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
      total_stories: briefing.total_stories,
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
  /** (briefings from before Oct 13, 2026 don't have it) */
  total_stories?: number
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