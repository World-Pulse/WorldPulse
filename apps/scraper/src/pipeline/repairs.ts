/**
 * One-off data repairs that run when the scraper starts. Each one is bounded
 * and idempotent, so running it again on a later start changes nothing.
 *
 * History: the Oct 10, 2026 repair that undid the over-eager corroboration
 * (verified → pending for 15:30–16:05 UTC) ran on the first start of 48892ef
 * and was removed once done.
 */

import { db } from '../lib/postgres'

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
