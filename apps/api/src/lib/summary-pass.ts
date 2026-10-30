/**
 * The summary pass (Oct 19, 2026; Devon: "fix: opening a page will no longer
 * make the site ask Claude").
 *
 * Story pages used to ask Claude for a summary whenever one was opened
 * without it, so bots reading thousands of old pages spent the day's AI
 * allowance by 8:38 AM (lib/signal-summary.ts). Now this pass writes the
 * summaries instead: every 10 minutes, the stories verified in the last 7
 * days that have none (since Oct 30: the last day's first, the most outlets
 * first), up to 30 a pass, within the day's SUMMARY_DAILY_LIMIT, paced over
 * the day (pacedAllowance), and the spending cap (lib/claude.ts). A story
 * whose summary fails is tried again after 6 hours, so one bad story can't
 * stop the pass. One API process runs it at a time.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import {
  CACHE_KEY_PREFIX, generateSignalSummary, summaryAllowed, summaryDailyLimit, summariesUsedToday, type SignalSummaryInput,
} from './signal-summary'

export const SUMMARY_PASS_MS    = 10 * 60_000
export const SUMMARY_PASS_BATCH = 30
/** Verified stories this recent are summarized (the sitemap lists 7 days of them) */
export const SUMMARY_PASS_DAYS  = 7
const CANDIDATES = 400
const LOCK_KEY = 'signal-ai-summary:pass-lock'
const LAST_KEY = 'signal-ai-summary:pass-last'
/** A story whose summary failed waits this long before it's tried again */
const TRIED_KEY = (id: string) => `signal-ai-summary:tried:${id}`
const TRIED_S   = 6 * 3_600

/**
 * The day's summaries spread over the day (Oct 30, 2026). The pass wrote 30
 * every 10 minutes from UTC midnight, so the day's limit (400) was gone by
 * about 5:30 AM UTC (1:30 AM in New York), and every story verified in
 * Europe's and America's day waited for the next UTC midnight, when newer
 * ones came first. Now by each moment of the UTC day at most its share of the
 * limit is written, an hour's share ahead: the same number a day, all day.
 */
export const PACE_AHEAD_MIN = 60
export function pacedAllowance(limit: number, now: Date): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return Math.max(0, Math.min(limit, Math.ceil((limit * (minutes + PACE_AHEAD_MIN)) / 1440)))
}

/** Stories verified this recently go first, the most outlets first; older ones after, newest first */
const FRESH_MS = 24 * 3_600_000

export interface SummaryPassResult {
  at:       string
  checked:  number
  missing:  number
  written:  number
  /** Why it stopped early, if it did */
  stopped?: string
}

type Row = {
  id: string; title: string; summary: string | null; body: string | null; category: string; severity: string; tags: string[] | null
  language: string | null; source_count?: number | null; verified_at?: string | Date | null
}

/**
 * The order summaries are written in: the last day's stories first, the most
 * outlets first (the stories readers open most), then older ones newest
 * first. Rows come newest first from the database; ties keep that order.
 */
export function summaryOrder<T extends Pick<Row, 'source_count' | 'verified_at'>>(rows: T[], now = new Date()): T[] {
  const fresh = (r: T) => {
    const at = r.verified_at ? new Date(r.verified_at).getTime() : NaN
    return Number.isFinite(at) && now.getTime() - at <= FRESH_MS
  }
  return rows
    .map((r, i) => ({ r, i, fresh: fresh(r), outlets: Number(r.source_count) || 0 }))
    .sort((a, b) => (Number(b.fresh) - Number(a.fresh)) || (a.fresh ? b.outlets - a.outlets : 0) || a.i - b.i)
    .map(x => x.r)
}

/** The verified stories of the last days without a kept summary, newest first */
export async function storiesWithoutSummary(now = new Date()): Promise<{ checked: number; todo: SignalSummaryInput[] }> {
  const since = new Date(now.getTime() - SUMMARY_PASS_DAYS * 86_400_000)
  const rows = await db('signals')
    .where('status', 'verified')
    .where('verified_at', '>', since)
    .orderBy('verified_at', 'desc')
    .limit(CANDIDATES)
    .select(['id', 'title', 'summary', 'body', 'category', 'severity', 'tags', 'language', 'source_count', 'verified_at']) as Row[]
  if (rows.length === 0) return { checked: 0, todo: [] }
  const [kept, tried] = await Promise.all([
    redis.mget(...rows.map(r => `${CACHE_KEY_PREFIX}${r.id}`)),
    redis.mget(...rows.map(r => TRIED_KEY(String(r.id)))),
  ])
  const todo = summaryOrder(rows.filter((r, i) => !kept[i] && !tried[i] && typeof r.title === 'string' && r.title.trim()), now)
    .map(r => ({
      id:       String(r.id),
      title:    r.title,
      summary:  r.summary,
      body:     r.body,
      category: r.category ?? 'other',
      severity: r.severity ?? 'medium',
      tags:     Array.isArray(r.tags) ? r.tags : [],
      language: r.language ?? 'en',
    }))
  return { checked: rows.length, todo }
}

/** One pass: writes up to SUMMARY_PASS_BATCH summaries; stops when an AI gives none (no key, the cap, the day's limit) */
export async function summarizeVerifiedStories(now = new Date(), batch = SUMMARY_PASS_BATCH): Promise<SummaryPassResult> {
  const at = now.toISOString()
  const lock = await redis.set(LOCK_KEY, at, 'EX', 9 * 60, 'NX').catch(() => null)
  if (lock !== 'OK') return { at, checked: 0, missing: 0, written: 0, stopped: 'another pass is running' }
  let result: SummaryPassResult = { at, checked: 0, missing: 0, written: 0 }
  try {
    const { checked, todo } = await storiesWithoutSummary(now)
    result = { at, checked, missing: todo.length, written: 0 }
    // The day's limit, paced over the day
    const limit = summaryDailyLimit()
    const used = await summariesUsedToday(now)
    const room = pacedAllowance(limit, now) - used
    if (todo.length > 0 && room <= 0) {
      result.stopped = `paced: ${used} of the day's ${limit} written by this hour`
      return result
    }
    batch = Math.min(batch, Math.max(0, room))
    let failed = 0
    let inARow = 0
    for (const story of todo) {
      if (result.written + failed >= batch) break
      if (!(await summaryAllowed(now))) {
        result.stopped = 'no AI now (no key, the spending cap or the day\'s summary limit)'
        break
      }
      const summary = await generateSignalSummary(story)
      if (summary.model === 'extractive') {
        failed++
        await redis.set(TRIED_KEY(story.id), at, 'EX', TRIED_S).catch(() => {})
        if (++inARow >= 3) {
          result.stopped = 'three summaries failed in a row'
          break
        }
        continue
      }
      inARow = 0
      result.written++
    }
  } catch (err) {
    result.stopped = 'error'
    logger.warn({ err }, 'Summary pass failed')
  } finally {
    await redis.del(LOCK_KEY).catch(() => {})
    await redis.set(LAST_KEY, JSON.stringify(result), 'EX', 7 * 86_400).catch(() => {})
  }
  if (result.written > 0 || result.stopped) logger.info(result, 'Summary pass')
  return result
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSummaryPass(): void {
  if (timer) return
  // the first pass a minute after start, then every 10 minutes
  setTimeout(() => { void summarizeVerifiedStories() }, 60_000).unref?.()
  timer = setInterval(() => { void summarizeVerifiedStories() }, SUMMARY_PASS_MS)
  timer.unref?.()
}

export function stopSummaryPass(): void {
  if (timer) clearInterval(timer)
  timer = null
}
