/**
 * Stories: the signals the scraper's same-story rule linked (signals.story_id,
 * plan item 12b). GET /api/v1/stories/:id lists them oldest first, so a page
 * can show when each outlet picked the story up and when it turned verified.
 * GET /api/v1/stories lists the stories most outlets are reporting right now
 * (the home page's "Developing Stories", plan item 12e).
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'
import { parseQuery, StoryListQuerySchema } from '../lib/query-schemas'
import { signalsHaveStoryIds, hostOf } from '../lib/stories'
import { rankStories, textArray, EVENT_TEMPLATE_SQL, type StoryCandidate } from '../lib/story-list'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SIGNALS = 50
/** Of those, the story's first reports; the rest are its latest */
const FIRST_REPORTS = 10

/** Stories looked at per list request: the ones most recently reported */
const MAX_CANDIDATES = 600
/** Seconds a story list is reused */
const LIST_CACHE_TTL = 120

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical']

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
export function storyListSql(hasStoryIds: boolean): string {
  const active = hasStoryIds
    ? `SELECT COALESCE(story_id, id) AS story_key
         FROM signals
        WHERE created_at >= ? AND status IN ('verified', 'pending')
          AND (story_id IS NOT NULL OR cardinality(original_urls) >= 2)
        GROUP BY 1`
    : `SELECT id AS story_key
         FROM signals
        WHERE created_at >= ? AND status IN ('verified', 'pending')
          AND cardinality(original_urls) >= 2
        GROUP BY 1`
  const members = hasStoryIds
    ? `SELECT ${MEMBER_COLUMNS}, s.story_id AS story_key
         FROM signals s JOIN active a ON s.story_id = a.story_key
        WHERE s.status IN ('verified', 'pending')
       UNION ALL
       SELECT ${MEMBER_COLUMNS}, s.id AS story_key
         FROM signals s JOIN active a ON s.id = a.story_key
        WHERE s.story_id IS NULL AND s.status IN ('verified', 'pending')`
    : `SELECT ${MEMBER_COLUMNS}, s.id AS story_key
         FROM signals s JOIN active a ON s.id = a.story_key
        WHERE s.status IN ('verified', 'pending')`
  return `
    WITH active AS (
      ${active}
      ORDER BY max(created_at) DESC
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
      SELECT m.story_key, array_agg(u.url ORDER BY m.reliability_score DESC NULLS LAST, m.created_at, u.ord) AS urls
        FROM members m
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
           f.sev_rank, f.place, f.category, COALESCE(l2.urls, '{}') AS urls, l.lead_id, l.title
      FROM facts f
      JOIN leads l ON l.story_key = f.story_key
      LEFT JOIN links l2 ON l2.story_key = f.story_key`
}

export const registerStoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['stories']
  })

  /**
   * GET /api/v1/stories?hours=12&limit=6
   * The stories most outlets are reporting: reported in the last `hours`
   * (1-72) by at least two outlets, ranked by how many outlets and how serious,
   * halving every 6 hours since the last report; each event once.
   */
  app.get('/', { preHandler: [optionalAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const qr = parseQuery(StoryListQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { hours, limit } = qr.data

    const cacheKey = `stories:list:${hours}:${limit}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const since = new Date(Date.now() - hours * 3_600_000)
    const result = await db.raw(storyListSql(await signalsHaveStoryIds()), [since, EVENT_TEMPLATE_SQL])
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
        firstSeenAt,
        updatedAt,
        verifiedAt:  r.verified_at ? new Date(r.verified_at as string) : null,
      })
    }

    const response = {
      success: true,
      data: { stories: rankStories(candidates, limit), hours, generatedAt: new Date().toISOString() },
    }
    redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response)).catch(() => {})
    return reply.send(response)
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
                min(verified_at) OVER ()                               AS first_verified
           FROM signals
          WHERE status IN ('verified', 'pending') AND ${scope}
       ),
       hosts AS (
         SELECT DISTINCT lower(regexp_replace(substring(link.url from '^https\\?://([^/:\\?#]+)'), '^www\\.', '')) AS host
           FROM signals s
           CROSS JOIN LATERAL unnest(s.original_urls) AS link(url)
          WHERE s.status IN ('verified', 'pending') AND ${scope.replace(/story_id|\bid\b/g, c => `s.${c}`)}
       )
       SELECT m.*,
              (SELECT count(*) FROM hosts WHERE host <> '')                   AS outlets,
              (SELECT array_agg(host ORDER BY host) FROM hosts WHERE host <> '') AS outlet_names
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

    return reply.send({
      success: true,
      data: {
        storyId,
        /** Reports in the story (more than `signals` holds when it's big) */
        size: total,
        /** Websites that carried it, from every report's links */
        outlets,
        /** Those websites, A to Z */
        outletNames,
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
