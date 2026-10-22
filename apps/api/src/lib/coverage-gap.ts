/**
 * The coverage gap: the crises the news covers least for their size (Devon,
 * Oct 21, 2026, 10:02 PM: "Let's get after it", on a weekly list of
 * under-reported crises made from WorldPulse's own counts).
 *
 * The crises: the countries UNHCR counts at least a million people displaced
 * from, inside the country or abroad (lib/unhcr-displaced.ts, CC BY 4.0), the
 * way CARE's yearly "Breaking the Silence" takes the crises affecting at least
 * a million people and ranks them by the articles written about them.
 *
 * Their coverage: the news websites (outlets) WorldPulse placed in each
 * country in the week, from the article links in its news reports (the
 * outlets it reads, and the articles GDELT points it to). Data feeds and
 * official press offices aren't outlets, and reports on sports, culture,
 * technology, science or space aren't coverage of a crisis.
 *
 * Ranked by people displaced per outlet: the most people for the fewest
 * outlets first, and before them any crisis no outlet covered at all. GET /api/v1/coverage-gap answers for the last 7 days, or a
 * finished ISO week (?week=2026-W42), each kept like the week's digest
 * (routes/stories.ts): the last 7 days remade every hour, a finished week
 * made in the background and kept for 30 days.
 */

import { longQuery } from './long-query'
import { logger } from './logger'
import { staleWhileRevalidate, keptAge, remakeNow, type SwrOptions } from './swr-cache'
import { EVENT_TEMPLATE_SQL, tidyHeadline } from './story-list'
import { UNHCR_DISPLACED, UNHCR_YEAR } from './unhcr-displaced'
import { isoWeekOf, previousWeek, weekBounds, weekName, type IsoWeek } from './week'
import { COUNTRY_NAMES } from '../routes/countries'
import { outletOf } from './outlets'

/** A crisis: at least this many people displaced from the country */
export const MIN_DISPLACED = 1_000_000
/** Reports on these aren't coverage of a crisis */
export const LEFT_OUT_CATEGORIES = ['sports', 'culture', 'technology', 'science', 'space'] as const
/** The most covered countries shown beside the crises, for comparison */
const MOST_COVERED = 5
/** The outlets named for each crisis, and its stories */
const SITES_SHOWN = 5
const STORIES_SHOWN = 3
/** The stories the database gives for each crisis, before those naming the country are put first */
const STORY_CANDIDATES = 8
/** A story on these is about a crisis; others (a TV anchor leaving CNN, placed in Iraq) come after them */
export const CRISIS_TOPICS = ['conflict', 'disaster', 'health', 'security', 'breaking', 'geopolitics', 'climate', 'elections'] as const
const QUERY_SECONDS = 60
const DAY_MS = 86_400_000

/** The last 7 days: remade every hour, served for a day while remade */
const ROLLING_KEEP: SwrOptions = { freshSeconds: 3_600, staleSeconds: 24 * 3_600, lockSeconds: 2 * QUERY_SECONDS }
/** A finished week hardly changes: kept a day, then served for 30 days while remade */
const FINISHED_WEEK_KEEP: SwrOptions = { freshSeconds: 24 * 3_600, staleSeconds: 30 * 86_400, lockSeconds: 2 * QUERY_SECONDS }
/** The finished weeks kept made: the ones the page links to */
export const WARM_FINISHED_WEEKS = 4
const WARM_MS = 30 * 60_000

/**
 * Sites whose links are data feeds or official press offices, not news
 * outlets: the scraper's data pollers (sources/*.ts) and the news feeds
 * tagged 'institutional'. Their own reports are left out by their tags; this
 * catches a link of theirs that joined a news report.
 */
const NOT_OUTLETS = [
  'acleddata.com', 'opensky-network.org', 'marinetraffic.com', 'aviation-safety.net', 'celestrak.org',
  'cisa.gov', 'comtradeapi.un.org', 'firms.modaps.eosdis.nasa.gov', 'gpsjam.org', 'usgs.gov',
  'interpol.int', 'inetintel.cc.gatech.edu', 'finance.yahoo.com', 'weather.gov', 'alienvault.com',
  'patentsview.org', 'poweroutage.us', 'reliefweb.int', 'safecast.org', 'noaa.gov', 'tsunami.gov',
  'unhcr.org', 'who.int', 'iaea.org', 'treasury.gov', 'gdacs.org', 'cdc.gov', 'press.un.org',
  'ec.europa.eu', 'consilium.europa.eu', 'gov.uk', 'icc-cpi.int', 'icrc.org',
]

/** Whether a site (a link's host, without "www.") counts as a news outlet */
export function isOutlet(host: string | null | undefined): boolean {
  const h = String(host ?? '').trim().toLowerCase()
  if (!h || !h.includes('.')) return false
  return !NOT_OUTLETS.some(d => h === d || h.endsWith(`.${d}`))
}

/** Full names where the country list abbreviates */
const LONG_NAMES: Record<string, string> = {
  CF: 'Central African Republic', BA: 'Bosnia and Herzegovina', GQ: 'Equatorial Guinea',
  PG: 'Papua New Guinea', TT: 'Trinidad and Tobago', DO: 'Dominican Republic', MK: 'North Macedonia',
  AE: 'United Arab Emirates', CD: 'Democratic Republic of the Congo',
}

export function countryName(code: string): string {
  return LONG_NAMES[code] ?? COUNTRY_NAMES[code] ?? code
}

/**
 * Words that place a headline in a crisis country: its name's stem (Syria in
 * "Syrian"), Spanish, French and Portuguese spellings, its capital and the
 * places and groups its crisis is named by. A story WorldPulse placed in the
 * country whose headline names none of them may be placed there by mistake
 * (Oct 21, 2026: a US court case of a Syrian-born activist, "placed" in Syria,
 * was Syria's top story), so the stories naming the country go first.
 */
const CRISIS_WORDS: Record<string, string[]> = {
  SD: ['sudan', 'khartoum', 'darfur', 'fasher', 'kordofan', 'omdurman', 'port sudan', 'rsf'],
  SS: ['south sudan', 'juba', 'abyei', 'bentiu', 'jonglei', 'upper nile', 'soudan du sud', 'sudán del sur'],
  SY: ['syri', 'siria', 'syrie', 'damascus', 'damas', 'aleppo', 'alep', 'idlib', 'homs', 'latakia', 'deir ez'],
  UA: ['ukrain', 'ucrania', 'ucrânia', 'kyiv', 'kiev', 'kharkiv', 'odesa', 'zelensk', 'donbas', 'donetsk', 'zaporizh', 'kherson'],
  VE: ['venezuel', 'caracas', 'maduro'],
  CO: ['colombi', 'bogot', 'medell', 'catatumbo', 'eln', 'farc'],
  AF: ['afghan', 'afgan', 'kabul', 'taliban', 'kandahar', 'herat'],
  CD: ['congo', 'drc', 'rdc', 'kinshasa', 'goma', 'kivu', 'ituri', 'm23', 'bukavu'],
  MM: ['myanmar', 'burm', 'rakhine', 'rohingya', 'yangon', 'naypyi', 'mandalay'],
  YE: ['yemen', 'houthi', 'sanaa', "sana'a", 'aden', 'marib', 'hodeid'],
  SO: ['somali', 'mogadishu', 'shabaab', 'puntland', 'jubaland', 'baidoa'],
  NG: ['nigeria', 'abuja', 'lagos', 'borno', 'kaduna', 'zamfara', 'benue', 'plateau state', 'boko haram'],
  ET: ['ethiopia', 'éthiopie', 'etiopía', 'addis', 'tigray', 'amhara', 'oromia', 'abiy'],
  BF: ['burkina', 'ouagadougou', 'djibo', 'traoré'],
  HT: ['haiti', 'haïti', 'haití', 'port-au-prince', 'haitian'],
  IQ: ['iraq', 'irak', 'baghdad', 'bagdad', 'mosul', 'erbil', 'basra', 'kurdistan', 'kirkuk'],
  CF: ['central african', 'centrafric', 'centroafric', 'bangui'],
  CM: ['cameroon', 'cameroun', 'camerún', 'yaound', 'douala', 'anglophone', 'bamenda'],
}

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a headline names the country (or, for a crisis, its capital, places
 * and groups), each word at the start of a word: "Iraqi" names Iraq, "bin
 * Laden" doesn't name Aden
 */
export function namesCountry(code: string, title: string): boolean {
  const t = title.toLowerCase()
  const name = countryName(code).toLowerCase()
  const words = CRISIS_WORDS[code] ?? [name.length > 5 ? name.slice(0, -1) : name]
  return words.some(w => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}`, 'u').test(t))
}

/** One country's links from one site in the window (the first query) */
export interface HostRow { code: string; host: string | null; articles: number }
/** One of a crisis's stories in the window (the second query) */
export interface StoryRow { code: string; lead_id: string; title: string; sites: number; verified: boolean }

export interface GapCrisis {
  rank: number
  code: string
  name: string
  /** People displaced from the country: inside it and abroad (UNHCR) */
  displaced: number
  inside: number
  abroad: number
  /** News websites WorldPulse placed in the country in the window */
  outlets: number
  /** Their articles (distinct links) */
  articles: number
  /**
   * Of those outlets, the ones the outlet directory knows to be based in the
   * country, and abroad (the rest, many of the articles GDELT points to, aren't known)
   */
  outletsHome: number
  outletsAbroad: number
  /** displaced / outlets (a crisis no outlet covered counts as one outlet), rounded */
  peoplePerOutlet: number
  /** The outlets with the most articles on it */
  sites: Array<{ site: string; articles: number }>
  /** Its stories with the most outlets */
  stories: Array<{ id: string; title: string; outlets: number; verified: boolean }>
}

export interface CoverageGap {
  /** 'last7days': the 7 days up to `end`; 'week': a finished ISO week */
  window: 'last7days' | 'week'
  week: string | null
  start: string
  end: string
  minDisplaced: number
  unhcrYear: number
  crises: GapCrisis[]
  mostCovered: Array<{ code: string; name: string; outlets: number; articles: number }>
  totals: {
    /** Articles from news outlets placed in any country */
    articles: number
    outlets: number
    countries: number
    crisisArticles: number
    /** crisisArticles / articles, 0 to 1 (4 decimals) */
    crisisShare: number
    crisisDisplaced: number
  }
  generatedAt: string
}

/** The crises: the countries with at least MIN_DISPLACED people displaced, largest first */
export function crisisCountries(min = MIN_DISPLACED): Array<{ code: string; inside: number; abroad: number; displaced: number }> {
  return Object.entries(UNHCR_DISPLACED)
    .map(([code, [inside, abroad]]) => ({ code, inside, abroad, displaced: inside + abroad }))
    .filter(c => c.displaced >= min)
    .sort((a, b) => b.displaced - a.displaced)
}

/** The page's figures from the two queries' rows (kept apart from the database so it can be tested) */
export function buildCoverageGap(hostRows: HostRow[], storyRows: StoryRow[], w: { window: CoverageGap['window']; week: string | null; start: Date; end: Date }, now = new Date()): CoverageGap {
  const perCountry = new Map<string, Map<string, number>>()
  const allSites = new Set<string>()
  let articles = 0
  for (const r of hostRows) {
    const host = String(r.host ?? '').trim().toLowerCase().replace(/^www\./, '')
    const n = Math.max(0, Math.round(Number(r.articles) || 0))
    if (!isOutlet(host) || n === 0 || !/^[A-Z]{2}$/.test(String(r.code))) continue
    let sites = perCountry.get(r.code)
    if (!sites) { sites = new Map(); perCountry.set(r.code, sites) }
    sites.set(host, (sites.get(host) ?? 0) + n)
    allSites.add(host)
    articles += n
  }
  const coverage = (code: string) => {
    const sites = perCountry.get(code)
    if (!sites) return { outlets: 0, articles: 0, top: [] as Array<{ site: string; articles: number }>, home: 0, abroad: 0 }
    const top = [...sites.entries()].map(([site, a]) => ({ site, articles: a }))
      .sort((a, b) => b.articles - a.articles || a.site.localeCompare(b.site))
    // where the outlets are based, for those the outlet directory knows (plan 15, Oct 22, 2026)
    let home = 0, abroad = 0
    for (const site of sites.keys()) {
      const country = outletOf(site)?.country
      if (country === code) home += 1
      else if (country) abroad += 1
    }
    return { outlets: sites.size, articles: top.reduce((t, s) => t + s.articles, 0), top: top.slice(0, SITES_SHOWN), home, abroad }
  }

  // each crisis's stories as the database ranked them, those naming the country first (a stable sort)
  const candidates = new Map<string, StoryRow[]>()
  for (const r of storyRows) {
    if (!r.lead_id || !r.title) continue
    const list = candidates.get(r.code) ?? []
    list.push(r)
    candidates.set(r.code, list)
  }
  const storiesOf = new Map<string, GapCrisis['stories']>()
  for (const [code, list] of candidates) {
    const named = list.filter(r => namesCountry(code, String(r.title)))
    const rest = list.filter(r => !namesCountry(code, String(r.title)))
    storiesOf.set(code, [...named, ...rest].slice(0, STORIES_SHOWN).map(r => ({
      id: String(r.lead_id), title: tidyHeadline(String(r.title)), outlets: Math.max(1, Number(r.sites) || 1), verified: Boolean(r.verified),
    })))
  }

  const crises = crisisCountries().map(c => {
    const cov = coverage(c.code)
    return {
      rank: 0,
      code: c.code,
      name: countryName(c.code),
      displaced: c.displaced,
      inside: c.inside,
      abroad: c.abroad,
      outlets: cov.outlets,
      outletsHome: cov.home,
      outletsAbroad: cov.abroad,
      articles: cov.articles,
      peoplePerOutlet: Math.round(c.displaced / Math.max(1, cov.outlets)),
      sites: cov.top,
      stories: storiesOf.get(c.code) ?? [],
    }
  })
  // a crisis no outlet covered first (the most people first), then the most people per outlet
  crises.sort((a, b) => Number(a.outlets > 0) - Number(b.outlets > 0) || b.peoplePerOutlet - a.peoplePerOutlet || b.displaced - a.displaced)
  crises.forEach((c, i) => { c.rank = i + 1 })

  const mostCovered = [...perCountry.keys()].map(code => ({ code, name: countryName(code), ...coverage(code) }))
    .sort((a, b) => b.outlets - a.outlets || b.articles - a.articles)
    .slice(0, MOST_COVERED)
    .map(({ code, name, outlets, articles: a }) => ({ code, name, outlets, articles: a }))

  const crisisArticles = crises.reduce((t, c) => t + c.articles, 0)
  return {
    window: w.window,
    week: w.week,
    start: w.start.toISOString(),
    end: w.end.toISOString(),
    minDisplaced: MIN_DISPLACED,
    unhcrYear: UNHCR_YEAR,
    crises,
    mostCovered,
    totals: {
      articles,
      outlets: allSites.size,
      countries: perCountry.size,
      crisisArticles,
      crisisShare: articles > 0 ? Math.round((crisisArticles / articles) * 10_000) / 10_000 : 0,
      crisisDisplaced: crises.reduce((t, c) => t + c.displaced, 0),
    },
    generatedAt: now.toISOString(),
  }
}

/**
 * A link's site in SQL: the host of an http(s) link, lower case, without
 * "www." (a literal ? in knex's raw SQL is written \\?, or it takes it for a value)
 */
const SITE_SQL = (url: string) => `regexp_replace(substring(lower(${url}) from '^https\\?://([^/:\\?#]+)'), '^www\\.', '')`

/** The reports that count: news (the outlets read, GDELT's articles), not press offices, not left-out subjects */
const COUNTED = `('news' = ANY(s.tags) OR 'gdelt' = ANY(s.tags))
     AND NOT ('institutional' = ANY(s.tags))
     AND s.category::text <> ALL(?::text[])`

export const HOSTS_SQL = `
  SELECT s.country_code AS code, ${SITE_SQL('u.url')} AS host, count(DISTINCT u.url)::int AS articles
    FROM signals s
   CROSS JOIN LATERAL unnest(s.original_urls) AS u(url)
   WHERE s.created_at >= ? AND s.created_at < ?
     AND s.country_code ~ '^[A-Z]{2}$'
     AND ${COUNTED}
   GROUP BY 1, 2`

export const STORIES_SQL = `
  WITH s AS (
    SELECT s.country_code AS code, COALESCE(s.story_id, s.id) AS story_key, s.id, s.title,
           s.status::text AS status, s.category::text AS category, s.reliability_score, s.created_at, s.original_urls,
           CASE s.severity::text WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END AS sev,
           (s.title ~ ?) AS template
      FROM signals s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND s.country_code = ANY(?::text[])
       AND ${COUNTED}
  ),
  k AS (
    SELECT s.code, s.story_key, count(DISTINCT s.id)::int AS reports, bool_or(s.status = 'verified') AS verified,
           max(s.sev) AS sev, bool_or(NOT s.template) AS has_headline,
           bool_or(s.category = ANY(?::text[])) AS crisis_topic,
           count(DISTINCT ${SITE_SQL('u.url')})::int AS sites
      FROM s
      LEFT JOIN LATERAL unnest(s.original_urls) AS u(url) ON true
     GROUP BY s.code, s.story_key
  ),
  r AS (
    SELECT k.*, row_number() OVER (PARTITION BY k.code ORDER BY k.has_headline DESC, k.crisis_topic DESC, k.sites DESC, k.verified DESC, k.sev DESC, k.reports DESC) AS rn
      FROM k
  )
  SELECT r.code, r.sites, r.verified, lead.id::text AS lead_id, lead.title
    FROM r
   CROSS JOIN LATERAL (
     SELECT s.id, s.title FROM s
      WHERE s.story_key = r.story_key AND s.code = r.code
      ORDER BY s.template ASC, s.reliability_score DESC NULLS LAST, s.created_at ASC
      LIMIT 1
   ) AS lead
   WHERE r.rn <= ?
   ORDER BY r.code, r.rn`

/** The window's figures, from the database */
export async function makeCoverageGap(w: { window: CoverageGap['window']; week: string | null; start: Date; end: Date }): Promise<CoverageGap> {
  const left = [...LEFT_OUT_CATEGORIES]
  const codes = crisisCountries().map(c => c.code)
  const [hosts, stories] = await Promise.all([
    longQuery(QUERY_SECONDS, trx => trx.raw(HOSTS_SQL, [w.start, w.end, left])),
    longQuery(QUERY_SECONDS, trx => trx.raw(STORIES_SQL, [EVENT_TEMPLATE_SQL, w.start, w.end, codes, left, [...CRISIS_TOPICS], STORY_CANDIDATES])),
  ])
  const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] } | undefined)?.rows ?? [])
  return buildCoverageGap(rows<HostRow>(hosts), rows<StoryRow>(stories), w)
}

export function rollingWindow(now = new Date()) {
  return { window: 'last7days' as const, week: null, start: new Date(now.getTime() - 7 * DAY_MS), end: now }
}

export function weekWindow(week: IsoWeek) {
  const { start, end } = weekBounds(week)
  return { window: 'week' as const, week: weekName(week), start, end }
}

/**
 * v2 (Oct 21, 2026): the lists made before each crisis's stories were about the crisis (c6b9417) are made again;
 * v3 (Oct 22): with each crisis's outlets at home and abroad
 */
export function coverageGapKey(week: IsoWeek | null): string {
  return `coverage:gap:v3:${week ? weekName(week) : 'last7days'}`
}

/**
 * The figures as kept: the last 7 days (made while the caller waits if
 * nothing is kept), or a finished week (null while it is made in the background)
 */
export async function keptCoverageGap(week: IsoWeek | null): Promise<CoverageGap | null> {
  if (!week) return staleWhileRevalidate(coverageGapKey(null), ROLLING_KEEP, () => makeCoverageGap(rollingWindow()))
  return staleWhileRevalidate<CoverageGap | null>(coverageGapKey(week), FINISHED_WEEK_KEEP, () => makeCoverageGap(weekWindow(week)), async () => null)
}

/** Keeps the last 7 days and the last WARM_FINISHED_WEEKS finished weeks made, one at a time; returns what it made */
export async function warmCoverageGaps(now = new Date()): Promise<string[]> {
  const jobs: Array<{ week: IsoWeek | null }> = [{ week: null }]
  let w = isoWeekOf(now)
  for (let i = 0; i < WARM_FINISHED_WEEKS; i++) { w = previousWeek(w); jobs.push({ week: w }) }
  const made: string[] = []
  for (const { week } of jobs) {
    const key = coverageGapKey(week)
    const keep = week ? FINISHED_WEEK_KEEP : ROLLING_KEEP
    const age = await keptAge(key)
    if (age !== null && age < keep.freshSeconds) continue
    const ok = await remakeNow(key, keep, () => makeCoverageGap(week ? weekWindow(week) : rollingWindow()))
      .catch(err => { logger.warn({ err, week: week ? weekName(week) : 'last7days' }, 'Coverage gap could not be made (it is tried again later)'); return false })
    if (ok) made.push(week ? weekName(week) : 'last7days')
  }
  return made
}

let warmTimer: ReturnType<typeof setInterval> | null = null

/** warmCoverageGaps two minutes after start (after the week digests), then every 30 minutes */
export function startCoverageGapWarmer(): void {
  if (warmTimer) return
  const run = () => {
    void warmCoverageGaps()
      .then(made => { if (made.length) logger.info({ made }, 'Coverage gap figures made') })
      .catch(() => {})
  }
  setTimeout(run, 120_000).unref?.()
  warmTimer = setInterval(run, WARM_MS)
  warmTimer.unref?.()
}

export function stopCoverageGapWarmer(): void {
  if (warmTimer) clearInterval(warmTimer)
  warmTimer = null
}
