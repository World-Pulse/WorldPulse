/**
 * The second outlet (plan 0s3; Devon, Oct 22, 2026: "PROCEED WITH: Find the
 * second outlet. Search GDELT, a free index of over 100,000 news outlets, for
 * every medium-or-higher report with only one source").
 *
 * Most reports stay pending with one outlet because WorldPulse reads a few
 * hundred feeds, not because no one else carried the story: of the 100
 * newest medium reports on Oct 22, 93 had one outlet, and the share of
 * reports verified by 2+ outlets was 12%. GDELT's news index (its DOC 2.0
 * API: free, no key, 100,000+ outlets) finds the others. A medium, high or
 * critical news report in English with one outlet is searched a while after
 * it arrives (medium after 3 hours, high and critical after 1 and again after
 * 10): its headline's two most telling words, in English-language coverage
 * of the 24 hours either side of it (three, when the 75 most relevant
 * articles held no match and there were more). An article found there counts
 * as another outlet when
 *  - it is on another website (sister sites of one owner are one: en. and
 *    www.protothema.gr, frontline.thehindu.com and thehindu.com),
 *  - the website is a newsroom, not an aggregator, a press-release wire, a
 *    blog platform or a known AI content farm (NOT_OUTLETS),
 *  - its headline passes the test an article merged into a report passes
 *    (correlate.ts: isSameStory, and no names the other lacks), within 24
 *    hours of the report,
 *  - and it isn't a copy (the same address slug, or the same headline word
 *    for word as the report or as another outlet found: one wire story on
 *    twenty papers is one outlet).
 * Up to 3 join the report: their links are listed with it, its outlet count
 * goes up, it turns verified the way a merged article verifies it
 * (confirmMergedArticle), and its page says so ("Also reported by …").
 * Claude's cross-check reads the first CROSSCHECKS_A_DAY reports a day this
 * verifies (100: a few cents; by 1:35 PM on Oct 22 the day's 2,087 AI calls,
 * 1,092 of them cross-checks, had cost 48 cents), the rest stand on the
 * headline test, as merged articles did before the cross-check existed.
 *
 * GDELT asks for one request every 5 seconds from a server: a request starts
 * 6 seconds after the last one was answered, by a slot shared with the story
 * page's news images and TV clips (gdelt:doc:slot), and a pass waits 2
 * seconds after each search so they get their turn. When GDELT says to slow
 * down, searching stops for 10 minutes, twice as long each time it says so
 * again within 6 hours (at most 2 hours).
 *
 * Daily counts: second-outlet:day:<date> (on /api/v1/health); the latest
 * matches, for reading by hand: second-outlet:recent. Off with
 * SECOND_OUTLET=off.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { confirmMergedArticle, isSameStory, namesDiffer, type CorrelationCandidate } from './correlate'
import { isEventTemplateTitle } from './event-titles'
import { morePlacesInText } from './entity-rules'
import { placesInText } from './geo'
import { isCopyOf } from './independence'
import { hostOf, sourceKey } from './signal-columns'
import { cleanTitle, cleanUrl, withoutOutletName } from './text'

export const DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc'
const UA = 'WorldPulse/0.1 (open-source; https://world-pulse.io)'

export const PASS_INTERVAL_MS = 5 * 60_000
/** A pass stops searching after this long (the next starts at the next interval) */
const PASS_BUDGET_MS = 4.5 * 60_000
/** GDELT asks for one request every 5 seconds: one every 6, for the whole server */
export const SLOT_KEY = 'gdelt:doc:slot'
const SLOT_MS = 6_000
/** After a search, room for the story page's searches */
const YIELD_MS = 2_000
const PAUSE_KEY = 'second-outlet:pause'
const PAUSE_S = 10 * 60
const SLOW_STREAK_KEY = 'second-outlet:slow-streak'
const LOCK_KEY = 'second-outlet:lock'
const CHECKED_KEY = (id: string, round: number) => `second-outlet:checked:${id}:${round}`
export const DAY_KEY = (day: string) => `second-outlet:day:${day}`
export const RECENT_KEY = 'second-outlet:recent'
const KEEP_S = 40 * 86_400

const HOUR = 3_600_000
/** When a report is searched: medium after 3 hours; high and critical after 1, and again after 10 */
const FIRST_AFTER_MS = 3 * HOUR
const FIRST_AFTER_BIG_MS = 1 * HOUR
const SECOND_AFTER_MS = 10 * HOUR
const LOOKBACK_MS = 30 * HOUR
/** The search window either side of the report (isSameStory's window too) */
const WINDOW_MS = 24 * HOUR
export const MAX_ADDED = 3
const MAX_RECORDS = 75
const CROSSCHECKS_A_DAY = Number(process.env.SECOND_OUTLET_CROSSCHECKS) || 100

// ─── Search words ────────────────────────────────────────────────────────────

/** Words that don't say which story it is */
const PLAIN = new Set([
  'about', 'above', 'according', 'across', 'after', 'again', 'against', 'ahead', 'allegedly', 'also', 'amid', 'among', 'another',
  'around', 'away', 'back', 'been', 'before', 'behind', 'being', 'below', 'between', 'beyond', 'both', 'breaking',
  'call', 'called', 'calls', 'claim', 'claims', 'could', 'despite', 'does', 'down', 'during', 'each', 'even', 'every',
  'exclusive', 'explainer', 'first', 'from', 'gets', 'give', 'gives', 'have', 'here', 'into', 'just', 'know', 'last',
  'latest', 'live', 'made', 'make', 'makes', 'many', 'media', 'more', 'most', 'much', 'must', 'near', 'news', 'next',
  'official', 'officials', 'once', 'only', 'onto', 'other', 'over', 'photos', 'report', 'reported', 'reportedly', 'reports', 'said',
  'says', 'second', 'should', 'since', 'some', 'source', 'sources', 'spokesman', 'spokesperson', 'spokeswoman',
  'still', 'such', 'take', 'takes', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'third',
  'this', 'those', 'through', 'today', 'told', 'tells', 'tonight', 'took', 'toward', 'towards', 'under', 'until',
  'update', 'updates', 'upon', 'very', 'video', 'videos', 'want', 'wants', 'watch', 'week', 'were', 'what', 'when',
  'where', 'which', 'while', 'will', 'with', 'within', 'without', 'would', 'year', 'years', 'yesterday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
])

/** Words of a kind of event or its usual actors: many stories share them */
const EVENTISH = new Set([
  'attack', 'attacks', 'army', 'case', 'cases', 'country', 'court', 'crash', 'dead', 'deal', 'death', 'deaths', 'died',
  'dies', 'election', 'fire', 'fires', 'flood', 'floods', 'forces', 'government', 'injured', 'injures', 'kill', 'killed',
  'killing', 'kills', 'market', 'markets', 'military', 'minister', 'nation', 'national', 'outbreak', 'people', 'police',
  'president', 'price', 'prices', 'protest', 'protests', 'rain', 'rains', 'state', 'storm', 'strike', 'strikes',
  'talks', 'troops', 'world',
])

/** Headline verbs: other outlets tell the same story with other ones */
const WEAK = new Set([
  'announce', 'announced', 'announces', 'backs', 'begins', 'calls', 'closes', 'ends', 'faces', 'falls', 'hits',
  'joins', 'leave', 'leaves', 'loses', 'meets', 'opens', 'plans', 'rises', 'seeks', 'sets', 'signs', 'slams',
  'urge', 'urged', 'urges', 'visits', 'vows', 'warn', 'warned', 'warns', 'wins',
])

/**
 * The three words of a headline most likely to find other outlets' articles
 * on the same story, the most telling first: the places it names, names in a
 * sentence-case headline (capitalised past its first word), long words, and
 * last the words of a kind of event and headline verbs. Only plain letters, 4
 * or more of them (GDELT refuses short words; counts differ from outlet to
 * outlet).
 */
export function queryWords(title: string, max = 3): string[] {
  const tokens = title.replace(/[\u2018\u2019]/g, "'").split(/[\s\-–—/]+/)
  const words = tokens
    .map(t => t.replace(/'s$/i, '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
    .map((word, i) => ({ word, i }))
    .filter(({ word }) => word.length >= 4 && /^[A-Za-z]+$/.test(word))
  const capitals = words.filter(({ word }) => /^[A-Z]/.test(word)).length
  const titleCase = words.length > 0 && capitals / words.length >= 0.6
  const known = placesInText(title)
  const placeWords = new Set([...known, ...morePlacesInText(title, null, known)].flatMap(p => p.toLowerCase().split(/[^a-z]+/)))
  const scored = new Map<string, number>()
  for (const { word, i } of words) {
    const lower = word.toLowerCase()
    if (PLAIN.has(lower)) continue
    let score = Math.min(word.length, 12) / 12
    if (/^[A-Z]/.test(word) && !titleCase) score += i === 0 ? 0.5 : 2
    if (placeWords.has(lower)) score += 1
    if (EVENTISH.has(lower)) score -= 0.6
    if (WEAK.has(lower)) score -= 0.6
    if (score > (scored.get(lower) ?? -Infinity)) scored.set(lower, score)
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w)
}

/** GDELT's time format, YYYYMMDDHHMMSS (UTC) */
export function gdeltTime(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/** The DOC 2.0 search for these words, English-language articles between the two times */
export function searchUrl(words: string[], from: Date, to: Date): string {
  const params = new URLSearchParams({
    query:         `${words.join(' ')} sourcelang:english`,
    mode:          'artlist',
    format:        'json',
    maxrecords:    String(MAX_RECORDS),
    sort:          'HybridRel',
    startdatetime: gdeltTime(from),
    enddatetime:   gdeltTime(to),
  })
  return `${DOC_API}?${params}`
}

/** An article's "seendate" (20261022T153000Z) as a date */
export function seenAt(value: unknown): Date | null {
  const m = typeof value === 'string' ? /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(value.trim()) : null
  if (!m) return null
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!))
  return isNaN(d.getTime()) ? null : d
}

// ─── GDELT's reply ───────────────────────────────────────────────────────────

export interface DocArticle { url?: unknown; title?: unknown; seendate?: unknown; domain?: unknown; language?: unknown }

export type SearchReply =
  | { kind: 'ok'; articles: DocArticle[] }
  | { kind: 'slow' }                       // GDELT says to slow down
  | { kind: 'error'; reason: string }

/** GDELT's reply: its articles, "slow down", or what went wrong */
export function readReply(status: number, body: string): SearchReply {
  const text = body.trim()
  if (status === 429 || /limit requests to one every/i.test(text.slice(0, 300))) return { kind: 'slow' }
  if (status < 200 || status >= 300) return { kind: 'error', reason: `HTTP ${status}` }
  if (!text || text === '{}') return { kind: 'ok', articles: [] }
  if (!text.startsWith('{')) return { kind: 'error', reason: `query refused: ${text.slice(0, 80)}` }
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // GDELT's JSON sometimes carries a stray backslash or control character from a headline
    try {
      json = JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\').replace(/[\u0000-\u001f]+/g, ' '))
    } catch {
      return { kind: 'error', reason: 'unreadable reply' }
    }
  }
  const articles = (json as { articles?: unknown })?.articles
  return { kind: 'ok', articles: Array.isArray(articles) ? articles.filter(a => a && typeof a === 'object') as DocArticle[] : [] }
}

// ─── Which articles are other outlets ────────────────────────────────────────

/** Second-level names under a country's domain: news.bbc.co.uk is the site bbc.co.uk */
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gen', 'go', 'gob', 'gov', 'info', 'mil', 'ne', 'net', 'news', 'nic', 'or', 'org', 'web'])

/** The website a host belongs to: one owner's sister sites are one (en.protothema.gr, www.protothema.gr) */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const tld = labels[labels.length - 1]!
  const sld = labels[labels.length - 2]!
  return labels.slice(tld.length === 2 && SECOND_LEVEL.has(sld) ? -3 : -2).join('.')
}

/**
 * Websites whose articles aren't another newsroom's reporting: readers and
 * aggregators that carry other outlets' articles, press-release wires, social
 * and blog platforms, and the known AI content farms (the list in
 * packages/types/src/ai-content-farms.ts)
 */
export const NOT_OUTLETS = new Set([
  'aol.com', 'archive.org', 'archive.ph', 'bignewsnetwork.com', 'dailyhunt.in', 'devdiscourse.com', 'dnyuz.com',
  'flipboard.com', 'google.com', 'ground.news', 'headtopics.com', 'inkl.com', 'latestly.com', 'menafn.com', 'msn.com',
  'newsbreak.com', 'newsnow.co.uk', 'pressreader.com', 'theworldnews.net', 'yahoo.com', 'zawya.com',
  'accesswire.com', 'businesswire.com', 'einpresswire.com', 'globenewswire.com', 'newswire.com', 'openpr.com',
  'prnewswire.com', 'prweb.com',
  'blogspot.com', 'facebook.com', 'medium.com', 'reddit.com', 'substack.com', 'tumblr.com', 'twitter.com',
  'wordpress.com', 'x.com', 'youtube.com',
  'allnewsupdate.net', 'breakingnewsreporter.com', 'currentnewspaper.net', 'dailynewspulse.net', 'dailytrendingnews.net',
  'fastbreaking.news', 'flashbulletinnews.com', 'globalheadlines24.net', 'headlineinsider.com', 'justintrendstoday.com',
  'morningtidings.com', 'nationalnewsbrief.com', 'newsbreakfeed.co', 'newsnow24.co', 'politicswatch24.com',
  'realclearnewsfeed.com', 'theamericas24.com', 'thenewsglobe.net', 'thepoliticsnews.com', 'trendingreporters.com',
  'urgentdispatch.net', 'usadailytimes.com', 'usanewsflash.com', 'worldnewsdaily24.com', 'worldpresswire.io',
])

/** A report waiting for a second outlet, as the search reads it */
export interface HeldReport {
  id: string
  title: string
  category: string
  severity: string
  published_at: Date | string
  original_urls: string[]
  source_ids: string[]
  location_name: string | null
  lat: number | null
  lng: number | null
  tags: string[]
}

export interface FoundOutlet { url: string; title: string; site: string; at: Date }

/** A headline as GDELT gives it, tidied: no outlet name at the end, no spaces before punctuation */
export function articleTitle(title: unknown, url: string): string {
  if (typeof title !== 'string') return ''
  const tidy = cleanTitle(title).replace(/\s+([,.;:!?%)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+'\s*s\b/g, "'s")
  return withoutOutletName(tidy, url)
}

/**
 * The articles that are other outlets' reports of this report's story, at
 * most `max`, the most relevant first (GDELT's order)
 */
export function otherOutlets(report: HeldReport, articles: DocArticle[], now = new Date(), max = MAX_ADDED): FoundOutlet[] {
  const held: CorrelationCandidate = {
    id: report.id,
    title: report.title,
    category: report.category,
    severity: report.severity,
    source_id: sourceKey(report.source_ids, report.original_urls, report.id),
    location_name: report.location_name,
    lat: report.lat,
    lng: report.lng,
    published_at: report.published_at,
    reliability_score: 0,
    tags: [],
    url: report.original_urls[0] ?? null,
  }
  const sites = new Set(report.original_urls.map(u => siteOf(hostOf(u))).filter(Boolean))
  const found: FoundOutlet[] = []
  for (const article of articles) {
    if (found.length >= max) break
    const url = typeof article.url === 'string' ? article.url.trim() : ''
    if (!/^https?:\/\//i.test(url)) continue
    const site = siteOf(hostOf(url))
    if (!site || sites.has(site) || NOT_OUTLETS.has(site)) continue
    const at = seenAt(article.seendate)
    if (!at || at.getTime() > now.getTime() + 10 * 60_000) continue
    const title = articleTitle(article.title, url)
    if (!title) continue
    const other: CorrelationCandidate = { ...held, id: 'gdelt', title, source_id: site, published_at: at, url, lat: null, lng: null }
    if (!isSameStory(held, other) || namesDiffer(report.title, title)) continue
    if (isCopyOf({ url, title }, { urls: report.original_urls, title: report.title })) continue
    if (found.some(f => isCopyOf({ url, title }, { urls: [f.url], title: f.title }))) continue
    sites.add(site)
    found.push({ url: cleanUrl(url), title, site, at })
  }
  return found
}

// ─── Which reports, and when ─────────────────────────────────────────────────

/** Whether a report is news a search can find: not a machine feed's (aircraft, fires, quakes), not a template headline */
export function searchable(report: Pick<HeldReport, 'title' | 'tags'>): boolean {
  const tags = new Set(report.tags.map(t => String(t).toLowerCase()))
  if (tags.has('osint') && !tags.has('gdelt')) return false
  if (isEventTemplateTitle(report.title)) return false
  return queryWords(report.title).length >= 2
}

/** Which search a report is due for: 1, 2 (high and critical, again after 10 hours), or 0 (none now) */
export function dueRound(severity: string, ageMs: number, done1: boolean, done2: boolean): 0 | 1 | 2 {
  if (ageMs > LOOKBACK_MS) return 0
  const big = severity === 'high' || severity === 'critical'
  if (big && ageMs >= SECOND_AFTER_MS) return done2 ? 0 : 2
  if (done1) return 0
  return ageMs >= (big ? FIRST_AFTER_BIG_MS : FIRST_AFTER_MS) ? 1 : 0
}

// ─── A pass ──────────────────────────────────────────────────────────────────

export interface PassStats {
  due: number
  searched: number
  requests: number
  matched: number
  outlets: number
  promoted: number
  crosschecked: number
  skipped: number
  slow: number
  errors: number
}

export interface DueReport { report: HeldReport; round: 1 | 2; at: Date }

export interface SecondOutletDeps {
  /** The reports due for a search now, the most urgent first */
  due(now: Date): Promise<DueReport[]>
  /** Mark a report's search as taken (false: another pass took it) */
  claim(id: string, round: number): Promise<boolean>
  release(id: string, round: number): Promise<void>
  /** The report as it is now: null when it no longer waits for a second outlet */
  current(id: string): Promise<HeldReport | null>
  search(url: string): Promise<SearchReply>
  /** Add the outlets; true when the report turned verified */
  add(report: HeldReport, found: FoundOutlet[], crossCheck: boolean): Promise<boolean>
  crossChecksToday(day: string): Promise<number>
  paused(): Promise<boolean>
  pause(): Promise<void>
  lock(): Promise<boolean>
  unlock(): Promise<void>
  count(day: string, stats: PassStats): Promise<void>
  remember(entry: Record<string, unknown>): Promise<void>
  wait(ms: number): Promise<void>
  clock(): number
}

const emptyStats = (): PassStats => ({ due: 0, searched: 0, requests: 0, matched: 0, outlets: 0, promoted: 0, crosschecked: 0, skipped: 0, slow: 0, errors: 0 })

/** One pass: the due reports, searched one at a time, until the pass's time is up */
export async function runSecondOutlets(deps: SecondOutletDeps = liveDeps): Promise<PassStats> {
  const stats = emptyStats()
  if (await deps.paused()) return stats
  if (!(await deps.lock())) return stats
  const started = deps.clock()
  const day = new Date(started).toISOString().slice(0, 10)
  try {
    const due = await deps.due(new Date(started))
    stats.due = due.length
    let crossChecks = await deps.crossChecksToday(day)
    for (const { report: listed, round, at } of due) {
      if (deps.clock() - started > PASS_BUDGET_MS) break
      if (!(await deps.claim(listed.id, round))) continue
      const report = await deps.current(listed.id)
      if (!report) { stats.skipped++; continue }
      const words = queryWords(report.title)
      const from = new Date(at.getTime() - WINDOW_MS)
      const to = new Date(Math.min(deps.clock(), at.getTime() + WINDOW_MS))
      // The two best words; three when GDELT's most relevant held no match and there were more
      let reply = await deps.search(searchUrl(words.slice(0, 2), from, to))
      stats.requests++
      let found = reply.kind === 'ok' ? otherOutlets(report, reply.articles, new Date(deps.clock())) : []
      if (reply.kind === 'ok' && found.length === 0 && reply.articles.length >= MAX_RECORDS && words.length > 2) {
        await deps.wait(YIELD_MS)
        reply = await deps.search(searchUrl(words, from, to))
        stats.requests++
        found = reply.kind === 'ok' ? otherOutlets(report, reply.articles, new Date(deps.clock())) : []
      }
      if (reply.kind === 'slow') {
        stats.slow++
        await deps.release(listed.id, round)   // searched again after the pause
        await deps.pause()
        break
      }
      if (reply.kind === 'error') {
        stats.errors++
        logger.debug({ id: report.id, reason: reply.reason }, 'Second outlet: search failed')
        await deps.wait(YIELD_MS)
        continue
      }
      stats.searched++
      if (found.length > 0) {
        const crossCheck = crossChecks < CROSSCHECKS_A_DAY
        const promoted = await deps.add(report, found, crossCheck)
        stats.matched++
        stats.outlets += found.length
        if (promoted) {
          stats.promoted++
          if (crossCheck) { stats.crosschecked++; crossChecks++ }
        }
        await deps.remember({
          at: new Date(deps.clock()).toISOString(),
          id: report.id,
          severity: report.severity,
          title: report.title.slice(0, 140),
          words,
          promoted,
          found: found.map(f => ({ site: f.site, title: f.title.slice(0, 140), url: f.url })),
        })
      }
      await deps.wait(YIELD_MS)
    }
  } finally {
    await deps.count(day, stats).catch(err => logger.warn({ err }, 'Second outlet: counts not saved'))
    await deps.unlock().catch(() => {})
  }
  return stats
}

// ─── The live parts ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

interface ReportRow {
  id: string
  title: string | null
  category: string | null
  severity: string | null
  status?: string | null
  source_count?: number | string | null
  source_ids: unknown
  original_urls: unknown
  location_name: string | null
  lat: number | string | null
  lng: number | string | null
  tags: unknown
  published_at: Date | string
  created_at: Date | string
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function toHeld(r: ReportRow): HeldReport {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    category: String(r.category ?? ''),
    severity: String(r.severity ?? ''),
    published_at: r.published_at,
    original_urls: strings(r.original_urls),
    source_ids: strings(r.source_ids),
    location_name: r.location_name ?? null,
    lat: num(r.lat),
    lng: num(r.lng),
    tags: strings(r.tags),
  }
}

const REPORT_COLUMNS = `id, title, category, severity, status, source_count, source_ids, original_urls, location_name, tags,
  COALESCE(event_time, created_at) AS published_at, created_at,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`

/** Waiting for a second outlet: pending, one outlet, medium or above, in English */
const WAITING = `status = 'pending' AND COALESCE(source_count, 1) <= 1
  AND severity IN ('medium', 'high', 'critical') AND language = 'en'
  AND cardinality(original_urls) >= 1`

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2 }

export const liveDeps: SecondOutletDeps = {
  async due(now) {
    const { rows } = await db.raw(
      `SELECT ${REPORT_COLUMNS} FROM signals
        WHERE ${WAITING}
          AND created_at > ?::timestamptz AND created_at < ?::timestamptz
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 800`,
      [new Date(now.getTime() - LOOKBACK_MS).toISOString(), new Date(now.getTime() - FIRST_AFTER_BIG_MS).toISOString()],
    ) as { rows: ReportRow[] }
    const reports = rows.map(r => ({ row: r, report: toHeld(r) })).filter(({ report }) => searchable(report))
    if (reports.length === 0) return []
    const pipe = redis.pipeline()
    for (const { report } of reports) pipe.exists(CHECKED_KEY(report.id, 1)).exists(CHECKED_KEY(report.id, 2))
    const done = ((await pipe.exec()) ?? []).map(([, n]) => Number(n) > 0)
    const due: DueReport[] = []
    reports.forEach(({ row, report }, i) => {
      const age = now.getTime() - new Date(row.created_at).getTime()
      const round = dueRound(report.severity, age, done[2 * i] ?? false, done[2 * i + 1] ?? false)
      const at = new Date(report.published_at)
      if (round && !isNaN(at.getTime())) due.push({ report, round, at: at.getTime() > now.getTime() ? now : at })
    })
    return due.sort((a, b) => (SEVERITY_RANK[a.report.severity] ?? 3) - (SEVERITY_RANK[b.report.severity] ?? 3))
  },

  async claim(id, round) {
    return await redis.set(CHECKED_KEY(id, round), '1', 'EX', 3 * 86_400, 'NX') === 'OK'
  },

  async release(id, round) {
    await redis.del(CHECKED_KEY(id, round))
  },

  async current(id) {
    const { rows } = await db.raw(`SELECT ${REPORT_COLUMNS} FROM signals WHERE id = ? AND ${WAITING}`, [id]) as { rows: ReportRow[] }
    return rows[0] ? toHeld(rows[0]) : null
  },

  async search(url) {
    // One request at a time across the server: the slot frees 6 seconds after it was taken
    const giveUp = Date.now() + 60_000
    for (;;) {
      const ok = await redis.set(SLOT_KEY, '1', 'PX', SLOT_MS, 'NX').catch(() => 'OK')
      if (ok === 'OK') break
      if (Date.now() > giveUp) return { kind: 'error', reason: 'slot busy' }
      await sleep(250)
    }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      return readReply(res.status, await res.text())
    } catch (err) {
      return { kind: 'error', reason: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' }
    } finally {
      // 6 seconds from when GDELT answered, not from when it was asked (Oct 22: "slow down" after 5 requests)
      await redis.set(SLOT_KEY, '1', 'PX', SLOT_MS).catch(() => {})
    }
  },

  async add(report, found, crossCheck) {
    // The links and the count, as a merged article adds them (index.ts storeArticleGroup)
    for (const f of found) {
      await db('signals').where('id', report.id).update({
        source_count:  db.raw('COALESCE(source_count, 1) + 1'),
        original_urls: db.raw('array_append(original_urls, ?)', [f.url]),
        last_updated:  new Date(),
      })
    }
    for (const f of found) {
      await confirmMergedArticle(report.id, { title: f.title, source_id: f.site, published_at: f.at }, { crossCheck })
        .catch(err => logger.warn({ err, id: report.id }, 'Second outlet: merged-article check failed (non-fatal)'))
    }
    // A line on the report's page (only the table's first columns: the later ones come from a migration production may not have run)
    await db('verification_log').insert({
      signal_id:  report.id,
      check_type: 'corroboration',
      result:     'confirmed',
      confidence: 0.8,
      notes:      `Also reported by ${found.map(f => f.site).join(', ')} (found in GDELT's index of news outlets)`,
    }).catch(err => logger.warn({ err, id: report.id }, 'Second outlet: not logged on the report page'))
    const row = await db('signals').where('id', report.id).first('status') as { status?: string } | undefined
    return row?.status === 'verified'
  },

  async crossChecksToday(day) {
    return Number(await redis.hget(DAY_KEY(day), 'crosschecked')) || 0
  },

  async paused() {
    return !!(await redis.get(PAUSE_KEY))
  },

  async pause() {
    // 10 minutes, then twice as long each time GDELT says it again within 6 hours (at most 2 hours)
    const streak = await redis.incr(SLOW_STREAK_KEY).catch(() => 1)
    await redis.expire(SLOW_STREAK_KEY, 6 * 3_600).catch(() => {})
    await redis.set(PAUSE_KEY, new Date().toISOString(), 'EX', Math.min(PAUSE_S * 2 ** Math.max(0, streak - 1), 2 * 3_600))
  },

  async lock() {
    return await redis.set(LOCK_KEY, '1', 'EX', 600, 'NX') === 'OK'
  },

  async unlock() {
    await redis.del(LOCK_KEY)
  },

  async count(day, stats) {
    const multi = redis.multi()
    let any = false
    for (const [k, v] of Object.entries(stats)) {
      if (k === 'due' || !v) continue
      multi.hincrby(DAY_KEY(day), k, v)
      any = true
    }
    if (!any) return
    multi.expire(DAY_KEY(day), KEEP_S)
    await multi.exec()
  },

  async remember(entry) {
    await redis.multi().lpush(RECENT_KEY, JSON.stringify(entry)).ltrim(RECENT_KEY, 0, 99).expire(RECENT_KEY, 7 * 86_400).exec()
  },

  wait: sleep,
  clock: () => Date.now(),
}

/** Every 5 minutes (off with SECOND_OUTLET=off) */
export function startSecondOutlets(): void {
  if ((process.env.SECOND_OUTLET || 'on').toLowerCase() === 'off') {
    logger.info('Second outlet off (SECOND_OUTLET=off)')
    return
  }
  const run = () => {
    runSecondOutlets()
      .then(s => { if (s.requests) logger.info(s, 'Second outlet pass') })
      .catch(err => logger.warn({ err }, 'Second outlet pass failed (non-fatal)'))
  }
  setTimeout(run, 4 * 60_000)
  setInterval(run, PASS_INTERVAL_MS)
}
