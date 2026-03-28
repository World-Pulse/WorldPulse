/**
 * search-latency.ts
 *
 * Gate 3 — Search Latency Hardening (p95 < 200ms)
 *
 * Provides:
 *  - recordSearchLatency(ms)   — persist a sample to the rolling window
 *  - getSearchPercentiles()    — compute p50/p95/p99 from the last N samples
 *  - getSearchAvgLatencyMs()   — 5-minute rolling average for the /health endpoint
 *  - maybeLogPercentiles(log)  — log p50/p95/p99 every 100 requests
 *
 * Storage (Redis):
 *  search:latency:samples      — List<number> trimmed to WINDOW_SIZE, newest at right
 *  search:latency:req_count    — INCR counter; used to trigger logging every 100 reqs
 *  search:latency:5min:avg     — String "avg_ms" with 5-minute TTL; refreshed each req
 */

import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

const SAMPLES_KEY   = 'search:latency:samples'
const COUNT_KEY     = 'search:latency:req_count'
const AVG_5MIN_KEY  = 'search:latency:5min:avg'

/** Rolling window size — last 200 samples are kept for percentile calculation */
const WINDOW_SIZE   = 200

/** How many requests between p50/p95/p99 log emissions */
const LOG_EVERY     = 100

/** TTL for the 5-minute average key (seconds) */
const AVG_TTL_S     = 300

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a single search latency sample (in milliseconds).
 * Also refreshes the 5-minute rolling average key.
 *
 * Fire-and-forget: all Redis errors are swallowed so this never affects
 * the main request path latency.
 */
export function recordSearchLatency(ms: number): void {
  // Use pipeline for atomicity and minimal round-trips
  ;(async () => {
    try {
      const pipeline = redis.pipeline()

      // 1. Append to rolling window, trim to WINDOW_SIZE
      pipeline.rpush(SAMPLES_KEY, String(ms))
      pipeline.ltrim(SAMPLES_KEY, -WINDOW_SIZE, -1)

      // 2. Increment request counter
      pipeline.incr(COUNT_KEY)

      await pipeline.exec()

      // 3. Refresh 5-minute rolling average (separate pipeline to get INCR result)
      //    Read current avg (if any), compute EMA, write back with TTL
      const prevAvgStr = await redis.get(AVG_5MIN_KEY)
      const prevAvg    = prevAvgStr !== null ? parseFloat(prevAvgStr) : ms

      // Exponential moving average α = 0.1 (smooth, 5-min window feel)
      const newAvg = prevAvg + 0.1 * (ms - prevAvg)
      await redis.setex(AVG_5MIN_KEY, AVG_TTL_S, newAvg.toFixed(2))
    } catch {
      // Fire-and-forget — never propagate
    }
  })()
}

/**
 * Compute p50, p95, p99 from the current rolling window.
 * Returns null if no samples are available.
 */
export async function getSearchPercentiles(): Promise<{
  p50: number
  p95: number
  p99: number
  sampleCount: number
} | null> {
  try {
    const raw = await redis.lrange(SAMPLES_KEY, 0, -1)
    if (raw.length === 0) return null

    const samples = raw.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
    return {
      p50:         percentile(samples, 50),
      p95:         percentile(samples, 95),
      p99:         percentile(samples, 99),
      sampleCount: samples.length,
    }
  } catch {
    return null
  }
}

/**
 * Returns the 5-minute rolling average search latency in ms, or null if
 * there are no recent samples (key expired / Redis unavailable).
 */
export async function getSearchAvgLatencyMs(): Promise<number | null> {
  try {
    const val = await redis.get(AVG_5MIN_KEY)
    if (val === null) return null
    const parsed = parseFloat(val)
    return isNaN(parsed) ? null : Math.round(parsed)
  } catch {
    return null
  }
}

/**
 * Called after each search request.
 * Every LOG_EVERY requests: fetch the rolling window, compute p50/p95/p99,
 * and emit a structured log line via the provided Pino logger.
 */
export async function maybeLogPercentiles(
  log: { info: (obj: Record<string, unknown>, msg: string) => void },
): Promise<void> {
  try {
    const count = await redis.get(COUNT_KEY)
    if (count === null) return

    const n = parseInt(count, 10)
    if (isNaN(n) || n % LOG_EVERY !== 0) return

    const percs = await getSearchPercentiles()
    if (!percs) return

    log.info(
      {
        metric:        'search_latency_percentiles',
        p50_ms:        percs.p50,
        p95_ms:        percs.p95,
        p99_ms:        percs.p99,
        sample_count:  percs.sampleCount,
        req_count:     n,
        gate3_target:  'p95 < 200ms',
        gate3_pass:    percs.p95 < 200,
      },
      `[Search Latency] p50=${percs.p50}ms p95=${percs.p95}ms p99=${percs.p99}ms (n=${percs.sampleCount})`,
    )
  } catch {
    // Never propagate — this is observability, not critical path
  }
}
