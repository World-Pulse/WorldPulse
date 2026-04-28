/**
 * Implicit Interest Learning Engine
 *
 * Computes user interest weights from interaction history (clicks, expands,
 * bookmarks). After 50+ interactions, the system infers categories and
 * regions the user cares about without explicit onboarding.
 *
 * Weight formula per category:
 *   weight = (interaction_count / total_interactions) × recency_factor
 *   recency_factor: interactions in last 7 days count 2x
 *
 * Used by the "For You" feed tab and personalization boosting.
 */

import { db } from '../db/postgres'

const MIN_INTERACTIONS = 50
const RECENCY_WINDOW_DAYS = 7
const RECENCY_MULTIPLIER = 2.0

export interface ImplicitWeights {
  categories: Record<string, number>  // category → weight (0-1)
  regions: Record<string, number>     // country_code → weight (0-1)
  totalInteractions: number
  isActive: boolean  // true if 50+ interactions
}

/**
 * Compute implicit interest weights for a user.
 * Returns category and region weights normalized to [0, 1].
 */
export async function computeImplicitWeights(userId: string): Promise<ImplicitWeights> {
  // Count total interactions
  const [{ count: totalCount }] = await db('user_interactions')
    .where('user_id', userId)
    .count('id as count')

  const total = Number(totalCount)

  if (total < MIN_INTERACTIONS) {
    return {
      categories: {},
      regions: {},
      totalInteractions: total,
      isActive: false,
    }
  }

  const recentCutoff = new Date(Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // ── Category weights ────────────────────────────────────────────────
  const categoryRows = await db('user_interactions')
    .select('category')
    .select(db.raw('COUNT(*) as total_count'))
    .select(db.raw(`COUNT(*) FILTER (WHERE created_at >= ?) as recent_count`, [recentCutoff.toISOString()]))
    .where('user_id', userId)
    .whereNotNull('category')
    .groupBy('category')

  const categories: Record<string, number> = {}
  let maxCatScore = 0

  for (const row of categoryRows) {
    const totalC = Number(row.total_count)
    const recentC = Number(row.recent_count)
    const oldC = totalC - recentC
    const weightedCount = oldC + (recentC * RECENCY_MULTIPLIER)
    const score = weightedCount / total
    categories[row.category] = score
    if (score > maxCatScore) maxCatScore = score
  }

  // Normalize to [0, 1]
  if (maxCatScore > 0) {
    for (const cat of Object.keys(categories)) {
      categories[cat] = Math.round((categories[cat] / maxCatScore) * 1000) / 1000
    }
  }

  // ── Region weights ──────────────────────────────────────────────────
  const regionRows = await db('user_interactions')
    .select('country_code')
    .select(db.raw('COUNT(*) as total_count'))
    .select(db.raw(`COUNT(*) FILTER (WHERE created_at >= ?) as recent_count`, [recentCutoff.toISOString()]))
    .where('user_id', userId)
    .whereNotNull('country_code')
    .groupBy('country_code')

  const regions: Record<string, number> = {}
  let maxRegScore = 0

  for (const row of regionRows) {
    const totalR = Number(row.total_count)
    const recentR = Number(row.recent_count)
    const oldR = totalR - recentR
    const weightedCount = oldR + (recentR * RECENCY_MULTIPLIER)
    const score = weightedCount / total
    regions[row.country_code] = score
    if (score > maxRegScore) maxRegScore = score
  }

  if (maxRegScore > 0) {
    for (const cc of Object.keys(regions)) {
      regions[cc] = Math.round((regions[cc] / maxRegScore) * 1000) / 1000
    }
  }

  return {
    categories,
    regions,
    totalInteractions: total,
    isActive: true,
  }
}

/**
 * Record a user interaction for implicit learning.
 */
export async function recordInteraction(params: {
  userId: string
  signalId?: string
  postId?: string
  interactionType: 'click' | 'expand' | 'bookmark' | 'share' | 'dwell'
  category?: string
  countryCode?: string
  severity?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await db('user_interactions').insert({
    user_id: params.userId,
    signal_id: params.signalId || null,
    post_id: params.postId || null,
    interaction_type: params.interactionType,
    category: params.category || null,
    country_code: params.countryCode || null,
    severity: params.severity || null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : '{}',
  })
}
