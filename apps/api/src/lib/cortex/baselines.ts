/**
 * Statistical Baselines Engine — Phase 1.6.1
 *
 * Computes daily signal counts by category × region × severity,
 * stores rolling averages, and detects z-score anomalies.
 *
 * Designed to run nightly (3am UTC) but safe to call any time.
 *
 * @module cortex/baselines
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BaselineRow {
  date: string
  category: string
  region: string
  severity: string
  signal_count: number
  avg_reliability: number
  corroborated_count: number
  day_of_week: number
}

export interface AnomalyDetection {
  category: string
  region: string
  current_count: number
  baseline_avg: number
  baseline_stddev: number
  z_score: number
  direction: 'above' | 'below'
  window: string
}

export interface BaselineStats {
  avg_7d: number
  avg_30d: number
  avg_90d: number
  stddev_7d: number
  stddev_30d: number
  stddev_90d: number
  day_of_week_avg: number   // average for this specific day of week
  current: number
  z_score_7d: number
  z_score_30d: number
  trend: 'rising' | 'stable' | 'falling'
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ANOMALY_Z_THRESHOLD = 2.0       // Flag when ≥ 2σ above/below
const BASELINE_CACHE_TTL  = 3600      // 1 hour cache
const BASELINE_CACHE_PREFIX = 'cortex:baseline:'

// ─── Compute daily baselines ─────────────────────────────────────────────────

/**
 * Compute and store baselines for a given date (defaults to yesterday).
 *
 * Groups signals by category × region × severity and stores counts.
 * Also stores an "all" severity aggregate per category × region.
 */
export async function computeDailyBaselines(
  targetDate?: Date,
): Promise<{ rows_inserted: number }> {
  const date = targetDate ?? new Date(Date.now() - 24 * 3600 * 1000)
  const dateStr = date.toISOString().slice(0, 10)
  const dayOfWeek = date.getDay() // 0=Sunday

  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + 1)
  const nextDateStr = nextDate.toISOString().slice(0, 10)

  console.log(`[CORTEX] Computing baselines for ${dateStr}...`)

  // Get signal counts grouped by category × location_name × severity
  // Use country_code or location_name as region, falling back to 'global'
  const rows = await db('signals')
    .select(
      'category',
      'severity',
      db.raw("LEFT(COALESCE(NULLIF(TRIM(location_name), ''), 'global'), 200) as region"),
    )
    .count('* as signal_count')
    .avg('reliability_score as avg_reliability')
    .select(db.raw("COALESCE(SUM(CASE WHEN source_count >= 2 THEN 1 ELSE 0 END), 0) as corroborated_count"))
    .where('created_at', '>=', `${dateStr}T00:00:00Z`)
    .where('created_at', '<', `${nextDateStr}T00:00:00Z`)
    .whereIn('status', ['verified', 'pending'])
    .groupBy('category', 'severity', db.raw("LEFT(COALESCE(NULLIF(TRIM(location_name), ''), 'global'), 200)"))

  if (rows.length === 0) {
    console.log(`[CORTEX] No signals found for ${dateStr}`)
    return { rows_inserted: 0 }
  }

  // Also compute "all" severity aggregates per category × region
  const allSevRows = await db('signals')
    .select(
      'category',
      db.raw("'all' as severity"),
      db.raw("LEFT(COALESCE(NULLIF(TRIM(location_name), ''), 'global'), 200) as region"),
    )
    .count('* as signal_count')
    .avg('reliability_score as avg_reliability')
    .select(db.raw("COALESCE(SUM(CASE WHEN source_count >= 2 THEN 1 ELSE 0 END), 0) as corroborated_count"))
    .where('created_at', '>=', `${dateStr}T00:00:00Z`)
    .where('created_at', '<', `${nextDateStr}T00:00:00Z`)
    .whereIn('status', ['verified', 'pending'])
    .groupBy('category', db.raw("LEFT(COALESCE(NULLIF(TRIM(location_name), ''), 'global'), 200)"))

  // Global aggregates (all regions) per category
  const globalRows = await db('signals')
    .select(
      'category',
      db.raw("'all' as severity"),
      db.raw("'global' as region"),
    )
    .count('* as signal_count')
    .avg('reliability_score as avg_reliability')
    .select(db.raw("COALESCE(SUM(CASE WHEN source_count >= 2 THEN 1 ELSE 0 END), 0) as corroborated_count"))
    .where('created_at', '>=', `${dateStr}T00:00:00Z`)
    .where('created_at', '<', `${nextDateStr}T00:00:00Z`)
    .whereIn('status', ['verified', 'pending'])
    .groupBy('category')

  const allRows = [...rows, ...allSevRows, ...globalRows].map((r: any) => ({
    date: dateStr,
    category: r.category,
    region: r.region,
    severity: r.severity,
    signal_count: Number(r.signal_count),
    avg_reliability: Number(r.avg_reliability ?? 0),
    corroborated_count: Number(r.corroborated_count ?? 0),
    day_of_week: dayOfWeek,
  }))

  // Upsert — on conflict update
  for (const row of allRows) {
    await db('signal_baselines')
      .insert(row)
      .onConflict(['date', 'category', 'region', 'severity'])
      .merge()
  }

  console.log(`[CORTEX] Stored ${allRows.length} baseline rows for ${dateStr}`)
  return { rows_inserted: allRows.length }
}

// ─── Rolling averages & z-scores ─────────────────────────────────────────────

/**
 * Get rolling baseline stats for a category × region combination.
 */
export async function getBaselineStats(
  category: string,
  region: string = 'global',
  severity: string = 'all',
): Promise<BaselineStats | null> {
  const cacheKey = `${BASELINE_CACHE_PREFIX}${category}:${region}:${severity}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) return JSON.parse(cached)

  const today = new Date().toISOString().slice(0, 10)
  const dayOfWeek = new Date().getDay()

  // Get last 90 days of baselines
  const rows = await db('signal_baselines')
    .select('date', 'signal_count', 'day_of_week')
    .where('category', category)
    .where('region', region)
    .where('severity', severity)
    .where('date', '>=', db.raw("CURRENT_DATE - INTERVAL '90 days'"))
    .orderBy('date', 'desc')

  if (rows.length < 3) return null // Not enough data for meaningful stats

  const counts = rows.map((r: any) => Number(r.signal_count))
  const last7  = counts.slice(0, 7)
  const last30 = counts.slice(0, 30)
  const last90 = counts

  // Same day-of-week average (for seasonality)
  const sameDayRows = rows.filter((r: any) => r.day_of_week === dayOfWeek)
  const sameDayCounts = sameDayRows.map((r: any) => Number(r.signal_count))

  const avg7  = mean(last7)
  const avg30 = mean(last30)
  const avg90 = mean(last90)
  const std7  = stddev(last7)
  const std30 = stddev(last30)
  const std90 = stddev(last90)
  const dowAvg = sameDayCounts.length > 0 ? mean(sameDayCounts) : avg30

  // Get today's count so far
  const todayResult = await db('signals')
    .where('category', category)
    .where(region !== 'global' ? { location_name: region } : {})
    .where(severity !== 'all' ? { severity } : {})
    .where('created_at', '>=', `${today}T00:00:00Z`)
    .whereIn('status', ['verified', 'pending'])
    .count('* as count')
    .first()

  const current = Number((todayResult as any)?.count ?? 0)

  // Z-scores (using 30d baseline as primary)
  const z7  = std7  > 0 ? (current - avg7)  / std7  : 0
  const z30 = std30 > 0 ? (current - avg30) / std30 : 0

  // Trend: compare last 3 days avg vs previous 3 days avg
  const recent3 = counts.length >= 3 ? mean(counts.slice(0, 3)) : current
  const prev3   = counts.length >= 6 ? mean(counts.slice(3, 6)) : avg30
  const trend: 'rising' | 'stable' | 'falling' =
    recent3 > prev3 * 1.15 ? 'rising' :
    recent3 < prev3 * 0.85 ? 'falling' :
    'stable'

  const stats: BaselineStats = {
    avg_7d: round2(avg7),
    avg_30d: round2(avg30),
    avg_90d: round2(avg90),
    stddev_7d: round2(std7),
    stddev_30d: round2(std30),
    stddev_90d: round2(std90),
    day_of_week_avg: round2(dowAvg),
    current,
    z_score_7d: round2(z7),
    z_score_30d: round2(z30),
    trend,
  }

  await redis.setex(cacheKey, BASELINE_CACHE_TTL, JSON.stringify(stats)).catch(() => {})
  return stats
}

// ─── Anomaly detection ───────────────────────────────────────────────────────

/**
 * Scan all category × region combinations for z-score anomalies.
 * Runs after daily baseline computation.
 */
export async function detectAnomalies(
  targetDate?: Date,
): Promise<AnomalyDetection[]> {
  const date = targetDate ?? new Date(Date.now() - 24 * 3600 * 1000)
  const dateStr = date.toISOString().slice(0, 10)

  console.log(`[CORTEX] Scanning for anomalies on ${dateStr}...`)

  // Get today's baselines
  const todayRows = await db('signal_baselines')
    .where('date', dateStr)
    .where('severity', 'all')     // Check at the aggregate level
    .select('category', 'region', 'signal_count')

  const anomalies: AnomalyDetection[] = []

  for (const row of todayRows as any[]) {
    // Compare against 30-day rolling baseline
    const histRows = await db('signal_baselines')
      .where('category', row.category)
      .where('region', row.region)
      .where('severity', 'all')
      .where('date', '<', dateStr)
      .where('date', '>=', db.raw(`'${dateStr}'::date - INTERVAL '30 days'`))
      .select('signal_count')

    if (histRows.length < 5) continue // Need minimum history

    const histCounts = (histRows as any[]).map(r => Number(r.signal_count))
    const avg = mean(histCounts)
    const std = stddev(histCounts)

    if (std === 0) continue // No variance = no anomalies

    const current = Number(row.signal_count)
    const zScore = (current - avg) / std

    if (Math.abs(zScore) >= ANOMALY_Z_THRESHOLD) {
      const anomaly: AnomalyDetection = {
        category: row.category,
        region: row.region,
        current_count: current,
        baseline_avg: round2(avg),
        baseline_stddev: round2(std),
        z_score: round2(zScore),
        direction: zScore > 0 ? 'above' : 'below',
        window: '30d',
      }
      anomalies.push(anomaly)

      // Persist to anomalies table
      await db('signal_anomalies')
        .insert({
          date: dateStr,
          category: row.category,
          region: row.region,
          current_count: current,
          baseline_avg: round2(avg),
          baseline_stddev: round2(std),
          z_score: round2(zScore),
          direction: zScore > 0 ? 'above' : 'below',
          window: '30d',
        })
        .onConflict()
        .ignore()
    }
  }

  if (anomalies.length > 0) {
    console.log(`[CORTEX] Detected ${anomalies.length} anomalies:`)
    for (const a of anomalies) {
      console.log(`  ${a.category}/${a.region}: ${a.current_count} signals (${a.z_score}σ ${a.direction} 30d baseline of ${a.baseline_avg})`)
    }
  } else {
    console.log('[CORTEX] No anomalies detected')
  }

  return anomalies
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * Backfill baselines for the last N days.
 * Useful on first install or after data recovery.
 */
export async function backfillBaselines(days: number = 30): Promise<void> {
  console.log(`[CORTEX] Backfilling baselines for last ${days} days...`)
  for (let i = days; i >= 1; i--) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000)
    await computeDailyBaselines(date)
  }
  console.log(`[CORTEX] Backfill complete`)
}

// ─── Run full nightly cycle ──────────────────────────────────────────────────

/**
 * Full nightly baseline cycle:
 * 1. Compute yesterday's baselines
 * 2. Detect anomalies against 30-day history
 * 3. Clear baseline cache
 */
export async function runNightlyBaselines(): Promise<{
  baselines_stored: number
  anomalies_detected: number
}> {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)

  const { rows_inserted } = await computeDailyBaselines(yesterday)
  const anomalies = await detectAnomalies(yesterday)

  // Clear cached baseline stats so fresh queries pick up new data
  const keys = await redis.keys(`${BASELINE_CACHE_PREFIX}*`).catch(() => [] as string[])
  if (keys.length > 0) {
    await redis.del(...keys).catch(() => {})
  }

  console.log(`[CORTEX] Nightly baselines complete: ${rows_inserted} rows, ${anomalies.length} anomalies`)

  return {
    baselines_stored: rows_inserted,
    anomalies_detected: anomalies.length,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
