/**
 * Names in every language, for the reports before them (Nov 21, 2026; Devon, 3:31 PM: "Proceed with the rerun").
 * world-names.ts went live at 12:45 PM ET (ff1d1e1) for new reports only. This reads, once, the reports of the
 * RELINK_DAYS before in the languages other than English, a day at a time, and links each to the names the table
 * reads in its headline (namesInTitle, at most MAX_NAMES), as the live path does. The names the rules or the script
 * places linked already need no care: a report an entity holds already is counted once (linkEntityToReports), so
 * each day's reports of an entity go in one statement, and a big entity (Russia, 11,000 reports) is written once a
 * day, not once a report. Headlines only: no model, no rules. A restart carries on after the last day done, and redoes
 * the day it was in, which changes nothing that was written.
 *
 * Progress, for reading: names-relink:progress (GET /api/v1/public/languages, names_relink).
 *
 * @module pipeline/names-relink
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { linkEntityToReports, type ExtractedEntity } from './entity-graph'
import { namesInTitle } from './world-names'

/** When the live path started (ff1d1e1, 12:45 PM ET): the reports after it have their names */
export const NAMES_LIVE_AT = '2026-11-21T17:45:00.000Z'
export const RELINK_DAYS = 7
export const RELINK_PAGE = 2_000
/** Pauses, for a server already busy (Nov 21, 3:40 PM: load 16 on 2 processors, Postgres at 69%): between pages of
 * reports, between entities written, between days. About half an hour in all */
export const PAUSE_MS = { page: 2_000, entity: 100, day: 30_000 } as const
export const PROGRESS_KEY = 'names-relink:progress'
export const DAY_DONE_KEY = 'names-relink:day-done'
const KEEP_S = 30 * 86_400
const DAY_MS = 86_400_000

export interface RelinkReport { id: string; title: string; language: string; created_at: string }
export interface RelinkDayStats { day: string; reports: number; named: number; links: number; entities: number; added: number; failed: number }
export interface RelinkDeps {
  /** A page of a window's reports in other languages than English, after `after` (created_at, id), oldest first */
  page(from: Date, to: Date, after: { at: string; id: string } | null, limit: number): Promise<RelinkReport[]>
  /** One entity's reports of the day; how many were new to it */
  link(entity: ExtractedEntity, ids: string[], oldest: string, newest: string): Promise<number>
  /** The start of the last day done, as setDayDone wrote it */
  dayDone(): Promise<string | null>
  setDayDone(day: string, stats: RelinkDayStats, total: RelinkTotal): Promise<void>
  pause(ms: number): Promise<void>
}
export interface RelinkTotal { days: number; reports: number; named: number; links: number; added: number }

/** The table's names for one report, as the live path reads them (insert-signal.ts ownLanguageNames) */
export function namesToLink(r: Pick<RelinkReport, 'title' | 'language'>): ExtractedEntity[] {
  return namesInTitle(r.title, r.language).map(e => ({ name: e.name, type: e.type, salience: 0.5 }))
}

export async function relinkNames(deps: RelinkDeps = liveRelinkDeps, liveAt: string = NAMES_LIVE_AT): Promise<RelinkTotal> {
  const end = Date.parse(liveAt)
  const done = await deps.dayDone()
  const total: RelinkTotal = { days: 0, reports: 0, named: 0, links: 0, added: 0 }
  for (let t = end - RELINK_DAYS * DAY_MS; t < end; t += DAY_MS) {
    const from = new Date(t)
    const to = new Date(Math.min(t + DAY_MS, end))
    const day = from.toISOString()
    if (done && day <= done) continue
    const stats: RelinkDayStats = { day, reports: 0, named: 0, links: 0, entities: 0, added: 0, failed: 0 }
    const byEntity = new Map<string, { entity: ExtractedEntity; ids: Set<string>; oldest: string; newest: string }>()
    let after: { at: string; id: string } | null = null
    for (;;) {
      const rows = await deps.page(from, to, after, RELINK_PAGE)
      for (const [i, r] of rows.entries()) {
        stats.reports++
        const names = namesToLink(r)
        if (names.length) stats.named++
        for (const e of names) {
          const key = `${e.type}:${e.name}`
          const g = byEntity.get(key) ?? { entity: e, ids: new Set<string>(), oldest: r.created_at, newest: r.created_at }
          g.ids.add(r.id)
          if (r.created_at < g.oldest) g.oldest = r.created_at
          if (r.created_at > g.newest) g.newest = r.created_at
          byEntity.set(key, g)
          stats.links++
        }
        // room for the scraper's own work between reports
        if (i % 250 === 249) await deps.pause(0)
      }
      if (rows.length < RELINK_PAGE) break
      const last = rows[rows.length - 1]!
      after = { at: last.created_at, id: last.id }
      await deps.pause(PAUSE_MS.page)
    }
    for (const g of byEntity.values()) {
      try {
        stats.added += await deps.link(g.entity, [...g.ids], g.oldest, g.newest)
        stats.entities++
      } catch (err) {
        stats.failed++
        logger.warn({ err, entity: g.entity.name }, 'Names re-link: an entity not written (non-fatal)')
      }
      await deps.pause(PAUSE_MS.entity)
    }
    total.days++; total.reports += stats.reports; total.named += stats.named; total.links += stats.links; total.added += stats.added
    await deps.setDayDone(day, stats, total)
    logger.info(stats, 'Names re-link: a day of reports linked')
    await deps.pause(PAUSE_MS.day)
  }
  return total
}

// ─── The live parts ──────────────────────────────────────────────────────────

export const liveRelinkDeps: RelinkDeps = {
  async page(from, to, after, limit) {
    // created_at as text: the cursor keeps its microseconds
    const { rows } = await db.raw(
      `SELECT id::text AS id, title, language, created_at::text AS created_at
         FROM signals
        WHERE created_at >= ?::timestamptz AND created_at < ?::timestamptz
          AND language IS NOT NULL AND language <> 'en'
          ${after ? 'AND (created_at, id) > (?::timestamptz, ?::uuid)' : ''}
        ORDER BY created_at, id
        LIMIT ?`,
      [from.toISOString(), to.toISOString(), ...(after ? [after.at, after.id] : []), limit],
    ) as { rows: Array<Record<string, unknown>> }
    return rows.map(r => ({ id: String(r.id), title: String(r.title ?? ''), language: String(r.language ?? ''), created_at: String(r.created_at) }))
  },
  link: linkEntityToReports,
  async dayDone() {
    return redis.get(DAY_DONE_KEY)
  },
  async setDayDone(day, stats, total) {
    const before = JSON.parse((await redis.get(PROGRESS_KEY).catch(() => null)) ?? '{}') as Partial<RelinkTotal> & { days_done?: number }
    const progress = {
      days_done: (before.days_done ?? 0) + 1,
      of: RELINK_DAYS,
      last_day: day,
      // the totals of every run so far (a restart starts its own count at the day it was in)
      reports: (before.reports ?? 0) + stats.reports,
      named: (before.named ?? 0) + stats.named,
      links: (before.links ?? 0) + stats.links,
      added: (before.added ?? 0) + stats.added,
      failed: ((before as { failed?: number }).failed ?? 0) + stats.failed,
      this_run: total,
      updated: new Date().toISOString(),
    }
    await redis.set(PROGRESS_KEY, JSON.stringify(progress), 'EX', KEEP_S)
    await redis.set(DAY_DONE_KEY, day, 'EX', KEEP_S)
  },
  pause: ms => new Promise(resolve => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve))),
}
