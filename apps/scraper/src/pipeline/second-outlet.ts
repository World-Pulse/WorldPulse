/**
 * The second outlet (plan 0s3; Devon, Oct 22, 2026: "PROCEED WITH: Find the
 * second outlet. Search GDELT, a free index of over 100,000 news outlets, for
 * every medium-or-higher report with only one source").
 *
 * Most reports stay pending with one outlet because WorldPulse reads a few
 * hundred feeds, not because no one else carried the story: of the 100
 * newest medium reports on Oct 22, 93 had one outlet, and the share of
 * reports verified by 2+ outlets was 12%. GDELT reads far more outlets, and
 * every 15 minutes publishes, free, the list of the articles it read
 * (gdelt-articles.ts). Every 15 minutes this reads the new list and holds the
 * last 8 hours of it in memory (about 50,000 English articles), and each
 * medium, high or critical news report in English with one outlet, from the
 * last 30 hours, is compared with it: with the articles new since the last
 * time, or, for a report new since then, with all 8 hours. An article counts
 * as another outlet when
 *  - it shares two or more of the report's headline words (not only words of
 *    a kind of event: "killed", "police"),
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
 * First built on GDELT's search API (one search per report): live on Oct 22
 * it answered "Please limit requests to one every 5 seconds" after 5 to 8
 * requests even at one every 6 seconds, and tells heavy users to use its
 * files. The files have no such limit and cover every article, not 75 a
 * search. After a restart the last hour of files is read again.
 *
 * Daily counts: second-outlet:day:<date> (GET /api/v1/public/second-outlets);
 * the latest matches, for reading by hand: second-outlet:recent. Off with
 * SECOND_OUTLET=off.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { confirmMergedArticle, isSameStory, namesDiffer, type CorrelationCandidate } from './correlate'
import { isEventTemplateTitle } from './event-titles'
import { isCopyOf } from './independence'
import { hostOf, sourceKey } from './signal-columns'
import { cleanUrl } from './text'
import { fetchArticles, fetchNewestStamp, filesToRead, siteOf, stampDate, type GdeltArticle } from './gdelt-articles'
import { queueReindex } from './reindex'

export { siteOf, articleTitle } from './gdelt-articles'

/** GDELT publishes a file every 15 minutes; a few minutes after, it is read */
export const CYCLE_MS = 15 * 60_000
const LOCK_KEY = 'second-outlet:lock'
const LOCK_S = 6 * 60
export const DAY_KEY = (day: string) => `second-outlet:day:${day}`
export const RECENT_KEY = 'second-outlet:recent'
export const LAST_CYCLE_KEY = 'second-outlet:last-cycle'
const KEEP_S = 40 * 86_400

const HOUR = 3_600_000
/** How much of GDELT's list is held: 8 hours, about 50,000 English articles */
export const WINDOW_KEEP_MS = 8 * HOUR
/** Files read in one cycle: after a restart the last hour, after a gap at most 2 hours */
const WARM_FILES = 4
const MAX_FILES = 8
/** Reports compared: from the last 30 hours, settled for 20 minutes (intake may still add outlets) */
const LOOKBACK_MS = 30 * HOUR
const SETTLE_MS = 20 * 60_000
export const MAX_ADDED = 3
/** The articles a report is compared with in one cycle, the most words shared first */
const MAX_CANDIDATES = 40
const CROSSCHECKS_A_DAY = Number(process.env.SECOND_OUTLET_CROSSCHECKS) || 100

// ─── Headline words ──────────────────────────────────────────────────────────

/** Words that don't say which story it is */
const PLAIN = new Set([
  'about', 'above', 'according', 'across', 'after', 'again', 'against', 'ahead', 'all', 'allegedly', 'also', 'amid',
  'among', 'and', 'another', 'any', 'are', 'around', 'away', 'back', 'been', 'before', 'behind', 'being', 'below',
  'between', 'beyond', 'both', 'breaking', 'but', 'call', 'called', 'calls', 'can', 'claim', 'claims', 'could',
  'despite', 'did', 'does', 'down', 'during', 'each', 'even', 'every', 'exclusive', 'explainer', 'first', 'for',
  'from', 'get', 'gets', 'give', 'gives', 'had', 'has', 'have', 'her', 'here', 'his', 'how', 'into', 'its', 'just',
  'know', 'last', 'latest', 'live', 'made', 'make', 'makes', 'many', 'may', 'media', 'more', 'most', 'much', 'must',
  'near', 'new', 'news', 'next', 'not', 'now', 'off', 'official', 'officials', 'once', 'one', 'only', 'onto', 'other',
  'our', 'out', 'over', 'photos', 'report', 'reported', 'reportedly', 'reports', 'said', 'says', 'second', 'she',
  'should', 'since', 'some', 'source', 'sources', 'spokesman', 'spokesperson', 'spokeswoman', 'still', 'such',
  'take', 'takes', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'third', 'this',
  'those', 'through', 'today', 'told', 'tells', 'tonight', 'took', 'toward', 'towards', 'two', 'under', 'until',
  'update', 'updates', 'upon', 'very', 'video', 'videos', 'want', 'wants', 'was', 'watch', 'way', 'week', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'within', 'without', 'would', 'year',
  'years', 'yesterday', 'you', 'your',
  'ago', 'ask', 'big', 'end', 'far', 'few', 'got', 'key', 'let', 'lot', 'old', 'own', 'per', 'put', 'say', 'see', 'set',
  'top', 'use', 'via', 'yet',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
])

/** Words of a kind of event or its usual actors: many stories share them */
const EVENTISH = new Set([
  'attack', 'attacks', 'army', 'case', 'cases', 'country', 'court', 'crash', 'dead', 'deal', 'death', 'deaths', 'die',
  'died', 'dies', 'election', 'fire', 'fires', 'flood', 'floods', 'forces', 'government', 'injured', 'injures', 'kill',
  'killed', 'killing', 'kills', 'market', 'markets', 'military', 'minister', 'nation', 'national', 'outbreak', 'people',
  'police', 'president', 'price', 'prices', 'protest', 'protests', 'rain', 'rains', 'state', 'storm', 'strike',
  'strikes', 'talks', 'troops', 'war', 'world',
  // counts in words: shared by many stories
  'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'dozen', 'dozens', 'hundreds', 'thousands',
])

/** A headline's words that can tie it to another outlet's: lower case, 3 or more letters or digits, no plain words */
export function storyTokens(title: string): string[] {
  const out = new Set<string>()
  for (const raw of title.replace(/[‘’]/g, "'").toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const word = raw.replace(/'s$/, '').replace(/'/g, '')
    if (word.length < 3 || PLAIN.has(word)) continue
    out.add(word)
  }
  return [...out]
}

/**
 * For each report, the articles that share two or more of its words, one at
 * least not a word of a kind of event, the most shared first
 */
export function candidatePairs(reports: Array<{ tokens: string[] }>, articles: Array<{ tokens: string[] }>): Map<number, number[]> {
  const index = new Map<string, number[]>()
  reports.forEach((r, i) => { for (const t of r.tokens) { const list = index.get(t); if (list) list.push(i); else index.set(t, [i]) } })
  const out = new Map<number, Array<{ a: number; n: number }>>()
  articles.forEach((article, a) => {
    const shared = new Map<number, { n: number; telling: boolean }>()
    for (const t of article.tokens) {
      const list = index.get(t)
      if (!list) continue
      const telling = !EVENTISH.has(t)
      for (const r of list) {
        const s = shared.get(r)
        if (s) { s.n++; s.telling ||= telling } else shared.set(r, { n: 1, telling })
      }
    }
    for (const [r, s] of shared) {
      if (s.n < 2 || !s.telling) continue
      const list = out.get(r)
      if (list) list.push({ a, n: s.n }); else out.set(r, [{ a, n: s.n }])
    }
  })
  return new Map([...out].map(([r, list]) => [r, list.sort((x, y) => y.n - x.n).map(x => x.a)]))
}

// ─── Which articles are other outlets ────────────────────────────────────────

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
  'prnewswire.com', 'prweb.com', 'csrwire.com', '3blmedia.com', 'einnews.com', 'finanznachrichten.de', 'pr-inside.com',
  'prlog.org',
  // republishers seen in GDELT's list on Oct 22: other outlets' articles under their own name
  'allafrica.com', 'aol.co.uk', 'cedarnews.net', 'ghanamma.com', 'hawaiitelegraph.com', 'iheart.com', 'indiagazette.com',
  'heraldglobe.com', 'kenyastar.com', 'netscape.com', 'newjerseytelegraph.com', 'nigerianeye.com', 'romaniapress.com',
  'russiaherald.com', 'wn.com', 'zerohedge.com',
  'blogspot.com', 'facebook.com', 'medium.com', 'reddit.com', 'substack.com', 'tumblr.com', 'twitter.com',
  'wordpress.com', 'x.com', 'youtube.com',
  'allnewsupdate.net', 'breakingnewsreporter.com', 'currentnewspaper.net', 'dailynewspulse.net', 'dailytrendingnews.net',
  'fastbreaking.news', 'flashbulletinnews.com', 'globalheadlines24.net', 'headlineinsider.com', 'justintrendstoday.com',
  'morningtidings.com', 'nationalnewsbrief.com', 'newsbreakfeed.co', 'newsnow24.co', 'politicswatch24.com',
  'realclearnewsfeed.com', 'theamericas24.com', 'thenewsglobe.net', 'thepoliticsnews.com', 'trendingreporters.com',
  'urgentdispatch.net', 'usadailytimes.com', 'usanewsflash.com', 'worldnewsdaily24.com', 'worldpresswire.io',
])

/**
 * One owner's websites count as one: its papers share stories (in the dry run
 * of Oct 22, Torstar's Spectator and Niagara Falls Review, Reach's Express and
 * Daily Star, Newsquest's Northwich Guardian and Messenger "confirmed" each
 * other). The big chains whose papers GDELT reads most; any other website is
 * its own owner.
 */
const OWNER_GROUPS: Record<string, string[]> = {
  bbc: ['bbc.co.uk', 'bbc.com'],
  aol: ['aol.com', 'aol.co.uk'],
  guardian: ['theguardian.com', 'guardian.co.uk'],
  reach: ['express.co.uk', 'dailystar.co.uk', 'mirror.co.uk', 'themirror.com', 'dailyrecord.co.uk', 'chroniclelive.co.uk',
    'manchestereveningnews.co.uk', 'liverpoolecho.co.uk', 'walesonline.co.uk', 'birminghammail.co.uk', 'irishmirror.ie',
    'belfastlive.co.uk', 'bristolpost.co.uk', 'nottinghampost.com', 'leicestermercury.co.uk', 'hulldailymail.co.uk',
    'devonlive.com', 'cornwalllive.com', 'kentlive.news', 'mylondon.news', 'examinerlive.co.uk', 'lancs.live',
    'gloucestershirelive.co.uk', 'stokesentinel.co.uk', 'derbytelegraph.co.uk', 'coventrytelegraph.net', 'glasgowlive.co.uk',
    'edinburghlive.co.uk', 'dailypost.co.uk', 'hertfordshiremercury.co.uk', 'getsurrey.co.uk', 'irishstar.com', 'ok.co.uk'],
  newsquest: ['thenorthernecho.co.uk', 'glasgowtimes.co.uk', 'heraldscotland.com', 'thenational.scot', 'bournemouthecho.co.uk',
    'dailyecho.co.uk', 'theargus.co.uk', 'oxfordmail.co.uk', 'yorkpress.co.uk', 'thetelegraphandargus.co.uk',
    'lancashiretelegraph.co.uk', 'theboltonnews.co.uk', 'southwalesargus.co.uk', 'messengernewspapers.co.uk',
    'northwichguardian.co.uk', 'thecomet.net', 'edp24.co.uk', 'eveningnews24.co.uk', 'ipswichstar.co.uk', 'eadt.co.uk',
    'newsandstar.co.uk', 'nwemail.co.uk', 'hexham-courant.co.uk', 'thenorthernecho.co.uk', 'worcesternews.co.uk',
    'swindonadvertiser.co.uk', 'wiltshiretimes.co.uk', 'gazetteandherald.co.uk', 'dorsetecho.co.uk', 'eastlondonadvertiser.co.uk'],
  nationalworld: ['scotsman.com', 'yorkshirepost.co.uk', 'yorkshireeveningpost.co.uk', 'sunderlandecho.com', 'shieldsgazette.com',
    'lep.co.uk', 'thestar.co.uk', 'newsletter.co.uk', 'nationalworld.com', 'edinburghnews.scotsman.com'],
  postmedia: ['nationalpost.com', 'financialpost.com', 'calgaryherald.com', 'calgarysun.com', 'edmontonjournal.com', 'edmontonsun.com',
    'vancouversun.com', 'theprovince.com', 'ottawacitizen.com', 'ottawasun.com', 'montrealgazette.com', 'torontosun.com',
    'winnipegsun.com', 'leaderpost.com', 'thestarphoenix.com', 'windsorstar.com', 'lfpress.com', 'thewhig.com', 'canada.com'],
  torstar: ['thestar.com', 'thespec.com', 'niagarafallsreview.ca', 'wellandtribune.ca', 'stcatharinesstandard.ca', 'therecord.com',
    'guelphmercury.com', 'simcoe.com', 'durhamregion.com', 'insidehalton.com', 'thepeterboroughexaminer.com'],
  gannett: ['usatoday.com', 'cincinnati.com', 'freep.com', 'jsonline.com', 'indystar.com', 'azcentral.com', 'tennessean.com',
    'desmoinesregister.com', 'courier-journal.com', 'democratandchronicle.com', 'northjersey.com', 'app.com', 'lohud.com',
    'detroitnews.com', 'commercialappeal.com', 'statesman.com', 'palmbeachpost.com', 'jacksonville.com', 'dispatch.com'],
  alden: ['chicagotribune.com', 'nydailynews.com', 'baltimoresun.com', 'orlandosentinel.com', 'sun-sentinel.com', 'courant.com',
    'mcall.com', 'dailypress.com', 'pilotonline.com', 'mercurynews.com', 'eastbaytimes.com', 'denverpost.com', 'ocregister.com',
    'presstelegram.com', 'dailynews.com', 'twincities.com', 'bostonherald.com', 'sbsun.com', 'dailybulletin.com', 'pe.com'],
  mcclatchy: ['miamiherald.com', 'kansascity.com', 'sacbee.com', 'star-telegram.com', 'newsobserver.com', 'charlotteobserver.com',
    'kentucky.com', 'thestate.com', 'idahostatesman.com', 'fresnobee.com', 'bnd.com', 'thenewstribune.com', 'heraldsun.com'],
  hearst: ['sfchronicle.com', 'sfgate.com', 'houstonchronicle.com', 'chron.com', 'timesunion.com', 'ctpost.com', 'nhregister.com',
    'expressnews.com', 'mysanantonio.com', 'seattlepi.com', 'stamfordadvocate.com', 'greenwichtime.com'],
  lee: ['tucson.com', 'stltoday.com', 'omaha.com', 'richmond.com', 'buffalonews.com', 'journalstar.com', 'madison.com',
    'wcfcourier.com', 'qctimes.com', 'roanoke.com', 'pantagraph.com', 'nwitimes.com'],
  cox: ['wokv.com', 'krmg.com', 'wsbradio.com', 'whio.com', 'wftv.com'],
}
const OWNERS = new Map(Object.entries(OWNER_GROUPS).flatMap(([group, sites]) => sites.map(site => [site, group] as const)))
export const ownerOf = (site: string): string => OWNERS.get(site) ?? site

/** Pieces about a story, not reports of it: a factbox, an explainer, a live page, an opinion */
export const FEATURE_RE = /^(?:factbox|fact\s?check|explainer|analysis|timeline|opinion|editorial|letter|live|watch|q&a|quiz|podcast|in pictures|photos?)\b|^(?:who|what|why|how)\s+(?:is|are|was|were|to|do|does|did)\b/i

/**
 * Whether one headline is another's copy with a little added or cut: 85% or
 * more of the shorter one's words (5 or more) in the longer one ("Nigeria:
 * Kaduna Journalist Granted Bail ..." on a republisher, a wire story's
 * headline reworded on a member paper, "... - ICIJ"). One wire story on
 * several papers is one source.
 */
export function nearCopy(a: string, b: string): boolean {
  const words = (t: string) => t.toLowerCase().replace(/[\u2018\u2019']/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1)
  const [wa, wb] = [words(a), words(b)]
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (short.length < 5) return false
  const inLong = new Set(long)
  return short.filter(w => inLong.has(w)).length / short.length >= 0.85
}

/** A report waiting for a second outlet */
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

/**
 * The articles that are other outlets' reports of this report's story, at
 * most `max`, in the order given (the most words shared first)
 */
export function otherOutlets(report: HeldReport, articles: GdeltArticle[], now = new Date(), max = MAX_ADDED): FoundOutlet[] {
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
  const sites = new Set(report.original_urls.map(u => ownerOf(siteOf(hostOf(u)))).filter(Boolean))
  const found: FoundOutlet[] = []
  for (const { url, title, site, at } of articles) {
    if (found.length >= max) break
    if (!site || sites.has(ownerOf(site)) || NOT_OUTLETS.has(site)) continue
    if (at.getTime() > now.getTime() + 10 * 60_000) continue
    if (FEATURE_RE.test(title)) continue
    const other: CorrelationCandidate = { ...held, id: 'gdelt', title, source_id: site, published_at: at, url, lat: null, lng: null }
    if (!isSameStory(held, other) || namesDiffer(report.title, title)) continue
    if (isCopyOf({ url, title }, { urls: report.original_urls, title: report.title }) || nearCopy(title, report.title)) continue
    if (found.some(f => isCopyOf({ url, title }, { urls: [f.url], title: f.title }) || nearCopy(title, f.title))) continue
    sites.add(ownerOf(site))
    found.push({ url: cleanUrl(url), title, site, at })
  }
  return found
}

/** Whether a report is news another outlet could carry: not a machine feed's (aircraft, fires, quakes), not a template headline */
export function searchable(report: Pick<HeldReport, 'title' | 'tags'>): boolean {
  const tags = new Set(report.tags.map(t => String(t).toLowerCase()))
  if (tags.has('osint') && !tags.has('gdelt')) return false
  if (isEventTemplateTitle(report.title)) return false
  return storyTokens(report.title).length >= 3
}

// ─── The articles held ───────────────────────────────────────────────────────

type HeldArticle = GdeltArticle & { tokens: string[] }

/** GDELT's files of the last 8 hours, a batch a file */
export class ArticleWindow {
  private batches: Array<{ stamp: string; articles: HeldArticle[] }> = []

  add(stamp: string, articles: GdeltArticle[]): void {
    if (this.batches.some(b => b.stamp === stamp)) return
    this.batches.push({ stamp, articles: articles.map(a => ({ ...a, tokens: storyTokens(a.title) })) })
    this.batches.sort((a, b) => a.stamp.localeCompare(b.stamp))
  }

  /** Drop the files older than `keepMs` before `now` */
  evict(now: Date, keepMs = WINDOW_KEEP_MS): void {
    this.batches = this.batches.filter(b => stampDate(b.stamp).getTime() >= now.getTime() - keepMs)
  }

  newest(): string | null {
    return this.batches.length ? this.batches[this.batches.length - 1]!.stamp : null
  }

  /** The articles of the files after `stamp` (all with null) */
  after(stamp: string | null): HeldArticle[] {
    return this.batches.filter(b => stamp === null || b.stamp > stamp).flatMap(b => b.articles)
  }

  get size(): number {
    return this.batches.reduce((n, b) => n + b.articles.length, 0)
  }
}

/** What a cycle keeps for the next: the articles held, and how far each report has been compared */
export interface FinderState {
  window: ArticleWindow
  /** The newest file each report was compared with */
  compared: Map<string, string>
}

export const newState = (): FinderState => ({ window: new ArticleWindow(), compared: new Map() })

// ─── A cycle ─────────────────────────────────────────────────────────────────

export interface CycleStats {
  files: number
  articles: number
  reports: number
  pairs: number
  matched: number
  outlets: number
  promoted: number
  crosschecked: number
  errors: number
}

export interface SecondOutletDeps {
  newestStamp(): Promise<string | null>
  fetchArticles(stamp: string): Promise<GdeltArticle[] | null>
  /** The reports waiting for a second outlet now */
  waiting(now: Date): Promise<HeldReport[]>
  /** Add the outlets; true when the report turned verified */
  add(report: HeldReport, found: FoundOutlet[], crossCheck: boolean): Promise<boolean>
  crossChecksToday(day: string): Promise<number>
  lock(): Promise<boolean>
  unlock(): Promise<void>
  count(day: string, stats: CycleStats): Promise<void>
  remember(entry: Record<string, unknown>): Promise<void>
  /** The last cycle's files and counts, kept for reading */
  trace(entry: Record<string, unknown>): Promise<void>
  clock(): number
}

/** What the last cycle read, for GET /api/v1/public/second-outlets (second-outlet:last-cycle) */
let lastTrace: Record<string, unknown> | null = null

const emptyStats = (): CycleStats => ({ files: 0, articles: 0, reports: 0, pairs: 0, matched: 0, outlets: 0, promoted: 0, crosschecked: 0, errors: 0 })

/** One cycle: GDELT's new files in, every waiting report compared with what it hasn't been compared with */
export async function runSecondOutlets(state: FinderState, deps: SecondOutletDeps = liveDeps): Promise<CycleStats> {
  const stats = emptyStats()
  if (!(await deps.lock())) return stats
  const now = new Date(deps.clock())
  const day = now.toISOString().slice(0, 10)
  try {
    // 1. GDELT's new files
    const newest = await deps.newestStamp().catch(err => { stats.errors++; logger.warn({ err }, 'Second outlet: GDELT file list unreadable'); return null })
    const trace: { newest: string | null; read: Array<[string, number]>; missing: string[]; failed: Array<[string, string]> } = { newest, read: [], missing: [], failed: [] }
    if (newest) {
      const held = state.window.newest()
      for (const stamp of filesToRead(newest, held, held ? MAX_FILES : WARM_FILES)) {
        let articles: GdeltArticle[] | null = null
        try {
          articles = await deps.fetchArticles(stamp)
        } catch (err) {
          stats.errors++
          trace.failed.push([stamp, String((err as Error)?.message || err).slice(0, 120)])
          logger.warn({ err, stamp }, 'Second outlet: GDELT file unreadable')
          continue
        }
        if (!articles) { trace.missing.push(stamp); continue }
        state.window.add(stamp, articles)
        stats.files++
        stats.articles += articles.length
        trace.read.push([stamp, articles.length])
      }
    }
    lastTrace = { at: now.toISOString(), ...trace }
    state.window.evict(now)
    const latest = state.window.newest()
    if (!latest) return stats

    // 2. The reports, each compared with the files it hasn't been compared with
    const reports = (await deps.waiting(now)).filter(searchable)
    stats.reports = reports.length
    const groups = new Map<string | null, HeldReport[]>()
    for (const r of reports) {
      const since = state.compared.get(r.id) ?? null
      if (since === latest) continue
      const list = groups.get(since)
      if (list) list.push(r); else groups.set(since, [r])
    }
    const found = new Map<string, { report: HeldReport; outlets: FoundOutlet[] }>()
    for (const [since, group] of groups) {
      const articles = state.window.after(since)
      const pairs = candidatePairs(group.map(r => ({ tokens: storyTokens(r.title) })), articles)
      let n = 0
      for (const [i, list] of pairs) {
        const report = group[i]!
        const best = list.slice(0, MAX_CANDIDATES)
        stats.pairs += best.length
        const outlets = otherOutlets(report, best.map(a => articles[a]!), now)
        if (outlets.length) found.set(report.id, { report, outlets })
        // room for the scraper's other work between reports
        if (++n % 100 === 0) await new Promise(resolve => setImmediate(resolve))
      }
    }
    for (const r of reports) state.compared.set(r.id, latest)
    const live = new Set(reports.map(r => r.id))
    for (const id of state.compared.keys()) if (!live.has(id)) state.compared.delete(id)

    // 3. The outlets found join their reports
    let crossChecks = await deps.crossChecksToday(day).catch(() => CROSSCHECKS_A_DAY)
    for (const { report, outlets } of found.values()) {
      const crossCheck = crossChecks < CROSSCHECKS_A_DAY
      try {
        const promoted = await deps.add(report, outlets, crossCheck)
        stats.matched++
        stats.outlets += outlets.length
        if (promoted) {
          stats.promoted++
          if (crossCheck) { stats.crosschecked++; crossChecks++ }
        }
        await deps.remember({
          at: new Date(deps.clock()).toISOString(),
          id: report.id,
          severity: report.severity,
          title: report.title.slice(0, 140),
          promoted,
          found: outlets.map(f => ({ site: f.site, title: f.title.slice(0, 140), url: f.url })),
        })
      } catch (err) {
        stats.errors++
        logger.warn({ err, id: report.id }, 'Second outlet: outlets not added')
      }
    }
  } finally {
    await deps.count(day, stats).catch(err => logger.warn({ err }, 'Second outlet: counts not saved'))
    if (lastTrace) await deps.trace({ ...lastTrace, held: state.window.size, stats }).catch(() => {})
    await deps.unlock().catch(() => {})
  }
  return stats
}

// ─── The live parts ──────────────────────────────────────────────────────────

interface ReportRow {
  id: string
  title: string | null
  category: string | null
  severity: string | null
  source_ids: unknown
  original_urls: unknown
  location_name: string | null
  lat: number | string | null
  lng: number | string | null
  tags: unknown
  published_at: Date | string
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

export const liveDeps: SecondOutletDeps = {
  newestStamp: fetchNewestStamp,
  fetchArticles,

  async waiting(now) {
    // Pending, one outlet, medium or above, in English, settled
    const { rows } = await db.raw(
      `SELECT id, title, category, severity, source_ids, original_urls, location_name, tags,
              COALESCE(event_time, created_at) AS published_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM signals
        WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1
          AND severity IN ('medium', 'high', 'critical') AND language = 'en'
          AND cardinality(original_urls) >= 1
          AND created_at > ?::timestamptz AND created_at < ?::timestamptz
        ORDER BY created_at DESC
        LIMIT 20000`,
      [new Date(now.getTime() - LOOKBACK_MS).toISOString(), new Date(now.getTime() - SETTLE_MS).toISOString()],
    ) as { rows: ReportRow[] }
    return rows.map(toHeld)
  },

  async add(report, found, crossCheck) {
    // Still waiting? (an outlet may have joined since it was read)
    const now = await db('signals').where('id', report.id).first('status', 'source_count') as { status?: string; source_count?: number } | undefined
    if (!now || now.status !== 'pending' || Number(now.source_count ?? 1) > 1) return false
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
      notes:      `Also reported by ${found.map(f => f.site).join(', ')} (found in GDELT's list of news articles)`,
    }).catch(err => logger.warn({ err, id: report.id }, 'Second outlet: not logged on the report page'))
    const row = await db('signals').where('id', report.id).first('status') as { status?: string } | undefined
    // the search index still has it as it came: pending, one outlet (reindex.ts)
    await queueReindex([report.id]).catch(err => logger.warn({ err, id: report.id }, 'Second outlet: search re-index not queued'))
    return row?.status === 'verified'
  },

  async crossChecksToday(day) {
    return Number(await redis.hget(DAY_KEY(day), 'crosschecked')) || 0
  },

  async lock() {
    // 6 minutes: a cycle takes one or two; a restart that killed one mid-cycle
    // cost the next cycle while the old lock held (14 minutes until Oct 22)
    return await redis.set(LOCK_KEY, '1', 'EX', LOCK_S, 'NX') === 'OK'
  },

  async unlock() {
    await redis.del(LOCK_KEY)
  },

  async count(day, stats) {
    const multi = redis.multi()
    let any = false
    for (const [k, v] of Object.entries(stats)) {
      if (!v || k === 'reports') continue
      multi.hincrby(DAY_KEY(day), k, v)
      any = true
    }
    // the reports waiting at the latest cycle (a count, not a sum)
    multi.hset(DAY_KEY(day), 'waiting', stats.reports)
    multi.expire(DAY_KEY(day), KEEP_S)
    if (any || stats.reports) await multi.exec()
  },

  async remember(entry) {
    await redis.multi().lpush(RECENT_KEY, JSON.stringify(entry)).ltrim(RECENT_KEY, 0, 99).expire(RECENT_KEY, 7 * 86_400).exec()
  },

  async trace(entry) {
    await redis.set(LAST_CYCLE_KEY, JSON.stringify(entry), 'EX', 2 * 86_400)
  },

  clock: () => Date.now(),
}

/** Every 15 minutes, a few minutes after GDELT publishes (off with SECOND_OUTLET=off) */
export function startSecondOutlets(): void {
  if ((process.env.SECOND_OUTLET || 'on').toLowerCase() === 'off') {
    logger.info('Second outlet off (SECOND_OUTLET=off)')
    return
  }
  const state = newState()
  // One scraper runs at a time: a lock left by the process this one replaced is stale
  redis.del(LOCK_KEY).catch(() => {})
  const run = () => {
    runSecondOutlets(state)
      .then(s => logger.info({ ...s, held: state.window.size }, 'Second outlet cycle'))
      .catch(err => logger.warn({ err }, 'Second outlet cycle failed (non-fatal)'))
  }
  // GDELT's files come at :00, :15, :30 and :45, listed a few minutes later
  const now = Date.now()
  const nextSlot = Math.ceil((now - 7 * 60_000) / CYCLE_MS) * CYCLE_MS + 7 * 60_000
  setTimeout(() => { run(); setInterval(run, CYCLE_MS) }, Math.max(60_000, nextSlot - now))
}
