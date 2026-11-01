/**
 * Push alerts sent to readers' browsers (lib/web-push.ts; Devon, Oct 31,
 * 2026, 11:11 PM: "Yes" to web push). Every minute, like the saved alerts'
 * look (lib/alert-scan.ts), it reads the reports that became verified or
 * reached more outlets at least 10 minutes ago (the cross-check may send a
 * story back to pending in those minutes), and sends each story once to:
 * - every browser that asked for breaking news: a critical story verified
 *   by 2 or more outlets, or a high one carried by 5 or more (about 3 to 8
 *   stories a day on Oct 31);
 * - every browser that follows the story's country: its high and critical
 *   stories, once verified.
 * At most PUSHES_A_DAY a browser a day (New York's day), and each story once
 * (a story's reports share its story id). WEB_PUSH_OFF=1 stops the sending.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { sendPush, pushTopic, type PushResult } from './web-push'

const SINCE_KEY = 'push:scan:since'
const LOCK_KEY = 'push:scan:lock'
export const PUSH_EVERY_MS = 60_000
/** A verified story waits this long, as the saved alerts do (the cross-check may send it back) */
export const PUSH_SETTLE_MS = 10 * 60_000
/** How far back a look goes at most (after a restart or an outage) */
export const PUSH_MAX_BACK_MS = 60 * 60_000
/** Pushes a browser gets in a day at most */
export const PUSHES_A_DAY = 6
/** A high story is breaking news once this many outlets carry it */
export const BREAKING_HIGH_OUTLETS = 5
/** A story older than this when it is verified isn't news to push */
export const PUSH_MAX_AGE_MS = 24 * 3600_000
/** Sends at once */
const PARALLEL = 8
/** A subscription the push service refuses this many times in a row is dropped */
const MAX_FAILS = 10
const SITE = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://world-pulse.io'

export interface PushStory {
  id: string
  title: string
  severity: string
  source_count: number
  country_code: string | null
  location_name: string | null
  story_key: string
}

export interface PushSub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  breaking: boolean
  countries: string[]
}

/** Breaking news: critical once verified, or high once 5 outlets carry it */
export function isBreaking(s: Pick<PushStory, 'severity' | 'source_count'>): boolean {
  return s.severity === 'critical' || (s.severity === 'high' && s.source_count >= BREAKING_HIGH_OUTLETS)
}

/** Whether a browser wants this story: breaking news, or a high or critical story in a country it follows */
export function wants(sub: Pick<PushSub, 'breaking' | 'countries'>, s: PushStory): boolean {
  if (sub.breaking && isBreaking(s)) return true
  return !!s.country_code && (s.severity === 'critical' || s.severity === 'high') && sub.countries.includes(s.country_code)
}

let tableReady = false

/** True once the subscriptions table is known to exist */
export function pushReady(): boolean {
  return tableReady
}

/**
 * Create the subscriptions table if it is missing (Devon's OK, Oct 31, 2026), at every start like the
 * email subscribers' (lib/subscribers.ts): the deploy doesn't run db/migrate.ts. The first deploy of
 * push alerts (b185cb1) answered 500 until this: the table only existed in migrate.ts.
 */
export async function ensurePushTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint      TEXT        NOT NULL UNIQUE,
        p256dh        TEXT        NOT NULL,
        auth          TEXT        NOT NULL,
        breaking      BOOLEAN     NOT NULL DEFAULT TRUE,
        countries     TEXT[]      NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_sent_at  TIMESTAMPTZ,
        sent_count    INTEGER     NOT NULL DEFAULT 0,
        fail_count    INTEGER     NOT NULL DEFAULT 0
      )`)
    tableReady = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Push subscriptions table could not be created; push alerts stay off')
    return false
  }
}

/** The stories in a look: one per story (its report with the most outlets), in the order they were verified */
export function oneEach(rows: PushStory[]): PushStory[] {
  const best = new Map<string, PushStory>()
  for (const r of rows) {
    const had = best.get(r.story_key)
    if (!had || r.source_count > had.source_count) best.set(r.story_key, r)
  }
  return [...best.values()]
}

/** What the notification shows: the headline, how many outlets and where, and the story's page */
export function pushMessage(s: PushStory): { title: string; body: string; url: string; tag: string } {
  const where = (s.location_name || '').trim()
  const outlets = `Verified by ${s.source_count} outlet${s.source_count === 1 ? '' : 's'}`
  return {
    title: s.title.length > 140 ? `${s.title.slice(0, 137).trimEnd()}…` : s.title,
    body: where ? `${outlets} · ${where}` : outlets,
    url: `${SITE}/signals/${encodeURIComponent(s.id)}?utm_source=push`,
    tag: s.story_key,
  }
}

/** New York's date, the day the daily limit counts in */
export function nyDay(now: number): string {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Where a look starts: where the last one ended, at most PUSH_MAX_BACK_MS back */
async function since(now: number): Promise<number> {
  const kept = Date.parse(await redis.get(SINCE_KEY).catch(() => null) ?? '')
  const start = Number.isFinite(kept) ? kept : now - PUSH_SETTLE_MS - 5 * 60_000
  return Math.max(start, now - PUSH_SETTLE_MS - PUSH_MAX_BACK_MS)
}

/** Whether this browser may get this story now: once a story, PUSHES_A_DAY a day */
async function mayPush(subId: string, storyKey: string, now: number): Promise<boolean> {
  const once = await redis.set(`push:sent:${subId}:${storyKey}`, '1', 'EX', 3 * 86_400, 'NX').catch(() => null)
  if (once !== 'OK') return false
  const dayKey = `push:day:${subId}:${nyDay(now)}`
  const n = await redis.incr(dayKey).catch(() => 0)
  if (n === 1) await redis.expire(dayKey, 2 * 86_400).catch(() => 0)
  return n > 0 && n <= PUSHES_A_DAY
}

/** Keep the subscription's record: sent, gone (deleted), or refused again */
async function record(sub: PushSub, result: PushResult): Promise<void> {
  if (result === 'sent') {
    await db('web_push_subscriptions').where('id', sub.id).update({
      last_sent_at: db.fn.now(), sent_count: db.raw('sent_count + 1'), fail_count: 0,
    })
  } else if (result === 'gone') {
    await db('web_push_subscriptions').where('id', sub.id).delete()
  } else if (result === 'failed') {
    const [row] = await db('web_push_subscriptions').where('id', sub.id)
      .update({ fail_count: db.raw('fail_count + 1') }).returning(['fail_count'])
    if (Number(row?.fail_count ?? 0) >= MAX_FAILS) await db('web_push_subscriptions').where('id', sub.id).delete()
  }
}

export interface PushRun { stories: number; sent: number; gone: number; failed: number; skipped?: string }

/** One look; exported for tests */
export async function scanPush(now: number = Date.now()): Promise<PushRun> {
  const run: PushRun = { stories: 0, sent: 0, gone: 0, failed: 0 }
  if (process.env.WEB_PUSH_OFF === '1') { run.skipped = 'off'; return run }
  const from = await since(now)
  const until = now - PUSH_SETTLE_MS
  if (until <= from) { run.skipped = 'too soon'; return run }
  const at = 'greatest(verified_at, coalesce(last_corroborated_at, verified_at))'
  const rows = await db('signals')
    .where('status', 'verified')
    .whereIn('severity', ['critical', 'high'])
    .where('created_at', '>', new Date(now - PUSH_MAX_AGE_MS).toISOString())
    .whereRaw('coalesce(source_count, 1) >= 2')
    .whereRaw(`${at} > ?`, [new Date(from).toISOString()])
    .whereRaw(`${at} <= ?`, [new Date(until).toISOString()])
    .orderByRaw(`${at} asc`)
    .limit(500)
    .select('id', 'title', 'severity', 'source_count', 'country_code', 'location_name', 'story_id', db.raw(`${at} as at`)) as Array<{
      id: string; title: string; severity: string; source_count: number | null; country_code: string | null
      location_name: string | null; story_id: string | null; at: string | Date
    }>
  const end = rows.length === 500 ? new Date(rows[rows.length - 1]!.at).getTime() : until
  await redis.set(SINCE_KEY, new Date(end).toISOString(), 'EX', 2 * 86_400).catch(() => null)

  const stories = oneEach(rows.map(r => ({
    id: r.id, title: r.title, severity: r.severity, source_count: Number(r.source_count ?? 1),
    country_code: r.country_code, location_name: r.location_name, story_key: String(r.story_id ?? r.id),
  })))
  run.stories = stories.length
  if (stories.length === 0) return run

  const countries = [...new Set(stories.map(s => s.country_code).filter((c): c is string => !!c))]
  const subs = await db('web_push_subscriptions')
    .where(q => {
      q.where('breaking', true)
      if (countries.length) q.orWhereRaw('countries && ?::text[]', [countries])
    })
    .select('id', 'endpoint', 'p256dh', 'auth', 'breaking', 'countries') as PushSub[]

  const jobs: Array<{ sub: PushSub; story: PushStory }> = []
  for (const sub of subs) {
    for (const story of stories) {
      if (wants(sub, story) && await mayPush(sub.id, story.story_key, now)) jobs.push({ sub, story })
    }
  }
  for (let i = 0; i < jobs.length; i += PARALLEL) {
    await Promise.all(jobs.slice(i, i + PARALLEL).map(async ({ sub, story }) => {
      const { result } = await sendPush(sub, pushMessage(story), {
        ttl: 6 * 3600, urgency: story.severity === 'critical' ? 'high' : 'normal', topic: pushTopic(story.story_key),
      })
      if (result === 'sent') run.sent += 1
      else if (result === 'gone') run.gone += 1
      else if (result === 'failed') run.failed += 1
      await record(sub, result).catch(err => logger.warn({ err }, 'Push: record failed'))
    }))
  }
  return run
}

/** The message a browser gets when it turns alerts on, so the reader sees they work */
export function welcomeMessage(breaking: boolean, countryNames: string[]): { title: string; body: string; url: string; tag: string } {
  const what = [
    ...(breaking ? ['breaking news'] : []),
    ...(countryNames.length ? [`major stories in ${countryNames.slice(0, 3).join(', ')}${countryNames.length > 3 ? ' and more' : ''}`] : []),
  ].join(' and ')
  return {
    title: 'WorldPulse alerts are on',
    body: `You'll get ${what || 'alerts'}, once independent outlets confirm it. ${PUSHES_A_DAY} a day at most.`,
    url: `${SITE}/alerts?utm_source=push`,
    tag: 'welcome',
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Every minute, one look at a time (a look that overruns holds the lock) */
export function startPushScan(): void {
  if (timer) return
  timer = setInterval(() => {
    void (async () => {
      if (await redis.set(LOCK_KEY, '1', 'EX', 5 * 60, 'NX').catch(() => null) !== 'OK') return
      try {
        const run = await scanPush()
        if (run.sent || run.gone || run.failed) logger.info(run, 'Push alerts sent')
      } catch (err) {
        logger.warn({ err }, 'Push scan failed (non-fatal)')
      } finally {
        await redis.del(LOCK_KEY).catch(() => 0)
      }
    })()
  }, PUSH_EVERY_MS)
  timer.unref?.()
}

export function stopPushScan(): void {
  if (timer) { clearInterval(timer); timer = null }
}
