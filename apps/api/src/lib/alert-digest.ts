/**
 * The daily alert digest (plan K6; Devon, Oct 21, 2026: alerts "Free for
 * everyone"). An alert set to "digest: daily" (channels.digest; the Follow
 * button on a person's, place's or organisation's page makes one) doesn't
 * email each match: the dispatcher keeps the day's matches here, and after
 * 7 AM New York time each alert sends one email with them, the most serious
 * first (15 at most, with how many more). Nothing is sent without the email
 * key (RESEND_API_KEY); the matches wait up to 3 days.
 *
 * An alert that emails each match keeps its matches here too once it has sent
 * its emails for the day (alert-dispatcher.ts EMAILS_A_DAY), so they come in
 * the next morning's digest instead of being lost.
 */

import type { SignalSeverity } from '@worldpulse/types'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { newYorkTime } from './briefing-email'
import { EMAIL_CONFIGURED, sendAlertDigestEmail, type DigestItem } from './email'

const KEPT = (subId: string) => `alerts:digest:${subId}`
const SENT = (nyDate: string) => `alerts:digest:sent:${nyDate}`
const KEEP_SECONDS = 3 * 86_400
export const DIGEST_HOUR = 7
export const DIGEST_ITEMS = 15
const RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }

/** Keep a match for its alert's next digest */
export async function keepForDigest(subId: string, signalId: string): Promise<void> {
  try {
    await redis.sadd(KEPT(subId), signalId)
    await redis.expire(KEPT(subId), KEEP_SECONDS)
  } catch (err) {
    logger.warn({ err, subId }, 'Alert digest: match not kept')
  }
}

export interface DigestRun { due: boolean; alerts: number; sent: number; empty: number }

/** Send the day's digests, once a day after DIGEST_HOUR in New York */
export async function sendAlertDigests(now = new Date()): Promise<DigestRun> {
  const run: DigestRun = { due: false, alerts: 0, sent: 0, empty: 0 }
  const ny = newYorkTime(now)
  if (ny.hour < DIGEST_HOUR || !EMAIL_CONFIGURED) return run
  if (await redis.set(SENT(ny.date), '1', 'EX', 2 * 86_400, 'NX').catch(() => null) !== 'OK') return run
  run.due = true
  const subs = await db('alert_subscriptions as a')
    .join('users as u', 'u.id', 'a.user_id')
    .where('a.active', true)
    // every alert that emails: a daily one, or one with matches past its day's emails
    .whereRaw(`coalesce((a.channels->>'email')::boolean, true) = true`)
    .whereNotNull('u.email')
    .select('a.id as sub_id', 'a.name', 'u.email') as Array<{ sub_id: string; name: string; email: string }>
  for (const sub of subs) {
    run.alerts += 1
    const ids = (await redis.smembers(KEPT(sub.sub_id)).catch(() => [] as string[])).slice(0, 500)
    if (ids.length === 0) { run.empty += 1; continue }
    const rows = await db('signals').whereIn('id', ids).whereIn('status', ['verified', 'pending'])
      .select('id', 'title', 'severity', 'location_name', 'status', 'created_at') as Array<{
        id: string; title: string; severity: SignalSeverity; location_name: string | null; status: string; created_at: string
      }>
    if (rows.length === 0) { await redis.del(KEPT(sub.sub_id)).catch(() => 0); run.empty += 1; continue }
    rows.sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || Date.parse(b.created_at) - Date.parse(a.created_at))
    const items: DigestItem[] = rows.slice(0, DIGEST_ITEMS).map(r => ({ id: String(r.id), title: String(r.title), severity: r.severity, locationName: r.location_name, status: r.status }))
    if (await sendAlertDigestEmail(sub.email, sub.name, items, rows.length)) {
      run.sent += 1
      await redis.del(KEPT(sub.sub_id)).catch(() => 0)
    }
  }
  if (run.alerts) logger.info(run, 'Alert digests sent')
  return run
}

let timer: ReturnType<typeof setInterval> | null = null

export function startAlertDigests(): void {
  if (timer) return
  timer = setInterval(() => { void sendAlertDigests().catch(err => logger.warn({ err }, 'Alert digests failed (non-fatal)')) }, 10 * 60_000)
}

export function stopAlertDigests(): void {
  if (timer) { clearInterval(timer); timer = null }
}
