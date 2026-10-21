/**
 * Saved alerts checked against every new report (plan 10 and K6; Devon, Oct
 * 21, 2026: alerts "Free for everyone").
 *
 * Found Oct 21: the dispatcher's minute poll asked the API's own list for the
 * 50 newest verified critical and 50 newest verified high reports (the
 * "since" it sent was never read), so a saved alert saw only verified high
 * and critical reports. A Follow alert ("every report naming it, however
 * minor") almost never matched, and nothing medium or low ever did.
 *
 * Now, every minute, straight from the database:
 * - the reports that arrived since the last look (pending or verified, at
 *   the lowest severity any alert asks for, at least a minute old so intake
 *   has placed and filed them), for the alerts that fire on each report;
 * - the reports that became verified, or reached more outlets, at least 10
 *   minutes ago (the cross-check may send a story back to pending in those
 *   minutes), for the alerts that fire on verification (channels.verified,
 *   with channels.min_outlets), each story once.
 * Each look starts where the last one ended (kept in Redis), at most an hour
 * back, so a restart neither misses a minute nor floods anyone.
 */

import type { Signal, SignalSeverity } from '@worldpulse/types'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { alertDispatcher } from './alert-dispatcher'
import { alertWhen } from './alert-match'

const NEW_SINCE_KEY = 'alerts:scan:new:since'
const VERIFIED_SINCE_KEY = 'alerts:scan:verified:since'
const LOCK_KEY = 'alerts:scan:lock'
export const SCAN_EVERY_MS = 60_000
/** A new report waits this long (intake places and files it) */
export const NEW_SETTLE_MS = 60_000
/** A verified story waits this long (the cross-check may send it back) */
export const VERIFIED_SETTLE_MS = 10 * 60_000
/** How far back a look goes at most (after a restart or an outage) */
export const MAX_BACK_MS = 60 * 60_000
/** Reports a look reads at most; the next look carries on from the last one read */
export const BATCH = 2000

const RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }
const SEVERITIES: SignalSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

export interface ReportRow {
  id: string
  title: string
  summary: string | null
  category: string
  severity: SignalSeverity
  status: string
  country_code: string | null
  location_name: string | null
  source_count: number | null
  reliability_score: number | null
  story_id: string | null
  original_urls: string[] | null
  created_at: string | Date
  verified_at: string | Date | null
  last_corroborated_at: string | Date | null
  /** The time the look ordered by: created_at, or when it became verified or gained outlets */
  at: string | Date
}

const iso = (v: string | Date | null): string | null => (v == null ? null : new Date(v).toISOString())

/** A database row as the dispatcher's and the email's report */
export function rowToSignal(r: ReportRow): Signal {
  const created = iso(r.created_at) ?? new Date().toISOString()
  return {
    id: r.id, title: r.title, summary: r.summary ?? '', body: '',
    category: r.category as Signal['category'], severity: r.severity, status: r.status as Signal['status'],
    reliabilityScore: Number(r.reliability_score ?? 0), alertTier: 'ROUTINE',
    sourceCount: Number(r.source_count ?? 1), location: null,
    locationName: r.location_name, countryCode: r.country_code, region: null,
    tags: [], sources: [], originalUrls: Array.isArray(r.original_urls) ? r.original_urls : [],
    language: 'en', viewCount: 0, shareCount: 0, postCount: 0, eventTime: null,
    firstReported: created, verifiedAt: iso(r.verified_at), lastUpdated: created,
    lastCorroboratedAt: iso(r.last_corroborated_at), createdAt: created,
  } as Signal
}

/** Where a look starts: where the last one ended, at most MAX_BACK_MS back */
async function since(key: string, now: number, settle: number, first: number): Promise<number> {
  const kept = Date.parse(await redis.get(key).catch(() => null) ?? '')
  const start = Number.isFinite(kept) ? kept : now - settle - first
  return Math.max(start, now - settle - MAX_BACK_MS)
}

export interface ScanRun { newReports: number; verifiedReports: number; verifiedSent: number; skipped?: string }

/** One look; exported for tests */
export async function scanAlerts(now = Date.now()): Promise<ScanRun> {
  const run: ScanRun = { newReports: 0, verifiedReports: 0, verifiedSent: 0 }
  const subs = await alertDispatcher.loadDbSubscriptions()
  if (subs.length === 0) { run.skipped = 'no alerts'; return run }
  const onReport = subs.filter(s => !alertWhen(s.channels).verified)
  const onVerified = subs.filter(s => alertWhen(s.channels).verified)
  const lowest = (list: typeof subs) => SEVERITIES.filter(sev => list.some(s => (RANK[sev] ?? 0) >= (RANK[s.min_severity] ?? 3)))

  // ── New reports, for the alerts that fire on each one ─────────────────────
  if (onReport.length) {
    const from = await since(NEW_SINCE_KEY, now, NEW_SETTLE_MS, 5 * 60_000)
    const until = now - NEW_SETTLE_MS
    if (until > from) {
      const rows = await db('signals')
        .where('created_at', '>', new Date(from).toISOString())
        .where('created_at', '<=', new Date(until).toISOString())
        .whereIn('status', ['pending', 'verified'])
        .whereIn('severity', lowest(onReport))
        .orderBy('created_at', 'asc')
        .limit(BATCH)
        .select('id', 'title', 'summary', 'category', 'severity', 'status', 'country_code', 'location_name',
          'source_count', 'reliability_score', 'story_id', 'original_urls', 'created_at', 'verified_at',
          'last_corroborated_at', 'created_at as at') as ReportRow[]
      run.newReports = rows.length
      if (rows.length) await alertDispatcher.dispatchDbSubscriptionAlerts(rows.map(rowToSignal))
      // a full batch: the next look carries on from the last report read
      const end = rows.length === BATCH ? new Date(rows[rows.length - 1]!.at).getTime() : until
      await redis.set(NEW_SINCE_KEY, new Date(end).toISOString(), 'EX', 2 * 86_400).catch(() => null)
    }
  }

  // ── Stories verified, or carried by more outlets, for the alerts that wait for it ──
  if (onVerified.length) {
    const from = await since(VERIFIED_SINCE_KEY, now, VERIFIED_SETTLE_MS, 5 * 60_000)
    const until = now - VERIFIED_SETTLE_MS
    if (until > from) {
      const fewest = Math.min(...onVerified.map(s => alertWhen(s.channels).minOutlets))
      const at = 'greatest(verified_at, coalesce(last_corroborated_at, verified_at))'
      const rows = await db('signals')
        .where('status', 'verified')
        // a story first reported days ago and verified only now isn't news to alert on
        .where('created_at', '>', new Date(now - 3 * 86_400_000).toISOString())
        .whereRaw('coalesce(source_count, 1) >= ?', [fewest])
        .whereIn('severity', lowest(onVerified))
        .whereRaw(`${at} > ?`, [new Date(from).toISOString()])
        .whereRaw(`${at} <= ?`, [new Date(until).toISOString()])
        .orderByRaw(`${at} asc`)
        .limit(BATCH)
        .select('id', 'title', 'summary', 'category', 'severity', 'status', 'country_code', 'location_name',
          'source_count', 'reliability_score', 'story_id', 'original_urls', 'created_at', 'verified_at',
          'last_corroborated_at', db.raw(`${at} as at`)) as ReportRow[]
      run.verifiedReports = rows.length
      if (rows.length) {
        run.verifiedSent = await alertDispatcher.dispatchVerifiedAlerts(
          rows.map(r => ({ signal: rowToSignal(r), storyKey: String(r.story_id ?? r.id) })))
      }
      const end = rows.length === BATCH ? new Date(rows[rows.length - 1]!.at).getTime() : until
      await redis.set(VERIFIED_SINCE_KEY, new Date(end).toISOString(), 'EX', 2 * 86_400).catch(() => null)
    }
  }
  return run
}

let timer: ReturnType<typeof setInterval> | null = null

/** Every minute, one look at a time (a look that overruns holds the lock) */
export function startAlertScan(): void {
  if (timer) return
  timer = setInterval(() => {
    void (async () => {
      if (await redis.set(LOCK_KEY, '1', 'EX', 5 * 60, 'NX').catch(() => null) !== 'OK') return
      try {
        const run = await scanAlerts()
        if (run.newReports || run.verifiedReports) logger.debug(run, 'Alert scan')
      } catch (err) {
        logger.warn({ err }, 'Alert scan failed (non-fatal)')
      } finally {
        await redis.del(LOCK_KEY).catch(() => 0)
      }
    })()
  }, SCAN_EVERY_MS)
  timer.unref?.()
}

export function stopAlertScan(): void {
  if (timer) { clearInterval(timer); timer = null }
}
