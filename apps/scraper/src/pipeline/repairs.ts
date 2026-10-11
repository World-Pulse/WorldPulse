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
