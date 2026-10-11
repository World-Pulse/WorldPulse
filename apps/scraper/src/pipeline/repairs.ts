/**
 * One-off data repairs that run when the scraper starts. Each one is bounded
 * and idempotent, so running it again on a later start changes nothing.
 *
 * History: the Oct 10, 2026 repair that undid the over-eager corroboration
 * (verified → pending for 15:30–16:05 UTC) ran on the first start of 48892ef
 * and was removed once done.
 */

import { db } from '../lib/postgres'
import { EVENT_TEMPLATE_SQL } from './event-titles'
import { countIndependentOutlets } from './independence'
import { hostOf } from './signal-columns'

/** Where nginx serves uploaded post media (the uploads volume, under /uploads/) */
const PUBLIC_SITE = 'https://world-pulse.io'

/** Upload URLs built from the API's own address, which no browser can load */
const LOCAL_UPLOAD_RE = '^https?://(localhost|127\\.0\\.0\\.1):3001/uploads/'

/**
 * Post images and videos uploaded before UPLOADS_BASE_URL was set got URLs
 * on the API's internal address (http://localhost:3001/uploads/...). The same
 * files are public at https://world-pulse.io/uploads/..., so point the stored
 * URLs there. Only rows that still have such a URL are touched.
 */
export async function fixLocalhostUploadUrls(): Promise<number> {
  const result = await db.raw(
    `UPDATE posts
        SET media_urls = ARRAY(
              SELECT regexp_replace(u, ?, ?)
                FROM unnest(media_urls) WITH ORDINALITY AS t(u, i)
               ORDER BY i)
      WHERE EXISTS (SELECT 1 FROM unnest(media_urls) AS m(u) WHERE u ~ ?)`,
    [LOCAL_UPLOAD_RE, `${PUBLIC_SITE}/uploads/`, LOCAL_UPLOAD_RE],
  )
  return Number((result as { rowCount?: number })?.rowCount ?? 0)
}

/** GDELT's reliability for a single coded event (sources/gdelt.ts) */
const GDELT_RELIABILITY = 0.65

/**
 * Undo corroboration between GDELT "<event label> in <place>" signals, whose
 * titles verified each other on Oct 10, 2026 ("Armed conflict in Washington,
 * District of Columbia, United States"; see pipeline/event-titles.ts). Each
 * goes back to pending, one source, its own link only, and at most GDELT's
 * base reliability. Only signals from the last 7 days, and only those still
 * marked verified or multi-source, so a later start changes nothing.
 */
export async function undoTemplateCorroboration(): Promise<number> {
  const result = await db.raw(
    `UPDATE signals
        SET status = 'pending',
            source_count = 1,
            reliability_score = LEAST(reliability_score, ?),
            original_urls = original_urls[1:1]
      WHERE tags @> ARRAY['gdelt']::text[]
        AND created_at > NOW() - INTERVAL '7 days'
        AND (status = 'verified' OR source_count > 1)
        AND title ~ ?`,
    [GDELT_RELIABILITY, EVENT_TEMPLATE_SQL],
  )
  return Number((result as { rowCount?: number })?.rowCount ?? 0)
}

/**
 * Verified signals from the last 3 days whose links are all copies of one
 * article on different websites (sister stations, syndication sites: the same
 * address slug), which no longer counts as independent corroboration (see
 * pipeline/independence.ts), go back to pending with one source. Only rows
 * still verified with 2+ links are read, so a later start changes nothing.
 */
export async function undoCopyVerifications(): Promise<number> {
  const rows = await db('signals')
    .select('id', 'original_urls')
    .where('status', 'verified')
    .whereRaw(`created_at > NOW() - INTERVAL '3 days'`)
    .whereRaw('cardinality(original_urls) >= 2') as Array<{ id: string; original_urls: unknown }>
  const ids = rows
    .filter(r => {
      const urls = Array.isArray(r.original_urls) ? r.original_urls.map(String) : []
      const byHost = new Map(urls.map(u => [hostOf(u), u] as const))
      if (byHost.size < 2) return false // one website: verified some other way, leave it
      return countIndependentOutlets([...byHost].map(([host, url]) => ({ source_id: host, url }))) < 2
    })
    .map(r => r.id)
  if (ids.length === 0) return 0
  return db('signals').whereIn('id', ids).update({ status: 'pending', verified_at: null, source_count: 1 })
}
