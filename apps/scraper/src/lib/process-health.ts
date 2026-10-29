/**
 * Process-level health heartbeat and crash recording.
 *
 * Redis keys:
 *   scraper:process   — hash, updated every intervalMs; TTL = intervalMs * 3 ms
 *   scraper:last_crash — string (JSON), written on crash; TTL 7 days
 *   scraper:memory:history — list (JSON), a memory sample every 5 minutes, newest first, 4 hours kept
 */

import os from 'os'
import v8 from 'v8'
import { redis } from './redis.js'

const PROCESS_KEY    = 'scraper:process'
const LAST_CRASH_KEY = 'scraper:last_crash'
const CRASH_TTL_S    = 7 * 24 * 60 * 60   // 7 days in seconds
export const MEMORY_HISTORY_KEY = 'scraper:memory:history'
const HISTORY_EVERY_MS = 5 * 60_000
const HISTORY_KEEP     = 48

/**
 * The process's memory in MB (Oct 29, 2026). The scraper grows after each
 * restart (about 900 MB 2 hours after the 9:06 AM one; on Oct 28 it ran 18
 * hours and the server's memory and swap filled), and the status file showed
 * the container's total but not where in the process it was. heap: V8's
 * JavaScript objects, and the heap's limit; external and array_buffers:
 * Buffers and other memory held for JavaScript outside the heap; rss: what is
 * in memory now (pages pushed to swap don't count, the heap sizes do).
 */
export function memoryNow(): Record<string, number> {
  const m = process.memoryUsage()
  const mb = (n: number): number => Math.round(n / 1_048_576)
  return {
    rss_mb:           mb(m.rss),
    heap_used_mb:     mb(m.heapUsed),
    heap_total_mb:    mb(m.heapTotal),
    external_mb:      mb(m.external),
    array_buffers_mb: mb(m.arrayBuffers),
    heap_limit_mb:    mb(v8.getHeapStatistics().heap_size_limit),
  }
}

/**
 * Starts a periodic heartbeat that writes process metadata to Redis.
 * Returns the interval timer — pass to stopHeartbeat() on shutdown.
 */
export function startHeartbeat(intervalMs: number = 30_000): ReturnType<typeof setInterval> {
  const startedAt = new Date().toISOString()
  let lastSample = 0

  const writeHeartbeat = async (): Promise<void> => {
    try {
      const memory = memoryNow()
      await redis.hset(PROCESS_KEY, {
        pid:            String(process.pid),
        hostname:       os.hostname(),
        started_at:     startedAt,
        last_heartbeat: new Date().toISOString(),
        status:         'running',
        version:        process.env['npm_package_version'] ?? 'unknown',
        ...Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, String(v)])),
      })
      // pexpire takes milliseconds
      await redis.pexpire(PROCESS_KEY, intervalMs * 3)
      // A sample every 5 minutes, for the growth since this start (scripts/ops-status.sh)
      if (Date.now() - lastSample >= HISTORY_EVERY_MS) {
        lastSample = Date.now()
        await redis.lpush(MEMORY_HISTORY_KEY, JSON.stringify({ at: new Date().toISOString(), started: startedAt, ...memory }))
        await redis.ltrim(MEMORY_HISTORY_KEY, 0, HISTORY_KEEP - 1)
      }
    } catch {
      // non-fatal — process health write failure must never crash the scraper
    }
  }

  // Write immediately, then on every interval
  void writeHeartbeat()
  return setInterval(() => void writeHeartbeat(), intervalMs)
}

/** Stops the heartbeat interval timer. */
export function stopHeartbeat(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer)
}

/**
 * Records a crash into the scraper:process hash and scraper:last_crash key.
 * Completes within 2 seconds (whichever comes first).
 */
export async function recordProcessCrash(
  type:    string,
  message: string,
  stack:   string | undefined,
): Promise<void> {
  const crashAt  = new Date().toISOString()
  const stackStr = (stack ?? '').slice(0, 500)

  const write = async (): Promise<void> => {
    await redis.hset(PROCESS_KEY, {
      status:             'crashed',
      last_crash_type:    type,
      last_crash_message: message,
      last_crash_stack:   stackStr,
      last_crash_at:      crashAt,
    })
    await redis.set(
      LAST_CRASH_KEY,
      JSON.stringify({ type, message, stack: stackStr, crashed_at: crashAt }),
      'EX',
      CRASH_TTL_S,
    )
  }

  await Promise.race([
    write(),
    new Promise<void>(resolve => setTimeout(resolve, 2_000)),
  ])
}

/**
 * Registers uncaughtException and unhandledRejection handlers.
 * Each handler records the crash then exits with code 1.
 * Call this early in the bootstrap, before Kafka/DB connections.
 */
export function registerCrashHandlers(): void {
  process.on('uncaughtException', async (err: Error) => {
    await recordProcessCrash('uncaughtException', err.message, err.stack)
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack   = reason instanceof Error ? reason.stack   : undefined
    await recordProcessCrash('unhandledRejection', message, stack)
    process.exit(1)
  })
}
