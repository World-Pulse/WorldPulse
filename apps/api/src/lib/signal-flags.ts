/**
 * Readers' flags on a signal (plan C3, handoff H-0020; Oct 20, 2026).
 *
 * Until now an anonymous visitor could flag the same signal again and again
 * (only signed-in readers were checked: 10 flags a minute could inflate any
 * signal's count), and signal_flags.ip_hash was not a hash: the visitor's
 * address base64-encoded, so anyone with the table could read it back. Now
 * the address is stored as a keyed hash (HMAC-SHA256 with a key only the
 * server knows): the same visitor still matches, the address can't be read.
 * One flag per signal per reader: per account when signed in, else per
 * hashed address. No schema change (ip_hash is VARCHAR(64), the hash 64 hex).
 */

import { createHmac } from 'node:crypto'
import { db } from '../db/postgres'
import { logger } from './logger'

const HEX64 = /^[0-9a-f]{64}$/

function hashKey(): string {
  // `||`: compose passes an unset variable as ""
  return process.env.FLAG_HASH_SECRET || process.env.JWT_SECRET || 'worldpulse-flag-hash'
}

/** A visitor's address as a keyed hash: 64 hex characters, the same for the same address */
export function visitorHash(address: string): string {
  return createHmac('sha256', hashKey()).update(address.trim().toLowerCase()).digest('hex')
}

/** Whether this reader already flagged this signal: by account when signed in, else by hashed address */
export async function alreadyFlagged(signalId: string, userId: string | null, ipHash: string | null): Promise<boolean> {
  if (userId) return !!(await db('signal_flags').where({ signal_id: signalId, user_id: userId }).first('id'))
  if (ipHash) return !!(await db('signal_flags').where({ signal_id: signalId, ip_hash: ipHash }).whereNull('user_id').first('id'))
  return false
}

/**
 * Flags stored before the hash (an address base64-encoded): each becomes the
 * keyed hash of the address it held, so it can no longer be read back and an
 * old anonymous flag still counts for that visitor. Rows already hashed don't
 * match, so a later start changes nothing.
 */
export async function hashStoredFlagAddresses(): Promise<number> {
  try {
    const rows = await db('signal_flags')
      .whereNotNull('ip_hash')
      .whereRaw("ip_hash !~ '^[0-9a-f]{64}$'")
      .select('id', 'ip_hash')
      .limit(5_000) as Array<{ id: string; ip_hash: string }>
    let changed = 0
    for (const row of rows) {
      if (HEX64.test(row.ip_hash)) continue
      const address = Buffer.from(row.ip_hash, 'base64').toString('utf8')
      changed += Number(await db('signal_flags').where('id', row.id).update({ ip_hash: visitorHash(address) })) || 0
    }
    return changed
  } catch (err) {
    logger.warn({ err }, 'Flag addresses not hashed yet (will try at the next start)')
    return 0
  }
}

// ─── What a flag does (plan C5; Devon, Oct 21, 2026: "Show it + review list") ──
// The signal page says how many readers flagged a report and why (no notes,
// no who), and reports that 3 or more readers flagged in the last 30 days go
// on a review list for Devon (GET /api/v1/admin/flags, admins only; its count
// in /ops-status.json).

export const FLAG_REASONS = ['inaccurate', 'outdated', 'duplicate', 'misinformation'] as const
export type FlagReason = (typeof FLAG_REASONS)[number]
/** Readers' flags that put a report on the review list */
export const REVIEW_AT = 3
/** How far back the review list looks */
export const REVIEW_DAYS = 30

export interface FlagSummary { count: number; reasons: Partial<Record<FlagReason, number>> }

/** How many readers flagged a signal, and why (each reader once: alreadyFlagged) */
export async function flagSummary(signalId: string): Promise<FlagSummary> {
  const rows = await db('signal_flags').where('signal_id', signalId)
    .select('reason').count('* as n').groupBy('reason') as Array<{ reason: string; n: string | number }>
  const reasons: FlagSummary['reasons'] = {}
  let count = 0
  for (const r of rows) {
    const n = Number(r.n) || 0
    count += n
    if ((FLAG_REASONS as readonly string[]).includes(r.reason)) reasons[r.reason as FlagReason] = n
  }
  return { count, reasons }
}

export interface ReviewItem {
  id: string
  title: string
  status: string
  createdAt: string | null
  flags: number
  reasons: Partial<Record<FlagReason, number>>
  lastFlagAt: string | null
  /** The newest three readers' notes, 200 characters each at most */
  notes: string[]
}

/** Reports flagged by REVIEW_AT or more readers in the last REVIEW_DAYS days, the most flagged first */
export async function flagReviewList(limit = 50): Promise<ReviewItem[]> {
  const { rows } = await db.raw(
    `SELECT s.id, s.title, s.status, s.created_at,
            count(*)                                                        AS flags,
            max(f.created_at)                                               AS last_flag_at,
            (array_agg(left(f.notes, 200) ORDER BY f.created_at DESC)
               FILTER (WHERE coalesce(btrim(f.notes), '') <> ''))[1:3]      AS notes,
            (SELECT json_object_agg(r.reason, r.n)
               FROM (SELECT reason, count(*) AS n FROM signal_flags f2
                      WHERE f2.signal_id = s.id AND f2.created_at > now() - make_interval(days => ?)
                      GROUP BY reason) r)                                   AS reasons
       FROM signal_flags f
       JOIN signals s ON s.id = f.signal_id
      WHERE f.created_at > now() - make_interval(days => ?)
      GROUP BY s.id
     HAVING count(*) >= ?
      ORDER BY count(*) DESC, max(f.created_at) DESC
      LIMIT ?`,
    [REVIEW_DAYS, REVIEW_DAYS, REVIEW_AT, Math.min(Math.max(1, limit), 200)],
  ) as { rows: Array<Record<string, unknown>> }
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map(r => {
    const reasons: ReviewItem['reasons'] = {}
    const raw = (typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons) as Record<string, unknown> | null
    for (const [k, v] of Object.entries(raw ?? {})) {
      if ((FLAG_REASONS as readonly string[]).includes(k)) reasons[k as FlagReason] = Number(v) || 0
    }
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      status: String(r.status ?? ''),
      createdAt: iso(r.created_at),
      flags: Number(r.flags) || 0,
      reasons,
      lastFlagAt: iso(r.last_flag_at),
      notes: Array.isArray(r.notes) ? (r.notes as unknown[]).map(String) : [],
    }
  })
}
