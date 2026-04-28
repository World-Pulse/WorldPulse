/**
 * Entity Relationship Strengthening — Phase 1.6.3
 *
 * Closes the gap where 90% of signals contribute entity nodes but no edges.
 * Uses co-occurrence patterns to infer relationships without LLM calls.
 *
 * Systems:
 *   1. Co-occurrence inference — entities appearing in same signals → inferred edges
 *   2. Temporal tracking — first_seen, last_seen, trend (rising/stable/falling)
 *   3. Entity merging — fuzzy dedup via Levenshtein distance
 *   4. Importance scoring — weighted degree centrality
 *
 * Runs nightly as a batch job.
 *
 * @module cortex/entity-strengthen
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Constants ───────────────────────────────────────────────────────────────

const CO_OCCURRENCE_THRESHOLD = 3     // Min co-occurrences to create edge
const CO_OCCURRENCE_WINDOW_DAYS = 14  // Look at last 2 weeks of signals
const MAX_SIGNAL_IDS_PER_ENTITY = 200
const FUZZY_MERGE_MAX_DISTANCE = 2    // Levenshtein distance threshold
const IMPORTANCE_CACHE_TTL = 3600     // 1 hour

// ─── Co-occurrence Inference ─────────────────────────────────────────────────

/**
 * Scan entity_nodes for co-occurrence patterns and create inferred edges.
 *
 * When two entities appear in the same signal 3+ times within 14 days,
 * create an edge with predicate "co_occurs_with" and confidence based on frequency.
 */
export async function inferCoOccurrenceEdges(): Promise<{
  pairs_scanned: number
  edges_created: number
}> {
  console.log('[CORTEX] Starting co-occurrence inference...')

  // Get all entities with recent signals (last 14 days)
  const cutoff = new Date(Date.now() - CO_OCCURRENCE_WINDOW_DAYS * 24 * 3600 * 1000)

  // Get entities that have been seen recently
  const entities = await db('entity_nodes')
    .where('last_seen', '>=', cutoff.toISOString())
    .where('mention_count', '>=', 2)
    .select('id', 'canonical_name', 'type', 'signal_ids')
    .orderBy('mention_count', 'desc')
    .limit(500) // Cap for performance

  if (entities.length < 2) {
    console.log('[CORTEX] Not enough entities for co-occurrence analysis')
    return { pairs_scanned: 0, edges_created: 0 }
  }

  // Build signal → entity index
  const signalToEntities = new Map<string, string[]>()
  for (const entity of entities) {
    const signalIds: string[] = Array.isArray(entity.signal_ids)
      ? entity.signal_ids
      : (typeof entity.signal_ids === 'string' ? JSON.parse(entity.signal_ids) : [])

    for (const sid of signalIds) {
      if (!signalToEntities.has(sid)) signalToEntities.set(sid, [])
      signalToEntities.get(sid)!.push(entity.id)
    }
  }

  // Count pairwise co-occurrences
  const pairCounts = new Map<string, { count: number; signal_ids: string[] }>()

  for (const [signalId, entityIds] of signalToEntities) {
    if (entityIds.length < 2) continue

    // Generate pairs (sorted to ensure consistent key)
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const key = [entityIds[i], entityIds[j]].sort().join('::')
        if (!pairCounts.has(key)) {
          pairCounts.set(key, { count: 0, signal_ids: [] })
        }
        const pair = pairCounts.get(key)!
        pair.count++
        if (pair.signal_ids.length < 20) {
          pair.signal_ids.push(signalId)
        }
      }
    }
  }

  let edgesCreated = 0

  for (const [key, { count, signal_ids }] of pairCounts) {
    if (count < CO_OCCURRENCE_THRESHOLD) continue

    const [sourceId, targetId] = key.split('::') as [string, string]

    // Calculate confidence: 3 co-occurrences = 0.3, 10+ = 0.8, capped at 0.9
    const confidence = Math.min(0.9, 0.1 * count)

    // Check if edge already exists
    const existing = await db('entity_edges')
      .where('source_entity_id', sourceId)
      .where('target_entity_id', targetId)
      .where('predicate', 'co_occurs_with')
      .first()

    if (existing) {
      // Update weight and signal_ids
      const existingSignals: string[] = Array.isArray(existing.signal_ids)
        ? existing.signal_ids
        : JSON.parse(existing.signal_ids ?? '[]')

      const mergedSignals = [...new Set([...existingSignals, ...signal_ids])].slice(-50)

      await db('entity_edges')
        .where('id', existing.id)
        .update({
          weight: confidence,
          signal_ids: JSON.stringify(mergedSignals),
          last_seen: new Date().toISOString(),
        })
    } else {
      // Create new inferred edge
      const edgeId = createHash('sha256')
        .update(`${sourceId}::${targetId}::co_occurs_with`)
        .digest('hex')
        .slice(0, 32)

      await db('entity_edges')
        .insert({
          id: edgeId,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          predicate: 'co_occurs_with',
          weight: confidence,
          signal_ids: JSON.stringify(signal_ids),
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        })
        .onConflict('id')
        .ignore()

      edgesCreated++
    }
  }

  console.log(`[CORTEX] Co-occurrence: scanned ${pairCounts.size} pairs, created ${edgesCreated} new edges`)
  return { pairs_scanned: pairCounts.size, edges_created: edgesCreated }
}

// ─── Temporal Tracking ───────────────────────────────────────────────────────

/**
 * Update temporal trend for all active entities.
 * Compares recent 7-day mention count vs previous 7-day.
 */
export async function updateEntityTrends(): Promise<{ updated: number }> {
  const now = new Date()
  const week1Start = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const week2Start = new Date(now.getTime() - 14 * 24 * 3600 * 1000)

  // Get entities active in last 14 days
  const entities = await db('entity_nodes')
    .where('last_seen', '>=', week2Start.toISOString())
    .select('id', 'signal_ids', 'mention_count')

  let updated = 0

  for (const entity of entities) {
    const signalIds: string[] = Array.isArray(entity.signal_ids)
      ? entity.signal_ids
      : JSON.parse(entity.signal_ids ?? '[]')

    if (signalIds.length === 0) continue

    // Count signals in each week by checking published_at
    const signals = await db('signals')
      .whereIn('id', signalIds.slice(-100))
      .select('published_at')

    let recentCount = 0
    let olderCount = 0

    for (const s of signals) {
      const pubDate = new Date(s.published_at)
      if (pubDate >= week1Start) recentCount++
      else if (pubDate >= week2Start) olderCount++
    }

    let trend: string
    if (olderCount === 0 && recentCount > 0) trend = 'rising'
    else if (recentCount > olderCount * 1.3) trend = 'rising'
    else if (recentCount < olderCount * 0.7) trend = 'falling'
    else trend = 'stable'

    // Store trend in metadata
    await db('entity_nodes')
      .where('id', entity.id)
      .update({
        metadata: db.raw(
          "COALESCE(metadata, '{}')::jsonb || ?::jsonb",
          [JSON.stringify({ trend, recent_7d: recentCount, previous_7d: olderCount })]
        ),
      })

    updated++
  }

  console.log(`[CORTEX] Entity trends: updated ${updated} entities`)
  return { updated }
}

// ─── Fuzzy Entity Merging ────────────────────────────────────────────────────

/**
 * Find and merge duplicate entities with similar names.
 * Uses PostgreSQL similarity() for trigram matching.
 */
export async function findMergeCandidates(): Promise<Array<{
  entity_a: { id: string; name: string; type: string; count: number }
  entity_b: { id: string; name: string; type: string; count: number }
  similarity: number
}>> {
  // Use trigram similarity to find near-duplicates of the same type
  const candidates = await db.raw(`
    SELECT
      a.id as a_id, a.canonical_name as a_name, a.type as a_type, a.mention_count as a_count,
      b.id as b_id, b.canonical_name as b_name, b.type as b_type, b.mention_count as b_count,
      similarity(a.canonical_name, b.canonical_name) as sim
    FROM entity_nodes a
    JOIN entity_nodes b ON a.type = b.type AND a.id < b.id
    WHERE similarity(a.canonical_name, b.canonical_name) > 0.7
      AND a.canonical_name != b.canonical_name
      AND length(a.canonical_name) >= 3
    ORDER BY sim DESC
    LIMIT 50
  `)

  return (candidates.rows ?? []).map((r: any) => ({
    entity_a: { id: r.a_id, name: r.a_name, type: r.a_type, count: Number(r.a_count) },
    entity_b: { id: r.b_id, name: r.b_name, type: r.b_type, count: Number(r.b_count) },
    similarity: Number(r.sim),
  }))
}

/**
 * Merge entity B into entity A (A keeps its ID, B's signals move to A).
 * High-confidence merges (similarity > 0.85 + same type) can be auto-merged.
 */
export async function mergeEntities(keepId: string, mergeId: string): Promise<boolean> {
  const keep = await db('entity_nodes').where('id', keepId).first()
  const merge = await db('entity_nodes').where('id', mergeId).first()
  if (!keep || !merge) return false

  const keepSignals: string[] = Array.isArray(keep.signal_ids)
    ? keep.signal_ids : JSON.parse(keep.signal_ids ?? '[]')
  const mergeSignals: string[] = Array.isArray(merge.signal_ids)
    ? merge.signal_ids : JSON.parse(merge.signal_ids ?? '[]')

  const combinedSignals = [...new Set([...keepSignals, ...mergeSignals])].slice(-MAX_SIGNAL_IDS_PER_ENTITY)
  const keepAliases: string[] = Array.isArray(keep.aliases)
    ? keep.aliases : JSON.parse(keep.aliases ?? '[]')
  const mergeAliases: string[] = Array.isArray(merge.aliases)
    ? merge.aliases : JSON.parse(merge.aliases ?? '[]')

  const combinedAliases = [...new Set([...keepAliases, ...mergeAliases, merge.canonical_name])]

  // Update keep entity
  await db('entity_nodes').where('id', keepId).update({
    signal_ids: JSON.stringify(combinedSignals),
    aliases: JSON.stringify(combinedAliases),
    mention_count: keep.mention_count + merge.mention_count,
    first_seen: keep.first_seen < merge.first_seen ? keep.first_seen : merge.first_seen,
    last_seen: keep.last_seen > merge.last_seen ? keep.last_seen : merge.last_seen,
  })

  // Redirect edges from merge → keep
  await db('entity_edges')
    .where('source_entity_id', mergeId)
    .update({ source_entity_id: keepId })
  await db('entity_edges')
    .where('target_entity_id', mergeId)
    .update({ target_entity_id: keepId })

  // Delete merged entity
  await db('entity_nodes').where('id', mergeId).delete()

  console.log(`[CORTEX] Merged entity "${merge.canonical_name}" into "${keep.canonical_name}"`)
  return true
}

// ─── Importance Scoring ──────────────────────────────────────────────────────

/**
 * Compute weighted degree centrality for entities.
 * Stores importance_score in metadata.
 */
export async function computeImportanceScores(): Promise<{ scored: number }> {
  console.log('[CORTEX] Computing entity importance scores...')

  // Get edge counts per entity (weighted by edge weight)
  const scores = await db.raw(`
    WITH edge_scores AS (
      SELECT entity_id, SUM(weight) as weighted_degree, COUNT(*) as degree
      FROM (
        SELECT source_entity_id as entity_id, weight FROM entity_edges
        UNION ALL
        SELECT target_entity_id as entity_id, weight FROM entity_edges
      ) edges
      GROUP BY entity_id
    )
    SELECT
      en.id,
      en.canonical_name,
      en.mention_count,
      COALESCE(es.weighted_degree, 0) as weighted_degree,
      COALESCE(es.degree, 0) as degree
    FROM entity_nodes en
    LEFT JOIN edge_scores es ON en.id = es.entity_id
    WHERE en.mention_count >= 2
    ORDER BY COALESCE(es.weighted_degree, 0) + en.mention_count * 0.1 DESC
    LIMIT 500
  `)

  const entities = scores.rows ?? []
  if (entities.length === 0) return { scored: 0 }

  // Normalize to 0-1 range
  const maxScore = entities.reduce((max: number, e: any) =>
    Math.max(max, Number(e.weighted_degree) + Number(e.mention_count) * 0.1), 0)

  for (const entity of entities) {
    const rawScore = Number(entity.weighted_degree) + Number(entity.mention_count) * 0.1
    const normalizedScore = maxScore > 0 ? Math.round((rawScore / maxScore) * 100) / 100 : 0

    await db('entity_nodes')
      .where('id', entity.id)
      .update({
        metadata: db.raw(
          "COALESCE(metadata, '{}')::jsonb || ?::jsonb",
          [JSON.stringify({
            importance_score: normalizedScore,
            weighted_degree: Number(entity.weighted_degree),
            edge_count: Number(entity.degree),
          })]
        ),
      })
  }

  console.log(`[CORTEX] Importance scores: computed for ${entities.length} entities`)
  return { scored: entities.length }
}

// ─── Auto-merge high-confidence duplicates ───────────────────────────────────

export async function autoMergeDuplicates(): Promise<{ merged: number }> {
  const candidates = await findMergeCandidates()
  let merged = 0

  for (const c of candidates) {
    // Only auto-merge very high confidence (>0.85 similarity)
    if (c.similarity < 0.85) continue

    // Keep the entity with more mentions
    const keepId = c.entity_a.count >= c.entity_b.count ? c.entity_a.id : c.entity_b.id
    const mergeId = keepId === c.entity_a.id ? c.entity_b.id : c.entity_a.id

    const success = await mergeEntities(keepId, mergeId)
    if (success) merged++
  }

  if (merged > 0) {
    console.log(`[CORTEX] Auto-merged ${merged} duplicate entities`)
  }
  return { merged }
}

// ─── Full cycle ──────────────────────────────────────────────────────────────

/**
 * Run the full entity strengthening cycle:
 * 1. Infer co-occurrence edges
 * 2. Update temporal trends
 * 3. Auto-merge high-confidence duplicates
 * 4. Compute importance scores
 */
export async function runEntityStrengtheningCycle(): Promise<{
  edges_created: number
  trends_updated: number
  entities_merged: number
  entities_scored: number
}> {
  console.log('[CORTEX] Running entity strengthening cycle...')

  const coOccurrence = await inferCoOccurrenceEdges()
  const trends = await updateEntityTrends()
  const merges = await autoMergeDuplicates()
  const importance = await computeImportanceScores()

  console.log('[CORTEX] Entity strengthening complete')

  return {
    edges_created: coOccurrence.edges_created,
    trends_updated: trends.updated,
    entities_merged: merges.merged,
    entities_scored: importance.scored,
  }
}
