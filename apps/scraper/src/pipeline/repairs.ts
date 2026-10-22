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
import { decodeEntities, cleanUrl, cleanTitle, ENCODED_TEXT_RE, FEED_FOOTER_SQL, OUTLET_NOTE_SQL, OUTLET_SUFFIX_SQL, summaryWithoutNotes, feedText, HTML_TAG_RE, withoutOutletName, saysMore, articleSummary, storyPostText } from './text'
import { liftedSeverity, readLoweredSql, type SeverityRow } from './severity-lift'
import { tidyGeoName } from '../sources/gdelt'
import { NEWS_SOURCE_REGISTRY, detectNewsCategory, isShoppingItem } from '../sources/news-rss'
import { categorizeArticle, categorizeText } from './categories'
import { corroboratedReliability, RELIABILITY_CEILING } from './correlate'
import { FIPS_TO_ISO, isoForStoredFips } from './fips-countries'
import { countryNameOf } from './world-countries'

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

/**
 * Reliability of the last 3 days' corroborated stories that reached the old
 * cap (correlate.ts added 0.07 per outlet up to 1.0: 252 of 574 verified
 * stories showed 100%), as correlate.ts scores them now: the report's
 * starting score (its RSS outlet's own, GDELT's 0.65, else 0.7) with each
 * further outlet closing part of the gap to 0.98. Only lowers, and lowered
 * rows no longer match, so a later start changes nothing. OSINT feeds keep
 * their own scores (USGS and the like start at 0.99).
 */
export async function recalibrateFlatReliability(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .where('source_count', '>=', 2)
    .where('reliability_score', '>', RELIABILITY_CEILING)
    .whereRaw("(NOT (tags @> ARRAY['osint']::text[]) OR tags @> ARRAY['gdelt']::text[])")
    .select('id', 'tags', 'source_count', 'reliability_score')
    .limit(10000) as Array<{ id: string; tags: string[] | null; source_count: number | null; reliability_score: number | string }>
  const sources = new Map(NEWS_SOURCE_REGISTRY.map(src => [src.id, src]))
  const changed: Array<{ id: string; score: number }> = []
  for (const row of rows) {
    const tags = row.tags ?? []
    const base = tags.includes('gdelt') ? 0.65
      : tags.includes('rss') ? (tags.map(t => sources.get(t)).find(Boolean)?.reliability ?? 0.8)
      : 0.7
    const score = Math.round(corroboratedReliability(base, (Number(row.source_count) || 1) - 1) * 1000) / 1000
    if (score < Number(row.reliability_score)) changed.push({ id: row.id, score })
  }
  // 500 rows a statement
  for (let i = 0; i < changed.length; i += 500) {
    const batch = changed.slice(i, i + 500)
    await db.raw(
      `UPDATE signals AS s SET reliability_score = v.score
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::numeric)').join(', ')}) AS v(id, score)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.score]),
    )
  }
  return changed.length
}

/**
 * Shopping pages saved as news in the last 3 days (Wired's coupon codes and
 * gift guides; news-rss.ts isShoppingItem skips them now). Like stale feed
 * items they become 'retracted' with a tag, shopping-item, so they can be
 * found and put back. Only pending rows, so a later start changes nothing.
 */
export async function retractShoppingItems(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .where('status', 'pending')
    .whereRaw("tags @> ARRAY['news', 'rss']::text[]")
    .select('id', 'title', 'original_urls')
    .limit(30000) as Array<{ id: string; title: string | null; original_urls: string[] | null }>
  const ids = rows
    .filter(r => isShoppingItem({ title: r.title ?? '', link: r.original_urls?.[0] ?? '' }))
    .map(r => r.id)
  if (ids.length === 0) return 0
  await db('signals').whereIn('id', ids).update({
    status: 'retracted',
    tags:   db.raw("array_append(tags, 'shopping-item')"),
  })
  return ids.length
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
    .select('id', 'title', 'summary', 'category', 'severity', 'source_count', db.raw(`${readLoweredSql()} AS read_lowered`))
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
 * Summaries of the last 3 days with a feed's footer or pitch ("The post …
 * appeared first on …", "Read More: <link>", "Get our breaking news email,
 * free app or daily news podcast"), or with HTML the feed sent encoded
 * ("&lt;p&gt;", shown as codes: 119 of 3,211 recent summaries on Oct 11,
 * 2026), as text.ts writes them now: plain text without them, and null where
 * only the headline is left. Cleaned rows no longer match, so a later start
 * finds nothing to do.
 */
export async function stripFeedFooters(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw('summary ~* ?', [FEED_FOOTER_SQL])
    .select('id', 'title', 'summary')
    .limit(5000) as Array<{ id: string; title: string | null; summary: string | null }>
  let fixed = 0
  for (const row of rows) {
    if (!row.summary) continue
    const text = HTML_TAG_RE.test(row.summary) ? feedText(row.summary) : row.summary
    const clean = summaryWithoutNotes(text, row.title ?? '')
    if (clean === row.summary) continue
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

/** Rows a statement for the VALUES updates below */
const UPDATE_BATCH = 500

/**
 * The last 3 days' reports whose summary only repeats the headline, and the
 * story posts that show it twice (H-0024, Oct 20, 2026): the older news
 * reader stored the word rules' summary, the headline's first 150
 * characters (12 of the 100 newest reports), and its post read
 * "<headline>\n\n<headline>" (48 of the 50 newest in Global Pulse). Each
 * report gets what intake writes now (text.ts articleSummary): the
 * article's opening from its feed (raw_articles, by the report's links),
 * else no summary; each such post, the headline once, or with the new
 * summary. A fixed row no longer matches, so a later start finds nothing to
 * do.
 */
export async function repairHeadlineSummaries(): Promise<{ summaries: number; posts: number }> {
  // Summaries no longer than their headline: the ones that can only repeat it
  const found = await db.raw(
    `SELECT id, title, summary, original_urls
       FROM signals
      WHERE created_at > NOW() - INTERVAL '3 days'
        AND summary IS NOT NULL
        AND length(summary) <= length(title) + 3
      LIMIT 20000`,
  ) as { rows?: Array<{ id: string; title: string | null; summary: string; original_urls: unknown }> }
  const repeats = (found.rows ?? []).filter(r => typeof r.title === 'string' && !saysMore(r.summary, r.title))

  // Each article's text from its feed, by the report's links (raw_articles.url is unique)
  const linksOf = (r: { original_urls: unknown }) => (Array.isArray(r.original_urls) ? r.original_urls : []).filter((u): u is string => typeof u === 'string')
  const links = [...new Set(repeats.flatMap(linksOf))]
  const bodies = new Map<string, string>()
  for (let i = 0; i < links.length; i += UPDATE_BATCH) {
    const got = await db.raw(
      'SELECT url, body FROM raw_articles WHERE url = ANY(?::text[]) AND body IS NOT NULL',
      [links.slice(i, i + UPDATE_BATCH)],
    ) as { rows?: Array<{ url: string; body: string }> }
    for (const a of got.rows ?? []) bodies.set(a.url, a.body)
  }

  const fixed = repeats.map(r => {
    const body = linksOf(r).map(u => bodies.get(u)).find(b => typeof b === 'string') ?? null
    return { id: r.id, summary: articleSummary(null, body, r.title as string) }
  })
  for (let i = 0; i < fixed.length; i += UPDATE_BATCH) {
    const batch = fixed.slice(i, i + UPDATE_BATCH)
    await db.raw(
      `UPDATE signals AS s SET summary = v.summary
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text)').join(', ')}) AS v(id, summary)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.summary]),
    )
  }

  // Story posts that show their headline twice, rewritten from their report as it reads now
  const posts = await db.raw(
    `SELECT p.id, p.content, s.summary
       FROM posts p
       JOIN signals s ON s.id = p.signal_id
      WHERE p.post_type = 'signal'
        AND p.created_at > NOW() - INTERVAL '3 days'
        AND strpos(p.content, E'\n\n') > 0
      LIMIT 20000`,
  ) as { rows?: Array<{ id: string; content: string; summary: string | null }> }
  const rewritten: Array<{ id: string; content: string }> = []
  for (const p of posts.rows ?? []) {
    const cut = p.content.indexOf('\n\n')
    const headline = p.content.slice(0, cut)
    // Only the automated "<headline>\n\n<summary>" posts whose summary says nothing more
    if (saysMore(p.content.slice(cut + 2), headline)) continue
    const content = storyPostText(headline, p.summary)
    if (content !== p.content) rewritten.push({ id: p.id, content })
  }
  for (let i = 0; i < rewritten.length; i += UPDATE_BATCH) {
    const batch = rewritten.slice(i, i + UPDATE_BATCH)
    await db.raw(
      `UPDATE posts AS p SET content = v.content
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text)').join(', ')}) AS v(id, content)
        WHERE p.id = v.id`,
      batch.flatMap(r => [r.id, r.content]),
    )
  }
  return { summaries: fixed.length, posts: rewritten.length }
}

/**
 * Headlines of the last 3 days without the outlet's name their page title
 * ended with ("… - The Korea Times", "… | Mint"), as intake writes them now
 * (text.ts withoutOutletName, Oct 11, 2026: 138 of 2,600 recent stories).
 * Reads what intake read (the headline and the first link), so it can run at
 * every start: a cleaned headline no longer changes.
 */
export async function stripOutletNames(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw('title ~ ?', [OUTLET_SUFFIX_SQL])
    .select('id', 'title', 'original_urls')
    .limit(30000) as Array<{ id: string; title: string | null; original_urls: unknown }>
  const changed: Array<{ id: string; title: string }> = []
  for (const row of rows) {
    if (typeof row.title !== 'string') continue
    const urls = Array.isArray(row.original_urls) ? row.original_urls : []
    const title = withoutOutletName(row.title, typeof urls[0] === 'string' ? urls[0] : null)
    if (title !== row.title) changed.push({ id: row.id, title })
  }
  // 500 rows a statement
  for (let i = 0; i < changed.length; i += 500) {
    const batch = changed.slice(i, i + 500)
    await db.raw(
      `UPDATE signals AS s SET title = v.title
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text)').join(', ')}) AS v(id, title)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.title]),
    )
  }
  return changed.length
}

/** The category values the signals table takes */
const STORED_CATEGORIES = new Set([
  'breaking', 'conflict', 'geopolitics', 'climate', 'health', 'economy', 'technology', 'science',
  'elections', 'culture', 'disaster', 'security', 'sports', 'space', 'finance', 'other',
])

/**
 * News categories of the last 3 days, as the RSS reader's rules give them
 * now (news-rss.ts detectNewsCategory, Oct 11, 2026): the Houthi attack on
 * Riyadh airport had been filed as finance and the Pope's surgery as
 * geopolitics, and since the World Map draws each signal's kind, a wrong
 * category showed the wrong icon. Only RSS signals (their source's own
 * category is the fallback); a second start finds nothing to change.
 */
export async function recategorizeRecentNews(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '3 days'"))
    .whereRaw("tags @> ARRAY['rss']::text[]")
    .select('id', 'title', 'summary', 'category', 'tags')
    .limit(30000) as Array<{ id: string; title: string; summary: string | null; category: string; tags: string[] | null }>
  const sources = new Map(NEWS_SOURCE_REGISTRY.map(src => [src.id, src]))
  const changed: Array<{ id: string; category: string }> = []
  for (const row of rows) {
    const source = (row.tags ?? []).map(t => sources.get(t)).find(Boolean)
    if (!source) continue
    const category = detectNewsCategory(row.title ?? '', row.summary ?? '', source.category)
    // (a few sources default to names the database's category list lacks, like "military")
    if (category !== row.category && STORED_CATEGORIES.has(category)) changed.push({ id: row.id, category })
  }
  // 500 rows a statement
  for (let i = 0; i < changed.length; i += 500) {
    const batch = changed.slice(i, i + 500)
    await db.raw(
      `UPDATE signals AS s SET category = v.category::category
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text)').join(', ')}) AS v(id, category)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.category]),
    )
  }
  return changed.length
}

const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }
/** Categories classify.ts caps at medium (and "other" at low) */
const CAPPED_AT_MEDIUM = new Set(['culture', 'sports', 'science', 'space'])

/**
 * Categories of article signals saved before `before` in the last 3 days
 * (article groups from the sources table, and GDELT events with a real
 * headline), as classify.ts files them now (categories.ts, Oct 11, 2026).
 * The old rules read the pronoun "who" as the WHO and any "alert" in a long
 * article as breaking news: 213 of 1,185 recent GDELT events were health,
 * among them a novelist and a footballer's transfer talks. Only the headline
 * (and a summary, usually the headline again) is stored, so that's what's
 * read; a high or critical story whose headline names no category is left
 * as it is. Severity follows the category as classify.ts caps it: at most
 * low for "other", at most medium for culture, sports, science and space,
 * otherwise what the words earn up to what the outlet count allows (never
 * lowered). index.ts runs this once: later signals were filed with the
 * article's opening too, which a headline-only reading would overrule.
 */
export async function recategorizeRecentArticles(before: Date): Promise<number> {
  const found = await db.raw(
    `SELECT id, title, summary, category::text AS category, severity::text AS severity, source_count,
            ${readLoweredSql()} AS read_lowered
       FROM signals
      WHERE created_at > NOW() - INTERVAL '3 days'
        AND created_at < ?
        AND NOT (tags @> ARRAY['rss']::text[])
        AND (tags @> ARRAY['gdelt']::text[] OR NOT (tags @> ARRAY['osint']::text[]))
        AND title !~ ?
      LIMIT 30000`,
    [before.toISOString(), EVENT_TEMPLATE_SQL],
  )
  const rows = ((found as { rows?: Array<SeverityRow & { source_count: number | null }> })?.rows ?? [])
  const changed: Array<{ id: string; category: string; severity: string }> = []
  for (const row of rows) {
    const title = row.title ?? ''
    const category = categorizeArticle(title, row.summary)
    if (category === row.category || !STORED_CATEGORIES.has(category)) continue
    const current = SEVERITY_RANK[row.severity] ?? 0
    // A headline that names no kind of event doesn't overrule a serious story
    if (categorizeText(title, row.summary ?? '') === null && current >= SEVERITY_RANK.high!) continue
    let severity = row.severity
    if (category === 'other') {
      if (current > SEVERITY_RANK.low!) severity = 'low'
    } else {
      severity = liftedSeverity({ ...row, category }, Number(row.source_count) || 1) ?? row.severity
      if (CAPPED_AT_MEDIUM.has(category) && (SEVERITY_RANK[severity] ?? 0) > SEVERITY_RANK.medium!) severity = 'medium'
    }
    changed.push({ id: row.id, category, severity })
  }
  // 500 rows a statement
  for (let i = 0; i < changed.length; i += 500) {
    const batch = changed.slice(i, i + 500)
    await db.raw(
      `UPDATE signals AS s SET category = v.category::category, severity = v.severity::signal_severity
         FROM (VALUES ${batch.map(() => '(?::uuid, ?::text, ?::text)').join(', ')}) AS v(id, category, severity)
        WHERE s.id = v.id`,
      batch.flatMap(r => [r.id, r.category, r.severity]),
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


/** GDELT codes that mean a different country in ISO (Nigeria's NI is Nicaragua's ISO code) */
const FIPS_ONLY_CODES = Object.entries(FIPS_TO_ISO).filter(([fips, [iso]]) => fips !== iso).map(([fips]) => fips)

/**
 * GDELT stories of the last 30 days stored with GDELT's FIPS 10-4 country code
 * instead of the ISO one (Oct 20, 2026; handoff H-0022): Nigerian stories had
 * NI, Nicaragua's code, and Irish ones EI, no country at all, so they showed on
 * the wrong country page or none. gdelt.ts converts the code now
 * (fips-countries.ts). A row is changed only when its place name ends with the
 * country the FIPS code means ("Lagos, Nigeria" with NI becomes NG); a place
 * found in the article's own text keeps its ISO code ("Managua, Nicaragua"
 * with NI). Changed rows no longer match, so a later start changes nothing.
 */
export async function fixGdeltFipsCountries(): Promise<number> {
  const rows = await db('signals')
    .where('created_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
    .whereRaw("tags @> ARRAY['gdelt']::text[]")
    .whereIn('country_code', FIPS_ONLY_CODES)
    .select('id', 'country_code', 'location_name')
    .limit(20_000) as Array<{ id: string; country_code: string | null; location_name: string | null }>
  const byCountry = new Map<string, string[]>()
  for (const row of rows) {
    const iso = isoForStoredFips(row.country_code, row.location_name, countryNameOf)
    if (iso) byCountry.set(iso, [...(byCountry.get(iso) ?? []), row.id])
  }
  let fixed = 0
  for (const [iso, ids] of byCountry) {
    for (let i = 0; i < ids.length; i += 500) {
      fixed += Number(await db('signals').whereIn('id', ids.slice(i, i + 500)).update({ country_code: iso })) || 0
    }
  }
  return fixed
}

/**
 * The database feeds that no longer answer, switched off (Devon's OK, Oct 14,
 * 2026; plan Q4). Every poll of each one failed, some for months: AP closed its
 * public feeds (the address no longer resolves), swissinfo.ch answers 410 Gone
 * and TRT World 404, EMSC's feed redirects to its mobile site, GDACS refused
 * this poller (406), ReliefWeb's firewall blocks the server, and the VOA,
 * RFE/RL and Dawn addresses died. No news is lost: the news poller
 * (news-rss.ts) and the adapters (gdacs.ts, reliefweb.ts, seismic.ts) read
 * their current addresses.
 *
 * 737bdfe put this in apps/api/src/db/migrate.ts, but the automatic deploy
 * (scripts/server-deploy.sh) never runs that file, so it didn't take effect.
 * This runs at every start. To bring one back, give it a working feed and take
 * it off this list.
 *
 * Oct 17, 2026 (Devon: look into the failing sources): CBC News and NHK World
 * had never once answered our server (every poll timed out; paused 8 and 6
 * times). CBC's network turns away every client that isn't a web browser, and
 * NHK World's feed address is gone (404) and turns feed readers away too.
 * Canada now comes from The Globe and Mail, Global News and the National Post,
 * Japan from The Japan Times, Japan Today and Nikkei Asia (news-rss.ts).
 */
export const RETIRED_SOURCE_SLUGS = [
  'ap-news', 'swissinfo', 'trt-world', 'emsc-quakes', 'gdacs', 'reliefweb', 'voa-news', 'rferl', 'dawn-pk',
  'cbc-news', 'nhk-world',
]

export async function switchOffRetiredSources(): Promise<number> {
  return db('sources')
    .where('active', true)
    .whereIn('slug', RETIRED_SOURCE_SLUGS)
    .update({ active: false, updated_at: new Date() })
}
