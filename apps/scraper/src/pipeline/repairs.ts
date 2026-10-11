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
import { decodeEntities, cleanUrl, cleanTitle, ENCODED_TEXT_RE, cleanSummary, FEED_FOOTER_SQL, OUTLET_NOTE_SQL, summaryWithoutNotes } from './text'
import { liftedSeverity, type SeverityRow } from './severity-lift'
import { tidyGeoName } from '../sources/gdelt'

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

/**
 * News-feed signals from the last 3 days about stories published more than
 * 3 days before we saw them: backlogs of feeds that started working again on
 * Oct 10–11, 2026 (CNN world from 2021–2023, Xinhua from 2017, WHO from 2024,
 * …), shown as fresh news. news-rss now skips such items (MAX_ITEM_AGE_MS).
 * They become 'retracted' (feeds show verified and pending only) and get the
 * tag stale-feed-item, so they can be found and put back. Only pending rows
 * are touched, so a later start changes nothing.
 */
export async function retractStaleFeedItems(): Promise<number> {
  const result = await db.raw(
    `UPDATE signals
        SET status = 'retracted',
            tags = array_append(tags, 'stale-feed-item')
      WHERE tags @> ARRAY['news', 'rss']::text[]
        AND status = 'pending'
        AND created_at > NOW() - INTERVAL '3 days'
        AND event_time IS NOT NULL
        AND event_time < created_at - INTERVAL '3 days'`,
  )
  return Number((result as { rowCount?: number })?.rowCount ?? 0)
}

/** Pin names the old geocoder rule wrote: the bare word(s) in lowercase */
const OLD_GEOCODER_NAME_RE = "^[a-z]+([ '-][a-z]+){0,2}$"

/** Names re-checked per start (most used first); the rest wait for the next start */
const MAX_PLACE_NAMES = 300

type Place = { point: boolean; lat?: number; lng?: number; name?: string; countryCode?: string; region?: string }

const rowCount = (result: unknown) => Number((result as { rowCount?: number })?.rowCount ?? 0)

/**
 * Until Oct 11, 2026 any capitalised word the geocoder knew became a map pin,
 * named by the word in lowercase: "trump" (a US hamlet), "anthropic" (housing
 * in Afghanistan), "energy" (a village in Illinois), besides right ones like
 * "doncaster". Gazetteer, feed and sensor places are capitalised, so a
 * lowercase name marks one of those pins. Each such name from the last 7 days
 * is looked up again with today's rules (`lookup`, geo.ts geocodePlace): a
 * notable place of that name keeps the pin under its proper name; otherwise
 * each signal gets the place its own title and summary give without the
 * geocoder (`fromText`: a known place, else the capital of a country it
 * names), or no pin. Afterwards no lowercase names are left, so a later
 * start changes nothing. Each lookup is followed by a pause, so the live
 * pipeline keeps its share of the geocoder (1 request a second at most), and
 * the repair stops at the first lookup the geocoder doesn't answer.
 */
export async function recheckGeocodedPlaces(
  lookup: (name: string) => Promise<Place[] | null>,
  fromText: (text: string) => Place,
  pauseMs = 3_000,
): Promise<{ renamed: number; repinned: number; cleared: number; stopped?: boolean }> {
  const found = await db.raw(
    `SELECT location_name AS name
       FROM signals
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND location_name ~ ?
      GROUP BY location_name
      ORDER BY COUNT(*) DESC
      LIMIT ${MAX_PLACE_NAMES}`,
    [OLD_GEOCODER_NAME_RE],
  )
  const names = ((found as { rows?: Array<{ name: string }> })?.rows ?? []).map(r => r.name)
  const totals = { renamed: 0, repinned: 0, cleared: 0 }

  const setPlace = async (where: string, whereArgs: unknown[], place: Place | null) => {
    if (place?.point && place.lat != null && place.lng != null) {
      return rowCount(await db.raw(
        `UPDATE signals SET location_name = ?, location = ST_MakePoint(?, ?), country_code = ?, region = ? WHERE ${where}`,
        [place.name ?? null, place.lng, place.lat, place.countryCode ?? null, place.region ?? null, ...whereArgs],
      ))
    }
    return rowCount(await db.raw(
      `UPDATE signals SET location_name = NULL, location = NULL, country_code = ?, region = NULL WHERE ${where}`,
      [place?.countryCode ?? null, ...whereArgs],
    ))
  }
  const recent = `location_name = ? AND created_at > NOW() - INTERVAL '7 days'`

  for (const name of names) {
    const places = await lookup(name)
    // The geocoder couldn't be asked (refusing, failing, cooling down): that
    // says nothing about the name, so leave the rest for a later start. (On
    // Oct 11, 2026 failed lookups were read as "no such place" and some right
    // pins, like Doncaster's, were removed.)
    if (places === null) return { ...totals, stopped: true }
    const [place] = places
    if (place?.point) {
      totals.renamed += await setPlace(recent, [name], place)
    } else {
      const rows = await db('signals')
        .select('id', 'title', 'summary')
        .whereRaw(recent, [name]) as Array<{ id: string; title: string | null; summary: string | null }>
      for (const row of rows) {
        // (not the "Source: <outlet>" line a summary may end with: "Kyiv Independent" isn't Kyiv)
        const own = fromText(`${row.title ?? ''} ${(row.summary ?? '').replace(/\s*Source:[\s\S]*$/, '')}`)
        const changed = await setPlace('id = ?', [row.id], own)
        if (own.point) totals.repinned += changed
        else totals.cleared += changed
      }
    }
    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs))
  }
  return totals
}

/** Rows decoded per start (the rest on later starts) */
const MAX_ENCODED_ROWS = 5000

/**
 * Signals from the last 7 days whose title or summary still shows HTML codes
 * ("isn&#x27;t", "&#8211;"), or whose links have "&amp;" for "&" (GDACS):
 * about 5% of the day's headlines on Oct 11, 2026, before insert-signal.ts
 * cleaned new ones. Decoded in place; decoded rows no longer match, so a
 * later start changes nothing.
 */
export async function decodeStoredEntities(): Promise<number> {
  const found = await db.raw(
    `SELECT id, title, summary, original_urls
       FROM signals
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND (title ~* ? OR summary ~* ? OR array_to_string(original_urls, ' ') LIKE '%&amp;%')
      LIMIT ${MAX_ENCODED_ROWS}`,
    [ENCODED_TEXT_SQL, ENCODED_TEXT_SQL],
  )
  const rows = ((found as { rows?: Array<{ id: string; title: string | null; summary: string | null; original_urls: unknown }> })?.rows ?? [])
  let changed = 0
  for (const row of rows) {
    const title = typeof row.title === 'string' ? cleanTitle(row.title) : row.title
    const summary = typeof row.summary === 'string' ? decodeEntities(row.summary) : row.summary
    const urls = Array.isArray(row.original_urls) ? row.original_urls.map(u => (typeof u === 'string' ? cleanUrl(u) : u)) : null
    const sameUrls = urls === null || urls.every((u, i) => u === (row.original_urls as unknown[])[i])
    if (title === row.title && summary === row.summary && sameUrls) continue
    await db('signals').where('id', row.id).update({
      title, summary, ...(urls && !sameUrls ? { original_urls: urls } : {}),
    })
    changed++
  }
  return changed
}

/** ENCODED_TEXT_RE for Postgres (~* is already case-insensitive) */
const ENCODED_TEXT_SQL = ENCODED_TEXT_RE.source

/**
 * Reports corroborated before Oct 11, 2026 kept the single-source severity
 * cap (severity-lift.ts): the Riyadh airport attack, 25 outlets, was medium.
 * Signals of the last 3 days with 2+ outlets get the severity their words
 * earn, up to what their count allows. Only raises, so a later start finds
 * nothing to do.
 */
export async function liftCappedSeverities(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .where('source_count', '>=', 2)
    .whereIn('status', ['verified', 'pending'])
    .whereIn('severity', ['info', 'low', 'medium', 'high'])
    .select('id', 'title', 'summary', 'category', 'severity', 'source_count')
    .limit(5000) as Array<SeverityRow & { source_count: number }>
  let raised = 0
  for (const row of rows) {
    const severity = liftedSeverity(row, Number(row.source_count) || 1)
    if (!severity) continue
    await db('signals').where('id', row.id).update({ severity })
    raised++
  }
  return raised
}

/**
 * Summaries of the last 3 days that end in a feed's footer ("The post …
 * appeared first on …", "Read More: <link>") lose it (text.ts cleanSummary).
 * Cleaned rows no longer match, so a later start finds nothing to do.
 */
export async function stripFeedFooters(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw('summary ~* ?', [FEED_FOOTER_SQL])
    .select('id', 'summary')
    .limit(5000) as Array<{ id: string; summary: string | null }>
  let fixed = 0
  for (const row of rows) {
    if (!row.summary) continue
    const clean = cleanSummary(row.summary)
    if (clean === row.summary || clean.length === 0) continue
    await db('signals').where('id', row.id).update({ summary: clean })
    fixed++
  }
  return fixed
}

/**
 * Summaries of the last 3 days with the outlet note the RSS reader added
 * ("Source: X (reliability: 76%, bias: center).", text.ts), as
 * summaryWithoutNotes writes them now: the note gone, and null where only the
 * headline was left (about half of a day's RSS signals). Cleaned rows no
 * longer match, so a later start finds nothing to do.
 */
export async function stripOutletNotes(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw('summary ~ ?', [OUTLET_NOTE_SQL])
    .select('id', 'title', 'summary')
    .limit(30000) as Array<{ id: string; title: string | null; summary: string | null }>
  const changed: Array<{ id: string; summary: string | null }> = []
  for (const row of rows) {
    const clean = summaryWithoutNotes(row.summary, row.title ?? '')
    if (clean !== row.summary) changed.push({ id: row.id, summary: clean })
  }
  // 500 rows a statement
  for (let i = 0; i < changed.length; i += 500) {
    const batch = changed.slice(i, i + 500)
    await db.raw(
      `UPDATE signals AS s SET summary = v.summary
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text)').join(', ')}) AS v(id, summary)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.summary]),
    )
  }
  return changed.length
}

/**
 * GDELT place names of the last 3 days with lost letters ("Ar Riya?") or a
 * state named twice ("Karnataka, Karnataka, India"), in the place and in
 * the "<event> in <place>" headline, read as gdelt.ts tidyGeoName writes
 * them now. Tidied rows no longer match, so a later start finds nothing to do.
 */
export async function tidyGdeltPlaceNames(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw("tags @> ARRAY['gdelt']::text[]")
    .where(function () {
      // (bound values: a literal ? in knex's raw SQL is read as a placeholder)
      this.whereRaw('title LIKE ?', ['%?%']).orWhereRaw('location_name LIKE ?', ['%?%'])
        .orWhereRaw('title LIKE ?', ['%\uFFFD%']).orWhereRaw('location_name LIKE ?', ['%\uFFFD%'])
        .orWhereRaw('location_name ~ ?', ['^([^,]+), \\1(,|$)'])
    })
    .select('id', 'title', 'location_name')
    .limit(5000) as Array<{ id: string; title: string; location_name: string | null }>
  let fixed = 0
  for (const row of rows) {
    const update: { title?: string; location_name?: string } = {}
    const place = row.location_name ? tidyGeoName(row.location_name) : null
    if (place && place !== row.location_name) update.location_name = place
    const m = /^(.+?) in (.+)$/.exec(row.title)
    if (m) {
      const tidy = tidyGeoName(m[2]!)
      if (tidy && tidy !== m[2]) update.title = `${m[1]} in ${tidy}`
    }
    if (Object.keys(update).length === 0) continue
    await db('signals').where('id', row.id).update(update)
    fixed++
  }
  return fixed
}

