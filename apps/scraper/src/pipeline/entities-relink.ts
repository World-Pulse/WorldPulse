/**
 * The week's older reports read again for the people, places and organisations they name (Nov 22, 2026; Devon,
 * 1:48 PM: "1 ok", the once-only re-link offered on Nov 20 at 11:39 AM). Three things left the week's older reports with
 * fewer links than a new report gets: until d01f5b4 (Nov 20, 11:50 AM) the scraper's start-up repair kept only the first
 * 100 reports of an entity it folded a variant into, at every deploy (Mexico held 101 of its 2,867); the places named
 * in other scripts (scriptPlaces, Nov 20) are read for new reports only; and names-relink.ts read the week's headlines
 * in other languages for names only. On Nov 22 at 2 PM, 51% of the week's reports were linked to a named person, place
 * or organisation.
 *
 * This reads, once, the reports from RELINK_DAYS before its first start up to NAMES_LIVE_AT (from then on the live path
 * reads every report with all of today's rules), a day at a time, with the live path's rules and no model: the rules
 * on the headline and summary, the places in other scripts where the rules found none, and the names in the headline's
 * own language (entitiesToLink, as insert-signal.ts reads a report that isn't serious). Each entity's reports of the day
 * go in one statement (linkEntityToReports), the most-named first: a report an entity holds already is counted once and
 * nothing is taken away, so links are only ever added. A restart carries on after the last day done, and redoes the day
 * it was in, which changes nothing that was written.
 *
 * Progress, for reading: entities-relink:progress (GET /api/v1/public/languages, entities_relink).
 *
 * @module pipeline/entities-relink
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { extractEntitiesRuleBased, linkEntityToReports, type ExtractedEntity } from './entity-graph'
import { scriptPlaces, ownLanguageNames } from './insert-signal'
import { NAMES_LIVE_AT } from './names-relink'

export const RELINK_DAYS = 8
export const RELINK_PAGE = 2_000
/** Pauses, for a server already busy: between pages of reports, after an entity with many of the day's reports and
 * after a small one, and between days */
export const PAUSE_MS = { page: 2_000, entity: 100, small: 10, day: 30_000 } as const
/** An entity named in fewer of the day's reports than this is a small write */
export const SMALL_ENTITY = 20
/** Reports read between two yields to the scraper's own work (the rules take about 2 ms a report) */
export const YIELD_EVERY = 50
export const PROGRESS_KEY = 'entities-relink:progress'
export const DAY_DONE_KEY = 'entities-relink:day-done'
const KEEP_S = 30 * 86_400
const DAY_MS = 86_400_000

export interface RelinkReport { id: string; title: string; summary: string | null; language: string | null; created_at: string }
export interface RelinkDayStats { day: string; reports: number; linked: number; links: number; entities: number; added: number; failed: number }
export interface RelinkTotal { days: number; reports: number; linked: number; links: number; added: number; failed: number }
export interface RelinkDeps {
  /** A page of a window's reports, every language, after `after` (created_at, id), oldest first */
  page(from: Date, to: Date, after: { at: string; id: string } | null, limit: number): Promise<RelinkReport[]>
  /** One entity's reports of the day; how many were new to it */
  link(entity: ExtractedEntity, ids: string[], oldest: string, newest: string): Promise<number>
  /** The start of the last day done, as setDayDone wrote it */
  dayDone(): Promise<string | null>
  setDayDone(day: string, stats: RelinkDayStats, total: RelinkTotal, of: number): Promise<void>
  pause(ms: number): Promise<void>
}

/** The people, places and organisations a report names, as the live path reads a report that isn't serious */
export function entitiesToLink(r: Pick<RelinkReport, 'title' | 'summary' | 'language'>): ExtractedEntity[] {
  const title = String(r.title ?? '')
  const out: ExtractedEntity[] = [...extractEntitiesRuleBased(title, r.summary ?? '').entities]
  if (!out.some(e => e.type === 'location')) {
    for (const name of scriptPlaces(title)) out.push({ name, type: 'location', salience: 0.5 })
  }
  out.push(...ownLanguageNames(title, String(r.language ?? '') || 'en', out))
  return out
}

/** The days to read: from RELINK_DAYS before the first start (runOnce's cutoff) up to the live path's start */
export function relinkWindows(cutoff: Date, liveAt: string = NAMES_LIVE_AT): Array<{ from: Date; to: Date }> {
  const end = Math.min(Date.parse(liveAt), cutoff.getTime())
  const out: Array<{ from: Date; to: Date }> = []
  for (let t = cutoff.getTime() - RELINK_DAYS * DAY_MS; t < end; t += DAY_MS) out.push({ from: new Date(t), to: new Date(Math.min(t + DAY_MS, end)) })
  return out
}

export async function relinkEntities(cutoff: Date, deps: RelinkDeps = liveRelinkDeps, liveAt: string = NAMES_LIVE_AT): Promise<RelinkTotal> {
  const windows = relinkWindows(cutoff, liveAt)
  const done = await deps.dayDone()
  const total: RelinkTotal = { days: 0, reports: 0, linked: 0, links: 0, added: 0, failed: 0 }
  for (const { from, to } of windows) {
    const day = from.toISOString()
    if (done && day <= done) continue
    const stats: RelinkDayStats = { day, reports: 0, linked: 0, links: 0, entities: 0, added: 0, failed: 0 }
    const byEntity = new Map<string, { entity: ExtractedEntity; ids: Set<string>; oldest: string; newest: string }>()
    let after: { at: string; id: string } | null = null
    for (;;) {
      const rows = await deps.page(from, to, after, RELINK_PAGE)
      for (const [i, r] of rows.entries()) {
        stats.reports++
        let entities: ExtractedEntity[] = []
        try { entities = entitiesToLink(r) } catch (err) { logger.debug({ err, id: r.id }, 'Entities re-link: a report not read (non-fatal)') }
        if (entities.length) stats.linked++
        for (const e of entities) {
          const key = `${e.type}:${e.name}`
          const g = byEntity.get(key) ?? { entity: e, ids: new Set<string>(), oldest: r.created_at, newest: r.created_at }
          if (g.ids.has(r.id)) continue
          g.ids.add(r.id)
          if (r.created_at < g.oldest) g.oldest = r.created_at
          if (r.created_at > g.newest) g.newest = r.created_at
          byEntity.set(key, g)
          stats.links++
        }
        // room for the scraper's own work between reports
        if (i % YIELD_EVERY === YIELD_EVERY - 1) await deps.pause(0)
      }
      if (rows.length < RELINK_PAGE) break
      const last = rows[rows.length - 1]!
      after = { at: last.created_at, id: last.id }
      await deps.pause(PAUSE_MS.page)
    }
    // the most-named first, so the day's share linked rises soonest
    const groups = [...byEntity.values()].sort((a, b) => b.ids.size - a.ids.size || a.entity.name.localeCompare(b.entity.name))
    for (const g of groups) {
      try {
        stats.added += await deps.link(g.entity, [...g.ids], g.oldest, g.newest)
        stats.entities++
      } catch (err) {
        stats.failed++
        logger.warn({ err, entity: g.entity.name }, 'Entities re-link: an entity not written (non-fatal)')
      }
      await deps.pause(g.ids.size >= SMALL_ENTITY ? PAUSE_MS.entity : PAUSE_MS.small)
    }
    total.days++; total.reports += stats.reports; total.linked += stats.linked; total.links += stats.links
    total.added += stats.added; total.failed += stats.failed
    await deps.setDayDone(day, stats, total, windows.length)
    logger.info(stats, 'Entities re-link: a day of reports linked')
    await deps.pause(PAUSE_MS.day)
  }
  return total
}

// ─── The live parts ──────────────────────────────────────────────────────────

export const liveRelinkDeps: RelinkDeps = {
  async page(from, to, after, limit) {
    // created_at as text: the cursor keeps its microseconds
    const { rows } = await db.raw(
      `SELECT id::text AS id, title, summary, language, created_at::text AS created_at
         FROM signals
        WHERE created_at >= ?::timestamptz AND created_at < ?::timestamptz
          ${after ? 'AND (created_at, id) > (?::timestamptz, ?::uuid)' : ''}
        ORDER BY created_at, id
        LIMIT ?`,
      [from.toISOString(), to.toISOString(), ...(after ? [after.at, after.id] : []), limit],
    ) as { rows: Array<Record<string, unknown>> }
    return rows.map(r => ({
      id: String(r.id), title: String(r.title ?? ''), summary: r.summary == null ? null : String(r.summary),
      language: r.language == null ? null : String(r.language), created_at: String(r.created_at),
    }))
  },
  link: linkEntityToReports,
  async dayDone() {
    return redis.get(DAY_DONE_KEY)
  },
  async setDayDone(day, stats, total, of) {
    const before = JSON.parse((await redis.get(PROGRESS_KEY).catch(() => null)) ?? '{}') as Partial<RelinkTotal> & { days_done?: number }
    const progress = {
      days_done: (before.days_done ?? 0) + 1,
      of,
      last_day: day,
      // the totals of every run so far (a restart starts its own count at the day it was in)
      reports: (before.reports ?? 0) + stats.reports,
      linked: (before.linked ?? 0) + stats.linked,
      links: (before.links ?? 0) + stats.links,
      added: (before.added ?? 0) + stats.added,
      failed: (before.failed ?? 0) + stats.failed,
      this_run: total,
      updated: new Date().toISOString(),
    }
    await redis.set(PROGRESS_KEY, JSON.stringify(progress), 'EX', KEEP_S)
    await redis.set(DAY_DONE_KEY, day, 'EX', KEEP_S)
  },
  pause: ms => new Promise(resolve => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve))),
}
