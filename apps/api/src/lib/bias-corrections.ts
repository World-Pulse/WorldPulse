/**
 * bias-corrections.ts — Community crowdsourced bias corrections
 *
 * Allows authenticated users to submit and vote on bias label corrections
 * for news sources. When a correction reaches AUTO_APPLY_VOTES net votes
 * with AUTO_APPLY_CONSENSUS consensus, it is automatically applied.
 *
 * This counters Ground News's community bias ratings with a fully transparent,
 * auditable, open-source implementation.
 */

import type { Knex } from 'knex'
import type { Redis } from 'ioredis'

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_APPLY_VOTES     = 10   // minimum net upvotes before auto-apply
const AUTO_APPLY_CONSENSUS = 0.70 // minimum upvote ratio for auto-apply

// ─── Types ────────────────────────────────────────────────────────────────────

export type BiasLabelOption =
  | 'far-left'
  | 'left'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'right'
  | 'far-right'
  | 'satire'
  | 'state_media'
  | 'unknown'

export const VALID_BIAS_LABELS: ReadonlyArray<BiasLabelOption> = [
  'far-left', 'left', 'center-left', 'center', 'center-right',
  'right', 'far-right', 'satire', 'state_media', 'unknown',
]

export interface BiasCorrection {
  id:               number
  source_id:        number
  user_id:          number
  suggested_label:  string
  notes:            string | null
  status:           'pending' | 'applied' | 'rejected' | 'spam'
  net_votes:        number
  upvotes:          number
  downvotes:        number
  created_at:       string
  applied_at:       string | null
}

export interface BiasCorrectionSummary {
  pending_count:      number
  top_suggestion:     string | null
  top_suggestion_votes: number
  consensus_reached:  boolean
  consensus_label:    string | null
}

// ─── Submit correction ───────────────────────────────────────────────────────

/**
 * Submit a new bias correction suggestion for a source.
 * Returns the new correction id.
 */
export async function submitCorrection(
  db:              Knex,
  sourceId:        number,
  userId:          number,
  suggestedLabel:  string,
  notes?:          string,
): Promise<number> {
  const [row] = await db('source_bias_corrections')
    .insert({
      source_id:       sourceId,
      user_id:         userId,
      suggested_label: suggestedLabel,
      notes:           notes ?? null,
      status:          'pending',
    })
    .returning('id')

  const id = (row as { id: number } | undefined)?.id
  if (id == null) throw new Error('Failed to insert bias correction')
  return id
}

// ─── Vote on correction ──────────────────────────────────────────────────────

/**
 * Cast or update a vote on a bias correction.
 * Upserts so the user can change their vote.
 * After voting, checks whether auto-apply threshold is reached.
 */
export async function voteOnCorrection(
  db:           Knex,
  redis:        Redis,
  correctionId: number,
  userId:       number,
  vote:         1 | -1,
): Promise<void> {
  // Upsert vote
  await db.raw(
    `INSERT INTO source_bias_votes (correction_id, user_id, vote)
     VALUES (?, ?, ?)
     ON CONFLICT (correction_id, user_id) DO UPDATE SET vote = EXCLUDED.vote`,
    [correctionId, userId, vote],
  )

  // Check auto-apply threshold
  await autoApplyCheck(db, redis, correctionId)
}

// ─── Get corrections ─────────────────────────────────────────────────────────

/**
 * Return the top pending corrections for a source, ordered by net votes.
 */
export async function getCorrections(
  db:       Knex,
  sourceId: number,
  limit     = 10,
): Promise<BiasCorrection[]> {
  const rows = await db('source_bias_corrections as c')
    .leftJoin('source_bias_votes as v', 'v.correction_id', 'c.id')
    .where('c.source_id', sourceId)
    .where('c.status', 'pending')
    .groupBy('c.id')
    .select(
      'c.id',
      'c.source_id',
      'c.user_id',
      'c.suggested_label',
      'c.notes',
      'c.status',
      'c.created_at',
      'c.applied_at',
      db.raw('COALESCE(SUM(v.vote), 0)::integer AS net_votes'),
      db.raw('COALESCE(SUM(CASE WHEN v.vote = 1  THEN 1 ELSE 0 END), 0)::integer AS upvotes'),
      db.raw('COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END), 0)::integer AS downvotes'),
    )
    .orderBy('net_votes', 'desc')
    .limit(limit)

  return rows as BiasCorrection[]
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Return a concise summary: pending count, top suggestion, consensus flag.
 */
export async function getCorrectionSummary(
  db:       Knex,
  sourceId: number,
): Promise<BiasCorrectionSummary> {
  const corrections = await getCorrections(db, sourceId, 1)

  const countRow = await db('source_bias_corrections')
    .where('source_id', sourceId)
    .where('status', 'pending')
    .count('id as cnt')
    .first()

  const pending_count = parseInt(
    String((countRow as { cnt: string | number } | undefined)?.cnt ?? 0),
    10,
  )

  const top = corrections[0]
  const top_suggestion       = top?.suggested_label ?? null
  const top_suggestion_votes = top?.net_votes ?? 0
  const top_upvotes          = top?.upvotes ?? 0
  const top_total            = top_upvotes + (top?.downvotes ?? 0)
  const consensus            = top_total > 0 ? top_upvotes / top_total : 0
  const consensus_reached    =
    top_suggestion_votes >= AUTO_APPLY_VOTES && consensus >= AUTO_APPLY_CONSENSUS

  return {
    pending_count,
    top_suggestion,
    top_suggestion_votes,
    consensus_reached,
    consensus_label: consensus_reached ? top_suggestion : null,
  }
}

// ─── Auto-apply ───────────────────────────────────────────────────────────────

/**
 * Check if a correction has reached the auto-apply threshold.
 * If so: marks it applied, updates sources.bias_label, clears Redis cache.
 */
export async function autoApplyCheck(
  db:           Knex,
  redis:        Redis,
  correctionId: number,
): Promise<boolean> {
  // Fetch current correction + vote aggregates
  const rows = await db('source_bias_corrections as c')
    .leftJoin('source_bias_votes as v', 'v.correction_id', 'c.id')
    .where('c.id', correctionId)
    .where('c.status', 'pending')
    .groupBy('c.id')
    .select(
      'c.id',
      'c.source_id',
      'c.suggested_label',
      db.raw('COALESCE(SUM(v.vote), 0)::integer AS net_votes'),
      db.raw('COALESCE(SUM(CASE WHEN v.vote = 1  THEN 1 ELSE 0 END), 0)::integer AS upvotes'),
      db.raw('COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END), 0)::integer AS downvotes'),
    )

  const c = rows[0] as (BiasCorrection & { source_id: number }) | undefined
  if (!c) return false

  const total     = c.upvotes + c.downvotes
  const consensus = total > 0 ? c.upvotes / total : 0

  if (c.net_votes < AUTO_APPLY_VOTES || consensus < AUTO_APPLY_CONSENSUS) {
    return false
  }

  // Apply: update correction status + source bias_label
  await db.transaction(async trx => {
    await trx('source_bias_corrections')
      .where('id', correctionId)
      .update({ status: 'applied', applied_at: new Date().toISOString() })

    await trx('sources')
      .where('id', c.source_id)
      .update({ bias_label: c.suggested_label })
  })

  // Bust Redis bias cache for this source (key pattern from source-bias.ts)
  try {
    await redis.del(`bias:v1:${c.source_id}`)
  } catch {
    // Non-fatal — cache will expire naturally
  }

  return true
}
