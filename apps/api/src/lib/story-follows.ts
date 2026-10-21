/**
 * Follow a story (plan 8; Devon, Oct 21, 2026: "Yes, add it": the story
 * follows table). A signed-in reader follows a story from its page
 * (/signals/<id>: Developing Stories open there), and the page then says
 * what changed since their last visit: how many new reports and new outlets.
 *
 * A story is the signals sharing signals.story_id, or one signal no story
 * has claimed (its own id), as routes/stories.ts counts them. The table is
 * created when the API starts, if missing (only adding).
 */

import { db } from '../db/postgres'
import { logger } from './logger'

let ready = false

export async function ensureStoryFollowsTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS story_follows (
        user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        story_id     UUID        NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, story_id)
      )`)
    await db.raw('CREATE INDEX IF NOT EXISTS idx_story_follows_story ON story_follows (story_id)')
    ready = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Story follows table could not be created')
    return false
  }
}

export function followsReady(): boolean {
  return ready
}

/** At most this many stories per reader */
export const MAX_FOLLOWS = 200

/**
 * The story a story id or signal id belongs to: a signal's story_id, or the
 * signal's own id when no story claimed it, or the id itself when it is a
 * story's id. null when it is neither.
 */
export async function storyKeyOf(id: string): Promise<string | null> {
  const own = await db('signals').where('id', id).first('id', 'story_id') as { id: string; story_id?: string | null } | undefined
  if (own) return String(own.story_id || own.id)
  const member = await db('signals').where('story_id', id).first('id')
  return member ? id : null
}

export interface SinceLastVisit {
  /** Reports in the story created after the last visit */
  reports: number
  /** Websites that first carried the story after the last visit */
  outlets: number
}

export interface FollowState {
  following: boolean
  followedAt: string | null
  lastSeenAt: string | null
  /** What changed since the last visit; null when not following */
  since: SinceLastVisit | null
  /** The story's newest report */
  latestReportAt: string | null
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

/** New reports and new outlets in a story since a time (outlets: the websites in every report's links, as the story page counts them) */
export async function storyChangesSince(storyKey: string, since: Date): Promise<SinceLastVisit & { latestReportAt: string | null }> {
  // (A literal ? in knex's raw SQL is written \\?, or it takes it for a value.)
  const { rows } = await db.raw(
    `WITH m AS (
       SELECT id, created_at, original_urls FROM signals
        WHERE status IN ('verified', 'pending') AND (story_id = ? OR id = ?)
     ),
     hosts AS (
       SELECT lower(regexp_replace(substring(link.url from '^https\\?://([^/:\\?#]+)'), '^www\\.', '')) AS host,
              min(m.created_at) AS first_at
         FROM m CROSS JOIN LATERAL unnest(m.original_urls) AS link(url)
        GROUP BY 1
     )
     SELECT (SELECT count(*) FROM m WHERE created_at > ?)                          AS reports,
            (SELECT count(*) FROM hosts WHERE host <> '' AND first_at > ?)         AS outlets,
            (SELECT max(created_at) FROM m)                                        AS latest`,
    [storyKey, storyKey, since, since],
  ) as { rows: Array<{ reports: string | number; outlets: string | number; latest: unknown }> }
  const r = rows[0]
  return { reports: Number(r?.reports) || 0, outlets: Number(r?.outlets) || 0, latestReportAt: iso(r?.latest) }
}

export async function followState(userId: string, storyKey: string): Promise<FollowState> {
  const row = await db('story_follows').where({ user_id: userId, story_id: storyKey })
    .first('created_at', 'last_seen_at') as { created_at: unknown; last_seen_at: unknown } | undefined
  if (!row) return { following: false, followedAt: null, lastSeenAt: null, since: null, latestReportAt: null }
  const changes = await storyChangesSince(storyKey, new Date(row.last_seen_at as string))
  return {
    following: true,
    followedAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    since: { reports: changes.reports, outlets: changes.outlets },
    latestReportAt: changes.latestReportAt,
  }
}

/** Follow (again: nothing changes); false when the reader follows MAX_FOLLOWS already */
export async function followStory(userId: string, storyKey: string): Promise<boolean> {
  const already = await db('story_follows').where({ user_id: userId, story_id: storyKey }).first('story_id')
  if (already) return true
  const [{ n }] = await db('story_follows').where('user_id', userId).count('* as n') as Array<{ n: string | number }>
  if ((Number(n) || 0) >= MAX_FOLLOWS) return false
  await db.raw('INSERT INTO story_follows (user_id, story_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [userId, storyKey])
  return true
}

export async function unfollowStory(userId: string, storyKey: string): Promise<void> {
  await db('story_follows').where({ user_id: userId, story_id: storyKey }).delete()
}

/** The reader has seen the story as it is now */
export async function markStorySeen(userId: string, storyKey: string): Promise<void> {
  await db('story_follows').where({ user_id: userId, story_id: storyKey }).update({ last_seen_at: db.fn.now() })
}

export interface FollowedStory {
  storyId: string
  /** The story's newest report: its headline and page */
  title: string
  leadId: string
  reports: number
  latestReportAt: string | null
  lastSeenAt: string | null
  /** Reports since the last visit */
  newReports: number
}

/** The stories a reader follows, the ones with news since their last visit first, then the most recently updated */
export async function followedStories(userId: string, limit = 50): Promise<FollowedStory[]> {
  const { rows } = await db.raw(
    `SELECT f.story_id, f.last_seen_at, st.reports, st.latest, st.new_reports, lead.id AS lead_id, lead.title
       FROM story_follows f
       CROSS JOIN LATERAL (
         SELECT count(*) AS reports, max(s.created_at) AS latest,
                count(*) FILTER (WHERE s.created_at > f.last_seen_at) AS new_reports
           FROM signals s
          WHERE s.status IN ('verified', 'pending') AND (s.story_id = f.story_id OR s.id = f.story_id)
       ) st
       LEFT JOIN LATERAL (
         SELECT s.id, s.title FROM signals s
          WHERE s.status IN ('verified', 'pending') AND (s.story_id = f.story_id OR s.id = f.story_id)
          ORDER BY s.created_at DESC, s.id DESC LIMIT 1
       ) lead ON true
      WHERE f.user_id = ?
      ORDER BY (st.new_reports > 0) DESC, st.latest DESC NULLS LAST
      LIMIT ?`,
    [userId, Math.min(Math.max(1, limit), MAX_FOLLOWS)],
  ) as { rows: Array<Record<string, unknown>> }
  return rows.filter(r => r.lead_id).map(r => ({
    storyId: String(r.story_id),
    title: String(r.title ?? ''),
    leadId: String(r.lead_id),
    reports: Number(r.reports) || 0,
    latestReportAt: iso(r.latest),
    lastSeenAt: iso(r.last_seen_at),
    newReports: Number(r.new_reports) || 0,
  }))
}
