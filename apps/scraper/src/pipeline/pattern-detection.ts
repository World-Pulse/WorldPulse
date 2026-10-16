/**
 * Pattern Detection — Discovers recurring patterns, causal chains,
 * geographic hotspots, and cross-cluster bridges from signal data.
 *
 * Detection modes:
 *   1. Entity links — stories that name the same specific people, places and
 *      organisations (Oct 15, 2026; pipeline/entity-links.ts)
 *   2. Causal chains — entity links whose categories read as cause → effect, in
 *      time order. They used to link any two reports in related categories from
 *      the same country within 48 hours, so nearly all were coincidence.
 *   3. Geographic hotspots — regions with anomalously high activity
 *   4. Cross-cluster bridges — signals connecting otherwise separate event threads
 *
 * Runs every 2 hours. Results cached to Redis for the Cortex HUD.
 *
 * @module pipeline/pattern-detection
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { buildEntityLinks, loadEntityHits, type EntityLink } from './entity-links'

// ─── Config ─────────────────────────────────────────────────────────────────

const LOOKBACK_HOURS = 168          // 7 days of signal data
const CAUSAL_WINDOW_HOURS = 48      // Max gap between cause → effect
const ENTITY_WINDOW_HOURS = 72      // Stories linked by shared entities: the last 3 days
const HOTSPOT_MIN_SIGNALS = 5       // Minimum signals in a region to qualify
const HOTSPOT_STDDEV_THRESHOLD = 2  // Std devs above mean to flag as hotspot
const BRIDGE_MIN_SHARED_TAGS = 1    // Min shared tags between thread signals
const CACHE_KEY = 'cortex:patterns:latest'
const CACHE_TTL = 7200              // 2 hours

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CausalChain {
  id: string
  cause: { signal_id: string; title: string; category: string; created_at: string }
  effect: { signal_id: string; title: string; category: string; created_at: string }
  confidence: number    // 0-1
  link_type: string     // e.g. "conflict_escalation" (the category pair)
  delay_hours: number
  shared_entities?: string[]
}

export interface GeographicHotspot {
  region: string
  country_code: string
  signal_count: number
  avg_severity_rank: number
  dominant_category: string
  z_score: number       // How many std devs above mean
  signals: Array<{ id: string; title: string; severity: string }>
}

export interface CrossClusterBridge {
  signal_id: string
  signal_title: string
  thread_a: { id: string; title: string; signal_count: number }
  thread_b: { id: string; title: string; signal_count: number }
  shared_tags: string[]
  bridge_score: number  // 0-1
}

export interface PatternReport {
  causal_chains: CausalChain[]
  entity_links: EntityLink[]
  geographic_hotspots: GeographicHotspot[]
  cross_cluster_bridges: CrossClusterBridge[]
  generated_at: string
  lookback_hours: number
  signals_analyzed: number
}

// ─── Severity Ranking ───────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  info: 1, low: 2, medium: 3, high: 4, critical: 5,
}

// ─── Known Causal Category Pairs ────────────────────────────────────────────
// Categories where A frequently precedes B (directional)

const CAUSAL_PAIRS: Array<[string, string, string]> = [
  ['disaster', 'humanitarian', 'disaster_response'],
  ['conflict', 'humanitarian', 'conflict_displacement'],
  ['geopolitics', 'economy', 'policy_impact'],
  ['economy', 'geopolitics', 'economic_pressure'],
  ['health', 'economy', 'health_economic_impact'],
  ['climate', 'health', 'environmental_health'],
  ['technology', 'security', 'tech_security_risk'],
  ['conflict', 'security', 'conflict_escalation'],
  ['disaster', 'economy', 'disaster_economic_impact'],
  ['geopolitics', 'conflict', 'political_instability'],
  ['weather', 'disaster', 'weather_disaster_chain'],
  ['conflict', 'geopolitics', 'conflict_political_fallout'],
]

// ─── Core Detection ─────────────────────────────────────────────────────────

/**
 * Main entry point — runs all three detection modes and caches results.
 */
export async function detectPatterns(): Promise<PatternReport> {
  const start = Date.now()
  let signalsAnalyzed = 0

  try {
    // Count signals in window
    const countResult = await db.raw(`
      SELECT COUNT(*) as count FROM signals
      WHERE created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
        AND status IN ('verified', 'pending')
    `)
    signalsAnalyzed = Number(countResult.rows?.[0]?.count ?? 0)

    // Entity links first (chains come from them), the other two detectors alongside
    const [linked, hotspots, bridges] = await Promise.all([
      detectEntityLinks(),
      detectGeographicHotspots(),
      detectCrossClusterBridges(),
    ])
    const causalChains = linked.chains

    const report: PatternReport = {
      causal_chains: causalChains,
      entity_links: linked.links,
      geographic_hotspots: hotspots,
      cross_cluster_bridges: bridges,
      generated_at: new Date().toISOString(),
      lookback_hours: LOOKBACK_HOURS,
      signals_analyzed: signalsAnalyzed,
    }

    // Cache to Redis for Cortex HUD + metrics.ts
    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(report)).catch(() => {})

    const durationMs = Date.now() - start
    logger.info({
      chains: causalChains.length,
      entityLinks: linked.links.length,
      linkedStories: linked.stories,
      hotspots: hotspots.length,
      bridges: bridges.length,
      signalsAnalyzed,
      durationMs,
    }, '[PATTERNS] Pattern detection complete')

    return report
  } catch (err) {
    logger.error({ err }, '[PATTERNS] Pattern detection failed')
    return {
      causal_chains: [],
      entity_links: [],
      geographic_hotspots: [],
      cross_cluster_bridges: [],
      generated_at: new Date().toISOString(),
      lookback_hours: LOOKBACK_HOURS,
      signals_analyzed: signalsAnalyzed,
    }
  }
}

// ─── Entity Links and Causal Chains ─────────────────────────────────────────

/**
 * Stories linked by the entities they share, and the links that read as
 * cause → effect (a known category pair, in time order, within the window).
 * Nothing, rather than a timing-only guess, when the entity graph can't be read.
 */
async function detectEntityLinks(): Promise<{ links: EntityLink[]; chains: CausalChain[]; stories: number }> {
  try {
    const hits = await loadEntityHits(ENTITY_WINDOW_HOURS)
    const built = buildEntityLinks(hits, { causalPairs: CAUSAL_PAIRS, chainWindowHours: CAUSAL_WINDOW_HOURS })
    return { links: built.links, chains: built.chains, stories: built.stories }
  } catch (err) {
    logger.warn({ err }, '[PATTERNS] Entity link detection failed')
    return { links: [], chains: [], stories: 0 }
  }
}

// ─── Geographic Hotspot Detection ───────────────────────────────────────────

/**
 * Detect regions with anomalously high signal activity.
 * Uses z-score against the mean signal count per region.
 */
async function detectGeographicHotspots(): Promise<GeographicHotspot[]> {
  try {
    // Get signal counts by region in the lookback window
    const regionStats = await db.raw(`
      SELECT
        COALESCE(region, country_code, 'unknown') as region,
        country_code,
        COUNT(*) as signal_count,
        AVG(CASE severity
          WHEN 'critical' THEN 5 WHEN 'high' THEN 4
          WHEN 'medium' THEN 3 WHEN 'low' THEN 2
          ELSE 1 END) as avg_severity_rank,
        MODE() WITHIN GROUP (ORDER BY category) as dominant_category
      FROM signals
      WHERE created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
        AND status IN ('verified', 'pending')
        AND (region IS NOT NULL OR country_code IS NOT NULL)
      GROUP BY COALESCE(region, country_code, 'unknown'), country_code
      HAVING COUNT(*) >= ${HOTSPOT_MIN_SIGNALS}
      ORDER BY COUNT(*) DESC
    `)

    const regions = regionStats.rows ?? []
    if (regions.length < 3) return [] // Need enough data for statistics

    // Compute mean and stddev of signal counts
    const counts = regions.map((r: any) => Number(r.signal_count))
    const mean = counts.reduce((a: number, b: number) => a + b, 0) / counts.length
    const variance = counts.reduce((sum: number, c: number) => sum + (c - mean) ** 2, 0) / counts.length
    const stddev = Math.sqrt(variance) || 1

    const hotspots: GeographicHotspot[] = []

    for (const region of regions) {
      const count = Number(region.signal_count)
      const zScore = (count - mean) / stddev

      if (zScore >= HOTSPOT_STDDEV_THRESHOLD) {
        // Fetch top signals for this hotspot
        const topSignals = await db.raw(`
          SELECT id, title, severity
          FROM signals
          WHERE created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
            AND status IN ('verified', 'pending')
            AND (region = ? OR country_code = ?)
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 1 WHEN 'high' THEN 2
              WHEN 'medium' THEN 3 ELSE 4 END,
            created_at DESC
          LIMIT 5
        `, [region.region, region.region])

        hotspots.push({
          region: region.region ?? region.country_code,
          country_code: region.country_code ?? '',
          signal_count: count,
          avg_severity_rank: Math.round(Number(region.avg_severity_rank) * 100) / 100,
          dominant_category: region.dominant_category ?? 'unknown',
          z_score: Math.round(zScore * 100) / 100,
          signals: (topSignals.rows ?? []).map((s: any) => ({
            id: s.id,
            title: s.title,
            severity: s.severity,
          })),
        })
      }
    }

    return hotspots
      .sort((a, b) => b.z_score - a.z_score)
      .slice(0, 20)

  } catch (err) {
    logger.warn({ err }, '[PATTERNS] Geographic hotspot detection failed')
    return []
  }
}

// ─── Cross-Cluster Bridge Detection ─────────────────────────────────────────

/**
 * Find signals that connect otherwise separate event threads.
 * A "bridge" is a signal whose tags overlap with two or more distinct threads.
 */
async function detectCrossClusterBridges(): Promise<CrossClusterBridge[]> {
  try {
    // Find signals that appear in multiple threads (directly via event_thread_signals)
    // or signals with tags that overlap multiple threads
    const bridgeCandidates = await db.raw(`
      SELECT
        s.id as signal_id,
        s.title as signal_title,
        s.tags as signal_tags,
        array_agg(DISTINCT ets.thread_id) as thread_ids
      FROM signals s
      JOIN event_thread_signals ets ON ets.signal_id = s.id
      WHERE s.created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
      GROUP BY s.id, s.title, s.tags
      HAVING COUNT(DISTINCT ets.thread_id) >= 2
      LIMIT 30
    `)

    const bridges: CrossClusterBridge[] = []

    for (const candidate of bridgeCandidates.rows ?? []) {
      const threadIds = candidate.thread_ids ?? []
      if (threadIds.length < 2) continue

      // Get thread details for the first two threads
      const threads = await db('event_threads')
        .whereIn('id', threadIds.slice(0, 2))
        .select('id', 'title', 'signal_count')

      if (threads.length < 2) continue

      // Compute shared tags between the two threads' signal pools
      const threadTagsResult = await db.raw(`
        SELECT ets.thread_id, array_agg(DISTINCT unnested_tag) as tags
        FROM event_thread_signals ets
        JOIN signals s ON s.id = ets.signal_id
        CROSS JOIN LATERAL unnest(s.tags) AS unnested_tag
        WHERE ets.thread_id = ANY(?)
        GROUP BY ets.thread_id
      `, [threadIds.slice(0, 2)])

      const tagSets: Record<string, string[]> = {}
      for (const row of threadTagsResult.rows ?? []) {
        tagSets[row.thread_id] = row.tags ?? []
      }

      const tagsA = tagSets[threads[0].id] ?? []
      const tagsB = tagSets[threads[1].id] ?? []
      const shared = tagsA.filter(t => tagsB.includes(t))

      if (shared.length >= BRIDGE_MIN_SHARED_TAGS) {
        const bridgeScore = Math.min(1, shared.length * 0.15 + 0.3)

        bridges.push({
          signal_id: candidate.signal_id,
          signal_title: candidate.signal_title,
          thread_a: {
            id: threads[0].id,
            title: threads[0].title,
            signal_count: threads[0].signal_count,
          },
          thread_b: {
            id: threads[1].id,
            title: threads[1].title,
            signal_count: threads[1].signal_count,
          },
          shared_tags: shared.slice(0, 10),
          bridge_score: Math.round(bridgeScore * 1000) / 1000,
        })
      }
    }

    return bridges
      .sort((a, b) => b.bridge_score - a.bridge_score)
      .slice(0, 20)

  } catch (err) {
    logger.warn({ err }, '[PATTERNS] Cross-cluster bridge detection failed')
    return []
  }
}
