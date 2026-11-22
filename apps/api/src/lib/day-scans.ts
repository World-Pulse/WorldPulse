/**
 * A window of days read one day at a time, each day's rows kept in Redis (Nov 22, 2026).
 *
 * Three AI tools (chokepoints_news, cyber_attacks, us_weather_alerts) read a week of reports in one query: about
 * 25 seconds on a quiet day, past 2 minutes on Nov 22 morning (the server's load at 24 on its 2 CPUs after a
 * deploy), so every try failed, and each failed try cost the database its whole time limit. Read as days instead:
 * a past day is read until it has settled and then kept (read again at most hourly in its first 6 hours, while its
 * reports are still being verified), and today is read again only when today's read is older than `todaySeconds`.
 * So a remake reads hours of reports, not a week. Days are read one after another, and each day read is kept even
 * when a later one fails, so on a slow day every try gets further than the last.
 */
import type { Knex } from 'knex'
import { redis } from '../db/redis'
import { longQuery } from './long-query'

export const DAY_MS = 86_400_000
/** A past day is read again, at most every UNSETTLED_EVERY_MS, until this long after it ended */
export const SETTLE_MS = 6 * 3_600_000
export const UNSETTLED_EVERY_MS = 3_600_000
/** Days are kept this long after they end: the longest window a tool asks for (30 days) and a little more */
export const KEEP_DAYS = 32

export interface DayScan<R> {
  /** Redis key prefix for this scan's days: `${prefix}:day:2026-11-22` */
  prefix: string
  /** How long today's rows are kept before they are read again */
  todaySeconds: number
  /** Each day's query gets this many seconds (lib/long-query.ts) */
  querySeconds: number
  /** One day's rows, from (inclusive) to (exclusive), both ISO times, as small objects kept as JSON */
  read: (trx: Knex.Transaction, from: string, to: string) => Promise<R[]>
  /** When a row was made, in ms since 1970 */
  at: (row: R) => number
}

interface KeptDay<R> { made: number; rows: R[] }

/** A time from the database (a Date, or text), in ms; NaN when it isn't one */
export function msOf(v: unknown): number {
  if (v instanceof Date) return v.getTime()
  return typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : Number.NaN
}

/** Whether a day's kept read stands: today's for todaySeconds; a past day's for good once read SETTLE_MS after it ended, for an hour before that */
export function dayStands(made: number, end: number, now: number, todaySeconds: number): boolean {
  if (end > now) return now - made < todaySeconds * 1000
  if (made >= end + SETTLE_MS) return true
  return now - made < UNSETTLED_EVERY_MS
}

const dayName = (start: number) => new Date(start).toISOString().slice(0, 10)

/** The rows made in the last `days` days (after now minus days), newest first: each UTC day read once and kept */
export async function windowRows<R>(scan: DayScan<R>, days: number, now = Date.now()): Promise<R[]> {
  const from = now - days * DAY_MS
  const rows: R[] = []
  for (let start = Math.floor(from / DAY_MS) * DAY_MS; start <= now; start += DAY_MS) {
    const end = start + DAY_MS
    const key = `${scan.prefix}:day:${dayName(start)}`
    let kept: KeptDay<R> | null = null
    try {
      const raw = await redis.get(key)
      if (raw) kept = JSON.parse(raw) as KeptDay<R>
    } catch { /* read the day again */ }
    if (!kept || typeof kept.made !== 'number' || !Array.isArray(kept.rows) || !dayStands(kept.made, end, now, scan.todaySeconds)) {
      // the read's start, not its end: a report made while it ran is in the next read
      const made = Date.now()
      const read = await longQuery(scan.querySeconds, trx => scan.read(trx, new Date(start).toISOString(), new Date(end).toISOString()))
      kept = { made, rows: read.filter(r => { const t = scan.at(r); return t >= start && t < end }) }
      try {
        await redis.setex(key, Math.max(60, Math.ceil((end + KEEP_DAYS * DAY_MS - now) / 1000)), JSON.stringify(kept))
      } catch { /* read again next time */ }
    }
    for (const r of kept.rows) if (scan.at(r) > from) rows.push(r)
  }
  return rows.sort((a, b) => scan.at(b) - scan.at(a))
}
