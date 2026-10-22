/**
 * One-off (Oct 22, 2026): the reports of the last 8 days get the places the new
 * list (world-places.ts) finds in their own words, the way reports from now on
 * get them when they arrive (entity-rules.ts), so the Knowledge Graph — and the
 * engine's count of reports linked to a named person, place or organisation —
 * reflect them now instead of over the coming week. Runs once (a Redis mark),
 * in the background, a small batch at a time.
 */

import { pgPool as db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { upsertEntityNode } from './entity-graph'
import { morePlacesInText } from './entity-rules'
import { placesInText } from './geo'

const DONE_KEY = 'entity:more-places:backfill:v1'
const BATCH = 200
const PAUSE_MS = 200

interface Row { id: string; title: string | null; summary: string | null; created_at: Date | string; at_text: string }

/** The places each report gains (the ones placesInText already found are left out) */
export function morePlacesFor(row: Pick<Row, 'title' | 'summary'>): string[] {
  const title = String(row.title ?? '')
  const summary = row.summary == null ? null : String(row.summary)
  return morePlacesInText(title, summary, placesInText(`${title}. ${summary ?? ''}`))
}

export async function backfillMorePlaces(days = 8): Promise<{ reports: number; linked: number; links: number } | null> {
  if (await redis.get(DONE_KEY)) return null
  // one at a time, if two copies of the scraper start together
  if (await redis.set(`${DONE_KEY}:running`, '1', 'EX', 3_600, 'NX') !== 'OK') return null
  let after: { at: string; id: string } | null = null
  let reports = 0, linked = 0, links = 0
  for (;;) {
    const { rows } = await db.query(
      `SELECT id, title, summary, created_at, created_at::text AS at_text FROM signals
        WHERE created_at >= NOW() - make_interval(days => $1)
          ${after ? 'AND (created_at, id::text) > ($2::timestamptz, $3)' : ''}
        ORDER BY created_at, id::text
        LIMIT ${BATCH}`,
      after ? [days, after.at, after.id] : [days],
    ) as { rows: Row[] }
    if (!rows.length) break
    for (const row of rows) {
      reports++
      const places = morePlacesFor(row)
      if (places.length) linked++
      for (const name of places) {
        await upsertEntityNode({ name, type: 'location', salience: 0.5 }, String(row.id), new Date(row.created_at).toISOString())
        links++
      }
    }
    const last = rows[rows.length - 1]!
    after = { at: last.at_text, id: String(last.id) }   // the database's own time, to the microsecond
    await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
  }
  await redis.set(DONE_KEY, new Date().toISOString())
  return { reports, linked, links }
}
