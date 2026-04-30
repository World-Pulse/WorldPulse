/**
 * Pattern Detection — Discovers recurring patterns, causal chains,
 * geographic hotspots, and cross-cluster bridges from signal data.
 *
 * Three detection modes:
 *   1. Causal chains — sequences of signals that suggest cause → effect
 *   2. Geographic hotspots — regions with anomalously high activity
 *   3. Cross-cluster bridges — signals connecting otherwise separate event threads
 *
 * Runs every 2 hours. Results cached to Redis for the Cortex HUD.
 *
 * @module pipeline/pattern-detection
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

// ─── Config ─────────────────────────────────────────────────────────────────

const LOOKBACK_HOURS = 168          // 7 days of signal data
const CAUSAL_WINDOW_HOURS = 48      // Max gap between cause → effect
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
  link_type: string     // e.g. "category_sequence", "tag_overlap", "geo_proximity"
  delay_hours: number
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
  ['natural-disaster', 'humanitarian', 'disaster_response'],
  ['conflict', 'humanitarian', 'conflict_displacement'],
  ['political', 'economic', 'policy_impact'],
  ['economic', 'political', 'economic_pressure'],
  ['health', 'economic', 'health_economic_impact'],
  ['environmental', 'health', 'environmental_health'],
  ['technology', 'security', 'tech_security_risk'],
  ['conflict', 'security', 'conflict_escalation'],
  ['natural-disaster', 'economic', 'disaster_economic_impact'],
  ['political', 'conflict', 'political_instability'],
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

    // Run all three detectors in parallel
    const [causalChains, hotspots, bridges] = await Promise.all([
      detectCausalChains(),
      detectGeographicHotspots(),
      detectCrossClusterBridges(),
    ])

    const report: PatternReport = {
      causal_chains: causalChains,
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
      geographic_hotspots: [],
      cross_cluster_bridges: [],
      generated_at: new Date().toISOString(),
      lookback_hours: LOOKBACK_HOURS,
      signals_analyzed: signalsAnalyzed,
    }
  }
}

// ─── Causal Chain Detection ─────────────────────────────────────────────────

/**
 * Detect cause → effect relationships between signals.
 * Uses known causal category pairs + geographic/tag proximity.
 */
async function detectCausalChains(): Promise<CausalChain[]> {
  const chains: CausalChain[] = []

  try {
    for (const [causeCategory, effectCategory, linkType] of CAUSAL_PAIRS) {
      const result = await db.raw(`
        SELECT
          s1.id as cause_id, s1.title as cause_title, s1.category as cause_cat,
          s1.created_at as cause_time, s1.country_code as cause_country,
          s1.tags as cause_tags,
          s2.id as effect_id, s2.title as effect_title, s2.category as effect_cat,
          s2.created_at as effect_time, s2.country_code as effect_country,
          s2.tags as effect_tags,
          EXTRACT(EPOCH FROM (s2.created_at - s1.created_at)) / 3600 as delay_hours
        FROM signals s1
        JOIN signals s2 ON s2.category = $2
          AND s2.created_at > s1.created_at
          AND s2.created_at <= s1.created_at + INTERVAL '${CAUSAL_WINDOW_HOURS} hours'
          AND s2.id != s1.id
        WHERE s1.category = $1
          AND s1.created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
          AND s1.status IN ('verified', 'pending')
          AND s2.status IN ('verified', 'pending')
          AND (s1.country_code = s2.country_code OR s1.region = s2.region)
        ORDER BY s1.created_at DESC
        LIMIT 20
      `, [causeCategory, effectCategory])

      for (const row of result.rows ?? []) {
        // Compute confidence based on multiple factors
        const causeTags = row.cause_tags ?? []
        const effectTags = row.effect_tags ?? []
        const tagOverlap = causeTags.filter((t: string) => effectTags.includes(t)).length
        const geoMatch = row.cause_country === row.effect_country ? 0.2 : 0

        const confidence = Math.min(1,
          0.3 +                                      // Base: known causal pair
          geoMatch +                                  // Geographic proximity
          Math.min(0.3, tagOverlap * 0.1) +          // Tag overlap
          (row.delay_hours < 12 ? 0.1 : 0) +         // Temporal proximity bonus
          0                                            // Future: embedding similarity
        )

        if (confidence >= 0.4) {
          chains.push({
            id: `${row.cause_id}_${row.effect_id}`,
            cause: {
              signal_id: row.cause_id,
              title: row.cause_title,
              category: row.cause_cat,
              created_at: row.cause_time?.toISOString?.() ?? row.cause_time,
            },
            effect: {
              signal_id: row.effect_id,
              title: row.effect_title,
              category: row.effect_cat,
              created_at: row.effect_time?.toISOString?.() ?? row.effect_time,
            },
            confidence: Math.round(confidence * 1000) / 1000,
            link_type: linkType,
            delay_hours: Math.round(Number(row.delay_hours) * 10) / 10,
          })
        }
      }
    }

    // Deduplicate — keep highest confidence per cause-effect pair
    const deduped = new Map<string, CausalChain>()
    for (const chain of chains) {
      const key = `${chain.cause.signal_id}:${chain.effect.signal_id}`
      const existing = deduped.get(key)
      if (!existing || chain.confidence > existing.confidence) {
        deduped.set(key, chain)
      }
    }

    return Array.from(deduped.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 50)

  } catch (err) {
    logger.warn({ err }, '[PATTERNS] Causal chain detection failed')
    return []
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
            AND (region = $1 OR country_code = $1)
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 1 WHEN 'high' THEN 2
              WHEN 'medium' THEN 3 ELSE 4 END,
            created_at DESC
          LIMIT 5
        `, [region.region])

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
        WHERE ets.thread_id = ANY($1)
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
