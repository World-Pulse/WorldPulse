/**
 * Fingerprints pipeline: every report gets an in-house fingerprint (lib/fingerprint.ts)
 * in its own table, so "similar reports" and search by meaning work.
 *
 *   • on insert:   each new report, right after it is saved
 *   • every 10 min: reports of the last 2 days that missed theirs, then 2,000
 *                   older ones, newest first, until the whole archive has one
 *
 * The table is created here when missing (safe at every start). Fingerprints
 * live apart from `signals`, so the reports table is never rewritten for them,
 * and each row names the model that made it.
 *
 * Replaces pipeline/embeddings.ts (OpenAI, out of credit since Oct 10, 2026;
 * its fall-back vectors never reached the database this week).
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import {
  FINGERPRINT_DIMS, FINGERPRINT_MODEL, fingerprintStatus, fingerprintWith,
  loadFingerprintModel, reportText, toVectorLiteral,
} from '../lib/fingerprint'

/** Older reports fingerprinted per 10-minute run */
const HISTORY_PER_RUN = 2_000
/** Rows per INSERT statement */
const INSERT_CHUNK = 250
/** How far back the catch-up of missed new reports looks */
const RECENT_DAYS = 2
const CURSOR_KEY = 'fingerprints:history:cursor'
const DONE_KEY = 'fingerprints:history:done'
const STATS_KEY = 'fingerprints:stats'

let tableReady: Promise<boolean> | null = null

/** Create the fingerprints table and its indexes if missing; false if that can't be done */
export function ensureFingerprintTable(): Promise<boolean> {
  if (tableReady) return tableReady
  tableReady = (async () => {
    try {
      await db.raw('CREATE EXTENSION IF NOT EXISTS vector')
      await db.raw(`
        CREATE TABLE IF NOT EXISTS signal_fingerprints (
          signal_id   UUID        PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
          created_at  TIMESTAMPTZ NOT NULL,
          model       TEXT        NOT NULL,
          vec         vector(${FINGERPRINT_DIMS}) NOT NULL
        )`)
      await db.raw('CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_created ON signal_fingerprints (created_at DESC)')
      await db.raw(`CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_vec ON signal_fingerprints
                      USING hnsw (vec vector_cosine_ops) WITH (m = 16, ef_construction = 64)`)
      return true
    } catch (err) {
      logger.warn({ err }, '[FINGERPRINT] Table could not be created; fingerprints stay off until the next start')
      return false
    }
  })()
  return tableReady
}

export interface ReportRow {
  id: string
  title: string | null
  summary?: string | null
  created_at: Date | string
}

/** Fingerprint rows and store them (existing ones are left as they are). Returns how many were new. */
export async function storeFingerprints(rows: ReportRow[]): Promise<number> {
  if (rows.length === 0 || !(await ensureFingerprintTable())) return 0
  const model = await loadFingerprintModel()
  if (!model) return 0
  let stored = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const values: unknown[] = []
    const marks: string[] = []
    for (const r of rows.slice(i, i + INSERT_CHUNK)) {
      const v = fingerprintWith(model, reportText(r.title, r.summary))
      if (!v) continue
      const at = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
      values.push(String(r.id), at, FINGERPRINT_MODEL, toVectorLiteral(v))
      marks.push('(?, ?, ?, ?)')
    }
    if (marks.length === 0) continue
    try {
      // joined with signals, so a report removed meanwhile is skipped instead of failing the batch
      const res = await db.raw(
        `INSERT INTO signal_fingerprints (signal_id, created_at, model, vec)
         SELECT v.id::uuid, v.at::timestamptz, v.model, v.vec::vector
           FROM (VALUES ${marks.join(', ')}) AS v(id, at, model, vec)
           JOIN signals s ON s.id = v.id::uuid
         ON CONFLICT (signal_id) DO NOTHING`,
        values,
      )
      stored += Number((res as { rowCount?: number }).rowCount ?? 0)
    } catch (err) {
      logger.debug({ err, rows: marks.length }, '[FINGERPRINT] A batch of fingerprints was not stored')
    }
  }
  return stored
}

/** Fingerprint one new report (called on insert; never throws) */
export async function fingerprintSignal(id: string, title: string, summary: string | null | undefined, createdAt: Date | string): Promise<boolean> {
  try {
    return (await storeFingerprints([{ id, title, summary, created_at: createdAt }])) > 0
  } catch (err) {
    logger.debug({ err, signalId: id }, '[FINGERPRINT] Fingerprint not stored (non-fatal)')
    return false
  }
}

interface Cursor { at: string; id: string }

/**
 * One backfill run: recent reports that missed their fingerprint, then the next
 * HISTORY_PER_RUN older reports (newest first; the place reached is kept in Redis).
 */
export async function backfillFingerprints(): Promise<{ recent: number; older: number; historyDone: boolean; ms: number; error?: string }> {
  const t0 = Date.now()
  let recent = 0
  let older = 0
  let historyDone = false
  let error: string | undefined
  try {
    if (!(await ensureFingerprintTable())) throw new Error('fingerprints table unavailable')
    if (!(await loadFingerprintModel())) throw new Error(fingerprintStatus().error ?? 'model unavailable')

    const missed = await db.raw(`
      SELECT s.id, s.title, s.summary, s.created_at
        FROM signals s
        LEFT JOIN signal_fingerprints f ON f.signal_id = s.id
       WHERE s.created_at > NOW() - INTERVAL '${RECENT_DAYS} days'
         AND f.signal_id IS NULL
       ORDER BY s.created_at DESC
       LIMIT ${HISTORY_PER_RUN}`)
    recent = await storeFingerprints((missed as { rows?: ReportRow[] }).rows ?? [])

    historyDone = (await redis.get(DONE_KEY).catch(() => null)) === '1'
    if (!historyDone) {
      const raw = await redis.get(CURSOR_KEY).catch(() => null)
      const cursor = raw ? (JSON.parse(raw) as Cursor) : null
      const page = cursor
        ? await db.raw(`
            SELECT id, title, summary, created_at FROM signals
             WHERE created_at <= NOW() - INTERVAL '${RECENT_DAYS} days'
               AND (created_at, id) < (?::timestamptz, ?::uuid)
             ORDER BY created_at DESC, id DESC
             LIMIT ${HISTORY_PER_RUN}`, [cursor.at, cursor.id])
        : await db.raw(`
            SELECT id, title, summary, created_at FROM signals
             WHERE created_at <= NOW() - INTERVAL '${RECENT_DAYS} days'
             ORDER BY created_at DESC, id DESC
             LIMIT ${HISTORY_PER_RUN}`)
      const rows = (page as { rows?: ReportRow[] }).rows ?? []
      older = await storeFingerprints(rows)
      const last = rows[rows.length - 1]
      if (last) {
        const at = last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at)
        await redis.set(CURSOR_KEY, JSON.stringify({ at, id: String(last.id) }))
      }
      if (rows.length < HISTORY_PER_RUN) {
        historyDone = true
        await redis.set(DONE_KEY, '1')
      }
    }
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 200)
  }
  const ms = Date.now() - t0
  await redis.set(STATS_KEY, JSON.stringify({
    at: new Date().toISOString(), recent, older, history_done: historyDone, ms, error: error ?? null,
    model: FINGERPRINT_MODEL, model_status: fingerprintStatus(),
  }), 'EX', 24 * 3600).catch(() => {})
  if (error) logger.warn({ error }, '[FINGERPRINT] Backfill run failed')
  else if (recent + older > 0) logger.info({ recent, older, historyDone, ms }, '[FINGERPRINT] Backfill run complete')
  return { recent, older, historyDone, ms, ...(error ? { error } : {}) }
}
