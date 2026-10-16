/**
 * Search by meaning over the in-house fingerprints (lib/fingerprint.ts), which
 * the scraper stores in signal_fingerprints (Oct 16, 2026; replaces Pinecone
 * and OpenAI, never configured or out of credit):
 *
 *   • similarReports(id)  the reports closest in meaning to one report, from
 *                         three weeks either side of it (a report's page)
 *   • searchByMeaning(q)  the reports closest to a plain-language question
 *
 * Both answer [] rather than an error while the table or the model isn't
 * there yet. Scores are 0–1 (1 = the same meaning). On 443 of WorldPulse's
 * own reports, 0.45 kept 72% of same-story pairs and 1% of the others.
 */

import { db } from '../db/postgres'
import { FINGERPRINT_MODEL, fingerprintWith, loadFingerprintModel, toVectorLiteral } from './fingerprint'

export interface MeaningMatch { id: string; score: number }

/** Nearest fingerprints read before the filters are applied */
const CANDIDATES = 200
export const SIMILAR_MIN_SCORE = 0.45
export const SEARCH_MIN_SCORE = 0.2

interface NearestOptions {
  limit:      number
  minScore:   number
  excludeId?: string
  category?:  string
  /** Only reports between these times */
  from?:      Date
  to?:        Date
}

async function nearest(vector: string, o: NearestOptions): Promise<MeaningMatch[]> {
  const where: string[] = ['nn.score >= ?']
  const args: unknown[] = [o.minScore]
  if (o.category) { where.push('s.category = ?'); args.push(o.category) }
  if (o.from) { where.push('s.created_at >= ?'); args.push(o.from.toISOString()) }
  if (o.to) { where.push('s.created_at <= ?'); args.push(o.to.toISOString()) }
  return db.transaction(async (trx) => {
    // the index hands back up to ef_search rows; ask for enough to filter from
    await trx.raw(`SET LOCAL hnsw.ef_search = ${CANDIDATES}`)
    const res = await trx.raw(
      `WITH nn AS (
         SELECT f.signal_id, 1 - (f.vec <=> ?::vector) AS score
           FROM signal_fingerprints f
          WHERE f.model = ?${o.excludeId ? ' AND f.signal_id <> ?::uuid' : ''}
          ORDER BY f.vec <=> ?::vector
          LIMIT ${CANDIDATES}
       )
       SELECT nn.signal_id AS id, nn.score
         FROM nn JOIN signals s ON s.id = nn.signal_id
        WHERE ${where.join(' AND ')}
        ORDER BY nn.score DESC
        LIMIT ?`,
      [vector, FINGERPRINT_MODEL, ...(o.excludeId ? [o.excludeId] : []), vector, ...args, o.limit],
    )
    const rows = (res as { rows?: Array<{ id: string; score: number | string }> }).rows ?? []
    return rows.map(r => ({ id: String(r.id), score: Math.round(Number(r.score) * 1000) / 1000 }))
  })
}

/** Reports closest in meaning to one report (it and exact copies excluded by id) */
export async function similarReports(id: string, limit = 5, minScore = SIMILAR_MIN_SCORE): Promise<MeaningMatch[]> {
  try {
    const own = await db.raw(
      'SELECT vec::text AS vec, created_at FROM signal_fingerprints WHERE signal_id = ?::uuid AND model = ?',
      [id, FINGERPRINT_MODEL],
    )
    const row = (own as { rows?: Array<{ vec: string; created_at: Date | string }> }).rows?.[0]
    if (!row) return []
    const at = new Date(row.created_at)
    const span = 21 * 86_400_000
    return await nearest(row.vec, {
      limit, minScore, excludeId: id,
      from: new Date(at.getTime() - span), to: new Date(at.getTime() + span),
    })
  } catch {
    return []   // no table yet, or the database is busy: no similar reports
  }
}

/** Reports closest in meaning to a question; null while the model isn't available */
export async function searchByMeaning(
  q: string,
  opts: { limit?: number; category?: string; minScore?: number } = {},
): Promise<MeaningMatch[] | null> {
  const model = await loadFingerprintModel()
  if (!model) return null
  const v = fingerprintWith(model, q)
  if (!v) return []              // no word of the question is known
  try {
    return await nearest(toVectorLiteral(v), {
      limit: opts.limit ?? 20, minScore: opts.minScore ?? SEARCH_MIN_SCORE, category: opts.category,
    })
  } catch {
    return []
  }
}
