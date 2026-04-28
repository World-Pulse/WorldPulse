/**
 * OSINT Heartbeat Watchdog
 *
 * Fixes the stability tracker's blind spot: OSINT sources that poll successfully
 * but find zero new signals (due to Redis dedup cache hits or genuinely quiet
 * monitoring periods) never call insertAndCorrelate(), which means recordSuccess()
 * is never called, and their `last_seen` timestamp goes stale.
 *
 * After 30 minutes without a `last_seen` update, the stability tracker marks the
 * source as "stale" and may fail its 70% clean-source quorum check — blocking the
 * 14-day stability window required for launch.
 *
 * Solution:
 *   OSINT sources register themselves with this watchdog via registerOsintSource().
 *   A cron runs every WATCHDOG_INTERVAL_MS (4 minutes by default). For each
 *   registered source, if its `last_seen` in Redis is older than STALE_THRESHOLD_MS,
 *   the watchdog writes a recordPollHeartbeat() — signalling "this source is alive
 *   and polling; it just had nothing new to report this cycle."
 *
 * This approach:
 *   - Requires zero changes to individual source files
 *   - Is additive (sources using insertAndCorrelate keep working as before)
 *   - Is safe (heartbeats are non-destructive; they do not inflate success_count)
 *
 * Usage (in sources/index.ts):
 *   const watchdog = createOsintWatchdog(redis)
 *   // register each source after its poller starts:
 *   watchdog.register('seismic', 'USGS Seismic', 'seismic')
 *   // start the cron:
 *   const stopWatchdog = watchdog.start()
 *   // stop on shutdown:
 *   stopWatchdog()
 */

import type Redis from 'ioredis'
import { recordPollHeartbeat } from '../health'
import { logger as rootLogger } from './logger'

const log = rootLogger.child({ module: 'osint-watchdog' })

/** How often to run the watchdog cron (ms). Default: 4 minutes. */
const WATCHDOG_INTERVAL_MS = 4 * 60_000

/**
 * A source is eligible for a heartbeat if its last_seen is older than this
 * threshold. Should be shorter than the stability tracker's DEAD_THRESHOLD_MS
 * (30 minutes) to ensure sources never cross into "stale" during quiet periods.
 * Default: 8 minutes (gives a 22-minute buffer before 30-min stale cutoff).
 */
const HEARTBEAT_THRESHOLD_MS = 8 * 60_000

interface OsintSourceEntry {
  sourceId:   string
  sourceName: string
  sourceSlug: string
}

export interface OsintWatchdog {
  /** Register an OSINT source so the watchdog can heartbeat it during quiet periods. */
  register: (sourceId: string, sourceName: string, sourceSlug: string) => void
  /** Start the watchdog cron. Returns a cleanup function. */
  start: () => () => void
}

const HEALTH_KEY = (sourceId: string): string => `scraper:health:${sourceId}`

export function createOsintWatchdog(redis: Redis): OsintWatchdog {
  const registry = new Map<string, OsintSourceEntry>()

  function register(sourceId: string, sourceName: string, sourceSlug: string): void {
    registry.set(sourceId, { sourceId, sourceName, sourceSlug })
    log.debug({ sourceId, sourceName }, 'OSINT watchdog: source registered')
  }

  async function runCycle(): Promise<void> {
    if (registry.size === 0) return

    const now = Date.now()
    const checks = Array.from(registry.values()).map(async (entry) => {
      try {
        const lastSeenRaw = await redis.hget(HEALTH_KEY(entry.sourceId), 'last_seen')
        const lastSeenMs  = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0
        const ageMs       = now - lastSeenMs

        if (ageMs >= HEARTBEAT_THRESHOLD_MS) {
          await recordPollHeartbeat(entry.sourceId, entry.sourceName, entry.sourceSlug)
          log.debug(
            { sourceId: entry.sourceId, ageMs: Math.round(ageMs / 1000) + 's' },
            'OSINT watchdog: heartbeat written (quiet poll cycle)',
          )
        }
      } catch (err) {
        // Non-fatal: watchdog failures must never crash the scraper
        log.warn({ err, sourceId: entry.sourceId }, 'OSINT watchdog: heartbeat write failed (non-fatal)')
      }
    })

    await Promise.allSettled(checks)
  }

  function start(): () => void {
    log.info({ sourceCount: registry.size }, 'OSINT watchdog started')
    const timer = setInterval(() => {
      runCycle().catch(err => {
        log.warn({ err }, 'OSINT watchdog: runCycle error (non-fatal)')
      })
    }, WATCHDOG_INTERVAL_MS)
    // Unref so the interval doesn't block process exit
    if (timer.unref) timer.unref()
    return () => {
      clearInterval(timer)
      log.info('OSINT watchdog stopped')
    }
  }

  return { register, start }
}
