/**
 * Readers report a post or a community (plan C6; Devon, Oct 21, 2026: "Yes,
 * add the table"). Until now only news reports could be flagged; a post or a
 * community had no way to be reported at all.
 *
 * A signed-in reader reports a post or a community once, with a reason (spam,
 * abuse, misinformation, other) and an optional note. Anything 3 or more
 * readers reported in the last 30 days goes on Devon's review list (GET
 * /api/v1/admin/reports, admins only; /admin shows it beside the flagged
 * reports). Nothing is hidden automatically.
 *
 * The table is created when the API starts, if missing (only adding).
 */

import { db } from '../db/postgres'
import { logger } from './logger'

export const REPORT_TARGETS = ['post', 'community'] as const
export type ReportTarget = (typeof REPORT_TARGETS)[number]
export const REPORT_REASONS = ['spam', 'abuse', 'misinformation', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
/** Readers' reports that put a post or community on the review list, and how far back it looks */
export const REPORT_REVIEW_AT = 3
export const REPORT_REVIEW_DAYS = 30

let ready = false

export async function ensureContentReportsTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_reports (
        id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        target_type VARCHAR(20) NOT NULL,
        target_id   UUID        NOT NULL,
        reporter_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason      VARCHAR(30) NOT NULL,
        note        TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (target_type, target_id, reporter_id)
      )`)
    await db.raw('CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports (target_type, target_id, created_at DESC)')
    ready = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Content reports table could not be created')
    return false
  }
}

export function reportsReady(): boolean {
  return ready
}

export function isReportTarget(v: unknown): v is ReportTarget {
  return typeof v === 'string' && (REPORT_TARGETS as readonly string[]).includes(v)
}

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v)
}

/** Whether the post (not deleted) or the community exists */
async function targetExists(type: ReportTarget, id: string): Promise<boolean> {
  if (type === 'post') return !!(await db('posts').where('id', id).whereNull('deleted_at').first('id'))
  return !!(await db('communities').where('id', id).first('id'))
}

/** One reader's report: 'reported', 'already' (they reported it before) or 'not_found' */
export async function reportContent(
  type: ReportTarget, id: string, reporterId: string, reason: ReportReason, note?: string | null,
): Promise<'reported' | 'already' | 'not_found'> {
  if (!(await targetExists(type, id))) return 'not_found'
  const inserted = await db('content_reports')
    .insert({ target_type: type, target_id: id, reporter_id: reporterId, reason, note: note?.trim().slice(0, 500) || null })
    .onConflict(['target_type', 'target_id', 'reporter_id'])
    .ignore()
    .returning('id') as Array<{ id: string }>
  return inserted.length ? 'reported' : 'already'
}

export interface ContentReviewItem {
  type: ReportTarget
  id: string
  /** The post's first 200 characters, or the community's name */
  preview: string
  /** Who posted it or made the community: their handle */
  by: string | null
  /** Where to see it: a community's page, or the post's */
  path: string
  reports: number
  reasons: Partial<Record<ReportReason, number>>
  lastReportAt: string | null
  /** The newest three notes, 200 characters each at most */
  notes: string[]
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

function reasonsOf(raw: unknown): ContentReviewItem['reasons'] {
  const out: ContentReviewItem['reasons'] = {}
  const obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null
  for (const [k, v] of Object.entries(obj ?? {})) if (isReportReason(k)) out[k] = Number(v) || 0
  return out
}

/** Posts and communities REPORT_REVIEW_AT or more readers reported in the last REPORT_REVIEW_DAYS days, the most reported first */
export async function contentReviewList(limit = 50): Promise<ContentReviewItem[]> {
  const cap = Math.min(Math.max(1, limit), 200)
  const grouped = (join: string, preview: string, by: string, path: string, type: ReportTarget) => db.raw(
    `SELECT r.target_id AS id, ${preview} AS preview, ${by} AS by, ${path} AS path,
            count(*) AS reports, max(r.created_at) AS last_report_at,
            (array_agg(left(r.note, 200) ORDER BY r.created_at DESC)
               FILTER (WHERE coalesce(btrim(r.note), '') <> ''))[1:3] AS notes,
            (SELECT json_object_agg(x.reason, x.n)
               FROM (SELECT reason, count(*) AS n FROM content_reports r2
                      WHERE r2.target_type = ? AND r2.target_id = r.target_id
                        AND r2.created_at > now() - make_interval(days => ?)
                      GROUP BY reason) x) AS reasons
       FROM content_reports r
       ${join}
      WHERE r.target_type = ? AND r.created_at > now() - make_interval(days => ?)
      GROUP BY r.target_id, ${preview}, ${by}, ${path}
     HAVING count(*) >= ?
      ORDER BY count(*) DESC, max(r.created_at) DESC
      LIMIT ?`,
    [type, REPORT_REVIEW_DAYS, type, REPORT_REVIEW_DAYS, REPORT_REVIEW_AT, cap],
  ) as Promise<{ rows: Array<Record<string, unknown>> }>
  const [posts, communities] = await Promise.all([
    grouped('JOIN posts p ON p.id = r.target_id LEFT JOIN users u ON u.id = p.author_id',
      'left(p.content, 200)', 'u.handle', "'/posts/' || p.id::text", 'post'),
    grouped('JOIN communities c ON c.id = r.target_id LEFT JOIN users u ON u.id = c.created_by',
      'c.name', 'u.handle', "'/communities/' || c.slug", 'community'),
  ])
  const items: ContentReviewItem[] = []
  for (const [type, res] of [['post', posts], ['community', communities]] as const) {
    for (const r of res.rows) {
      items.push({
        type, id: String(r.id), preview: String(r.preview ?? ''), by: r.by ? String(r.by) : null,
        path: String(r.path ?? ''), reports: Number(r.reports) || 0, reasons: reasonsOf(r.reasons),
        lastReportAt: iso(r.last_report_at), notes: Array.isArray(r.notes) ? (r.notes as unknown[]).map(String) : [],
      })
    }
  }
  return items.sort((a, b) => b.reports - a.reports || String(b.lastReportAt).localeCompare(String(a.lastReportAt))).slice(0, cap)
}
