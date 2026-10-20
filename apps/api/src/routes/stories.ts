/**
 * Stories: the signals the scraper's same-story rule linked (signals.story_id,
 * plan item 12b). GET /api/v1/stories/:id lists them oldest first, so a page
 * can show when each outlet picked the story up and when it turned verified.
 * GET /api/v1/stories lists the stories most outlets are reporting right now
 * (the home page's "Developing Stories", plan item 12e).
 */

import type { FastifyPluginAsync } from 'fastify'
import type { Knex } from 'knex'
import { db } from '../db/postgres'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'
import { parseQuery, StoryListQuerySchema } from '../lib/query-schemas'
import { signalsHaveStoryIds, hostOf } from '../lib/stories'
import { rankStories, textArray, EVENT_TEMPLATE_SQL, type StoryCandidate, type ListedStory } from '../lib/story-list'
import { staleWhileRevalidate, keptAge, remakeNow, type SwrOptions } from '../lib/swr-cache'
import { longQuery } from '../lib/long-query'
import { isoWeekOf, parseWeek, weekBounds, weekName, previousWeek, type IsoWeek } from '../lib/week'
import { logger } from '../lib/logger'
import { entityDirectory } from '../lib/entity-directory'
import { COUNTRY_NAMES } from './countries'
import { findReport, MAX_LINK_LENGTH } from '../lib/link-check'
import { internalCallHeaders } from '../lib/internal-call'
import { rateLimitKey } from '../lib/rate-limit-options'
import { inCountedWindow, STORY_COUNT_HOURS } from '../lib/story-window'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SIGNALS = 50
/** Of those, the story's first reports; the rest are its latest */
const FIRST_REPORTS = 10

/** Stories looked at per list request: the ones most recently reported */
const MAX_CANDIDATES = 600
/** Signals one /stories/outlets request may ask about (the map's list shows 60) */
const MAX_OUTLET_IDS = 60
/** An article link's website, for Postgres (bound as values: a "?" in knex's SQL is a placeholder) */
const HOST_PATTERN = '^https?://([^/:?#]+)'
const WWW_PATTERN = '^www\\.'
/**
 * Seconds a story list is reused; then it is served while one process remakes
 * it (lib/swr-cache.ts). A day's list took 20 s to make on Oct 15, 2026, so
 * remaking it every 2 minutes kept the database busy a sixth of the time
 */
const LIST_CACHE_TTL = 600
/** Seconds a kept list may still be served when remaking it fails */
const LIST_KEEP_SECONDS = 6 * 3_600
/**
 * Seconds the list's query may take (lib/long-query.ts): over a day of
 * reports it took about 5.5 s on Oct 15, 2026, past the pool's 5, and every
 * request answered 500 (Developing Stories, HQ's drafts)
 */
const LIST_QUERY_SECONDS = 60
/** The sitemap's stories: verified in the last this many days, at most SITEMAP_MAX (a sitemap file holds 50,000) */
const SITEMAP_DAYS = 7
const SITEMAP_MAX = 5_000
const SITEMAP_CACHE_KEY = 'stories:sitemap:v3'
const SITEMAP_CACHE_TTL = 1_800

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical']
/** A week's page (GET /stories/week): its top stories, busiest countries and the people most in the news */
const WEEK_STORIES = 15
const WEEK_COUNTRIES = 12
const WEEK_PEOPLE = 10
/** The week under way: kept 15 minutes, then served for a day while one process remakes it */
const CURRENT_WEEK_KEEP: SwrOptions = { freshSeconds: 900, staleSeconds: 24 * 3_600, lockSeconds: 2 * LIST_QUERY_SECONDS }
/**
 * A finished week hardly changes: kept a day, then served for 30 days while
 * remade. Making one takes up to a minute (2026-W41: 42 s on Oct 20, 2026,
 * when its page answered 500 after 20 s), so it is made in the background
 * (warmWeeks), never while a visitor waits
 */
const FINISHED_WEEK_KEEP: SwrOptions = { freshSeconds: 24 * 3_600, staleSeconds: 30 * 86_400, lockSeconds: 2 * LIST_QUERY_SECONDS }
/** The finished weeks kept made: the ones the website's sitemap lists */
const WARM_FINISHED_WEEKS = 4
/** How often warmWeeks looks (each look costs a Redis read per week when all are fresh) */
const WARM_WEEKS_MS = 30 * 60_000

const MEMBER_COLUMNS = `s.id, s.title, s.category::text AS category, s.status::text AS status,
         CASE s.severity::text WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END AS sev_rank,
         s.reliability_score, s.location_name, s.original_urls, s.created_at, s.verified_at`

/**
 * The stories reported since the first binding (newest first, at most
 * MAX_CANDIDATES), each with its size, times, highest severity, usual place
 * and category, every member's links (the most reliable members' first), and
 * a lead: a member with a real headline (not GDELT's "<event> in <place>",
 * the second binding), reported in the story's last 6 hours, verified and
 * reliable if possible.
 * A story is the signals sharing story_id, or a signal no story has claimed
 * whose links come from at least two addresses.
 */
export function storyListSql(hasStoryIds: boolean, scope: 'recent' | 'signals' | 'week' | 'country' = 'recent'): string {
  // scope 'signals': only the stories of the signals in an extra first binding
  // (uuid[]), e.g. the reports that name one entity (lib/entity-profile.ts).
  // scope 'country': only stories with a report placed in the country of an
  // extra first binding (its two-letter code; a country's page, plan 14)
  // scope 'week': reported between the first two bindings (from, to), the
  // biggest stories first instead of the newest, and only the week's own
  // reports counted, so a finished week stays as it was and a story running
  // for months doesn't top every week (GET /stories/week, plan G11)
  const week = scope === 'week'
  const only = scope === 'signals' ? 'id = ANY(?::uuid[]) AND ' : scope === 'country' ? 'country_code = ? AND ' : ''
  const since = week ? 'created_at >= (SELECT lo FROM win) AND created_at < (SELECT hi FROM win)' : 'created_at >= ?'
  const inWeek = week ? ' AND s.created_at >= (SELECT lo FROM win) AND s.created_at < (SELECT hi FROM win)' : ''
  const order = week ? 'count(*) DESC, max(created_at) DESC' : 'max(created_at) DESC'
  const active = hasStoryIds
    ? `SELECT COALESCE(story_id, id) AS story_key
         FROM signals
        WHERE ${only}${since} AND status IN ('verified', 'pending')
          AND (story_id IS NOT NULL OR cardinality(original_urls) >= 2)
        GROUP BY 1`
    : `SELECT id AS story_key
         FROM signals
        WHERE ${only}${since} AND status IN ('verified', 'pending')
          AND cardinality(original_urls) >= 2
        GROUP BY 1`
  const members = hasStoryIds
    ? `SELECT ${MEMBER_COLUMNS}, s.story_id AS story_key
         FROM signals s JOIN active a ON s.story_id = a.story_key
        WHERE s.status IN ('verified', 'pending')${inWeek}
       UNION ALL
       SELECT ${MEMBER_COLUMNS}, s.id AS story_key
         FROM signals s JOIN active a ON s.id = a.story_key
        WHERE s.story_id IS NULL AND s.status IN ('verified', 'pending')${inWeek}`
    : `SELECT ${MEMBER_COLUMNS}, s.id AS story_key
         FROM signals s JOIN active a ON s.id = a.story_key
        WHERE s.status IN ('verified', 'pending')${inWeek}`
  return `
    WITH ${week ? 'win AS (SELECT ?::timestamptz AS lo, ?::timestamptz AS hi), ' : ''}active AS (
      ${active}
      ORDER BY ${order}
      LIMIT ${MAX_CANDIDATES}
    ),
    members AS (
      ${members}
    ),
    facts AS (
      SELECT story_key,
             count(*)::int                                  AS size,
             min(created_at)                                AS first_seen,
             max(created_at)                                AS newest,
             min(verified_at)                               AS verified_at,
             max(sev_rank)                                  AS sev_rank,
             MODE() WITHIN GROUP (ORDER BY location_name)   AS place,
             MODE() WITHIN GROUP (ORDER BY category)        AS category
        FROM members
       GROUP BY story_key
    ),
    links AS (
      -- recent_urls: the members of the story's counted window (its last two
      -- days, lib/story-window.ts); a week counts its own reports
      SELECT m.story_key,
             array_agg(u.url ORDER BY m.reliability_score DESC NULLS LAST, m.created_at, u.ord) AS urls,
             array_agg(u.url ORDER BY m.reliability_score DESC NULLS LAST, m.created_at, u.ord)
               FILTER (WHERE ${week ? 'TRUE' : inCountedWindow('m.created_at', 'f.newest')}) AS recent_urls
        FROM members m
        JOIN facts f ON f.story_key = m.story_key
        CROSS JOIN LATERAL unnest(m.original_urls) WITH ORDINALITY AS u(url, ord)
       WHERE u.url IS NOT NULL
       GROUP BY m.story_key
    ),
    leads AS (
      SELECT DISTINCT ON (m.story_key) m.story_key, m.id::text AS lead_id, m.title
        FROM members m
        JOIN facts f ON f.story_key = m.story_key
       ORDER BY m.story_key,
                (m.title ~ ?) ASC,
                (m.created_at >= f.newest - INTERVAL '6 hours') DESC,
                (m.status = 'verified') DESC,
                m.reliability_score DESC NULLS LAST,
                m.created_at DESC
    )
    SELECT f.story_key::text AS story_key, f.size, f.first_seen, f.newest, f.verified_at,
           f.sev_rank, f.place, f.category, COALESCE(l2.urls, '{}') AS urls,
           COALESCE(l2.recent_urls, '{}') AS recent_urls, l.lead_id, l.title
      FROM facts f
      JOIN leads l ON l.story_key = f.story_key
      LEFT JOIN links l2 ON l2.story_key = f.story_key`
}

/**
 * The stories most outlets reported in the last `hours`, ranked as
 * GET /api/v1/stories ranks them (also the email briefing's stories, plan G4).
 */
export async function topStories(hours: number, limit: number, country?: string): Promise<ListedStory[]> {
  const since = new Date(Date.now() - hours * 3_600_000)
  const hasStoryIds = await signalsHaveStoryIds()
  const result = country
    ? await longQuery(LIST_QUERY_SECONDS, trx => trx.raw(storyListSql(hasStoryIds, 'country'), [country, since, EVENT_TEMPLATE_SQL]))
    : await longQuery(LIST_QUERY_SECONDS, trx => trx.raw(storyListSql(hasStoryIds), [since, EVENT_TEMPLATE_SQL]))
  return rankStories(candidatesOf(result), limit)
}

/**
 * The stories reported between `from` and `to` (a day, a week), the biggest
 * first, with only that window's own reports counted and no fading with age,
 * as a finished week ranks them (GET /stories/week; a past day's briefing)
 */
export async function storiesBetween(from: Date, to: Date, limit: number): Promise<ListedStory[]> {
  const hasStoryIds = await signalsHaveStoryIds()
  const result = await longQuery(LIST_QUERY_SECONDS, trx => trx.raw(storyListSql(hasStoryIds, 'week'), [from, to, EVENT_TEMPLATE_SQL]))
  return rankStories(candidatesOf(result), limit, to.getTime(), { decay: false })
}

/**
 * The stories that the given signals belong to, reported in the last
 * `hours`, ranked as topStories ranks them (two outlets or more, real
 * headlines, each event once). For an entity's page: the stories that name it.
 */
/** `q`: the connection to read on (the pool's, or a longQuery transaction with its own time limit) */
export async function storiesOfSignals(signalIds: string[], hours: number, limit: number, q: Knex | Knex.Transaction = db): Promise<ListedStory[]> {
  const ids = [...new Set(signalIds.filter(id => UUID_RE.test(id)).map(id => id.toLowerCase()))]
  if (ids.length === 0) return []
  const since = new Date(Date.now() - hours * 3_600_000)
  const result = await q.raw(storyListSql(await signalsHaveStoryIds(), 'signals'), [ids, since, EVENT_TEMPLATE_SQL])
  return rankStories(candidatesOf(result), limit)
}

function candidatesOf(result: unknown): StoryCandidate[] {
  const rows = (result as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? []
  const candidates: StoryCandidate[] = []
  for (const r of rows) {
    const updatedAt = new Date(r.newest as string)
    const firstSeenAt = new Date(r.first_seen as string)
    if (Number.isNaN(updatedAt.getTime()) || Number.isNaN(firstSeenAt.getTime()) || !r.lead_id) continue
    candidates.push({
      key:         String(r.story_key),
      leadId:      String(r.lead_id),
      title:       typeof r.title === 'string' ? r.title : '',
      category:    typeof r.category === 'string' ? r.category : null,
      place:       typeof r.place === 'string' && r.place.trim() !== '' ? r.place.trim() : null,
      severity:    SEVERITIES[Number(r.sev_rank) - 1] ?? 'info',
      size:        Number(r.size) || 1,
      urls:        textArray(r.urls),
      recentUrls:  textArray(r.recent_urls),
      firstSeenAt,
      updatedAt,
      verifiedAt:  r.verified_at ? new Date(r.verified_at as string) : null,
    })
  }
  return candidates
}

export async function weekDigest(week: IsoWeek, underWay: boolean) {
  const { start, end } = weekBounds(week)
  const until = underWay ? new Date() : end
  const hasStoryIds = await signalsHaveStoryIds()
  const storyKey = hasStoryIds ? 'COALESCE(story_id, id)' : 'id'
  const [stories, countryResult, directory] = await Promise.all([
    longQuery(LIST_QUERY_SECONDS, trx => trx.raw(storyListSql(hasStoryIds, 'week'), [start, until, EVENT_TEMPLATE_SQL]))
      .then(r => rankStories(candidatesOf(r), WEEK_STORIES, until.getTime(), { decay: false })),
    longQuery(LIST_QUERY_SECONDS, trx => trx.raw(
      `SELECT country_code AS code, count(DISTINCT ${storyKey})::int AS stories
         FROM signals
        WHERE status = 'verified' AND created_at >= ? AND created_at < ? AND country_code ~ '^[A-Z]{2}$'
        GROUP BY 1 ORDER BY 2 DESC LIMIT ?`,
      [start, until, WEEK_COUNTRIES + 4],
    )),
    underWay ? entityDirectory().catch(() => null) : Promise.resolve(null),
  ])
  const countryRows = ((countryResult as { rows?: Array<{ code: string; stories: number }> } | undefined)?.rows ?? [])
  const countries = countryRows
    .filter(r => r.code !== 'UK' && COUNTRY_NAMES[r.code])
    .slice(0, WEEK_COUNTRIES)
    .map(r => ({ code: r.code, name: COUNTRY_NAMES[r.code]!, stories: Number(r.stories) || 0 }))
  const people = directory
    ? (directory.groups.find(g => g.key === 'people')?.entities ?? []).slice(0, WEEK_PEOPLE).map(e => ({ id: e.id, name: e.name, reports: e.last7d }))
    : null
  return {
    week: weekName(week),
    start: start.toISOString(),
    end: end.toISOString(),
    underWay,
    stories,
    countries,
    people,
    generatedAt: new Date().toISOString(),
  }
}

/** Where a week's digest is kept; the week under way is kept apart from the finished week it becomes */
export function weekCacheKey(week: IsoWeek, underWay: boolean): string {
  return `stories:week:v2:${weekName(week)}${underWay ? ':so-far' : ''}`
}

/**
 * A week's digest as kept (GET /stories/week): the week under way, made
 * while the caller waits if nothing is kept; a finished week, null while it
 * is made in the background
 */
export async function keptWeek(week: IsoWeek, underWay: boolean): Promise<{ success: true; data: Awaited<ReturnType<typeof weekDigest>> } | null> {
  const make = async () => ({ success: true as const, data: await weekDigest(week, underWay) })
  return underWay
    ? staleWhileRevalidate(weekCacheKey(week, true), CURRENT_WEEK_KEEP, make)
    : staleWhileRevalidate<{ success: true; data: Awaited<ReturnType<typeof weekDigest>> } | null>(weekCacheKey(week, false), FINISHED_WEEK_KEEP, make, async () => null)
}

/**
 * Keeps the week under way and the last 4 finished weeks (the ones the
 * sitemap lists) made, one at a time, so no visitor or search engine waits
 * for one: each is made again once it is no longer fresh. Returns the weeks
 * it made.
 */
export async function warmWeeks(now = new Date()): Promise<string[]> {
  const current = isoWeekOf(now)
  const weeks: Array<{ week: IsoWeek; underWay: boolean }> = [{ week: current, underWay: true }]
  let w = current
  for (let i = 0; i < WARM_FINISHED_WEEKS; i++) { w = previousWeek(w); weeks.push({ week: w, underWay: false }) }
  const made: string[] = []
  for (const { week, underWay } of weeks) {
    const key = weekCacheKey(week, underWay)
    const keep = underWay ? CURRENT_WEEK_KEEP : FINISHED_WEEK_KEEP
    const age = await keptAge(key)
    if (age !== null && age < keep.freshSeconds) continue
    const ok = await remakeNow(key, keep, async () => ({ success: true as const, data: await weekDigest(week, underWay) }))
      .catch(err => { logger.warn({ err, week: weekName(week) }, 'Week digest could not be made (it is tried again later)'); return false })
    if (ok) made.push(weekName(week))
  }
  return made
}

let warmTimer: ReturnType<typeof setInterval> | null = null

/** warmWeeks a minute after start, then every 30 minutes */
export function startWeekWarmer(): void {
  if (warmTimer) return
  const run = () => {
    void warmWeeks()
      .then(made => { if (made.length) logger.info({ weeks: made }, 'WorldPulse Week digests made') })
      .catch(() => {})
  }
  setTimeout(run, 60_000).unref?.()
  warmTimer = setInterval(run, WARM_WEEKS_MS)
  warmTimer.unref?.()
}

export function stopWeekWarmer(): void {
  if (warmTimer) clearInterval(warmTimer)
  warmTimer = null
}

export const registerStoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['stories']
  })

  /**
   * GET /api/v1/stories?hours=12&limit=6 (&country=NG: only stories with a
   * report placed in that country, for its page, plan 14, Oct 20, 2026)
   * The stories most outlets are reporting: reported in the last `hours`
   * (1-72) by at least two outlets, ranked by how many outlets and how serious,
   * halving every 6 hours since the last report; each event once.
   */
  app.get('/', { preHandler: [optionalAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const qr = parseQuery(StoryListQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { hours, limit, country } = qr.data

    // The kept list at once; when it is 2 minutes old, one process remakes it in the background
    const response = await staleWhileRevalidate(
      country ? `stories:list:v2:${country}:${hours}:${limit}` : `stories:list:v2:${hours}:${limit}`,
      { freshSeconds: LIST_CACHE_TTL, staleSeconds: LIST_KEEP_SECONDS, lockSeconds: LIST_QUERY_SECONDS * 2 },
      async () => ({
        success: true,
        data: { stories: await topStories(hours, limit, country), hours, ...(country ? { country } : {}), generatedAt: new Date().toISOString() },
      }),
    )
    return reply.send(response)
  })

  /**
   * GET /api/v1/stories/sitemap
   * The pages search engines should know about (world-pulse.io/sitemap.xml,
   * plan G2): one address per verified story of the last SITEMAP_DAYS days,
   * newest first. A story's address is its most reliable verified report with
   * a real headline (not GDELT's "<event> in <place>"). Reused for 30 minutes.
   */
  app.get('/sitemap', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const response = await staleWhileRevalidate(
      SITEMAP_CACHE_KEY,
      { freshSeconds: SITEMAP_CACHE_TTL, staleSeconds: 24 * 3_600, lockSeconds: 2 * LIST_QUERY_SECONDS },
      storySitemap,
    )
    return reply.send(response)
  })

  /**
   * GET /api/v1/stories/week?week=2026-W43 (plan G11 slice 1, Oct 20, 2026):
   * "WorldPulse Week": the week's top stories ranked by independent outlets
   * (each event once, no fading with age), its busiest countries by verified
   * stories, and for the week under way the people most in the news (the
   * entity directory's last 7 days). Without ?week, the week under way.
   * Weeks run Monday to Monday, UTC. Kept: the week under way for 15 minutes,
   * finished weeks for 6 hours, each served while one process remakes it.
   */
  app.get('/week', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const asked = (req.query as { week?: string }).week
    const now = new Date()
    const current = isoWeekOf(now)
    const week = asked ? parseWeek(asked) : current
    if (!week) return sendError(reply, 400, 'VALIDATION_ERROR', 'week must be an ISO week like 2026-W43')
    if (weekBounds(week).start.getTime() > now.getTime()) return sendError(reply, 404, 'NOT_FOUND', 'That week has not started yet')
    const underWay = weekName(week) === weekName(current)
    const response = await keptWeek(week, underWay)
    if (!response) {
      // A finished week nobody has asked for yet: being made in the background
      reply.header('retry-after', '120')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'This week is being put together; try again in a couple of minutes')
    }
    return reply.send(response)
  })

  /** A week of verified stories (3 s on Oct 15, 2026, and growing): its own time limit, off the request path */
  async function storySitemap() {
    const storyKey = await signalsHaveStoryIds() ? 'COALESCE(s.story_id, s.id)' : 's.id'
    const since = new Date(Date.now() - SITEMAP_DAYS * 86_400_000)
    const result = await longQuery(LIST_QUERY_SECONDS, trx => trx.raw(
      `SELECT id, title, published, updated FROM (
         SELECT DISTINCT ON (${storyKey}) s.id::text AS id, s.title, s.created_at AS published,
                GREATEST(s.created_at, COALESCE(s.last_updated, s.created_at)) AS updated
           FROM signals s
          WHERE s.status = 'verified' AND s.created_at >= ?
          ORDER BY ${storyKey}, (s.title ~ ?) ASC, s.reliability_score DESC NULLS LAST, s.created_at ASC
       ) t ORDER BY updated DESC LIMIT ?`,
      [since, EVENT_TEMPLATE_SQL, SITEMAP_MAX],
    ))
    const rows = (result as { rows?: Array<{ id: unknown; title: unknown; published: unknown; updated: unknown }> } | undefined)?.rows ?? []
    const stories = rows.flatMap(r => {
      const at = new Date(r.updated as string)
      const published = new Date(r.published as string)
      if (!UUID_RE.test(String(r.id)) || Number.isNaN(at.getTime())) return []
      // title and publishedAt serve the news sitemap (world-pulse.io/news-sitemap.xml, plan G16)
      return [{
        id: String(r.id),
        title: typeof r.title === 'string' ? r.title : '',
        publishedAt: (Number.isNaN(published.getTime()) ? at : published).toISOString(),
        updatedAt: at.toISOString(),
      }]
    })
    return { success: true, data: { stories, days: SITEMAP_DAYS, generatedAt: new Date().toISOString() } }
  }

  /**
   * GET /api/v1/stories/outlets?ids=<signal ids, comma-separated, up to 60>
   * For each signal: its story, how many reports the story has and how many
   * outlets carried it (counted as /stories/:id counts them: the websites in
   * the links of its last two days' reports, and outletsAll since it began)
   * and whether it is verified, so a list of signals —
   * the World Map's "Latest in view" — can say "Verified · 12 outlets".
   * Unknown ids are left out.
   */
  // GET /api/v1/stories/by-link?url=<a news article's address>: the story the
  // article belongs to, with how many outlets reported it and which ones, among
  // the articles WorldPulse has collected ("paste a link, get the count",
  // version 1, Oct 20, 2026; lib/link-check.ts). The link itself is never fetched.
  app.get('/by-link', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { url } = req.query as { url?: unknown }
    if (typeof url !== 'string' || !url.trim()) return sendError(reply, 400, 'VALIDATION_ERROR', 'url: paste the address of a news article')
    if (url.length > MAX_LINK_LENGTH) return sendError(reply, 400, 'VALIDATION_ERROR', `url: at most ${MAX_LINK_LENGTH} characters`)

    const found = await findReport(url)
    if (found.status !== 'found') return reply.send({ success: true, data: { found: false, reason: found.status } })

    // The story, exactly as GET /stories/:id answers it, counted as this client's own call
    const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${found.reportId}`, headers: internalCallHeaders(rateLimitKey(req)) })
    if (res.statusCode === 429) return sendError(reply, 429, 'RATE_LIMITED', 'Too many requests; try again in a minute')
    if (res.statusCode === 404) return reply.send({ success: true, data: { found: false, reason: 'not_seen' } })
    if (res.statusCode !== 200) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The story could not be loaded just now; try again in a minute')
    const story = (res.json() as { data?: Record<string, unknown> }).data ?? {}
    const reports = Array.isArray(story.signals) ? story.signals as Array<Record<string, unknown>> : []
    const report = reports.find(r => r.id === found.reportId) ?? reports[0] ?? {}
    const times = reports.map(r => (typeof r.createdAt === 'string' ? r.createdAt : '')).filter(Boolean).sort()
    return reply.send({
      success: true,
      data: {
        found: true,
        /** How it was found: the news readers' article claim, or a report's links */
        via: found.via,
        report: {
          id: found.reportId,
          title: report.title ?? null,
          outlet: report.outlet ?? null,
          url: report.url ?? null,
          status: report.status ?? null,
          createdAt: report.createdAt ?? null,
        },
        story: {
          id: story.storyId ?? found.reportId,
          /** Websites that carried it in its last two days (lib/story-window.ts) */
          outlets: Number(story.outlets) || 0,
          /** Those websites, A to Z */
          outletNames: Array.isArray(story.outletNames) ? story.outletNames : [],
          /** Websites that carried it since it began */
          outletsAll: Number(story.outletsAll) || Number(story.outlets) || 0,
          verified: typeof story.verifiedAt === 'string',
          verifiedAt: story.verifiedAt ?? null,
          /** Reports in the story */
          size: Number(story.size) || reports.length,
          firstReportAt: story.firstReportAt ?? times[0] ?? null,
          latestReportAt: story.latestReportAt ?? times[times.length - 1] ?? null,
        },
        link: `${(process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')}/signals/${found.reportId}`,
      },
    })
  })

  app.get('/outlets', { preHandler: [optionalAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = String((req.query as { ids?: unknown } | undefined)?.ids ?? '')
    const ids = [...new Set(raw.split(',').map(v => v.trim()).filter(v => UUID_RE.test(v)))].slice(0, MAX_OUTLET_IDS)
    if (ids.length === 0) return reply.send({ success: true, data: { stories: {} } })

    const hasStories = await signalsHaveStoryIds()
    const storyKey = hasStories ? 'COALESCE(s.story_id, s.id)' : 's.id'
    const inStory = hasStories ? '(m.story_id = a.story_key OR m.id = a.story_key)' : 'm.id = a.story_key'
    const result = await db.raw(
      `WITH asked AS (
         SELECT s.id, ${storyKey} AS story_key FROM signals s WHERE s.id = ANY(?::uuid[])
       )
       SELECT a.id::text AS id, a.story_key::text AS story_id, f.size, f.verified, f.first_at, o.outlets, o.outlets_all
         FROM asked a
         CROSS JOIN LATERAL (
           SELECT count(*)::int AS size, bool_or(m.status = 'verified') AS verified,
                  min(m.created_at) AS first_at, max(m.created_at) AS newest
             FROM signals m
            WHERE ${inStory} AND m.status IN ('verified', 'pending')
         ) f
         CROSS JOIN LATERAL (
           -- the story's last two days, as /stories/:id counts them (lib/story-window.ts)
           SELECT count(DISTINCT lower(regexp_replace(substring(link.url from ?), ?, '')))
                    FILTER (WHERE ${inCountedWindow('m.created_at', 'f.newest')})::int AS outlets,
                  count(DISTINCT lower(regexp_replace(substring(link.url from ?), ?, '')))::int AS outlets_all
             FROM signals m CROSS JOIN LATERAL unnest(m.original_urls) AS link(url)
            WHERE ${inStory} AND m.status IN ('verified', 'pending')
         ) o`,
      [ids, HOST_PATTERN, WWW_PATTERN, HOST_PATTERN, WWW_PATTERN],
    ) as { rows?: Array<{ id: string; story_id: string; size: unknown; verified: unknown; first_at?: unknown; outlets: unknown; outlets_all: unknown }> } | undefined

    // (verified: any of the story's reports is, as the story page and the home page say)
    const stories: Record<string, { storyId: string; size: number; outlets: number; outletsAll: number; firstReportAt: string | null; verified: boolean }> = {}
    for (const r of result?.rows ?? []) {
      const outlets = Number(r.outlets) || 0
      const firstAt = r.first_at ? new Date(r.first_at as string | Date) : null
      stories[String(r.id)] = {
        storyId:    String(r.story_id),
        size:       Number(r.size) || 1,
        /** in the story's last two days (lib/story-window.ts) */
        outlets,
        /** since its first report ("· 143 since Oct 10") */
        outletsAll: Math.max(Number(r.outlets_all) || 0, outlets),
        firstReportAt: firstAt && Number.isFinite(firstAt.getTime()) ? firstAt.toISOString() : null,
        verified:   r.verified === true,
      }
    }
    return reply.send({ success: true, data: { stories } })
  })

  /**
   * GET /api/v1/stories/:id
   * One story's signals, oldest first. :id is a storyId from
   * /api/v1/feed/signals?group=story, or the id of any signal in the story.
   */
  app.get('/:id', { preHandler: [optionalAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return sendError(reply, 400, 'VALIDATION_ERROR', 'id: must be a story or signal id')

    const hasStories = await signalsHaveStoryIds()
    let storyId = id
    if (hasStories) {
      const row = await db('signals').where('id', id).first('story_id') as { story_id?: string | null } | undefined
      if (row?.story_id) storyId = String(row.story_id)
    }

    // A big story (the Riyadh airport attack had 80+ reports) is its start and
    // its latest reports, plus the one asked for; size and outlets count them all.
    // Outlets are the websites in every report's links, as the story list
    // counts them: an outlet whose article was merged into another report (a
    // duplicate) has no report of its own but carried the story. Until Oct 11
    // this counted each report's first link only, so the signal page said 51
    // outlets where the home page said 55.
    // (A literal ? in knex's raw SQL is written \\?, or it takes it for a value.)
    const scope = hasStories ? '(story_id = ? OR id = ?)' : 'id = ?'
    const scopeParams = hasStories ? [storyId, storyId] : [storyId]
    const result = await db.raw(
      `WITH m AS (
         SELECT id, title, status, severity, category, reliability_score, original_urls, location_name,
                created_at, verified_at,
                row_number() OVER (ORDER BY created_at ASC, id ASC)   AS position,
                row_number() OVER (ORDER BY created_at DESC, id DESC) AS from_end,
                count(*) OVER ()                                       AS total,
                min(verified_at) OVER ()                               AS first_verified,
                min(created_at) OVER ()                                AS first_at,
                max(created_at) OVER ()                                AS newest
           FROM signals
          WHERE status IN ('verified', 'pending') AND ${scope}
       ),
       links AS (
         SELECT lower(regexp_replace(substring(link.url from '^https\\?://([^/:\\?#]+)'), '^www\\.', '')) AS host, s.created_at
           FROM signals s
           CROSS JOIN LATERAL unnest(s.original_urls) AS link(url)
          WHERE s.status IN ('verified', 'pending') AND ${scope.replace(/story_id|\bid\b/g, c => `s.${c}`)}
       ),
       newest AS (SELECT max(created_at) AS t FROM m),
       -- each website once; recent: it carried the story in its last two days (lib/story-window.ts)
       hosts AS (
         SELECT l.host, bool_or(${inCountedWindow('l.created_at', 'n.t')}) AS recent
           FROM links l CROSS JOIN newest n
          WHERE l.host <> ''
          GROUP BY l.host
       )
       SELECT m.*,
              (SELECT count(*) FROM hosts WHERE recent)                         AS outlets,
              (SELECT array_agg(host ORDER BY host) FROM hosts WHERE recent)    AS outlet_names,
              (SELECT count(*) FROM hosts)                                      AS outlets_all,
              (SELECT array_agg(host ORDER BY host) FROM hosts)                 AS outlet_names_all
         FROM m
        WHERE position <= ? OR from_end <= ? OR id::text = ?
        ORDER BY created_at ASC, id ASC`,
      [...scopeParams, ...scopeParams, FIRST_REPORTS, MAX_SIGNALS - FIRST_REPORTS, id],
    ) as { rows: Array<Record<string, unknown>> }
    const members = result.rows
    if (members.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Story not found')

    const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)
    const total = Number(members[0]!.total) || members.length
    const outletNames = textArray(members[0]!.outlet_names)
    const outlets = Math.max(Number(members[0]!.outlets) || 0, outletNames.length)
    const outletNamesAll = textArray(members[0]!.outlet_names_all)
    const outletsAll = Math.max(Number(members[0]!.outlets_all) || 0, outlets, outletNamesAll.length)

    return reply.send({
      success: true,
      data: {
        storyId,
        /** Reports in the story (more than `signals` holds when it's big) */
        size: total,
        /** Websites that carried it in its last two days, from every report's links (lib/story-window.ts) */
        outlets,
        /** Those websites, A to Z */
        outletNames,
        /** Websites that carried it since it began, and their names, A to Z */
        outletsAll,
        outletNamesAll: outletNamesAll.length > 0 ? outletNamesAll : outletNames,
        /** The hours the count covers, up to the story's newest report */
        countedHours: STORY_COUNT_HOURS,
        firstReportAt: iso(members[0]!.first_at),
        latestReportAt: iso(members[0]!.newest),
        verifiedAt: iso(members[0]!.first_verified),
        signals: members.map(m => {
          // A signal's own article comes first; the story's other links follow it
          const urls = Array.isArray(m.original_urls) ? (m.original_urls as unknown[]).map(String) : []
          return {
            id:               m.id,
            title:            m.title,
            status:           m.status,
            severity:         m.severity,
            category:         m.category,
            reliabilityScore: Number(m.reliability_score ?? 0),
            outlet:           hostOf(urls[0]),
            url:              urls[0] ?? null,
            locationName:     m.location_name ?? null,
            createdAt:        iso(m.created_at),
            verifiedAt:       iso(m.verified_at),
            /** 1 for the first report; gaps show where reports were left out */
            position:         Number(m.position) || null,
          }
        }),
      },
    })
  })
}
