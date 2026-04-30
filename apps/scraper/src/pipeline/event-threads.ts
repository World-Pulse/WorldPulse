/**
 * Event Threads — Groups related signals into narrative threads
 *
 * Signals are grouped by:
 *   1. Tag overlap (>= 2 shared tags within a time window)
 *   2. Entity overlap (shared entities from the knowledge graph)
 *   3. Geographic proximity + category match
 *   4. Title similarity (trigram matching via pg_trgm)
 *
 * Threads have lifecycle statuses:
 *   developing → escalating → stable → resolved
 *
 * Runs every 5 minutes as a scheduled job.
 *
 * @module pipeline/event-threads
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

// ─── Config ─────────────────────────────────────────────────────────────────

const THREAD_WINDOW_HOURS = 48          // Look back N hours for groupable signals
const MIN_TAG_OVERLAP = 2               // Minimum shared tags to auto-group
const TITLE_SIMILARITY_THRESHOLD = 0.35 // pg_trgm similarity threshold
const MAX_THREAD_AGE_HOURS = 168        // Auto-resolve threads older than 7 days
const ESCALATION_THRESHOLD = 5          // Signal count to mark thread as escalating
const STABLE_QUIET_HOURS = 12           // Hours without new signal → mark stable
const BATCH_SIZE = 200                  // Process N unthreaded signals per cycle

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThreadCandidate {
  thread_id: string
  score: number  // 0-1, how well the signal matches this thread
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Main entry point — called every 5 minutes.
 * Finds unthreaded signals, matches them to existing threads or creates new ones,
 * then updates thread statuses.
 */
export async function updateEventThreads(): Promise<{
  processed: number
  matched: number
  created: number
  statusUpdates: number
}> {
  const start = Date.now()
  let processed = 0, matched = 0, created = 0

  try {
    // 1. Find recent signals not yet assigned to any thread
    const unthreaded = await db.raw(`
      SELECT s.id, s.title, s.summary, s.category, s.severity, s.tags,
             s.country_code, s.region, s.location_name, s.created_at,
             s.source_count, s.reliability_score
      FROM signals s
      WHERE s.created_at >= NOW() - INTERVAL '${THREAD_WINDOW_HOURS} hours'
        AND s.status IN ('verified', 'pending')
        AND s.id NOT IN (SELECT signal_id FROM event_thread_signals)
      ORDER BY s.created_at ASC
      LIMIT ${BATCH_SIZE}
    `)

    const signals = unthreaded.rows ?? []
    if (signals.length === 0) {
      // Still update thread statuses even if no new signals
      const statusUpdates = await updateThreadStatuses()
      return { processed: 0, matched: 0, created: 0, statusUpdates }
    }

    // 2. Get active threads for matching
    const activeThreads = await db('event_threads')
      .whereIn('status', ['developing', 'escalating'])
      .where('last_updated', '>=', db.raw(`NOW() - INTERVAL '${THREAD_WINDOW_HOURS} hours'`))
      .select('id', 'title', 'category', 'region', 'country_code')

    // Load tags for active threads (from their member signals)
    const threadTags: Record<string, string[]> = {}
    if (activeThreads.length > 0) {
      const threadSignalTags = await db.raw(`
        SELECT ets.thread_id, array_agg(DISTINCT unnested_tag) as tags
        FROM event_thread_signals ets
        JOIN signals s ON s.id = ets.signal_id
        CROSS JOIN LATERAL unnest(s.tags) AS unnested_tag
        WHERE ets.thread_id = ANY(?)
        GROUP BY ets.thread_id
      `, [activeThreads.map(t => t.id)])
      for (const row of threadSignalTags.rows ?? []) {
        threadTags[row.thread_id] = row.tags ?? []
      }
    }

    // 3. For each unthreaded signal, find best matching thread or create new one
    for (const signal of signals) {
      processed++
      const candidates: ThreadCandidate[] = []
      const signalTags = signal.tags ?? []

      for (const thread of activeThreads) {
        let score = 0
        const tTags = threadTags[thread.id] ?? []

        // Tag overlap scoring
        const overlap = signalTags.filter((t: string) => tTags.includes(t)).length
        if (overlap >= MIN_TAG_OVERLAP) {
          score += Math.min(0.4, overlap * 0.1)
        }

        // Category match
        if (signal.category && signal.category === thread.category) {
          score += 0.2
        }

        // Geographic match
        if (signal.country_code && signal.country_code === thread.country_code) {
          score += 0.15
        }
        if (signal.region && signal.region === thread.region) {
          score += 0.1
        }

        // Title similarity (pg_trgm)
        if (score > 0.1) {  // Only check expensive similarity if there's already some match
          try {
            const simResult = await db.raw(
              `SELECT similarity(?, ?) as sim`,
              [signal.title?.substring(0, 200) ?? '', thread.title?.substring(0, 200) ?? '']
            )
            const sim = Number(simResult.rows?.[0]?.sim ?? 0)
            if (sim >= TITLE_SIMILARITY_THRESHOLD) {
              score += sim * 0.3
            }
          } catch {
            // pg_trgm not available or error — skip similarity scoring
          }
        }

        if (score >= 0.3) {
          candidates.push({ thread_id: thread.id, score })
        }
      }

      if (candidates.length > 0) {
        // Match to best thread
        candidates.sort((a, b) => b.score - a.score)
        const best = candidates[0]

        await db('event_thread_signals').insert({
          thread_id: best.thread_id,
          signal_id: signal.id,
          relevance: Math.round(best.score * 1000) / 1000,
        }).onConflict(['thread_id', 'signal_id']).ignore()

        // Update thread metadata
        await db('event_threads')
          .where('id', best.thread_id)
          .update({
            signal_count: db.raw('signal_count + 1'),
            last_updated: new Date(),
            severity: pickHigherSeverity(
              (await db('event_threads').where('id', best.thread_id).select('severity').first())?.severity,
              signal.severity
            ),
          })

        matched++
      } else {
        // Create new thread from this signal
        const [thread] = await db('event_threads').insert({
          title: signal.title,
          summary: signal.summary?.substring(0, 500),
          category: signal.category,
          status: 'developing',
          severity: signal.severity ?? 'medium',
          region: signal.region,
          country_code: signal.country_code,
          signal_count: 1,
          first_signal_at: signal.created_at,
          last_updated: new Date(),
        }).returning('id')

        await db('event_thread_signals').insert({
          thread_id: thread.id,
          signal_id: signal.id,
          relevance: 1.0,
        }).onConflict(['thread_id', 'signal_id']).ignore()

        // Add to active threads for subsequent signals in this batch
        activeThreads.push({
          id: thread.id,
          title: signal.title,
          category: signal.category,
          region: signal.region,
          country_code: signal.country_code,
        })
        threadTags[thread.id] = signalTags

        created++
      }
    }

    // 4. Update thread lifecycle statuses
    const statusUpdates = await updateThreadStatuses()

    const durationMs = Date.now() - start
    logger.info(
      { processed, matched, created, statusUpdates, durationMs },
      `[THREADS] Event thread cycle complete`
    )

    // Cache latest stats for quick lookups
    await redis.setex('cortex:threads:stats', 300, JSON.stringify({
      processed, matched, created, statusUpdates,
      generated_at: new Date().toISOString(),
    })).catch(() => {})

    return { processed, matched, created, statusUpdates }
  } catch (err) {
    logger.error({ err }, '[THREADS] Event thread update failed')
    return { processed, matched, created, statusUpdates: 0 }
  }
}

/**
 * Update thread lifecycle statuses based on activity patterns.
 */
async function updateThreadStatuses(): Promise<number> {
  let updates = 0

  // Developing → Escalating (signal count >= threshold)
  const escalated = await db('event_threads')
    .where('status', 'developing')
    .where('signal_count', '>=', ESCALATION_THRESHOLD)
    .update({ status: 'escalating', last_updated: new Date() })
  updates += escalated

  // Escalating/Developing → Stable (no new signals in STABLE_QUIET_HOURS)
  const stabilized = await db('event_threads')
    .whereIn('status', ['developing', 'escalating'])
    .where('last_updated', '<', db.raw(`NOW() - INTERVAL '${STABLE_QUIET_HOURS} hours'`))
    .update({ status: 'stable', last_updated: new Date() })
  updates += stabilized

  // Stable → Resolved (older than MAX_THREAD_AGE_HOURS)
  const resolved = await db('event_threads')
    .where('status', 'stable')
    .where('last_updated', '<', db.raw(`NOW() - INTERVAL '${MAX_THREAD_AGE_HOURS} hours'`))
    .update({
      status: 'resolved',
      resolved_at: new Date(),
      last_updated: new Date(),
    })
  updates += resolved

  return updates
}

/**
 * Pick the higher severity between two severity strings.
 */
function pickHigherSeverity(a?: string, b?: string): string {
  const order = ['info', 'low', 'medium', 'high', 'critical']
  const ai = order.indexOf(a ?? 'low')
  const bi = order.indexOf(b ?? 'low')
  return order[Math.max(ai, bi)] ?? 'medium'
}
