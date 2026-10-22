/**
 * The April–May archive's second outlets (Devon, Oct 22, 2026: "verify
 * April–May now by running the outlet matching over those weeks … PROCEED").
 *
 * From Apr 5 to May 20, 2026 WorldPulse saved every outlet's article as a
 * report of its own and never joined two outlets' reports of one story (the
 * outlet matching, correlate.ts, was off until Oct 10), so all of them stayed
 * pending with one outlet, and the public search, which shows verified reports
 * only, shows none of them. Those weeks hold their own second outlets: the same
 * story from another newsroom, saved as another report.
 *
 * Once, day by day, each pending one-outlet report of medium severity or more,
 * in English, is compared with the other reports of the day before, that day
 * and the day after, by the live second outlet's test (second-outlet.ts
 * otherOutlets: two shared headline words, the same-story test with no name
 * only one headline has, within 24 hours, another owner's newsroom, not a
 * feature, not a copy). Up to 3 matches join it: their links are listed with
 * it, its outlet count goes up and its reliability with it (as a merged
 * article's does), it turns verified when that makes two outlets and a
 * reliability of 0.65 or more, as of when the second outlet's report came (not
 * now: nothing treats a story from May as news), its page says so ("Also
 * reported by …"), the reports of one story share a story id, and the search
 * index gets it again (reindex.ts). No Claude cross-check: they are months
 * old, and the live finder's later matches stand on the same test.
 *
 * Bounded and resumable: a day at a time (the day done is kept), with pauses
 * for the scraper's other work. Progress: repair:archive-outlets:stats (GET
 * /api/v1/public/second-outlets, archive).
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { corroboratedReliabilitySql } from './correlate'
import { REPUBLISHED_URL, siteOf, type GdeltArticle } from './gdelt-articles'
import { candidatePairs, otherOutlets, searchable, storyTokens, MAX_ADDED, NOT_OUTLETS, type FoundOutlet, type HeldReport } from './second-outlet'
import { hostOf } from './signal-columns'
import { cleanUrl } from './text'
import { joinStory } from './stories'
import { queueReindex } from './reindex'

export const ARCHIVE_FIRST_DAY = '2026-04-05'
export const ARCHIVE_LAST_DAY = '2026-05-20'
export const STATS_KEY = 'repair:archive-outlets:stats'
const DAY_DONE_KEY = 'repair:archive-outlets:day'
const DAY_MS = 86_400_000
const HELD_SEVERITIES = new Set(['medium', 'high', 'critical'])
/** Reports compared at a time, between pauses */
const CHUNK = 400
const MAX_CANDIDATES = 40

/** A report of the archive: one outlet's article, or a story already joined */
export interface ArchiveReport extends HeldReport {
  status: string
  source_count: number
  created_at: Date
}

export interface ArchiveMatch { report: ArchiveReport; outlets: FoundOutlet[]; ids: string[] }

export interface ArchiveDayStats { day: string; reports: number; held: number; pairs: number; matched: number; outlets: number; verified: number }

/** A report as another outlet's article: its first link, headline, website and time */
function asArticle(r: ArchiveReport): (GdeltArticle & { id: string; tokens: string[] }) | null {
  const url = r.original_urls[0]
  if (!url || REPUBLISHED_URL.test(url) || !searchable(r)) return null
  const site = siteOf(hostOf(url))
  const at = new Date(r.published_at)
  if (!site || isNaN(at.getTime())) return null
  return { id: r.id, url, title: r.title, site, at, tokens: storyTokens(r.title) }
}

/**
 * Whether a report waits for a second outlet: pending, one outlet, medium or
 * more, news another outlet could carry, from a newsroom (not a republisher's
 * copy or an aggregator's)
 */
export function waitsForOutlet(r: ArchiveReport): boolean {
  const url = r.original_urls[0]
  if (!url || REPUBLISHED_URL.test(url) || NOT_OUTLETS.has(siteOf(hostOf(url)))) return false
  return r.status === 'pending' && (r.source_count || 1) <= 1 && HELD_SEVERITIES.has(r.severity) && searchable(r)
}

/**
 * The other outlets of one day's waiting reports, among the reports of the
 * day before, that day and the day after (`pool`); `day` is YYYY-MM-DD (UTC)
 */
export async function matchDay(day: string, pool: ArchiveReport[], pause: () => Promise<void> = () => new Promise(r => setImmediate(r))): Promise<{ matches: ArchiveMatch[]; held: number; pairs: number }> {
  const start = Date.parse(day + 'T00:00:00Z')
  const held = pool.filter(r => { const t = r.created_at.getTime(); return t >= start && t < start + DAY_MS && waitsForOutlet(r) })
  const articles = pool.map(asArticle).filter((a): a is NonNullable<ReturnType<typeof asArticle>> => a !== null)
  const matches: ArchiveMatch[] = []
  let pairs = 0
  for (let i = 0; i < held.length; i += CHUNK) {
    const chunk = held.slice(i, i + CHUNK)
    const found = candidatePairs(chunk.map(r => ({ tokens: storyTokens(r.title) })), articles)
    for (const [k, list] of found) {
      const report = chunk[k]!
      const best = list.map(a => articles[a]!).filter(a => a.id !== report.id).slice(0, MAX_CANDIDATES)
      pairs += best.length
      // "now" a day after the report: an article up to a day later is another outlet's report of it (the same-story test keeps it within 24 hours)
      const outlets = otherOutlets(report, best, new Date(new Date(report.published_at).getTime() + DAY_MS), MAX_ADDED)
      if (outlets.length) {
        const byUrl = new Map(best.flatMap(a => [[a.url, a.id], [cleanUrl(a.url), a.id]] as Array<[string, string]>))
        matches.push({ report, outlets, ids: outlets.map(o => byUrl.get(o.url)).filter((id): id is string => !!id) })
      }
    }
    await pause()
  }
  return { matches, held: held.length, pairs }
}

export interface ArchiveDeps {
  load(from: Date, to: Date): Promise<ArchiveReport[]>
  /** Adds the outlets to the report; true when it turned verified */
  apply(match: ArchiveMatch): Promise<boolean>
  dayDone(): Promise<string | null>
  setDayDone(day: string): Promise<void>
  count(stats: ArchiveDayStats): Promise<void>
  pause(ms: number): Promise<void>
}

/** Every day of the archive not done yet, oldest first; the totals */
export async function verifyArchive(deps: ArchiveDeps = liveArchiveDeps): Promise<{ days: number; held: number; matched: number; outlets: number; verified: number }> {
  const total = { days: 0, held: 0, matched: 0, outlets: 0, verified: 0 }
  const done = await deps.dayDone()
  for (let t = Date.parse(ARCHIVE_FIRST_DAY + 'T00:00:00Z'); t <= Date.parse(ARCHIVE_LAST_DAY + 'T00:00:00Z'); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    if (done && day <= done) continue
    const pool = await deps.load(new Date(t - DAY_MS), new Date(t + 2 * DAY_MS))
    const { matches, held, pairs } = await matchDay(day, pool, () => deps.pause(0))
    const stats: ArchiveDayStats = { day, reports: pool.length, held, pairs, matched: 0, outlets: 0, verified: 0 }
    for (const m of matches) {
      try {
        const verified = await deps.apply(m)
        stats.matched++
        stats.outlets += m.outlets.length
        if (verified) stats.verified++
      } catch (err) {
        logger.warn({ err, id: m.report.id }, 'Archive outlets: not added (non-fatal)')
      }
    }
    await deps.count(stats)
    await deps.setDayDone(day)
    total.days++; total.held += held; total.matched += stats.matched; total.outlets += stats.outlets; total.verified += stats.verified
    logger.info(stats, 'Archive outlets: a day of April–May compared')
    await deps.pause(2_000)
  }
  return total
}

// ─── The live parts ──────────────────────────────────────────────────────────

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export const liveArchiveDeps: ArchiveDeps = {
  async load(from, to) {
    const { rows } = await db.raw(
      `SELECT id, title, category, severity, status, source_count, source_ids, original_urls, location_name, tags,
              COALESCE(event_time, created_at) AS published_at, created_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM signals
        WHERE created_at >= ?::timestamptz AND created_at < ?::timestamptz
          AND status IN ('pending', 'verified', 'disputed')
          AND language = 'en' AND cardinality(original_urls) >= 1
        ORDER BY created_at
        LIMIT 150000`,
      [from.toISOString(), to.toISOString()],
    ) as { rows: Array<Record<string, unknown>> }
    return rows.map(r => ({
      id: String(r.id),
      title: String(r.title ?? ''),
      category: String(r.category ?? ''),
      severity: String(r.severity ?? ''),
      status: String(r.status ?? ''),
      source_count: Number(r.source_count ?? 1) || 1,
      source_ids: strings(r.source_ids),
      original_urls: strings(r.original_urls),
      location_name: (r.location_name as string | null) ?? null,
      lat: num(r.lat),
      lng: num(r.lng),
      tags: strings(r.tags),
      published_at: r.published_at as Date,
      created_at: new Date(r.created_at as string | Date),
    }))
  },

  async apply({ report, outlets, ids }) {
    const n = outlets.length
    // When the second outlet's report came (never before the report itself)
    const first = Math.min(...outlets.map(o => o.at.getTime()))
    const at = new Date(Math.max(first, new Date(report.published_at).getTime(), report.created_at.getTime()))
    const changed = await db('signals')
      .where('id', report.id)
      .where('status', 'pending')
      .whereRaw('COALESCE(source_count, 1) <= 1')
      .update({
        source_count:         db.raw('COALESCE(source_count, 1) + ?', [n]),
        original_urls:        db.raw('COALESCE(original_urls, ARRAY[]::text[]) || ?::text[]', [outlets.map(o => o.url)]),
        reliability_score:    corroboratedReliabilitySql(String(n)),
        last_corroborated_at: at,
      })
    if (!changed) return false
    const promoted = await db('signals')
      .where('id', report.id)
      .where('status', 'pending')
      .where('source_count', '>=', 2)
      .where('reliability_score', '>=', 0.65)
      .update({ status: 'verified', verified_at: at })
    await joinStory([report.id, ...ids]).catch(err => logger.warn({ err, id: report.id }, 'Archive outlets: story not joined (non-fatal)'))
    await db('verification_log').insert({
      signal_id:  report.id,
      check_type: 'corroboration',
      result:     'confirmed',
      confidence: 0.8,
      notes:      `Also reported by ${outlets.map(o => o.site).join(', ')} (found among WorldPulse's own reports of the same days, Oct 22, 2026)`,
    }).catch(err => logger.warn({ err, id: report.id }, 'Archive outlets: not logged on the report page'))
    await queueReindex([report.id]).catch(() => {})
    return promoted > 0
  },

  dayDone: () => redis.get(DAY_DONE_KEY),
  async setDayDone(day) { await redis.set(DAY_DONE_KEY, day, 'EX', 60 * 86_400) },

  async count(stats) {
    await redis.multi()
      .hincrby(STATS_KEY, 'days', 1)
      .hincrby(STATS_KEY, 'held', stats.held)
      .hincrby(STATS_KEY, 'pairs', stats.pairs)
      .hincrby(STATS_KEY, 'matched', stats.matched)
      .hincrby(STATS_KEY, 'outlets', stats.outlets)
      .hincrby(STATS_KEY, 'verified', stats.verified)
      .hset(STATS_KEY, 'last_day', stats.day, 'updated_at', new Date().toISOString())
      .expire(STATS_KEY, 60 * 86_400)
      .exec()
  },

  pause: (ms) => new Promise(resolve => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve))),
}
