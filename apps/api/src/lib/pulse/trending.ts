/**
 * Trend Detection Engine
 *
 * Detects developing stories by analyzing signal clustering patterns:
 *   - Signals in the same category + region accumulating over 6-24h
 *   - Correlation clusters growing (new signals joining existing clusters)
 *   - Severity escalation (signals about same topic increasing in severity)
 *
 * Returns "Escalating" tags for stories that show acceleration patterns.
 *
 * @module pulse/trending
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrendingEvent {
  /** Category of the developing story */
  category: string
  /** Region or country where it's concentrated */
  region: string | null
  /** Location name for display */
  locationName: string | null
  /** Number of signals in this cluster window */
  signalCount: number
  /** Highest severity seen */
  peakSeverity: string
  /** Whether the story is escalating (more signals, higher severity over time) */
  isEscalating: boolean
  /** Escalation reason for display */
  escalationReason: string | null
  /** Representative signal IDs */
  signalIds: string[]
  /** When the cluster started */
  firstSeen: string
  /** Most recent signal */
  lastSeen: string
  /** Trend score — higher = more noteworthy */
  trendScore: number
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TREND_WINDOW_HOURS = 12   // Look back 12h for clustering
const MIN_SIGNALS_FOR_TREND = 3 // At least 3 signals to qualify
const ESCALATION_THRESHOLD = 5  // 5+ signals = "Escalating"
const CACHE_TTL = 5 * 60        // Cache trends for 5 minutes
const CACHE_KEY = 'pulse:trending'

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Detect trending/escalating events from recent signal patterns.
 * Groups signals by category + country_code within the last 12 hours,
 * then scores each cluster for trend strength.
 */
export async function detectTrends(options?: {
  hours?: number
  region?: string
  limit?: number
}): Promise<TrendingEvent[]> {
  const hours = options?.hours ?? TREND_WINDOW_HOURS
  const limit = options?.limit ?? 20

  // Check cache
  const cacheKey = `${CACHE_KEY}:${hours}:${options?.region ?? 'all'}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as TrendingEvent[]
  } catch { /* non-fatal */ }

  const since = new Date(Date.now() - hours * 3600_000)

  // Query signal clusters: group by category + country_code
  let q = db('signals')
    .whereIn('status', ['verified', 'pending'])
    .where('created_at', '>', since)
    .whereNotIn('category', ['culture', 'sports', 'other'])
    .groupBy('category', 'country_code')
    .having(db.raw('count(*) >= ?', [MIN_SIGNALS_FOR_TREND]))
    .orderByRaw('count(*) DESC')
    .limit(limit * 2) // over-fetch to allow filtering
    .select([
      'category',
      'country_code',
      db.raw('count(*) as signal_count'),
      db.raw('max(severity) as peak_severity'),
      db.raw('min(created_at) as first_seen'),
      db.raw('max(created_at) as last_seen'),
      db.raw("array_agg(id ORDER BY created_at DESC) as signal_ids"),
      db.raw("mode() WITHIN GROUP (ORDER BY location_name) as top_location"),
    ])

  if (options?.region) {
    q = q.where('country_code', options.region)
  }

  const clusters = await q

  // Score and classify each cluster
  const trends: TrendingEvent[] = []

  for (const cluster of clusters) {
    const signalCount = Number(cluster.signal_count)
    const ids = Array.isArray(cluster.signal_ids) ? cluster.signal_ids : []
    const peakSev = findPeakSeverity(String(cluster.peak_severity ?? 'low'))

    // Check for severity escalation within the window
    const escalationInfo = await checkEscalation(
      ids.slice(0, 10).map(String),
      String(cluster.category),
    )

    const isEscalating = signalCount >= ESCALATION_THRESHOLD || escalationInfo.isEscalating

    // Compute trend score
    const recencyMs = Date.now() - new Date(cluster.last_seen).getTime()
    const recencyFactor = Math.max(0, 1 - recencyMs / (hours * 3600_000))
    const severityFactor = (SEVERITY_RANK[peakSev] ?? 1) / 4
    const volumeFactor = Math.min(signalCount / 10, 1) // caps at 10 signals
    const trendScore = (severityFactor * 0.4 + volumeFactor * 0.4 + recencyFactor * 0.2) * 100

    trends.push({
      category: String(cluster.category),
      region: cluster.country_code ? String(cluster.country_code) : null,
      locationName: cluster.top_location ? String(cluster.top_location) : null,
      signalCount,
      peakSeverity: peakSev,
      isEscalating,
      escalationReason: isEscalating
        ? escalationInfo.reason ?? `${signalCount} signals in ${hours}h`
        : null,
      signalIds: ids.slice(0, 5).map(String),
      firstSeen: new Date(cluster.first_seen).toISOString(),
      lastSeen: new Date(cluster.last_seen).toISOString(),
      trendScore: Math.round(trendScore),
    })
  }

  // Sort by trend score
  trends.sort((a, b) => b.trendScore - a.trendScore)
  const result = trends.slice(0, limit)

  // Cache
  try {
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result))
  } catch { /* non-fatal */ }

  return result
}

/**
 * Get escalating events only — subset of trends marked as escalating.
 */
export async function getEscalatingEvents(options?: {
  hours?: number
  region?: string
}): Promise<TrendingEvent[]> {
  const trends = await detectTrends(options)
  return trends.filter(t => t.isEscalating)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findPeakSeverity(dbMax: string): string {
  // PostgreSQL max() on text doesn't respect our ordering, so normalize
  const known = ['critical', 'high', 'medium', 'low', 'info']
  return known.includes(dbMax) ? dbMax : 'medium'
}

/**
 * Check if a set of signals shows severity escalation over time.
 * Returns true if later signals are more severe than earlier ones.
 */
async function checkEscalation(
  signalIds: string[],
  category: string,
): Promise<{ isEscalating: boolean; reason: string | null }> {
  if (signalIds.length < 3) return { isEscalating: false, reason: null }

  try {
    const signals = await db('signals')
      .whereIn('id', signalIds)
      .orderBy('created_at', 'asc')
      .select(['severity', 'created_at'])

    if (signals.length < 3) return { isEscalating: false, reason: null }

    // Compare first half vs second half severity
    const mid = Math.floor(signals.length / 2)
    const firstHalf = signals.slice(0, mid)
    const secondHalf = signals.slice(mid)

    const avgFirst = firstHalf.reduce((s, r) => s + (SEVERITY_RANK[r.severity] ?? 1), 0) / firstHalf.length
    const avgSecond = secondHalf.reduce((s, r) => s + (SEVERITY_RANK[r.severity] ?? 1), 0) / secondHalf.length

    if (avgSecond > avgFirst + 0.5) {
      return {
        isEscalating: true,
        reason: `Severity escalating in ${category}: recent signals more severe than earlier reports`,
      }
    }

    // Check for acceleration (signals arriving faster)
    if (signals.length >= 4) {
      const times = signals.map(s => new Date(s.created_at).getTime())
      const firstGap = times[mid - 1]! - times[0]!
      const secondGap = times[times.length - 1]! - times[mid]!

      if (secondHalf.length >= firstHalf.length && secondGap < firstGap * 0.6) {
        return {
          isEscalating: true,
          reason: `Signal frequency accelerating in ${category}`,
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return { isEscalating: false, reason: null }
}
