/**
 * The summary pass (Oct 19, 2026; Devon: "fix: opening a page will no longer
 * make the site ask Claude").
 *
 * Story pages used to ask Claude for a summary whenever one was opened
 * without it, so bots reading thousands of old pages spent the day's AI
 * allowance by 8:38 AM (lib/signal-summary.ts). Now this pass writes the
 * summaries instead: every 10 minutes, the stories verified in the last 7
 * days that have none, newest first, up to 30 a pass, within the day's
 * SUMMARY_DAILY_LIMIT and the spending cap (lib/claude.ts). A story whose
 * summary fails is tried again after 6 hours, so one bad story can't stop
 * the pass. One API process runs it at a time.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { CACHE_KEY_PREFIX, generateSignalSummary, summaryAllowed, type SignalSummaryInput } from './signal-summary'

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

export interface SummaryPassResult {
  at:       string
  checked:  number
  missing:  number
  written:  number
  /** Why it stopped early, if it did */
  stopped?: string
}

type Row = { id: string; title: string; summary: string | null; body: string | null; category: string; severity: string; tags: string[] | null; language: string | null }

/** The verified stories of the last days without a kept summary, newest first */
export async function storiesWithoutSummary(now = new Date()): Promise<{ checked: number; todo: SignalSummaryInput[] }> {
  const since = new Date(now.getTime() - SUMMARY_PASS_DAYS * 86_400_000)
  const rows = await db('signals')
    .where('status', 'verified')
    .where('verified_at', '>', since)
    .orderBy('verified_at', 'desc')
    .limit(CANDIDATES)
    .select(['id', 'title', 'summary', 'body', 'category', 'severity', 'tags', 'language']) as Row[]
  if (rows.length === 0) return { checked: 0, todo: [] }
  const [kept, tried] = await Promise.all([
    redis.mget(...rows.map(r => `${CACHE_KEY_PREFIX}${r.id}`)),
    redis.mget(...rows.map(r => TRIED_KEY(String(r.id)))),
  ])
  const todo = rows
    .filter((r, i) => !kept[i] && !tried[i] && typeof r.title === 'string' && r.title.trim())
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
