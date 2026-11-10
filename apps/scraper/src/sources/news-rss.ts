/**
 * WorldPulse Global News RSS Adapter
 *
 * Ingests about 515 international news RSS feeds and creates WorldPulse signals from
 * breaking/world news items. Provides editorial-sourced signal coverage to
 * complement the OSINT/sensor feeds already in the pipeline.
 *
 * Tier 1 — Wire services & flagship broadcasters:
 *   BBC World, NPR, Deutsche Welle, UN News, UPI, ANSA, Yonhap, NYT, WSJ, PBS
 *   (Reuters and AP closed their public RSS feeds, so they aren't polled)
 * Tier 2 — Strong independent international outlets:
 *   Al Jazeera, The Guardian, France24, Euronews, Japan Times, Straits Times,
 *   The Hindu, SCMP, VOA, Kyiv Independent, Middle East Eye, Haaretz,
 *   Times of India, Sydney Morning Herald, DW Africa, The East African
 * Tier 2b — Regional & emerging-market outlets:
 *   Le Monde, Der Spiegel Intl, El País (EN), Daily Maverick,
 *   Nikkei Asia, Arab News, AllAfrica, Folha de S.Paulo, The Conversation,
 *   EURACTIV, Moscow Times, Taipei Times, Dawn Pakistan, Premium Times Nigeria,
 *   Bangkok Post, Al-Monitor, EUobserver, Africanews, RFE/RL,
 *   Asia Times, Channel NewsAsia
 * Tier 3 — State-controlled media (lower reliability, flagged):
 *   TASS (EN), CGTN, Anadolu Agency, Antara
 * Tier 4 — Financial intelligence:
 *   Bloomberg Markets, FT, MarketWatch, CoinDesk,
 *   The Block, ECB, Federal Reserve
 * Tier 4b — Premium finance (expanded):
 *   Barron's, CNBC Markets, CNN Business, TheStreet, Investing.com,
 *   WSJ Markets, Forbes Business
 * Tier 5 — Expanded regional & specialist coverage (50 new feeds, cycle 10):
 *   Africa: Nation Africa (KE), The Punch (NG), BusinessDay (NG),
 *     The Africa Report, Ahram Online (EG), Mail & Guardian (ZA),
 *     Vanguard (NG), Daily Trust (NG), The Reporter Ethiopia,
 *     Graphic Online (GH)
 *   SE Asia business: NST Malaysia, Philippine Daily Inquirer, VnExpress Intl,
 *     Myanmar Now
 *   LatAm investigative: Agência Pública (BR), CIPER Chile, La Silla Vacía (CO)
 *   Pacific: RNZ Pacific, Islands Business (FJ), ABC Pacific, RNZ National
 *   Climate/energy: Carbon Brief, Climate Home News, Renewable Energy World,
 *     OilPrice.com, Solar Power World, pv magazine, IEA News
 *   Science: Nature News, New Scientist, Phys.org, ScienceDaily,
 *     MIT Technology Review
 *   Defense/security: War on the Rocks, Bellingcat, Lawfare, Breaking Defense,
 *     Just Security
 *   Other: Balkan Insight, OCCRP, The Irrawaddy, The Diplomat, Eurasia Review,
 *     The Arab Weekly, Georgia Today
 *
 * Reliability scores reflect editorial independence, fact-check track records,
 * and MBFC/NewsGuard ratings. State-controlled outlets (Xinhua, TASS) are
 * tagged "state-media" and assigned lower reliability.
 *
 * Polling: staggered 30-min intervals (sources polled sequentially, 5 s apart).
 * A feed that fails 3 polls in a row is paused for 6 hours at a time (sites
 * that block us, or move their feed, aren't asked again every 30 minutes).
 * Dedup: Redis key with 24-hour TTL per article URL
 *
 * Feeds checked October 2026: 20 dead ones moved to their new addresses, and 20
 * that no longer exist were removed (Reuters and AP among them).
 *
 * Checked again Oct 14, 2026, every feed fetched from outside the server: 14
 * answered every request with a bot check or an error (403: EURACTIV, TheStreet,
 * Barron's, Nation Africa, Ahram Online, IEA, Lawfare, The Arab Weekly, Maritime
 * Global Security, Port Technology, IISS; 503: Naval News; 500: Georgia Today;
 * a broken certificate: Islands Business) and 6 still answered but had gone
 * quiet, so nothing new ever came from them (Xinhua's feed stopped in 2018,
 * CNN's two in 2018 and 2023, WHO's in March 2026, Nature's serves a web page,
 * and NHK's was Japanese and two months old). All 20 were removed; WSJ Markets
 * moved to Dow Jones' new feed address; 37 tested replacements were added at the
 * end of the registry. Failing feeds show in /ops-status.json (pipeline.sources.
 * news_feeds), and a feed that only lists old stories logs "News feed items
 * skipped as old".
 *
 * Oct 17, 2026: four feeds that had failed every poll from our server since
 * they were added were removed (Anadolu, The New Arab, The Thaiger, and
 * ReliefWeb's updates feed, whose firewall answers our server with a browser
 * check; ReliefWeb's disasters keep coming through reliefweb.ts). They answer
 * from elsewhere, so the block is on our server's side of the internet. Each
 * failing feed now records why its newest poll failed, as a fixed phrase
 * (feedFailureWhy), so /ops-status.json and HQ say why it fails.
 *
 * Oct 20, 2026 (plan R2): 10 more, each answering the server's own request
 * with fresh items that day: six first-hand official sources (the UN's
 * meeting record, the European Commission, the UK foreign ministry, the Bank
 * of England, the International Criminal Court, the Red Cross) and four
 * outlets for regions with none or few (Sudan and South Sudan, Mali and the
 * Sahel, Central Asia, Central America). Several of them allow only personal
 * or non-commercial use of their pages: like every feed here, only the
 * headline, at most 600 characters of the feed's own text and the link are
 * kept, and readers are sent to the original. Later that day 9 more (R2b):
 * Radio Dabanga (Sudan), JAMnews (South Caucasus), Post-Courier (Papua New
 * Guinea), Vanuatu Daily Post, Security Council Report, EconomyNext (Sri
 * Lanka), Amu TV (Afghanistan), The Haitian Times and Shafaq News (Iraq).
 */

import https from 'node:https'
import http  from 'node:http'
import zlib  from 'node:zlib'
import type { Knex }     from 'knex'
import type Redis        from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { setThinPlaces } from '../pipeline/correlate'
import { noteCoverage } from './coverage'
// Feed items published more than 3 days ago aren't news
import { MAX_ITEM_AGE_MS, isStaleItem } from '../pipeline/freshness'
// Feeds send "&#x27;" and "&amp;" in titles and summaries
import { decodeEntities, cleanSummary, repeatsTitle, feedText, clipText } from '../pipeline/text'
import { placeFromText, splitPlaces, withHomeNames, mentionedCountries, homePlaceFromText, findGazetteerPlace, namedCountryHomePlace, homeTwinPlace, placeInCountry, withoutEnvoyCountries, withoutNonPlaceNames } from '../pipeline/geo'
import { withLocalNames } from '../pipeline/local-names'
import { rateSeverity } from '../pipeline/severity'
import { categorizeText } from '../pipeline/categories'
import { gdacsAlertLevel, gdacsSeverity, gdacsTags, tidyGdacsTitle } from './gdacs'
export { MAX_ITEM_AGE_MS, isStaleItem, decodeEntities }

const log = rootLogger.child({ module: 'news-rss-source' })

// Longer than MAX_ITEM_AGE_MS, so an item is never processed twice while it's
// young enough to be news. With 24 hours, an item still in its feed a day later
// could come back as a new signal (the title check in insert-signal.ts only
// looks back 6 hours).
const DEDUP_TTL_S   = 4 * 24 * 3_600      // 4 days
const POLL_INTERVAL = 30 * 60_000         // 30 minutes between full cycles
const SOURCE_DELAY  = 5_000               // 5 s stagger between sources, while the list is small
const SOURCE_DELAY_MIN = 1_000            // never closer than 1 s
/** The cycle's pauses take at most this share of POLL_INTERVAL */
const CYCLE_SHARE = 0.75

/**
 * The pause between two feeds (Oct 20, 2026, growing to 300 feeds): 5 s while
 * the list is small, shorter as it grows, so that a whole cycle still fits in
 * its 30 minutes. At 5 s each, 300 feeds' pauses alone took 25 minutes, and
 * with the fetching and storing a cycle ran past the next one's start.
 */
export function sourceDelay(sources: number): number {
  if (sources <= 0) return SOURCE_DELAY
  return Math.max(SOURCE_DELAY_MIN, Math.min(SOURCE_DELAY, Math.floor((POLL_INTERVAL * CYCLE_SHARE) / sources)))
}

/** A whole poll cycle should end in this, a little under its 30 minutes, so the next one starts on time */
export const CYCLE_BUDGET = Math.round(POLL_INTERVAL * 0.9)
/** The shortest pause between two feeds (each is on its own host) */
export const SOURCE_PAUSE_MIN = 250

/**
 * The pause before the next feed (Oct 20, 2026, 405 feeds): what is left of the
 * cycle's budget, shared by the feeds still to read, less the time reading one
 * takes (the average so far), between SOURCE_PAUSE_MIN and SOURCE_DELAY. The
 * reader reads READ_AT_ONCE feeds a round, so it passes rounds and a round's time.
 * Reading a feed takes about 3 seconds as well, so the fixed pause
 * (sourceDelay(405) = 3.3 s) made a pass take 44 minutes, longer than its 30:
 * every other start was skipped and each feed was read once an hour (the
 * 7:05 PM audit: the reader reached the 389th feed 42 minutes after it started).
 */
export function cyclePause(feedsLeft: number, msLeft: number, avgReadMs: number): number {
  if (feedsLeft <= 0) return 0
  const share = msLeft / feedsLeft - Math.max(0, Number.isFinite(avgReadMs) ? avgReadMs : 0)
  if (!Number.isFinite(share)) return SOURCE_PAUSE_MIN
  return Math.max(SOURCE_PAUSE_MIN, Math.min(SOURCE_DELAY, Math.floor(share)))
}

/**
 * Feeds read at once (Oct 20, 2026, 475 feeds). Reading one takes about 3
 * seconds, so one after another the reads alone took 25 of the cycle's 30
 * minutes, with no room for slow answers or more feeds. Two at a time (each
 * feed is on its own host) a round takes about as long as its slower read, and
 * a pass has room to grow well past 500. The geocoder books its own slots
 * (throttleNominatim), so two readers never ask it at once.
 */
export const READ_AT_ONCE = 2

/** The cycle's rounds from startAt: [first, end) index ranges of READ_AT_ONCE feeds (the last may be shorter) */
export function readRounds(total: number, startAt: number, size = READ_AT_ONCE): Array<[number, number]> {
  const step = Math.max(1, Math.floor(size))
  const rounds: Array<[number, number]> = []
  for (let i = Math.max(0, startAt); i < total; i += step) rounds.push([i, Math.min(total, i + step)])
  return rounds
}

/**
 * One poll cycle at a time (Oct 20, 2026): the timer starts a cycle every 30
 * minutes, and one that hadn't finished ran on beside the next, so each feed
 * was asked twice as often. A cycle that is still running when the timer
 * fires lets that start go by. Returns the function the timer calls.
 */
export function oneCycleAtATime(run: () => Promise<void>, onSkip?: () => void): () => Promise<void> {
  let running = false
  return async () => {
    if (running) { onSkip?.(); return }
    running = true
    try { await run() } finally { running = false }
  }
}
/** Where an interrupted cycle stands, kept across restarts (every deploy restarts the scraper) */
const CYCLE_KEY = 'news-rss:cycle'
/** A saved place older than this starts a fresh cycle instead */
const CYCLE_RESUME_MS = 2 * POLL_INTERVAL

export interface CyclePlace { startedAt: number; nextId: string }

/**
 * Where a poll cycle starts (Oct 20, 2026). Every deploy restarts the
 * scraper, and a cycle always started again at the top of the list, so on a
 * day of deploys every 5 to 10 minutes the reader never got past the first
 * 211 feeds: the 183 added that afternoon went unread for up to 100 minutes,
 * while the first feeds were read after every deploy. A cycle that a restart
 * interrupted now carries on from the feed it had reached, when it started
 * less than an hour ago and that feed is still listed.
 */
export function cycleStart(saved: CyclePlace | null | undefined, ids: string[], now: number): { index: number; startedAt: number } {
  if (saved && typeof saved.nextId === 'string' && Number.isFinite(saved.startedAt) && now - saved.startedAt < CYCLE_RESUME_MS) {
    const index = ids.indexOf(saved.nextId)
    if (index > 0) return { index, startedAt: saved.startedAt }
  }
  return { index: 0, startedAt: now }
}

const MAX_ITEMS     = 20                  // max signals per source per poll
const MAX_FEED_BYTES     = 5 * 1024 * 1024 // a feed bigger than this isn't a feed
const FAILS_BEFORE_PAUSE = 3               // failed polls in a row before a feed is paused
const PAUSE_S            = 6 * 3_600       // how long a failing feed is paused

// ─── SOURCE REGISTRY ─────────────────────────────────────────────────────────

export interface NewsSource {
  /** Unique ID — also used as Redis key prefix and watchdog ID */
  id:          string
  /** Human-readable outlet name */
  name:        string
  /** RSS/Atom feed URL */
  feedUrl:     string
  /** Primary WorldPulse category for items from this outlet */
  category:    Category
  /** MBFC/NewsGuard-informed bias label for transparency */
  biasLabel:   'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'state-media' | 'unknown'
  /** Reliability 0.0–1.0 (0.9+ = top-tier; <0.6 = state-controlled) */
  reliability: number
  /** ISO 3166-1 alpha-2 country code for outlet's editorial home */
  countryCode: string
  /** Default signal coordinates (outlet HQ / primary coverage area) */
  defaultLat:  number
  defaultLng:  number
  /** Default human-readable location string */
  defaultLocation: string
  /** Extra tags appended to every signal from this source */
  extraTags:   string[]
  /** Language of the feed */
  language:    string
  /**
   * Set (Nov 5, 2026) when the feed's site turns every automated reader away
   * with a bot check: why, in a few words. A parked feed is tried once a day,
   * not every 30 minutes, its failed reads aren't counted as failing, and it is
   * read as usual again from the first time it answers (parkedFeedDue).
   */
  parked?:     string
  /**
   * Set (Nov 6, 2026) for a feed whose site-wide feed mixes in a section the
   * reader can't place: items whose link matches aren't read (skippedLink).
   * 15min's world section is in Lithuanian, whose foreign place names the
   * place-finder doesn't know, so its stories would be pinned in Vilnius.
   */
  skipLinks?:  RegExp
}

export const NEWS_SOURCE_REGISTRY: NewsSource[] = [
  // ── Tier 1 — Highest reliability international outlets ──────────────────
  {
    id:              'bbc-world',
    name:            'BBC World News',
    feedUrl:         'https://feeds.bbci.co.uk/news/world/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.92,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['bbc', 'uk-media'],
    language:        'en',
  },
  {
    id:              'npr-news',
    name:            'NPR News',
    feedUrl:         'https://feeds.npr.org/1001/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['npr', 'us-media'],
    language:        'en',
  },
  {
    id:              'dw-world',
    name:            'Deutsche Welle — World',
    feedUrl:         'https://rss.dw.com/rdf/rss-en-all',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'DE',
    defaultLat:      50.74,
    defaultLng:      7.09,
    defaultLocation: 'Bonn, Germany',
    extraTags:       ['dw', 'germany', 'europe'],
    language:        'en',
  },
  {
    id:              'un-news',
    name:            'UN News',
    feedUrl:         'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, United Nations',
    extraTags:       ['un', 'united-nations', 'international'],
    language:        'en',
  },
  // ── Tier 2 — Strong independent international outlets ───────────────────
  {
    id:              'al-jazeera',
    name:            'Al Jazeera English',
    feedUrl:         'https://www.aljazeera.com/xml/rss/all.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'QA',
    defaultLat:      25.28,
    defaultLng:      51.53,
    defaultLocation: 'Doha, Qatar',
    extraTags:       ['al-jazeera', 'middle-east', 'gulf'],
    language:        'en',
  },
  {
    id:              'guardian-world',
    name:            'The Guardian — World',
    feedUrl:         'https://www.theguardian.com/world/rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.84,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['guardian', 'uk-media'],
    language:        'en',
  },
  {
    id:              'france24',
    name:            'France24 English',
    feedUrl:         'https://www.france24.com/en/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'FR',
    defaultLat:      48.85,
    defaultLng:      2.35,
    defaultLocation: 'Paris, France',
    extraTags:       ['france24', 'france', 'europe'],
    language:        'en',
  },
  {
    id:              'euronews',
    name:            'Euronews',
    feedUrl:         'https://www.euronews.com/rss?level=theme&name=news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'FR',
    defaultLat:      45.76,
    defaultLng:      4.84,
    defaultLocation: 'Lyon, France',
    extraTags:       ['euronews', 'europe'],
    language:        'en',
  },
  {
    id:              'japan-times',
    name:            'The Japan Times',
    feedUrl:         'https://www.japantimes.co.jp/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'JP',
    defaultLat:      35.68,
    defaultLng:      139.69,
    defaultLocation: 'Tokyo, Japan',
    extraTags:       ['japan-times', 'japan', 'asia'],
    language:        'en',
  },
  {
    id:              'straits-times',
    name:            'The Straits Times',
    feedUrl:         'https://www.straitstimes.com/news/world/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.81,
    countryCode:     'SG',
    defaultLat:      1.35,
    defaultLng:      103.82,
    defaultLocation: 'Singapore',
    extraTags:       ['straits-times', 'singapore', 'southeast-asia'],
    language:        'en',
  },
  {
    id:              'the-hindu',
    name:            'The Hindu — International',
    feedUrl:         'https://www.thehindu.com/news/international/feeder/default.rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'IN',
    defaultLat:      13.08,
    defaultLng:      80.27,
    defaultLocation: 'Chennai, India',
    extraTags:       ['the-hindu', 'india', 'south-asia'],
    language:        'en',
  },
  {
    id:              'scmp-world',
    name:            'South China Morning Post — World',
    feedUrl:         'https://www.scmp.com/rss/91/feed',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.77,
    countryCode:     'HK',
    defaultLat:      22.32,
    defaultLng:      114.17,
    defaultLocation: 'Hong Kong',
    extraTags:       ['scmp', 'hong-kong', 'east-asia'],
    language:        'en',
  },
  {
    id:              'voa-news',
    name:            'VOA News',
    feedUrl:         'https://www.voanews.com/api/epiqq',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['voa', 'us-media'],
    language:        'en',
  },
  {
    id:              'kyiv-independent',
    name:            'Kyiv Independent',
    feedUrl:         'https://kyivindependent.com/news-archive/rss/',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'UA',
    defaultLat:      50.45,
    defaultLng:      30.52,
    defaultLocation: 'Kyiv, Ukraine',
    extraTags:       ['kyiv-independent', 'ukraine', 'eastern-europe'],
    language:        'en',
  },
  {
    id:              'haaretz',
    name:            'Haaretz English',
    feedUrl:         'https://www.haaretz.com/srv/haaretz-latest-headlines',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.79,
    countryCode:     'IL',
    defaultLat:      32.08,
    defaultLng:      34.78,
    defaultLocation: 'Tel Aviv, Israel',
    extraTags:       ['haaretz', 'israel', 'middle-east'],
    language:        'en',
  },
  {
    id:              'times-of-india',
    name:            'Times of India — World',
    feedUrl:         'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.74,
    countryCode:     'IN',
    defaultLat:      28.60,
    defaultLng:      77.21,
    defaultLocation: 'New Delhi, India',
    extraTags:       ['times-of-india', 'india', 'south-asia'],
    language:        'en',
  },
  {
    id:              'sydney-morning-herald',
    name:            'Sydney Morning Herald — World',
    feedUrl:         'https://www.smh.com.au/rss/world.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.81,
    countryCode:     'AU',
    defaultLat:      -33.87,
    defaultLng:      151.21,
    defaultLocation: 'Sydney, Australia',
    extraTags:       ['smh', 'australia', 'pacific'],
    language:        'en',
  },
  {
    id:              'dw-africa',
    name:            'Deutsche Welle — Africa',
    feedUrl:         'https://rss.dw.com/rdf/rss-en-africa',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'DE',
    defaultLat:      0.00,
    defaultLng:      20.00,
    defaultLocation: 'Africa',
    extraTags:       ['dw', 'africa', 'dw-africa'],
    language:        'en',
  },
  // ── Tier 2b — Regional & Emerging-Market outlets ────────────────────────
  {
    id:              'le-monde',
    name:            'Le Monde — International',
    feedUrl:         'https://www.lemonde.fr/rss/une.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.91,
    countryCode:     'FR',
    defaultLat:      48.85,
    defaultLng:      2.35,
    defaultLocation: 'Paris, France',
    extraTags:       ['le-monde', 'france', 'french-media'],
    language:        'fr',
  },
  {
    id:              'der-spiegel-intl',
    name:            'Der Spiegel International',
    feedUrl:         'https://www.spiegel.de/international/index.rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.88,
    countryCode:     'DE',
    defaultLat:      53.55,
    defaultLng:      10.00,
    defaultLocation: 'Hamburg, Germany',
    extraTags:       ['spiegel', 'germany', 'german-media'],
    language:        'en',
  },
  {
    id:              'el-pais-eng',
    name:            'El País — English Edition',
    feedUrl:         'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.87,
    countryCode:     'ES',
    defaultLat:      40.42,
    defaultLng:      -3.70,
    defaultLocation: 'Madrid, Spain',
    extraTags:       ['el-pais', 'spain', 'spanish-media'],
    language:        'en',
  },
  {
    id:              'daily-maverick',
    name:            'Daily Maverick',
    feedUrl:         'https://www.dailymaverick.co.za/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'ZA',
    defaultLat:      -25.75,
    defaultLng:      28.23,
    defaultLocation: 'Johannesburg, South Africa',
    extraTags:       ['daily-maverick', 'south-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'nikkei-asia',
    name:            'Nikkei Asia',
    feedUrl:         'https://asia.nikkei.com/rss/feed/nar',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'JP',
    defaultLat:      35.69,
    defaultLng:      139.69,
    defaultLocation: 'Tokyo, Japan',
    extraTags:       ['nikkei', 'japan', 'asia-pacific', 'business'],
    language:        'en',
  },
  {
    id:              'allafrica',
    name:            'AllAfrica',
    feedUrl:         'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'SN',
    defaultLat:      14.69,
    defaultLng:      -17.45,
    defaultLocation: 'Dakar, Senegal',
    extraTags:       ['allafrica', 'africa', 'pan-african'],
    language:        'en',
  },
  {
    id:              'folha-sao-paulo',
    name:            'Folha de S.Paulo — Mundo',
    feedUrl:         'https://feeds.folha.uol.com.br/mundo/rss091.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'BR',
    defaultLat:      -23.55,
    defaultLng:      -46.63,
    defaultLocation: 'São Paulo, Brazil',
    extraTags:       ['folha', 'brazil', 'latin-america'],
    language:        'pt',
  },
  {
    id:              'the-conversation',
    name:            'The Conversation — Global',
    feedUrl:         'https://theconversation.com/global/articles.atom',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'AU',
    defaultLat:      -37.81,
    defaultLng:      144.96,
    defaultLocation: 'Melbourne, Australia',
    extraTags:       ['the-conversation', 'academic', 'evidence-based'],
    language:        'en',
  },
  // ── Tier 2c — New Global Voices (cycle 9: 35 → 50) ──────────────────────
  {
    id:              'moscow-times',
    name:            'The Moscow Times (English)',
    feedUrl:         'https://www.themoscowtimes.com/rss/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'RU',
    defaultLat:      55.75,
    defaultLng:      37.62,
    defaultLocation: 'Moscow, Russia (exile edition)',
    extraTags:       ['moscow-times', 'russia', 'independent-media', 'exile-press'],
    language:        'en',
  },
  {
    id:              'taipei-times',
    name:            'Taipei Times',
    feedUrl:         'https://www.taipeitimes.com/xml/index.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'TW',
    defaultLat:      25.03,
    defaultLng:      121.57,
    defaultLocation: 'Taipei, Taiwan',
    extraTags:       ['taipei-times', 'taiwan', 'east-asia', 'cross-strait'],
    language:        'en',
  },
  {
    id:              'the-hindu-national',
    name:            'The Hindu — National',
    feedUrl:         'https://www.thehindu.com/news/national/feeder/default.rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'IN',
    defaultLat:      13.08,
    defaultLng:      80.27,
    defaultLocation: 'Chennai, India',
    extraTags:       ['the-hindu', 'india', 'south-asia', 'india-national'],
    language:        'en',
  },
  {
    id:              'dawn-pakistan',
    name:            'Dawn',
    feedUrl:         'https://www.dawn.com/feeds/home',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'PK',
    defaultLat:      33.72,
    defaultLng:      73.06,
    defaultLocation: 'Islamabad, Pakistan',
    extraTags:       ['dawn', 'pakistan', 'south-asia'],
    language:        'en',
  },
  {
    id:              'premium-times-nigeria',
    name:            'Premium Times Nigeria',
    feedUrl:         'https://www.premiumtimesng.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'NG',
    defaultLat:      9.08,
    defaultLng:      7.40,
    defaultLocation: 'Abuja, Nigeria',
    extraTags:       ['premium-times', 'nigeria', 'west-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'al-monitor',
    name:            'Al-Monitor',
    feedUrl:         'https://www.al-monitor.com/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      33.89,
    defaultLng:      35.50,
    defaultLocation: 'Middle East',
    extraTags:       ['al-monitor', 'middle-east', 'mena', 'analysis'],
    language:        'en',
  },
  {
    id:              'eu-observer',
    name:            'EUobserver',
    feedUrl:         'https://euobserver.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'BE',
    defaultLat:      50.85,
    defaultLng:      4.35,
    defaultLocation: 'Brussels, Belgium',
    extraTags:       ['eu-observer', 'europe', 'eu-institutions', 'brussels'],
    language:        'en',
  },
  {
    id:              'africanews',
    name:            'Africanews',
    feedUrl:         'https://www.africanews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'CD',
    defaultLat:      -4.32,
    defaultLng:      15.32,
    defaultLocation: 'Kinshasa, DRC / Pan-African',
    extraTags:       ['africanews', 'africa', 'pan-african'],
    language:        'en',
  },
  {
    id:              'rferl',
    name:            'Radio Free Europe / Radio Liberty',
    feedUrl:         'https://www.rferl.org/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'CZ',
    defaultLat:      50.08,
    defaultLng:      14.43,
    defaultLocation: 'Prague, Czech Republic',
    extraTags:       ['rferl', 'radio-free-europe', 'eastern-europe', 'independent-media'],
    language:        'en',
  },
  {
    id:              'asia-times',
    name:            'Asia Times',
    feedUrl:         'https://asiatimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'HK',
    defaultLat:      22.32,
    defaultLng:      114.17,
    defaultLocation: 'Hong Kong',
    extraTags:       ['asia-times', 'asia', 'asia-pacific', 'geopolitics'],
    language:        'en',
  },
  {
    id:              'channel-news-asia',
    name:            'Channel NewsAsia (CNA)',
    feedUrl:         'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'SG',
    defaultLat:      1.35,
    defaultLng:      103.82,
    defaultLocation: 'Singapore',
    extraTags:       ['cna', 'channel-news-asia', 'singapore', 'southeast-asia', 'asia-pacific'],
    language:        'en',
  },
  // ── Tier 3 — State-controlled media (lower reliability, flagged) ─────────
  {
    id:              'tass-en',
    name:            'TASS News Agency (English)',
    feedUrl:         'https://tass.com/rss/v2.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'RU',
    defaultLat:      55.75,
    defaultLng:      37.62,
    defaultLocation: 'Moscow, Russia',
    extraTags:       ['tass', 'russia', 'state-media', 'kremlin-affiliated'],
    language:        'en',
  },
  // ── Tier 4 — Financial Intelligence ─────────────────────────────────────
  {
    id:              'bloomberg-markets',
    name:            'Bloomberg Markets',
    feedUrl:         'https://feeds.bloomberg.com/markets/news.rss',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['bloomberg', 'markets', 'finance', 'wall-street'],
    language:        'en',
  },
  {
    id:              'ft-headlines',
    name:            'Financial Times Headlines',
    feedUrl:         'https://www.ft.com/rss/home/uk',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['ft', 'financial-times', 'finance', 'business'],
    language:        'en',
  },
  {
    id:              'marketwatch-top',
    name:            'MarketWatch Top Stories',
    feedUrl:         'https://feeds.marketwatch.com/marketwatch/topstories/',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['marketwatch', 'markets', 'finance', 'us-markets'],
    language:        'en',
  },
  {
    id:              'coindesk',
    name:            'CoinDesk',
    feedUrl:         'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['coindesk', 'crypto', 'bitcoin', 'blockchain', 'finance'],
    language:        'en',
  },
  {
    id:              'theblock',
    name:            'The Block',
    feedUrl:         'https://www.theblock.co/rss.xml',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['theblock', 'crypto', 'defi', 'blockchain', 'finance'],
    language:        'en',
  },
  {
    id:              'ecb-press',
    name:            'ECB Press Releases',
    feedUrl:         'https://www.ecb.europa.eu/rss/press.html',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'DE',
    defaultLat:      50.11,
    defaultLng:      8.68,
    defaultLocation: 'Frankfurt, Germany',
    extraTags:       ['ecb', 'central-bank', 'eurozone', 'monetary-policy', 'finance'],
    language:        'en',
  },
  {
    id:              'fed-press',
    name:            'Federal Reserve Press Releases',
    feedUrl:         'https://www.federalreserve.gov/feeds/press_all.xml',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['fed', 'federal-reserve', 'central-bank', 'fomc', 'finance'],
    language:        'en',
  },
  // ── Tier 4b — Premium Finance (expanded) ─────────────────────────────────
  {
    id:              'cnbc-markets',
    name:            'CNBC Markets',
    feedUrl:         'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      40.74,
    defaultLng:      -74.17,
    defaultLocation: 'Englewood Cliffs, NJ, United States',
    extraTags:       ['cnbc', 'markets', 'finance', 'us-markets', 'business'],
    language:        'en',
  },
  {
    id:              'investing-com-news',
    name:            'Investing.com News',
    feedUrl:         'https://www.investing.com/rss/news.rss',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'CY',
    defaultLat:      34.68,
    defaultLng:      33.04,
    defaultLocation: 'Limassol, Cyprus',
    extraTags:       ['investing-com', 'markets', 'finance', 'forex', 'commodities'],
    language:        'en',
  },
  {
    id:              'wsj-markets',
    name:            'Wall Street Journal Markets',
    feedUrl:         'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',
    category:        'finance',
    biasLabel:       'center-right',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['wsj', 'wall-street-journal', 'markets', 'finance', 'business'],
    language:        'en',
  },
  {
    id:              'forbes-money',
    name:            'Forbes Business',
    feedUrl:         'https://www.forbes.com/business/feed/',
    category:        'finance',
    biasLabel:       'center-right',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      40.73,
    defaultLng:      -74.00,
    defaultLocation: 'Jersey City, NJ, United States',
    extraTags:       ['forbes', 'money', 'finance', 'personal-finance', 'investing'],
    language:        'en',
  },
  // ── Tier 5 — African Regional Outlets ───────────────────────────────────
  {
    id:              'punch-nigeria',
    name:            'The Punch (Nigeria)',
    feedUrl:         'https://punchng.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.73,
    countryCode:     'NG',
    defaultLat:      6.46,
    defaultLng:      3.38,
    defaultLocation: 'Lagos, Nigeria',
    extraTags:       ['punch', 'nigeria', 'west-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'businessday-ng',
    name:            'BusinessDay Nigeria',
    feedUrl:         'https://businessday.ng/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'NG',
    defaultLat:      6.46,
    defaultLng:      3.38,
    defaultLocation: 'Lagos, Nigeria',
    extraTags:       ['businessday', 'nigeria', 'west-africa', 'africa', 'business'],
    language:        'en',
  },
  {
    id:              'mail-guardian-za',
    name:            'Mail & Guardian (South Africa)',
    feedUrl:         'https://mg.co.za/rss/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'ZA',
    defaultLat:      -26.20,
    defaultLng:      28.04,
    defaultLocation: 'Johannesburg, South Africa',
    extraTags:       ['mail-guardian', 'south-africa', 'africa', 'investigative'],
    language:        'en',
  },
  {
    id:              'vanguard-ng',
    name:            'Vanguard News (Nigeria)',
    feedUrl:         'https://www.vanguardngr.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.71,
    countryCode:     'NG',
    defaultLat:      6.46,
    defaultLng:      3.38,
    defaultLocation: 'Lagos, Nigeria',
    extraTags:       ['vanguard', 'nigeria', 'west-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'daily-trust-ng',
    name:            'Daily Trust (Nigeria)',
    feedUrl:         'https://dailytrust.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'NG',
    defaultLat:      9.08,
    defaultLng:      7.40,
    defaultLocation: 'Abuja, Nigeria',
    extraTags:       ['daily-trust', 'nigeria', 'north-nigeria', 'africa'],
    language:        'en',
  },
  {
    id:              'graphic-online-gh',
    name:            'Graphic Online (Ghana)',
    feedUrl:         'https://www.graphic.com.gh/news.feed?type=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.73,
    countryCode:     'GH',
    defaultLat:      5.56,
    defaultLng:      -0.20,
    defaultLocation: 'Accra, Ghana',
    extraTags:       ['graphic-online', 'ghana', 'west-africa', 'africa'],
    language:        'en',
  },
  // ── Tier 5 — Southeast Asian Business Press ──────────────────────────────
  {
    id:              'nst-malaysia',
    name:            'New Straits Times (Malaysia)',
    feedUrl:         'https://www.nst.com.my/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'MY',
    defaultLat:      3.14,
    defaultLng:      101.69,
    defaultLocation: 'Kuala Lumpur, Malaysia',
    extraTags:       ['nst', 'malaysia', 'southeast-asia'],
    language:        'en',
  },
  {
    id:              'philippine-inquirer',
    name:            'Philippine Daily Inquirer',
    feedUrl:         'https://www.inquirer.net/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'PH',
    defaultLat:      14.60,
    defaultLng:      121.00,
    defaultLocation: 'Manila, Philippines',
    extraTags:       ['philippine-inquirer', 'philippines', 'southeast-asia'],
    language:        'en',
  },
  {
    id:              'vnexpress-intl',
    name:            'VnExpress International',
    feedUrl:         'https://e.vnexpress.net/rss/news.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.73,
    countryCode:     'VN',
    defaultLat:      21.03,
    defaultLng:      105.85,
    defaultLocation: 'Hanoi, Vietnam',
    extraTags:       ['vnexpress', 'vietnam', 'southeast-asia'],
    language:        'en',
  },
  {
    id:              'myanmar-now',
    name:            'Myanmar Now',
    feedUrl:         'https://www.myanmar-now.org/en/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'MM',
    defaultLat:      16.80,
    defaultLng:      96.15,
    defaultLocation: 'Yangon, Myanmar',
    extraTags:       ['myanmar-now', 'myanmar', 'southeast-asia', 'independent-media'],
    language:        'en',
  },
  // ── Tier 5 — Latin American Investigative Journalism ─────────────────────
  {
    id:              'agencia-publica',
    name:            'Agência Pública (Brazil)',
    feedUrl:         'https://apublica.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.83,
    countryCode:     'BR',
    defaultLat:      -23.55,
    defaultLng:      -46.63,
    defaultLocation: 'São Paulo, Brazil',
    extraTags:       ['agencia-publica', 'brazil', 'latin-america', 'investigative'],
    language:        'pt',
  },
  {
    id:              'ciper-chile',
    name:            'CIPER Chile',
    feedUrl:         'https://www.ciperchile.cl/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'CL',
    defaultLat:      -33.46,
    defaultLng:      -70.65,
    defaultLocation: 'Santiago, Chile',
    extraTags:       ['ciper', 'chile', 'latin-america', 'investigative'],
    language:        'es',
  },
  {
    id:              'la-silla-vacia',
    name:            'La Silla Vacía (Colombia)',
    feedUrl:         'https://lasillavacia.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'CO',
    defaultLat:      4.71,
    defaultLng:      -74.07,
    defaultLocation: 'Bogotá, Colombia',
    extraTags:       ['la-silla-vacia', 'colombia', 'latin-america', 'politics'],
    language:        'es',
  },
  // ── Tier 5 — Pacific Island News ─────────────────────────────────────────
  {
    id:              'rnz-pacific',
    name:            'RNZ Pacific',
    feedUrl:         'https://www.rnz.co.nz/rss/pacific.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'NZ',
    defaultLat:      -17.73,
    defaultLng:      178.52,
    defaultLocation: 'Pacific Islands / Wellington, New Zealand',
    extraTags:       ['rnz', 'pacific', 'pacific-islands', 'new-zealand'],
    language:        'en',
  },
  {
    id:              'abc-pacific',
    name:            'ABC Pacific (Australia)',
    feedUrl:         'https://www.abc.net.au/news/feed/51120/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'AU',
    defaultLat:      -25.27,
    defaultLng:      133.77,
    defaultLocation: 'Pacific / Australia',
    extraTags:       ['abc-australia', 'pacific', 'pacific-islands', 'australia'],
    language:        'en',
  },
  {
    id:              'rnz-national',
    name:            'RNZ National News',
    feedUrl:         'https://www.rnz.co.nz/rss/national.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'NZ',
    defaultLat:      -41.29,
    defaultLng:      174.78,
    defaultLocation: 'Wellington, New Zealand',
    extraTags:       ['rnz', 'new-zealand', 'pacific', 'oceania'],
    language:        'en',
  },
  // ── Tier 5 — Climate & Energy Trade Press ────────────────────────────────
  {
    id:              'carbon-brief',
    name:            'Carbon Brief',
    feedUrl:         'https://www.carbonbrief.org/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['carbon-brief', 'climate', 'climate-science', 'energy'],
    language:        'en',
  },
  {
    id:              'climate-home-news',
    name:            'Climate Home News',
    feedUrl:         'https://www.climatechangenews.com/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['climate-home', 'climate', 'climate-policy', 'energy'],
    language:        'en',
  },
  {
    id:              'oilprice-com',
    name:            'OilPrice.com',
    feedUrl:         'https://oilprice.com/rss/main',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['oilprice', 'oil', 'gas', 'energy-markets', 'commodities'],
    language:        'en',
  },
  {
    id:              'solar-power-world',
    name:            'Solar Power World',
    feedUrl:         'https://www.solarpowerworldonline.com/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'United States',
    extraTags:       ['solar-power', 'solar', 'renewable-energy', 'climate'],
    language:        'en',
  },
  {
    id:              'pv-magazine',
    name:            'pv magazine',
    feedUrl:         'https://www.pv-magazine.com/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'DE',
    defaultLat:      52.52,
    defaultLng:      13.40,
    defaultLocation: 'Berlin, Germany',
    extraTags:       ['pv-magazine', 'solar', 'photovoltaic', 'renewable-energy', 'climate'],
    language:        'en',
  },
  // ── Tier 5 — Scientific Journals & Research ───────────────────────────────
  {
    id:              'new-scientist',
    name:            'New Scientist',
    feedUrl:         'https://www.newscientist.com/feed/home/',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['new-scientist', 'science', 'research', 'technology'],
    language:        'en',
  },
  {
    id:              'phys-org',
    name:            'Phys.org',
    feedUrl:         'https://phys.org/rss-feed/',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'United States',
    extraTags:       ['phys-org', 'science', 'physics', 'research', 'technology'],
    language:        'en',
  },
  {
    id:              'science-daily',
    name:            'ScienceDaily',
    feedUrl:         'https://www.sciencedaily.com/rss/top.xml',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'United States',
    extraTags:       ['sciencedaily', 'science', 'research', 'health'],
    language:        'en',
  },
  {
    id:              'mit-tech-review',
    name:            'MIT Technology Review',
    feedUrl:         'https://www.technologyreview.com/topnews.rss',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'US',
    defaultLat:      42.36,
    defaultLng:      -71.10,
    defaultLocation: 'Cambridge, United States',
    extraTags:       ['mit-tech-review', 'technology', 'ai', 'innovation', 'science'],
    language:        'en',
  },
  // ── Tier 5 — Defense & Security Specialist Blogs ─────────────────────────
  {
    id:              'war-on-the-rocks',
    name:            'War on the Rocks',
    feedUrl:         'https://warontherocks.com/feed/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['war-on-the-rocks', 'defense', 'security', 'strategy', 'military'],
    language:        'en',
  },
  {
    id:              'bellingcat',
    name:            'Bellingcat',
    feedUrl:         'https://www.bellingcat.com/feed/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'NL',
    defaultLat:      52.37,
    defaultLng:      4.90,
    defaultLocation: 'Amsterdam, Netherlands',
    extraTags:       ['bellingcat', 'osint', 'investigations', 'security', 'disinformation'],
    language:        'en',
  },
  {
    id:              'breaking-defense',
    name:            'Breaking Defense',
    feedUrl:         'https://breakingdefense.com/feed/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['breaking-defense', 'defense', 'military', 'pentagon', 'nato'],
    language:        'en',
  },
  {
    id:              'just-security',
    name:            'Just Security',
    feedUrl:         'https://www.justsecurity.org/feed/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['just-security', 'national-security', 'law', 'human-rights', 'policy'],
    language:        'en',
  },
  // ── Tier 5 — Additional Global Coverage ──────────────────────────────────
  {
    id:              'balkan-insight',
    name:            'Balkan Insight (BIRN)',
    feedUrl:         'https://balkaninsight.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'RS',
    defaultLat:      44.82,
    defaultLng:      20.46,
    defaultLocation: 'Belgrade, Serbia',
    extraTags:       ['balkan-insight', 'birn', 'balkans', 'eastern-europe', 'investigative'],
    language:        'en',
  },
  {
    id:              'occrp-news',
    name:            'OCCRP — Organized Crime and Corruption',
    feedUrl:         'https://www.occrp.org/en/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'NL',
    defaultLat:      52.37,
    defaultLng:      4.90,
    defaultLocation: 'Amsterdam, Netherlands',
    extraTags:       ['occrp', 'corruption', 'organized-crime', 'investigative', 'global'],
    language:        'en',
  },
  {
    id:              'irrawaddy',
    name:            'The Irrawaddy (Myanmar)',
    feedUrl:         'https://www.irrawaddy.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'MM',
    defaultLat:      16.80,
    defaultLng:      96.15,
    defaultLocation: 'Yangon, Myanmar',
    extraTags:       ['irrawaddy', 'myanmar', 'southeast-asia', 'independent-media'],
    language:        'en',
  },
  {
    id:              'the-diplomat',
    name:            'The Diplomat',
    feedUrl:         'https://thediplomat.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'JP',
    defaultLat:      35.69,
    defaultLng:      139.69,
    defaultLocation: 'Tokyo, Japan / Asia-Pacific',
    extraTags:       ['the-diplomat', 'asia-pacific', 'geopolitics', 'analysis'],
    language:        'en',
  },
  {
    id:              'eurasia-review',
    name:            'Eurasia Review',
    feedUrl:         'https://www.eurasiareview.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'US',
    defaultLat:      54.52,
    defaultLng:      45.00,
    defaultLocation: 'Eurasia',
    extraTags:       ['eurasia-review', 'eurasia', 'central-asia', 'geopolitics', 'analysis'],
    language:        'en',
  },
  // ── Maritime Intelligence ────────────────────────────────────────────────────
  // Core maritime industry sources for shipping, ports, chokepoints, piracy, naval
  {
    id:              'maritime-executive',
    name:            'The Maritime Executive',
    feedUrl:         'https://maritime-executive.com/articles.rss',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      33.74,
    defaultLng:      -118.28,
    defaultLocation: 'Fort Lauderdale, United States',
    extraTags:       ['maritime', 'shipping', 'naval', 'ports', 'trade', 'undersea-cables'],
    language:        'en',
  },
  {
    id:              'gcaptain',
    name:            'gCaptain',
    feedUrl:         'https://gcaptain.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'San Francisco, United States',
    extraTags:       ['maritime', 'shipping', 'naval', 'piracy', 'ports', 'chokepoints', 'offshore'],
    language:        'en',
  },
  {
    id:              'splash247',
    name:            'Splash247',
    feedUrl:         'https://splash247.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'SG',
    defaultLat:      1.29,
    defaultLng:      103.85,
    defaultLocation: 'Singapore',
    extraTags:       ['maritime', 'shipping', 'tanker', 'bulk', 'container', 'ports', 'trade'],
    language:        'en',
  },
  {
    id:              'seatrade-maritime',
    name:            'Seatrade Maritime News',
    feedUrl:         'https://www.seatrade-maritime.com/rss.xml',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.11,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['maritime', 'shipping', 'cruise', 'ports', 'offshore', 'regulations'],
    language:        'en',
  },
  // ── Maritime: Piracy & Security ────────────────────────────────────────────
  // ── Maritime: Naval & Defense ──────────────────────────────────────────────
  {
    id:              'usni-news',
    name:            'USNI News',
    feedUrl:         'https://news.usni.org/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'US',
    defaultLat:      38.98,
    defaultLng:      -76.49,
    defaultLocation: 'Annapolis, United States',
    extraTags:       ['maritime', 'naval', 'usn', 'defense', 'carrier-strike-groups', 'pacific', 'military'],
    language:        'en',
  },
  // ── Maritime: Port & Chokepoint Intelligence ───────────────────────────────
  {
    id:              'loadstar',
    name:            'The Loadstar',
    feedUrl:         'https://theloadstar.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.11,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['maritime', 'shipping', 'logistics', 'freight', 'supply-chain', 'container', 'ports'],
    language:        'en',
  },
  {
    id:              'freightwaves',
    name:            'FreightWaves',
    feedUrl:         'https://www.freightwaves.com/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'US',
    defaultLat:      35.96,
    defaultLng:      -83.92,
    defaultLocation: 'Chattanooga, United States',
    extraTags:       ['maritime', 'freight', 'logistics', 'trucking', 'supply-chain', 'shipping', 'trade'],
    language:        'en',
  },
  // ── Maritime: Sanctions & Compliance ───────────────────────────────────────
  {
    id:              'windward-intelligence',
    name:            'Windward Maritime AI',
    feedUrl:         'https://windward.ai/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'IL',
    defaultLat:      32.07,
    defaultLng:      34.78,
    defaultLocation: 'Tel Aviv, Israel',
    extraTags:       ['maritime', 'sanctions', 'dark-shipping', 'ais', 'compliance', 'deceptive-shipping'],
    language:        'en',
  },

  // ── Tier 6 — Diversity expansion: health, conflict, elections, technology, disaster ──
  // Added to address category imbalance (Apr 23 quality audit)
  {
    id:              'stat-news',
    name:            'STAT News',
    feedUrl:         'https://www.statnews.com/feed/',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      42.36,
    defaultLng:      -71.06,
    defaultLocation: 'Boston, United States',
    extraTags:       ['stat', 'health', 'medicine', 'pharma', 'biotech'],
    language:        'en',
  },
  {
    id:              'the-lancet',
    name:            'The Lancet',
    feedUrl:         'https://www.thelancet.com/rssfeed/lancet_online.xml',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.13,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['lancet', 'medical-research', 'health', 'peer-reviewed'],
    language:        'en',
  },
  {
    id:              'crisis-group',
    name:            'International Crisis Group',
    feedUrl:         'https://www.crisisgroup.org/rss.xml',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'BE',
    defaultLat:      50.85,
    defaultLng:      4.35,
    defaultLocation: 'Brussels, Belgium',
    extraTags:       ['crisis-group', 'conflict', 'peacebuilding', 'analysis'],
    language:        'en',
  },
  {
    id:              'gdacs',
    name:            'GDACS Alerts',
    feedUrl:         'https://www.gdacs.org/xml/rss.xml',
    category:        'disaster',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'IT',
    defaultLat:      45.81,
    defaultLng:      8.63,
    defaultLocation: 'Ispra, Italy',
    extraTags:       ['gdacs', 'disaster', 'earthquake', 'flood', 'cyclone', 'institutional'],
    language:        'en',
  },
  {
    id:              'techcrunch',
    name:            'TechCrunch',
    feedUrl:         'https://techcrunch.com/feed/',
    category:        'technology',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'San Francisco, United States',
    extraTags:       ['techcrunch', 'technology', 'startups', 'ai', 'cyber'],
    language:        'en',
  },
  {
    id:              'ars-technica',
    name:            'Ars Technica',
    feedUrl:         'https://feeds.arstechnica.com/arstechnica/index',
    category:        'technology',
    biasLabel:       'center-left',
    reliability:     0.85,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'San Francisco, United States',
    extraTags:       ['ars-technica', 'technology', 'science', 'cyber', 'ai'],
    language:        'en',
  },
  {
    id:              'wired',
    name:            'WIRED',
    feedUrl:         'https://www.wired.com/feed/rss',
    category:        'technology',
    biasLabel:       'center-left',
    reliability:     0.83,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'San Francisco, United States',
    extraTags:       ['wired', 'technology', 'cyber', 'ai', 'innovation'],
    language:        'en',
  },
  {
    id:              'the-record-cyber',
    name:            'The Record by Recorded Future',
    feedUrl:         'https://therecord.media/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington, United States',
    extraTags:       ['recorded-future', 'cyber', 'security', 'threat-intel', 'ransomware'],
    language:        'en',
  },
  {
    id:              'dark-reading',
    name:            'Dark Reading',
    feedUrl:         'https://www.darkreading.com/rss.xml',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      37.77,
    defaultLng:      -122.42,
    defaultLocation: 'San Francisco, United States',
    extraTags:       ['dark-reading', 'cyber', 'security', 'vulnerabilities', 'threat-intel'],
    language:        'en',
  },
  {
    id:              'cdc-outbreaks',
    name:            'CDC Outbreak Updates',
    feedUrl:         'https://tools.cdc.gov/podcasts/feed.asp?feedid=183',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.94,
    countryCode:     'US',
    defaultLat:      33.80,
    defaultLng:      -84.32,
    defaultLocation: 'Atlanta, United States',
    extraTags:       ['cdc', 'health', 'outbreak', 'epidemic', 'institutional'],
    language:        'en',
  },

  // ── Tier 7 — Wire syndication outlets (corroboration strategy) ────────
  // These outlets heavily republish AP/Reuters/AFP wire stories with near-
  // identical headlines. When the correlator sees "Iran nuclear talks stall"
  // from AP, ABC, CBS, and Yahoo within an hour, it clusters them into a
  // corroborated multi-source signal instead of 4 single-source signals.
  {
    id:              'abc-news',
    name:            'ABC News',
    feedUrl:         'https://abcnews.go.com/abcnews/internationalheadlines',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'US',
    defaultLat:      40.77,
    defaultLng:      -73.98,
    defaultLocation: 'New York, United States',
    extraTags:       ['abc-news', 'wire-syndication', 'ap-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'cbs-news',
    name:            'CBS News',
    feedUrl:         'https://www.cbsnews.com/latest/rss/world',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      40.76,
    defaultLng:      -73.97,
    defaultLocation: 'New York, United States',
    extraTags:       ['cbs-news', 'wire-syndication', 'ap-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'nbc-news',
    name:            'NBC News',
    feedUrl:         'https://feeds.nbcnews.com/nbcnews/public/world',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      40.76,
    defaultLng:      -73.97,
    defaultLocation: 'New York, United States',
    extraTags:       ['nbc-news', 'wire-syndication', 'ap-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'yahoo-news-world',
    name:            'Yahoo News — Top Stories',
    feedUrl:         'https://news.yahoo.com/rss',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      37.40,
    defaultLng:      -122.08,
    defaultLocation: 'Sunnyvale, United States',
    extraTags:       ['yahoo-news', 'wire-syndication', 'ap-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'fox-news-world',
    name:            'Fox News World',
    feedUrl:         'https://moxie.foxnews.com/google-publisher/world.xml',
    category:        'breaking',
    biasLabel:       'center-right',
    reliability:     0.75,
    countryCode:     'US',
    defaultLat:      40.76,
    defaultLng:      -73.98,
    defaultLocation: 'New York, United States',
    extraTags:       ['fox-news', 'wire-syndication', 'ap-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'sky-news-world',
    name:            'Sky News World',
    feedUrl:         'https://feeds.skynews.com/feeds/rss/world.xml',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.18,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['sky-news', 'wire-syndication', 'reuters-afp', 'breaking'],
    language:        'en',
  },
  {
    id:              'independent-world',
    name:            'The Independent World',
    feedUrl:         'https://www.independent.co.uk/news/world/rss',
    category:        'breaking',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.11,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['independent', 'wire-syndication', 'pa-reuters', 'breaking'],
    language:        'en',
  },
  {
    id:              'abc-au-world',
    name:            'ABC Australia World',
    feedUrl:         'https://www.abc.net.au/news/feed/51120/rss.xml',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'AU',
    defaultLat:      -33.87,
    defaultLng:      151.21,
    defaultLocation: 'Sydney, Australia',
    extraTags:       ['abc-australia', 'wire-syndication', 'ap-reuters-afp', 'breaking'],
    language:        'en',
  },
  // ── Added Oct 14, 2026 (Devon: replace broken sources and keep adding) ──
  // Each checked that day: answers with fresh English items. Replacing the 20
  // feeds removed above (and 9 dead database feeds) and widening coverage:
  // wires after AP closed its feeds, Switzerland, Türkiye, Egypt, the Gulf,
  // Kenya, the Caucasus, Central Asia, Ukraine, Thailand, Latin America,
  // defense, maritime and energy.
  // Wires and national news agencies
  {
    id:              'upi-top',
    name:            'UPI — Top News',
    feedUrl:         'https://rss.upi.com/news/top_news.rss',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['upi', 'wire', 'us-media'],
    language:        'en',
  },
  {
    id:              'ansa-en',
    name:            'ANSA English',
    feedUrl:         'https://www.ansa.it/english/news/english_nr_rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'IT',
    defaultLat:      41.90,
    defaultLng:      12.50,
    defaultLocation: 'Rome, Italy',
    extraTags:       ['ansa', 'wire', 'italy', 'europe'],
    language:        'en',
  },
  {
    id:              'yonhap-en',
    name:            'Yonhap News Agency',
    feedUrl:         'https://en.yna.co.kr/RSS/national.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'KR',
    defaultLat:      37.57,
    defaultLng:      126.98,
    defaultLocation: 'Seoul, South Korea',
    extraTags:       ['yonhap', 'wire', 'south-korea', 'asia-pacific'],
    language:        'en',
  },
  {
    id:              'yonhap-nk',
    name:            'Yonhap News Agency — North Korea',
    feedUrl:         'https://en.yna.co.kr/RSS/nk.xml',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'KR',
    defaultLat:      37.57,
    defaultLng:      126.98,
    defaultLocation: 'Seoul, South Korea',
    extraTags:       ['yonhap', 'wire', 'north-korea', 'korean-peninsula', 'asia-pacific'],
    language:        'en',
  },
  {
    id:              'antara-en',
    name:            'Antara News (English)',
    feedUrl:         'https://en.antaranews.com/rss/news.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'ID',
    defaultLat:      -6.21,
    defaultLng:      106.85,
    defaultLocation: 'Jakarta, Indonesia',
    extraTags:       ['antara', 'wire', 'indonesia', 'asia-pacific', 'state-media'],
    language:        'en',
  },
  {
    id:              'cgtn-world',
    name:            'CGTN — World',
    feedUrl:         'https://www.cgtn.com/subscribe/rss/section/world.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'CN',
    defaultLat:      39.91,
    defaultLng:      116.39,
    defaultLocation: 'Beijing, China',
    extraTags:       ['cgtn', 'china', 'state-media', 'ccp-affiliated'],
    language:        'en',
  },
  // US and international papers of record
  {
    id:              'nyt-world',
    name:            'The New York Times — World',
    feedUrl:         'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.90,
    countryCode:     'US',
    defaultLat:      40.76,
    defaultLng:      -73.99,
    defaultLocation: 'New York, United States',
    extraTags:       ['nyt', 'us-media'],
    language:        'en',
  },
  {
    id:              'nyt-business',
    name:            'The New York Times — Business',
    feedUrl:         'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
    category:        'economy',
    biasLabel:       'center-left',
    reliability:     0.90,
    countryCode:     'US',
    defaultLat:      40.76,
    defaultLng:      -73.99,
    defaultLocation: 'New York, United States',
    extraTags:       ['nyt', 'us-media', 'business'],
    language:        'en',
  },
  {
    id:              'wsj-world',
    name:            'Wall Street Journal — World',
    feedUrl:         'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['wsj', 'wall-street-journal', 'us-media'],
    language:        'en',
  },
  {
    id:              'pbs-world',
    name:            'PBS NewsHour — World',
    feedUrl:         'https://www.pbs.org/newshour/feeds/rss/world',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.89,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['pbs', 'us-media', 'public-media'],
    language:        'en',
  },
  {
    id:              'csmonitor-world',
    name:            'The Christian Science Monitor — World',
    feedUrl:         'https://rss.csmonitor.com/feeds/world',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      42.34,
    defaultLng:      -71.09,
    defaultLocation: 'Boston, United States',
    extraTags:       ['csmonitor', 'us-media'],
    language:        'en',
  },
  {
    id:              'fortune',
    name:            'Fortune',
    feedUrl:         'https://fortune.com/feed/fortune-feeds/?id=3230629',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['fortune', 'business', 'markets'],
    language:        'en',
  },
  // Regional outlets
  {
    id:              'japan-today',
    name:            'Japan Today',
    feedUrl:         'https://japantoday.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'JP',
    defaultLat:      35.68,
    defaultLng:      139.69,
    defaultLocation: 'Tokyo, Japan',
    extraTags:       ['japan', 'asia-pacific'],
    language:        'en',
  },
  {
    id:              'thelocal-ch',
    name:            'The Local Switzerland',
    feedUrl:         'https://feeds.thelocal.com/rss/ch',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'CH',
    defaultLat:      46.95,
    defaultLng:      7.45,
    defaultLocation: 'Bern, Switzerland',
    extraTags:       ['switzerland', 'europe'],
    language:        'en',
  },
  {
    id:              'hurriyet-dn',
    name:            'Hürriyet Daily News',
    feedUrl:         'https://www.hurriyetdailynews.com/rss/news',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.72,
    countryCode:     'TR',
    defaultLat:      41.01,
    defaultLng:      28.98,
    defaultLocation: 'Istanbul, Türkiye',
    extraTags:       ['turkey', 'middle-east', 'europe'],
    language:        'en',
  },
  {
    id:              'egypt-independent',
    name:            'Egypt Independent',
    feedUrl:         'https://www.egyptindependent.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'EG',
    defaultLat:      30.04,
    defaultLng:      31.24,
    defaultLocation: 'Cairo, Egypt',
    extraTags:       ['egypt', 'middle-east', 'africa'],
    language:        'en',
  },
  {
    id:              'mada-masr',
    name:            'Mada Masr (English)',
    feedUrl:         'https://www.madamasr.com/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'EG',
    defaultLat:      30.04,
    defaultLng:      31.24,
    defaultLocation: 'Cairo, Egypt',
    extraTags:       ['egypt', 'middle-east', 'independent-media'],
    language:        'en',
  },
  {
    id:              'the-national-uae',
    name:            'The National (UAE)',
    feedUrl:         'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'AE',
    defaultLat:      24.45,
    defaultLng:      54.38,
    defaultLocation: 'Abu Dhabi, United Arab Emirates',
    extraTags:       ['uae', 'gulf', 'middle-east'],
    language:        'en',
  },
  {
    id:              'aawsat-en',
    name:            'Asharq Al-Awsat (English)',
    feedUrl:         'https://english.aawsat.com/feed',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.74,
    countryCode:     'SA',
    defaultLat:      51.51,
    defaultLng:      -0.13,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['saudi-arabia', 'gulf', 'middle-east', 'pan-arab'],
    language:        'en',
  },
  {
    id:              'standard-ke',
    name:            'The Standard (Kenya)',
    feedUrl:         'https://www.standardmedia.co.ke/rss/headlines.php',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'KE',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['kenya', 'east-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'capitalfm-ke',
    name:            'Capital FM News (Kenya)',
    feedUrl:         'https://www.capitalfm.co.ke/news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'KE',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['kenya', 'east-africa', 'africa'],
    language:        'en',
  },
  {
    id:              'civil-ge',
    name:            'Civil.ge',
    feedUrl:         'https://civil.ge/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'GE',
    defaultLat:      41.72,
    defaultLng:      44.79,
    defaultLocation: 'Tbilisi, Georgia',
    extraTags:       ['georgia', 'caucasus', 'europe'],
    language:        'en',
  },
  {
    id:              'oc-media',
    name:            'OC Media',
    feedUrl:         'https://oc-media.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'GE',
    defaultLat:      41.72,
    defaultLng:      44.79,
    defaultLocation: 'Tbilisi, Georgia',
    extraTags:       ['caucasus', 'armenia', 'azerbaijan', 'georgia'],
    language:        'en',
  },
  {
    id:              'eurasianet',
    name:            'Eurasianet',
    feedUrl:         'https://eurasianet.org/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'US',
    defaultLat:      40.73,
    defaultLng:      -73.99,
    defaultLocation: 'New York, United States',
    extraTags:       ['central-asia', 'caucasus', 'eurasia'],
    language:        'en',
  },
  {
    id:              'ukrainska-pravda',
    name:            'Ukrainska Pravda (English)',
    feedUrl:         'https://www.pravda.com.ua/eng/rss/',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'UA',
    defaultLat:      50.45,
    defaultLng:      30.52,
    defaultLocation: 'Kyiv, Ukraine',
    extraTags:       ['ukraine', 'ukraine-war', 'europe'],
    language:        'en',
  },
  {
    id:              'khaosod-en',
    name:            'Khaosod English',
    feedUrl:         'https://www.khaosodenglish.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'TH',
    defaultLat:      13.76,
    defaultLng:      100.50,
    defaultLocation: 'Bangkok, Thailand',
    extraTags:       ['thailand', 'southeast-asia'],
    language:        'en',
  },
  {
    id:              'mercopress',
    name:            'MercoPress',
    feedUrl:         'https://en.mercopress.com/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'UY',
    defaultLat:      -34.90,
    defaultLng:      -56.19,
    defaultLocation: 'Montevideo, Uruguay',
    extraTags:       ['south-america', 'latin-america', 'south-atlantic'],
    language:        'en',
  },
  {
    id:              'mexico-news-daily',
    name:            'Mexico News Daily',
    feedUrl:         'https://mexiconewsdaily.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'MX',
    defaultLat:      19.43,
    defaultLng:      -99.13,
    defaultLocation: 'Mexico City, Mexico',
    extraTags:       ['mexico', 'latin-america'],
    language:        'en',
  },
  {
    id:              'ba-times',
    name:            'Buenos Aires Times',
    feedUrl:         'https://www.batimes.com.ar/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'AR',
    defaultLat:      -34.60,
    defaultLng:      -58.38,
    defaultLocation: 'Buenos Aires, Argentina',
    extraTags:       ['argentina', 'latin-america'],
    language:        'en',
  },
  // Defense, maritime and energy
  {
    id:              'defense-news',
    name:            'Defense News',
    feedUrl:         'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'US',
    defaultLat:      38.88,
    defaultLng:      -77.10,
    defaultLocation: 'Arlington, United States',
    extraTags:       ['defense', 'military', 'security'],
    language:        'en',
  },
  {
    id:              'the-war-zone',
    name:            'The War Zone',
    feedUrl:         'https://www.twz.com/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['defense', 'military', 'weapons'],
    language:        'en',
  },
  {
    id:              'defense-one',
    name:            'Defense One',
    feedUrl:         'https://www.defenseone.com/rss/all/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['defense', 'military', 'security', 'policy'],
    language:        'en',
  },
  {
    id:              'marinelink',
    name:            'MarineLink',
    feedUrl:         'https://www.marinelink.com/news/rss',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['maritime', 'shipping', 'offshore'],
    language:        'en',
  },
  {
    id:              'offshore-energy',
    name:            'Offshore Energy',
    feedUrl:         'https://www.offshore-energy.biz/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'NL',
    defaultLat:      51.92,
    defaultLng:      4.48,
    defaultLocation: 'Rotterdam, Netherlands',
    extraTags:       ['maritime', 'energy', 'offshore', 'lng'],
    language:        'en',
  },
  {
    id:              'energy-monitor',
    name:            'Energy Monitor',
    feedUrl:         'https://www.energymonitor.ai/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.13,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['energy', 'renewables', 'energy-transition'],
    language:        'en',
  },
  // ── Added Oct 14, 2026, 2 PM (plan Q5: replace what fails, keep adding) ──
  // Each checked that day: answers with fresh English items. Arab News, Bangkok
  // Post, The Africa Report and The Reporter (Ethiopia) answer from elsewhere but
  // turned away every poll from our server, so they were taken out.
  // Gulf, Thailand, Ethiopia and India: in place of feeds that block the server
  {
    id:              'gulf-news',
    name:            'Gulf News',
    feedUrl:         'https://gulfnews.com/stories.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'AE',
    defaultLat:      25.20,
    defaultLng:      55.27,
    defaultLocation: 'Dubai, United Arab Emirates',
    extraTags:       ['uae', 'gulf', 'middle-east'],
    language:        'en',
  },
  {
    id:              'saudi-gazette',
    name:            'Saudi Gazette',
    feedUrl:         'https://saudigazette.com.sa/rssFeed/74',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.68,
    countryCode:     'SA',
    defaultLat:      21.49,
    defaultLng:      39.19,
    defaultLocation: 'Jeddah, Saudi Arabia',
    extraTags:       ['saudi-arabia', 'gulf', 'middle-east'],
    language:        'en',
  },
  {
    id:              'fana-en',
    name:            'Fana Broadcasting (English)',
    feedUrl:         'https://www.fanamc.com/english/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'ET',
    defaultLat:      9.03,
    defaultLng:      38.74,
    defaultLocation: 'Addis Ababa, Ethiopia',
    extraTags:       ['ethiopia', 'east-africa', 'africa', 'state-media'],
    language:        'en',
  },
  {
    id:              'scroll-in',
    name:            'Scroll.in',
    feedUrl:         'https://feeds.feedburner.com/ScrollinArticles.rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'IN',
    defaultLat:      28.61,
    defaultLng:      77.21,
    defaultLocation: 'New Delhi, India',
    extraTags:       ['india', 'south-asia', 'independent-media'],
    language:        'en',
  },
  // Planned in 2026 but never added (the database migrations do not run on deploy)
  {
    id:              'foreign-policy',
    name:            'Foreign Policy',
    feedUrl:         'https://foreignpolicy.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['foreign-policy', 'analysis', 'us-media'],
    language:        'en',
  },
  {
    id:              'meduza-en',
    name:            'Meduza (English)',
    feedUrl:         'https://meduza.io/rss/en/all',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'RU',
    defaultLat:      55.76,
    defaultLng:      37.62,
    defaultLocation: 'Moscow, Russia',
    extraTags:       ['russia', 'independent-media', 'exile-media'],
    language:        'en',
  },
  {
    id:              'rest-of-world',
    name:            'Rest of World',
    feedUrl:         'https://restofworld.org/feed/latest/',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['technology', 'global-south'],
    language:        'en',
  },
  {
    id:              'sciencealert',
    name:            'ScienceAlert',
    feedUrl:         'https://www.sciencealert.com/feed',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'AU',
    defaultLat:      -37.81,
    defaultLng:      144.96,
    defaultLocation: 'Melbourne, Australia',
    extraTags:       ['science', 'research'],
    language:        'en',
  },
  {
    id:              'the-register',
    name:            'The Register',
    feedUrl:         'https://www.theregister.com/headlines.atom',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.13,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['technology', 'cybersecurity', 'it-industry'],
    language:        'en',
  },
  {
    id:              'folha-en',
    name:            'Folha de S.Paulo (English)',
    feedUrl:         'https://feeds.folha.uol.com.br/internacional/en/rss091.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'BR',
    defaultLat:      -23.55,
    defaultLng:      -46.63,
    defaultLocation: 'São Paulo, Brazil',
    extraTags:       ['folha', 'brazil', 'latin-america'],
    language:        'en',
  },
  // ── Added Oct 17, 2026 (Devon: look into the failing sources) ──────────────
  // Canada had no working outlet: CBC's network turns away every client that
  // isn't a web browser, so its feed never answered our server (the database
  // source cbc-news is retired, pipeline/repairs.ts). Three Canadian outlets
  // that answered a feed reader with fresh items that day; two of them reporting
  // one Canadian story also lets it reach "2+ outlets".
  {
    id:              'globe-and-mail-ca',
    name:            'The Globe and Mail (Canada)',
    feedUrl:         'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'CA',
    defaultLat:      43.65,
    defaultLng:      -79.38,
    defaultLocation: 'Toronto, Canada',
    extraTags:       ['globe-and-mail', 'canada', 'north-america'],
    language:        'en',
  },
  {
    id:              'global-news-ca',
    name:            'Global News',
    feedUrl:         'https://globalnews.ca/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'CA',
    defaultLat:      43.65,
    defaultLng:      -79.38,
    defaultLocation: 'Toronto, Canada',
    extraTags:       ['global-news', 'canada', 'north-america'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (R2: official sources and thin regions) ────────────
  // Each answered the server's own request (WorldPulse User-Agent and headers)
  // with fresh items that day. Official: the UN's meeting record, the European
  // Commission, the UK foreign ministry, the Bank of England, the ICC, the ICRC.
  // Regions with no outlet before: Sudan and South Sudan, the Sahel (Mali),
  // Central America. Central Asia had only Eurasianet and RFE/RL.
  {
    id:              'un-press',
    name:            'UN Meetings Coverage and Press Releases',
    feedUrl:         'https://press.un.org/en/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.92,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, United Nations',
    extraTags:       ['un', 'united-nations', 'security-council', 'general-assembly', 'institutional'],
    language:        'en',
  },
  {
    id:              'ec-press-corner',
    name:            'European Commission Press Corner',
    feedUrl:         'https://ec.europa.eu/commission/presscorner/api/rss?language=en',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.92,
    countryCode:     'BE',
    defaultLat:      50.84,
    defaultLng:      4.38,
    defaultLocation: 'Brussels, Belgium',
    extraTags:       ['european-commission', 'eu', 'europe', 'institutional'],
    language:        'en',
  },
  {
    id:              'uk-fcdo',
    name:            'UK Foreign, Commonwealth & Development Office',
    feedUrl:         'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.13,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['fcdo', 'uk-government', 'foreign-ministry', 'diplomacy', 'institutional'],
    language:        'en',
  },
  {
    id:              'boe-news',
    name:            'Bank of England News',
    feedUrl:         'https://www.bankofengland.co.uk/rss/news',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.09,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['boe', 'bank-of-england', 'central-bank', 'monetary-policy', 'finance'],
    language:        'en',
  },
  {
    id:              'icc-news',
    name:            'International Criminal Court',
    feedUrl:         'https://www.icc-cpi.int/rss/news/all',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'NL',
    defaultLat:      52.11,
    defaultLng:      4.32,
    defaultLocation: 'The Hague, Netherlands',
    extraTags:       ['icc', 'international-court', 'war-crimes', 'justice', 'institutional'],
    language:        'en',
  },
  {
    id:              'icrc-news',
    name:            'International Committee of the Red Cross',
    feedUrl:         'https://www.icrc.org/en/rss/news',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.14,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['icrc', 'red-cross', 'humanitarian', 'institutional'],
    language:        'en',
  },
  {
    id:              'studio-tamani',
    name:            'Studio Tamani (Mali)',
    feedUrl:         'https://www.studiotamani.org/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'ML',
    defaultLat:      12.64,
    defaultLng:      -8.00,
    defaultLocation: 'Bamako, Mali',
    extraTags:       ['mali', 'sahel', 'west-africa', 'africa', 'independent-media'],
    language:        'fr',
  },
  {
    id:              'times-central-asia',
    name:            'The Times of Central Asia',
    feedUrl:         'https://timesca.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['central-asia', 'eurasia', 'independent-media'],
    language:        'en',
  },
  {
    id:              'tico-times',
    name:            'The Tico Times (Costa Rica)',
    feedUrl:         'https://ticotimes.net/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'CR',
    defaultLat:      9.93,
    defaultLng:      -84.08,
    defaultLocation: 'San José, Costa Rica',
    extraTags:       ['costa-rica', 'central-america', 'latin-america'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (R2b: thin regions, second batch) ─────────────────
  // Each answered the server's own request (WorldPulse User-Agent and headers)
  // with fresh items that day. Regions with no outlet before: Iraq,
  // Afghanistan, Sri Lanka, Haiti, Papua New Guinea, Vanuatu. Sudan had only
  // Radio Tamazuj (from the south) and the Caucasus three outlets. Security
  // Council Report previews the Council's meetings and votes.
  {
    id:              'radio-dabanga',
    name:            'Radio Dabanga (Sudan)',
    feedUrl:         'https://www.dabangasudan.org/en/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'SD',
    defaultLat:      15.50,
    defaultLng:      32.56,
    defaultLocation: 'Khartoum, Sudan',
    extraTags:       ['sudan', 'darfur', 'east-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // independent news site on South Sudan and Sudan (Juba), about 9 items a day; robots.txt allows all;
  // its terms ask for approval before its content is redistributed for commercial
  // purposes: like every feed here, only the headline, the feed's own text (600
  // characters at most) and the link are kept (Oct 21, 2026, Q5 round 6: Eye
  // Radio and Radio Tamazuj failed every poll from the server)
  {
    id:              'sudans-post',
    name:            'Sudans Post',
    feedUrl:         'https://sudanspost.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'SS',
    defaultLat:      4.85,
    defaultLng:      31.58,
    defaultLocation: 'Juba, South Sudan',
    extraTags:       ['south-sudan', 'sudan', 'east-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  {
    id:              'jamnews',
    name:            'JAMnews (South Caucasus)',
    feedUrl:         'https://jam-news.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'GE',
    defaultLat:      41.72,
    defaultLng:      44.79,
    defaultLocation: 'Tbilisi, Georgia',
    extraTags:       ['caucasus', 'georgia', 'armenia', 'azerbaijan', 'independent-media'],
    language:        'en',
  },
  {
    id:              'post-courier-pg',
    name:            'Post-Courier (Papua New Guinea)',
    feedUrl:         'https://www.postcourier.com.pg/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'PG',
    defaultLat:      -9.44,
    defaultLng:      147.18,
    defaultLocation: 'Port Moresby, Papua New Guinea',
    extraTags:       ['papua-new-guinea', 'pacific', 'pacific-islands', 'oceania'],
    language:        'en',
  },
  {
    id:              'vanuatu-daily-post',
    name:            'Vanuatu Daily Post',
    feedUrl:         'https://www.dailypost.vu/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'VU',
    defaultLat:      -17.73,
    defaultLng:      168.32,
    defaultLocation: 'Port Vila, Vanuatu',
    extraTags:       ['vanuatu', 'pacific', 'pacific-islands', 'oceania'],
    language:        'en',
  },
  {
    id:              'scr-whats-in-blue',
    name:            'Security Council Report — What’s in Blue',
    feedUrl:         'https://www.securitycouncilreport.org/whatsinblue/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.98,
    defaultLocation: 'New York, United States',
    extraTags:       ['un', 'united-nations', 'security-council', 'diplomacy', 'analysis'],
    language:        'en',
    parked:          'bot check page (HTTP 403), Nov 5, 2026',
  },
  {
    id:              'economynext-lk',
    name:            'EconomyNext (Sri Lanka)',
    feedUrl:         'https://economynext.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'LK',
    defaultLat:      6.93,
    defaultLng:      79.86,
    defaultLocation: 'Colombo, Sri Lanka',
    extraTags:       ['sri-lanka', 'south-asia', 'business', 'markets'],
    language:        'en',
  },
  {
    id:              'amu-tv',
    name:            'Amu TV (Afghanistan)',
    feedUrl:         'https://amu.tv/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'AF',
    defaultLat:      34.56,
    defaultLng:      69.21,
    defaultLocation: 'Kabul, Afghanistan',
    extraTags:       ['afghanistan', 'south-asia', 'independent-media', 'exile-media'],
    language:        'en',
  },
  {
    id:              'haitian-times',
    name:            'The Haitian Times',
    feedUrl:         'https://haitiantimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'HT',
    defaultLat:      18.54,
    defaultLng:      -72.34,
    defaultLocation: 'Port-au-Prince, Haiti',
    extraTags:       ['haiti', 'caribbean', 'latin-america', 'diaspora'],
    language:        'en',
  },
  {
    id:              'shafaq-iraq',
    name:            'Shafaq News (Iraq)',
    feedUrl:         'https://shafaq.com/rss/en/Iraq',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'IQ',
    defaultLat:      33.32,
    defaultLng:      44.37,
    defaultLocation: 'Baghdad, Iraq',
    extraTags:       ['iraq', 'kurdistan', 'middle-east'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (R2a) ─────────────────────────────────────────────
  // The Council of the EU's press releases: sanctions listings, Council
  // decisions and conclusions, first-hand. Its dates are in <a10:updated>
  // (parseFeedItems), and its media advisories and accreditation notices
  // are left out (isPressNotice). Answered the server's own request with 20
  // items that day.
  {
    id:              'eu-council',
    name:            'Council of the EU',
    feedUrl:         'https://www.consilium.europa.eu/en/rss/pressreleases.ashx',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.92,
    countryCode:     'BE',
    defaultLat:      50.84,
    defaultLng:      4.38,
    defaultLocation: 'Brussels, Belgium',
    extraTags:       ['council-of-the-eu', 'eu', 'europe', 'institutional'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (Q5: toward 300 feeds, batch A) ────────────────────
  // 83 English-language outlets, most of them a country's first or second:
  // public broadcasters' English services, national dailies and independent
  // newsrooms in Europe, Africa, the Middle East, Central Asia, Asia, the
  // Pacific and the Caribbean. Each answered the server's own request (its
  // User-Agent and headers) that afternoon with fresh items, every item with a
  // headline, a link and a date. None of their hosts is polled anywhere else.
  // Sites whose terms forbid automated reading or scraping were left out (The
  // Chanzo, Libya Herald, Nepali Times, TheJournal.ie, Cyprus Mail, Atoll
  // Times, The Express Tribune, FBC, Free Malaysia Today, Barbados Today, The
  // Nassau Guardian), as were news aggregators (Club of Mozambique). We keep
  // a story's headline, up to 600 characters of the feed's own text and the link.
  // independent English-language news site run by journalists in Poland
  {
    id:              'notes-from-poland',
    name:            'Notes from Poland',
    feedUrl:         'https://notesfrompoland.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'PL',
    defaultLat:      52.23,
    defaultLng:      21.01,
    defaultLocation: 'Warsaw, Poland',
    extraTags:       ['poland', 'central-europe', 'europe', 'independent-media'],
    language:        'en',
  },
  // English-language news site in Budapest; lighter on politics
  {
    id:              'daily-news-hungary',
    name:            'Daily News Hungary',
    feedUrl:         'https://dailynewshungary.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'HU',
    defaultLat:      47.5,
    defaultLng:      19.04,
    defaultLocation: 'Budapest, Hungary',
    extraTags:       ['hungary', 'central-europe', 'europe'],
    language:        'en',
  },
  // Bulgaria's public radio, English service
  {
    id:              'bnr-en',
    name:            'Bulgarian National Radio (English)',
    feedUrl:         'https://bnrnews.bg/api/rss/en',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'BG',
    defaultLat:      42.7,
    defaultLng:      23.32,
    defaultLocation: 'Sofia, Bulgaria',
    extraTags:       ['bulgaria', 'balkans', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // private English-language news site in Sofia
  {
    id:              'novinite-bg',
    name:            'Novinite (Sofia News Agency)',
    feedUrl:         'https://www.novinite.com/services/news_rdf.php',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BG',
    defaultLat:      42.7,
    defaultLng:      23.32,
    defaultLocation: 'Sofia, Bulgaria',
    extraTags:       ['bulgaria', 'balkans', 'europe'],
    language:        'en',
  },
  // Estonia's public broadcaster, English service
  {
    id:              'err-news',
    name:            'ERR News (Estonia)',
    feedUrl:         'https://news.err.ee/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'EE',
    defaultLat:      59.44,
    defaultLng:      24.75,
    defaultLocation: 'Tallinn, Estonia',
    extraTags:       ['estonia', 'baltics', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // Lithuania's public broadcaster, English service
  {
    id:              'lrt-en',
    name:            'LRT English (Lithuania)',
    feedUrl:         'https://www.lrt.lt/en/news-in-english?rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'LT',
    defaultLat:      54.69,
    defaultLng:      25.28,
    defaultLocation: 'Vilnius, Lithuania',
    extraTags:       ['lithuania', 'baltics', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // small English-language news site; about 5 items a day
  {
    id:              'sarajevo-times',
    name:            'Sarajevo Times',
    feedUrl:         'https://sarajevotimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'BA',
    defaultLat:      43.86,
    defaultLng:      18.41,
    defaultLocation: 'Sarajevo, Bosnia and Herzegovina',
    extraTags:       ['bosnia', 'balkans', 'europe'],
    language:        'en',
  },
  // English-language news site in Oslo
  {
    id:              'newsinenglish-no',
    name:            'Views and News from Norway',
    feedUrl:         'https://www.newsinenglish.no/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'NO',
    defaultLat:      59.91,
    defaultLng:      10.75,
    defaultLocation: 'Oslo, Norway',
    extraTags:       ['norway', 'nordics', 'europe'],
    language:        'en',
  },
  // independent newsroom in Kirkenes covering the Arctic and Russia; regional, so no home pin
  {
    id:              'barents-observer',
    name:            'The Barents Observer',
    feedUrl:         'https://www.thebarentsobserver.com/?lab_viewport=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'NO',
    defaultLat:      59.91,
    defaultLng:      10.75,
    defaultLocation: 'Oslo, Norway',
    extraTags:       ['arctic', 'russia', 'norway', 'nordics', 'independent-media'],
    language:        'en',
  },
  // Nord University's Arctic newsroom in Bodø; regional, so no home pin
  {
    id:              'high-north-news',
    name:            'High North News',
    feedUrl:         'https://en.highnorthnews.com/?lab_viewport=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'NO',
    defaultLat:      59.91,
    defaultLng:      10.75,
    defaultLocation: 'Oslo, Norway',
    extraTags:       ['arctic', 'norway', 'nordics', 'security'],
    language:        'en',
  },
  // Iceland's public broadcaster, English service
  {
    id:              'ruv-en',
    name:            'RÚV English (Iceland)',
    feedUrl:         'https://www.ruv.is/rss/english',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'IS',
    defaultLat:      64.15,
    defaultLng:      -21.94,
    defaultLocation: 'Reykjavik, Iceland',
    extraTags:       ['iceland', 'nordics', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // Ireland's public broadcaster
  {
    id:              'rte-news',
    name:            'RTÉ News',
    feedUrl:         'https://www.rte.ie/feeds/rss/?index=/news/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'IE',
    defaultLat:      53.35,
    defaultLng:      -6.26,
    defaultLocation: 'Dublin, Ireland',
    extraTags:       ['ireland', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // Czech Radio's English service
  {
    id:              'radio-prague-en',
    name:            'Radio Prague International',
    feedUrl:         'https://english.radio.cz/rcz-rss/en',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'CZ',
    defaultLat:      50.08,
    defaultLng:      14.44,
    defaultLocation: 'Prague, Czechia',
    extraTags:       ['czechia', 'central-europe', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // Belgrade-based site on the Western Balkans and the EU; regional, so no home pin
  {
    id:              'european-western-balkans',
    name:            'European Western Balkans',
    feedUrl:         'https://europeanwesternbalkans.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'RS',
    defaultLat:      44.79,
    defaultLng:      20.45,
    defaultLocation: 'Belgrade, Serbia',
    extraTags:       ['balkans', 'eu-enlargement', 'europe', 'analysis'],
    language:        'en',
  },
  // English-language news site in Bucharest
  {
    id:              'romania-insider',
    name:            'Romania Insider',
    feedUrl:         'https://www.romania-insider.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'RO',
    defaultLat:      44.43,
    defaultLng:      26.1,
    defaultLocation: 'Bucharest, Romania',
    extraTags:       ['romania', 'eastern-europe', 'europe'],
    language:        'en',
  },
  // English-language news site in Zagreb
  {
    id:              'croatia-week',
    name:            'Croatia Week',
    feedUrl:         'https://www.croatiaweek.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'HR',
    defaultLat:      45.81,
    defaultLng:      15.98,
    defaultLocation: 'Zagreb, Croatia',
    extraTags:       ['croatia', 'balkans', 'europe'],
    language:        'en',
  },
  // English-language site; much travel and lifestyle
  {
    id:              'total-croatia-news',
    name:            'Total Croatia News',
    feedUrl:         'https://total-croatia-news.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'HR',
    defaultLat:      45.81,
    defaultLng:      15.98,
    defaultLocation: 'Zagreb, Croatia',
    extraTags:       ['croatia', 'balkans', 'europe'],
    language:        'en',
  },
  // Sveriges Radio's English service
  {
    id:              'radio-sweden',
    name:            'Radio Sweden (English)',
    feedUrl:         'https://api.sr.se/api/rss/program/2054',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'SE',
    defaultLat:      59.33,
    defaultLng:      18.07,
    defaultLocation: 'Stockholm, Sweden',
    extraTags:       ['sweden', 'nordics', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // Finland's public broadcaster, English service
  {
    id:              'yle-news',
    name:            'Yle News (Finland)',
    feedUrl:         'https://yle.fi/rss/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'FI',
    defaultLat:      60.17,
    defaultLng:      24.94,
    defaultLocation: 'Helsinki, Finland',
    extraTags:       ['finland', 'nordics', 'europe', 'public-broadcaster'],
    language:        'en',
  },
  // English-language news site in Helsinki
  {
    id:              'helsinki-times',
    name:            'Helsinki Times',
    feedUrl:         'https://www.helsinkitimes.fi/?format=feed&type=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'FI',
    defaultLat:      60.17,
    defaultLng:      24.94,
    defaultLocation: 'Helsinki, Finland',
    extraTags:       ['finland', 'nordics', 'europe'],
    language:        'en',
  },
  // Denmark's English-language newspaper
  {
    id:              'copenhagen-post',
    name:            'The Copenhagen Post',
    feedUrl:         'https://cphpost.dk/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'DK',
    defaultLat:      55.68,
    defaultLng:      12.57,
    defaultLocation: 'Copenhagen, Denmark',
    extraTags:       ['denmark', 'nordics', 'europe'],
    language:        'en',
  },
  // English-language weekly in the Algarve
  {
    id:              'portugal-resident',
    name:            'Portugal Resident',
    feedUrl:         'https://www.portugalresident.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'PT',
    defaultLat:      38.72,
    defaultLng:      -9.14,
    defaultLocation: 'Lisbon, Portugal',
    extraTags:       ['portugal', 'southern-europe', 'europe'],
    language:        'en',
  },
  // independent investigative news site
  {
    id:              'the-shift-mt',
    name:            'The Shift (Malta)',
    feedUrl:         'https://theshiftnews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'MT',
    defaultLat:      35.9,
    defaultLng:      14.51,
    defaultLocation: 'Valletta, Malta',
    extraTags:       ['malta', 'southern-europe', 'europe', 'investigative'],
    language:        'en',
  },
  // English edition of the Athens daily
  {
    id:              'tovima-en',
    name:            'To Vima (English)',
    feedUrl:         'https://www.tovima.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'GR',
    defaultLat:      37.98,
    defaultLng:      23.73,
    defaultLocation: 'Athens, Greece',
    extraTags:       ['greece', 'southern-europe', 'europe'],
    language:        'en',
  },
  // RTL Luxembourg's English news site
  {
    id:              'rtl-today-lu',
    name:            'RTL Today (Luxembourg)',
    feedUrl:         'https://today.rtl.lu/news/luxembourg.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'LU',
    defaultLat:      49.61,
    defaultLng:      6.13,
    defaultLocation: 'Luxembourg, Luxembourg',
    extraTags:       ['luxembourg', 'europe'],
    language:        'en',
  },
  // English-language news site of the SME daily
  {
    id:              'slovak-spectator',
    name:            'The Slovak Spectator',
    feedUrl:         'https://spectator.sme.sk/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'SK',
    defaultLat:      48.15,
    defaultLng:      17.11,
    defaultLocation: 'Bratislava, Slovakia',
    extraTags:       ['slovakia', 'central-europe', 'europe'],
    language:        'en',
  },
  // Kampala news magazine
  {
    id:              'independent-ug',
    name:            'The Independent (Uganda)',
    feedUrl:         'https://www.independent.co.ug/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'UG',
    defaultLat:      0.35,
    defaultLng:      32.58,
    defaultLocation: 'Kampala, Uganda',
    extraTags:       ['uganda', 'east-africa', 'africa'],
    language:        'en',
  },
  // Kampala news site; a national outlet, so stories that name no place are pinned at home
  {
    id:              'nile-post-ug',
    name:            'Nile Post (Uganda)',
    feedUrl:         'https://nilepost.co.ug/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'UG',
    defaultLat:      0.35,
    defaultLng:      32.58,
    defaultLocation: 'Kampala, Uganda',
    extraTags:       ['uganda', 'east-africa', 'africa'],
    language:        'en',
  },
  // Malawi's national daily
  {
    id:              'nation-malawi',
    name:            'The Nation (Malawi)',
    feedUrl:         'https://mwnation.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MW',
    defaultLat:      -13.96,
    defaultLng:      33.79,
    defaultLocation: 'Lilongwe, Malawi',
    extraTags:       ['malawi', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Namibia's largest independent daily
  {
    id:              'the-namibian',
    name:            'The Namibian',
    feedUrl:         'https://www.namibian.com.na/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'NA',
    defaultLat:      -22.56,
    defaultLng:      17.08,
    defaultLocation: 'Windhoek, Namibia',
    extraTags:       ['namibia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Tashkent news site, English edition
  {
    id:              'kun-uz-en',
    name:            'Kun.uz (English)',
    feedUrl:         'https://kun.uz/news/rss?lang=en',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'UZ',
    defaultLat:      41.3,
    defaultLng:      69.24,
    defaultLocation: 'Tashkent, Uzbekistan',
    extraTags:       ['uzbekistan', 'central-asia', 'asia'],
    language:        'en',
  },
  // Tashkent news site, English edition
  {
    id:              'daryo-uz-en',
    name:            'Daryo (English)',
    feedUrl:         'https://daryo.uz/en/rss-full/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'UZ',
    defaultLat:      41.3,
    defaultLng:      69.24,
    defaultLocation: 'Tashkent, Uzbekistan',
    extraTags:       ['uzbekistan', 'central-asia', 'asia'],
    language:        'en',
  },
  // Bishkek news agency covering all of Central Asia (headlines only, no summaries); regional, so no home pin
  {
    id:              'akipress-en',
    name:            'AKIpress (English)',
    feedUrl:         'https://akipress.com/rss/en.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'KG',
    defaultLat:      42.87,
    defaultLng:      74.59,
    defaultLocation: 'Bishkek, Kyrgyzstan',
    extraTags:       ['kyrgyzstan', 'central-asia', 'asia'],
    language:        'en',
  },
  // English-language daily founded in 2010; independent reporting in Kazakhstan is restricted, hence 0.62
  {
    id:              'astana-times',
    name:            'The Astana Times',
    feedUrl:         'https://astanatimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'KZ',
    defaultLat:      51.17,
    defaultLng:      71.45,
    defaultLocation: 'Astana, Kazakhstan',
    extraTags:       ['kazakhstan', 'central-asia', 'asia'],
    language:        'en',
  },
  // independent news agency in Dushanbe
  {
    id:              'asia-plus-tj',
    name:            'Asia-Plus (Tajikistan)',
    feedUrl:         'https://asiaplus.news/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'TJ',
    defaultLat:      38.56,
    defaultLng:      68.79,
    defaultLocation: 'Dushanbe, Tajikistan',
    extraTags:       ['tajikistan', 'central-asia', 'asia', 'independent-media'],
    language:        'en',
  },
  // run by Turkish journalists in exile (Stockholm), so no home pin
  {
    id:              'turkish-minute',
    name:            'Turkish Minute',
    feedUrl:         'https://www.turkishminute.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'TR',
    defaultLat:      39.93,
    defaultLng:      32.86,
    defaultLocation: 'Ankara, Turkey',
    extraTags:       ['turkey', 'middle-east', 'europe', 'exile-media'],
    language:        'en',
  },
  // independent Istanbul news network focused on rights
  {
    id:              'bianet-en',
    name:            'Bianet (English)',
    feedUrl:         'https://bianet.org/rss/english',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'TR',
    defaultLat:      39.93,
    defaultLng:      32.86,
    defaultLocation: 'Ankara, Turkey',
    extraTags:       ['turkey', 'rights', 'middle-east', 'europe', 'independent-media'],
    language:        'en',
  },
  // Kigali news site; independent reporting in Rwanda is restricted, hence 0.65
  {
    id:              'taarifa-rw',
    name:            'Taarifa (Rwanda)',
    feedUrl:         'https://taarifa.rw/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'RW',
    defaultLat:      -1.94,
    defaultLng:      30.06,
    defaultLocation: 'Kigali, Rwanda',
    extraTags:       ['rwanda', 'east-africa', 'great-lakes', 'africa'],
    language:        'en',
  },
  // Kuwait's English-language daily
  {
    id:              'arab-times-kw',
    name:            'Arab Times (Kuwait)',
    feedUrl:         'https://www.arabtimesonline.com/rssfeed/73/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'KW',
    defaultLat:      29.38,
    defaultLng:      47.99,
    defaultLocation: 'Kuwait City, Kuwait',
    extraTags:       ['kuwait', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Muscat daily
  {
    id:              'times-of-oman',
    name:            'Times of Oman',
    feedUrl:         'https://timesofoman.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'OM',
    defaultLat:      23.59,
    defaultLng:      58.41,
    defaultLocation: 'Muscat, Oman',
    extraTags:       ['oman', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Manama news site; its terms forbid commercial republishing without permission (we keep headline, summary and link only)
  {
    id:              'news-of-bahrain',
    name:            'News of Bahrain',
    feedUrl:         'https://www.newsofbahrain.com/rss/en.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'BH',
    defaultLat:      26.23,
    defaultLng:      50.59,
    defaultLocation: 'Manama, Bahrain',
    extraTags:       ['bahrain', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Mogadishu news site
  {
    id:              'somali-guardian',
    name:            'Somali Guardian',
    feedUrl:         'https://www.somaliguardian.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'SO',
    defaultLat:      2.05,
    defaultLng:      45.32,
    defaultLocation: 'Mogadishu, Somalia',
    extraTags:       ['somalia', 'horn-of-africa', 'africa'],
    language:        'en',
  },
  // independent analysis and reporting; about one item a day
  {
    id:              'ethiopia-insight',
    name:            'Ethiopia Insight',
    feedUrl:         'https://www.ethiopia-insight.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'ET',
    defaultLat:      9.03,
    defaultLng:      38.75,
    defaultLocation: 'Addis Ababa, Ethiopia',
    extraTags:       ['ethiopia', 'horn-of-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // independent non-profit newsroom (Amman)
  {
    id:              'syria-direct',
    name:            'Syria Direct',
    feedUrl:         'https://syriadirect.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'SY',
    defaultLat:      33.51,
    defaultLng:      36.28,
    defaultLocation: 'Damascus, Syria',
    extraTags:       ['syria', 'middle-east', 'independent-media'],
    language:        'en',
  },
  // Monrovia daily
  {
    id:              'frontpage-africa',
    name:            'FrontPage Africa (Liberia)',
    feedUrl:         'https://frontpageafricaonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'LR',
    defaultLat:      6.3,
    defaultLng:      -10.8,
    defaultLocation: 'Monrovia, Liberia',
    extraTags:       ['liberia', 'west-africa', 'africa'],
    language:        'en',
  },
  // independent Cameroonian news site
  {
    id:              'mimi-mefo-info',
    name:            'Mimi Mefo Info (Cameroon)',
    feedUrl:         'https://mimimefoinfos.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CM',
    defaultLat:      3.85,
    defaultLng:      11.5,
    defaultLocation: 'Yaoundé, Cameroon',
    extraTags:       ['cameroon', 'central-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // Multimedia Group's news site, Accra
  {
    id:              'myjoyonline-gh',
    name:            'MyJoyOnline (Ghana)',
    feedUrl:         'https://www.myjoyonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'GH',
    defaultLat:      5.6,
    defaultLng:      -0.19,
    defaultLocation: 'Accra, Ghana',
    extraTags:       ['ghana', 'west-africa', 'africa'],
    language:        'en',
  },
  // Beirut news site (its Lebanon feed)
  {
    id:              'naharnet',
    name:            'Naharnet (Lebanon)',
    feedUrl:         'https://www.naharnet.com/tags/lebanon/en/feed.atom',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'LB',
    defaultLat:      33.89,
    defaultLng:      35.5,
    defaultLocation: 'Beirut, Lebanon',
    extraTags:       ['lebanon', 'middle-east'],
    language:        'en',
  },
  // independent non-profit English daily
  {
    id:              'hong-kong-free-press',
    name:            'Hong Kong Free Press',
    feedUrl:         'https://hongkongfp.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'HK',
    defaultLat:      22.32,
    defaultLng:      114.17,
    defaultLocation: 'Hong Kong, Hong Kong',
    extraTags:       ['hong-kong', 'china', 'asia-pacific', 'independent-media'],
    language:        'en',
  },
  // the Cambodian Journalists Alliance's newsroom
  {
    id:              'camboja-news',
    name:            'CamboJA News (Cambodia)',
    feedUrl:         'https://cambojanews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'KH',
    defaultLat:      11.56,
    defaultLng:      104.92,
    defaultLocation: 'Phnom Penh, Cambodia',
    extraTags:       ['cambodia', 'southeast-asia', 'independent-media'],
    language:        'en',
  },
  // Manila business daily
  {
    id:              'businessworld-ph',
    name:            'BusinessWorld (Philippines)',
    feedUrl:         'https://bworldonline.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'PH',
    defaultLat:      14.6,
    defaultLng:      120.98,
    defaultLocation: 'Manila, Philippines',
    extraTags:       ['philippines', 'southeast-asia', 'business'],
    language:        'en',
  },
  // Tongan news site (Auckland and Nukuʻalofa); a few items a day
  {
    id:              'kaniva-tonga',
    name:            'Kaniva Tonga',
    feedUrl:         'https://kanivatonga.co.nz/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'TO',
    defaultLat:      -21.14,
    defaultLng:      -175.2,
    defaultLocation: 'Nuku\'alofa, Tonga',
    extraTags:       ['tonga', 'pacific', 'oceania'],
    language:        'en',
  },
  // Seoul English daily
  {
    id:              'korea-herald',
    name:            'The Korea Herald',
    feedUrl:         'https://www.koreaherald.com/rss/newsAll',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'KR',
    defaultLat:      37.57,
    defaultLng:      126.98,
    defaultLocation: 'Seoul, South Korea',
    extraTags:       ['south-korea', 'asia-pacific'],
    language:        'en',
  },
  // English edition of Nepal's largest news site
  {
    id:              'onlinekhabar-en',
    name:            'Onlinekhabar English (Nepal)',
    feedUrl:         'https://english.onlinekhabar.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'NP',
    defaultLat:      27.72,
    defaultLng:      85.32,
    defaultLocation: 'Kathmandu, Nepal',
    extraTags:       ['nepal', 'south-asia'],
    language:        'en',
  },
  // Vientiane news site (its news section; the site-wide feed is mostly regional)
  {
    id:              'laotian-times',
    name:            'Laotian Times',
    feedUrl:         'https://laotiantimes.com/category/allnews/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LA',
    defaultLat:      17.98,
    defaultLng:      102.63,
    defaultLocation: 'Vientiane, Laos',
    extraTags:       ['laos', 'southeast-asia'],
    language:        'en',
  },
  // independent Bangkok news site focused on rights
  {
    id:              'prachatai-en',
    name:            'Prachatai English (Thailand)',
    feedUrl:         'https://prachataienglish.com/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'TH',
    defaultLat:      13.76,
    defaultLng:      100.5,
    defaultLocation: 'Bangkok, Thailand',
    extraTags:       ['thailand', 'southeast-asia', 'rights', 'independent-media'],
    language:        'en',
  },
  // the Solomon Islands' public broadcaster
  {
    id:              'sibc-sb',
    name:            'SIBC (Solomon Islands)',
    feedUrl:         'https://www.sibconline.com.sb/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'SB',
    defaultLat:      -9.43,
    defaultLng:      159.95,
    defaultLocation: 'Honiara, Solomon Islands',
    extraTags:       ['solomon-islands', 'pacific', 'oceania', 'public-broadcaster'],
    language:        'en',
  },
  // Honiara news site
  {
    id:              'solomon-times',
    name:            'Solomon Times',
    feedUrl:         'https://www.solomontimes.com/rss/latest-news.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SB',
    defaultLat:      -9.43,
    defaultLng:      159.95,
    defaultLocation: 'Honiara, Solomon Islands',
    extraTags:       ['solomon-islands', 'pacific', 'oceania'],
    language:        'en',
  },
  // Apia news site
  {
    id:              'talamua-ws',
    name:            'Talamua (Samoa)',
    feedUrl:         'https://talamua.com/?feed=rss2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'WS',
    defaultLat:      -13.83,
    defaultLng:      -171.76,
    defaultLocation: 'Apia, Samoa',
    extraTags:       ['samoa', 'pacific', 'oceania'],
    language:        'en',
  },
  // Timor-Leste's state news agency
  {
    id:              'tatoli-en',
    name:            'Tatoli (Timor-Leste)',
    feedUrl:         'https://en.tatoli.tl/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'TL',
    defaultLat:      -8.56,
    defaultLng:      125.57,
    defaultLocation: 'Dili, Timor-Leste',
    extraTags:       ['timor-leste', 'southeast-asia', 'state-media'],
    language:        'en',
  },
  // English edition of the Ho Chi Minh City daily (scored like VnExpress International)
  {
    id:              'tuoi-tre-news',
    name:            'Tuoi Tre News (Vietnam)',
    feedUrl:         'https://news.tuoitre.vn/home.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'VN',
    defaultLat:      21.03,
    defaultLng:      105.85,
    defaultLocation: 'Hanoi, Vietnam',
    extraTags:       ['vietnam', 'southeast-asia'],
    language:        'en',
  },
  // GMA Network's national news feed
  {
    id:              'gma-news-nation',
    name:            'GMA News (Philippines)',
    feedUrl:         'https://data.gmanetwork.com/gno/rss/news/nation/feed.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'PH',
    defaultLat:      14.6,
    defaultLng:      120.98,
    defaultLocation: 'Manila, Philippines',
    extraTags:       ['philippines', 'southeast-asia'],
    language:        'en',
  },
  // Bhutan's public broadcaster; a national outlet, so stories that name no place are pinned at home
  {
    id:              'bbs-bhutan',
    name:            'BBS (Bhutan Broadcasting Service)',
    feedUrl:         'https://www.bbs.bt/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BT',
    defaultLat:      27.47,
    defaultLng:      89.64,
    defaultLocation: 'Thimphu, Bhutan',
    extraTags:       ['bhutan', 'south-asia', 'public-broadcaster'],
    language:        'en',
  },
  // Ulaanbaatar news site, English edition
  {
    id:              'news-mn-en',
    name:            'News.mn (Mongolia)',
    feedUrl:         'https://news.mn/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'MN',
    defaultLat:      47.89,
    defaultLng:      106.91,
    defaultLocation: 'Ulaanbaatar, Mongolia',
    extraTags:       ['mongolia', 'east-asia', 'asia'],
    language:        'en',
  },
  // Palau's newspaper
  {
    id:              'island-times-pw',
    name:            'Island Times (Palau)',
    feedUrl:         'https://islandtimes.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'PW',
    defaultLat:      7.5,
    defaultLng:      134.62,
    defaultLocation: 'Ngerulmud, Palau',
    extraTags:       ['palau', 'pacific', 'oceania'],
    language:        'en',
  },
  // the Cook Islands' daily; the place-finder doesn't know the Cook Islands, so its home is set by hand and its stories that name no place are pinned there
  {
    id:              'cook-islands-news',
    name:            'Cook Islands News',
    feedUrl:         'https://www.cookislandsnews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CK',
    defaultLat:      -21.21,
    defaultLng:      -159.78,
    defaultLocation: 'Avarua, Cook Islands',
    extraTags:       ['cook-islands', 'pacific', 'oceania'],
    language:        'en',
  },
  // Kuala Lumpur daily (its Malaysia feed)
  {
    id:              'malay-mail',
    name:            'Malay Mail',
    feedUrl:         'https://www.malaymail.com/feed/rss/malaysia',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MY',
    defaultLat:      3.14,
    defaultLng:      101.69,
    defaultLocation: 'Kuala Lumpur, Malaysia',
    extraTags:       ['malaysia', 'southeast-asia'],
    language:        'en',
  },
  // Lahore news weekly and site
  {
    id:              'friday-times-pk',
    name:            'The Friday Times (Pakistan)',
    feedUrl:         'https://www.thefridaytimes.com/rss/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'PK',
    defaultLat:      33.68,
    defaultLng:      73.05,
    defaultLocation: 'Islamabad, Pakistan',
    extraTags:       ['pakistan', 'south-asia'],
    language:        'en',
  },
  // Lahore daily (its national news feed)
  {
    id:              'the-nation-pk',
    name:            'The Nation (Pakistan)',
    feedUrl:         'https://www.nation.com.pk/rss/national',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'PK',
    defaultLat:      33.68,
    defaultLng:      73.05,
    defaultLocation: 'Islamabad, Pakistan',
    extraTags:       ['pakistan', 'south-asia'],
    language:        'en',
  },
  // Malé business news site
  {
    id:              'corporate-maldives',
    name:            'Corporate Maldives',
    feedUrl:         'https://corporatemaldives.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'MV',
    defaultLat:      4.18,
    defaultLng:      73.51,
    defaultLocation: 'Malé, Maldives',
    extraTags:       ['maldives', 'south-asia', 'business'],
    language:        'en',
  },
  // independent English-language site on Venezuela; a few items a day
  {
    id:              'caracas-chronicles',
    name:            'Caracas Chronicles',
    feedUrl:         'https://www.caracaschronicles.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'VE',
    defaultLat:      10.49,
    defaultLng:      -66.88,
    defaultLocation: 'Caracas, Venezuela',
    extraTags:       ['venezuela', 'latin-america', 'analysis'],
    language:        'en',
  },
  // English-language news site in Santo Domingo
  {
    id:              'dominican-today',
    name:            'Dominican Today',
    feedUrl:         'https://dominicantoday.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'DO',
    defaultLat:      18.49,
    defaultLng:      -69.93,
    defaultLocation: 'Santo Domingo, Dominican Republic',
    extraTags:       ['dominican-republic', 'caribbean', 'latin-america'],
    language:        'en',
  },
  // Kingston daily; a national outlet, so stories that name no place are pinned at home
  {
    id:              'jamaica-observer',
    name:            'Jamaica Observer',
    feedUrl:         'https://www.jamaicaobserver.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'JM',
    defaultLat:      17.97,
    defaultLng:      -76.79,
    defaultLocation: 'Kingston, Jamaica',
    extraTags:       ['jamaica', 'caribbean'],
    language:        'en',
  },
  // Nassau daily
  {
    id:              'tribune-242',
    name:            'The Tribune (Bahamas)',
    feedUrl:         'https://www.tribune242.com/rss/headlines/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BS',
    defaultLat:      25.05,
    defaultLng:      -77.35,
    defaultLocation: 'Nassau, Bahamas',
    extraTags:       ['bahamas', 'caribbean'],
    language:        'en',
  },
  // Belize City newspaper
  {
    id:              'amandala-bz',
    name:            'Amandala (Belize)',
    feedUrl:         'https://amandala.com.bz/news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'BZ',
    defaultLat:      17.25,
    defaultLng:      -88.77,
    defaultLocation: 'Belmopan, Belize',
    extraTags:       ['belize', 'central-america', 'caribbean'],
    language:        'en',
  },
  // Castries news site
  {
    id:              'st-lucia-times',
    name:            'St Lucia Times',
    feedUrl:         'https://stluciatimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LC',
    defaultLat:      14.01,
    defaultLng:      -60.99,
    defaultLocation: 'Castries, Saint Lucia',
    extraTags:       ['saint-lucia', 'caribbean'],
    language:        'en',
  },
  // Georgetown daily
  {
    id:              'kaieteur-news',
    name:            'Kaieteur News (Guyana)',
    feedUrl:         'https://kaieteurnewsonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'GY',
    defaultLat:      6.8,
    defaultLng:      -58.16,
    defaultLocation: 'Georgetown, Guyana',
    extraTags:       ['guyana', 'caribbean', 'south-america'],
    language:        'en',
  },
  // Bridgetown daily; a national outlet, so stories that name no place are pinned at home
  {
    id:              'nation-news-bb',
    name:            'Nation News (Barbados)',
    feedUrl:         'https://nationnews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BB',
    defaultLat:      13.1,
    defaultLng:      -59.62,
    defaultLocation: 'Bridgetown, Barbados',
    extraTags:       ['barbados', 'caribbean'],
    language:        'en',
    parked:          'bot check page (HTTP 403), Nov 5, 2026',
  },
  // Port of Spain daily (its news section); a national outlet, so stories that name no place are pinned at home
  {
    id:              'trinidad-express',
    name:            'Trinidad Express',
    feedUrl:         'https://trinidadexpress.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'TT',
    defaultLat:      10.65,
    defaultLng:      -61.51,
    defaultLocation: 'Port of Spain, Trinidad and Tobago',
    extraTags:       ['trinidad-and-tobago', 'caribbean'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (Q5: toward 300 feeds, batch B) ────────────────────
  // 22 Spanish- and French-language outlets for countries with no outlet (or
  // one): Peru, Venezuela, Ecuador, Bolivia, Paraguay, Cuba, the Dominican
  // Republic, Guatemala, Honduras, El Salvador, Nicaragua, Panama, Puerto Rico,
  // Mexico and Argentina; Burkina Faso, Madagascar, Mali, Chad, Guinea and
  // French Polynesia. Checked as batch A was. They get no home pins: the
  // place-finder doesn't know names like "Estados Unidos" or "Canadá", so a
  // foreign story would land at home. Left out for their terms: Business News
  // (Tunisia), which forbids any rebroadcast, even partial, and Le Nouvelliste
  // (Haiti) and El Tiempo (Colombia), which forbid automated reading.
  // Lima radio and news site, one of Peru's most read
  {
    id:              'rpp-noticias',
    name:            'RPP Noticias (Peru)',
    feedUrl:         'https://rpp.pe/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'PE',
    defaultLat:      -12.05,
    defaultLng:      -77.04,
    defaultLocation: 'Lima, Peru',
    extraTags:       ['peru', 'latin-america', 'south-america'],
    language:        'es',
  },
  // Quito digital daily
  {
    id:              'primicias-ec',
    name:            'Primicias (Ecuador)',
    feedUrl:         'https://www.primicias.ec/rss/home.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'EC',
    defaultLat:      -0.18,
    defaultLng:      -78.47,
    defaultLocation: 'Quito, Ecuador',
    extraTags:       ['ecuador', 'latin-america', 'south-america'],
    language:        'es',
  },
  // Cochabamba daily
  {
    id:              'los-tiempos-bo',
    name:            'Los Tiempos (Bolivia)',
    feedUrl:         'https://www.lostiempos.com/rss/actualidad',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'BO',
    defaultLat:      -16.5,
    defaultLng:      -68.15,
    defaultLocation: 'La Paz, Bolivia',
    extraTags:       ['bolivia', 'latin-america', 'south-america'],
    language:        'es',
  },
  // Asunción daily, Paraguay's largest
  {
    id:              'abc-color-py',
    name:            'ABC Color (Paraguay)',
    feedUrl:         'https://www.abc.com.py/arc/outboundfeeds/rss/nacionales/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'PY',
    defaultLat:      -25.26,
    defaultLng:      -57.58,
    defaultLocation: 'Asunción, Paraguay',
    extraTags:       ['paraguay', 'latin-america', 'south-america'],
    language:        'es',
  },
  // independent Cuban digital daily
  {
    id:              '14ymedio-cu',
    name:            '14ymedio (Cuba)',
    feedUrl:         'https://www.14ymedio.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'CU',
    defaultLat:      23.11,
    defaultLng:      -82.37,
    defaultLocation: 'Havana, Cuba',
    extraTags:       ['cuba', 'caribbean', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // Santo Domingo daily
  {
    id:              'diario-libre-do',
    name:            'Diario Libre (Dominican Republic)',
    feedUrl:         'https://www.diariolibre.com/rss/actualidad.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'DO',
    defaultLat:      18.49,
    defaultLng:      -69.93,
    defaultLocation: 'Santo Domingo, Dominican Republic',
    extraTags:       ['dominican-republic', 'caribbean', 'latin-america'],
    language:        'es',
  },
  // Guatemala City daily
  {
    id:              'la-hora-gt',
    name:            'La Hora (Guatemala)',
    feedUrl:         'https://lahora.gt/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'GT',
    defaultLat:      14.63,
    defaultLng:      -90.51,
    defaultLocation: 'Guatemala City, Guatemala',
    extraTags:       ['guatemala', 'central-america', 'latin-america'],
    language:        'es',
  },
  // independent investigative site; a few items a day
  {
    id:              'criterio-hn',
    name:            'Criterio.hn (Honduras)',
    feedUrl:         'https://criterio.hn/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'HN',
    defaultLat:      14.07,
    defaultLng:      -87.19,
    defaultLocation: 'Tegucigalpa, Honduras',
    extraTags:       ['honduras', 'central-america', 'latin-america', 'investigative'],
    language:        'es',
  },
  // San Salvador daily
  {
    id:              'diario-co-latino',
    name:            'Diario Co Latino (El Salvador)',
    feedUrl:         'https://www.diariocolatino.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.70,
    countryCode:     'SV',
    defaultLat:      13.69,
    defaultLng:      -89.22,
    defaultLocation: 'San Salvador, El Salvador',
    extraTags:       ['el-salvador', 'central-america', 'latin-america'],
    language:        'es',
  },
  // independent newsroom, working from exile
  {
    id:              'confidencial-ni',
    name:            'Confidencial (Nicaragua)',
    feedUrl:         'https://confidencial.digital/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'NI',
    defaultLat:      12.11,
    defaultLng:      -86.24,
    defaultLocation: 'Managua, Nicaragua',
    extraTags:       ['nicaragua', 'central-america', 'latin-america', 'independent-media', 'exile-media'],
    language:        'es',
  },
  // Panama City daily
  {
    id:              'la-prensa-pa',
    name:            'La Prensa (Panama)',
    feedUrl:         'https://www.prensa.com/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'PA',
    defaultLat:      8.98,
    defaultLng:      -79.52,
    defaultLocation: 'Panama City, Panama',
    extraTags:       ['panama', 'central-america', 'latin-america'],
    language:        'es',
  },
  // Mexico City daily
  {
    id:              'el-universal-mx',
    name:            'El Universal (Mexico)',
    feedUrl:         'https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'MX',
    defaultLat:      19.43,
    defaultLng:      -99.13,
    defaultLocation: 'Mexico City, Mexico',
    extraTags:       ['mexico', 'latin-america'],
    language:        'es',
  },
  // Buenos Aires daily
  {
    id:              'pagina-12-ar',
    name:            'Página/12 (Argentina)',
    feedUrl:         'https://www.pagina12.com.ar/arc/outboundfeeds/rss/secciones/el-pais/notas/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.74,
    countryCode:     'AR',
    defaultLat:      -34.6,
    defaultLng:      -58.38,
    defaultLocation: 'Buenos Aires, Argentina',
    extraTags:       ['argentina', 'latin-america', 'south-america'],
    language:        'es',
  },
  // Ouagadougou news site
  {
    id:              'lefaso-bf',
    name:            'Lefaso.net (Burkina Faso)',
    feedUrl:         'https://lefaso.net/spip.php?page=backend',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BF',
    defaultLat:      12.37,
    defaultLng:      -1.52,
    defaultLocation: 'Ouagadougou, Burkina Faso',
    extraTags:       ['burkina-faso', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Antananarivo daily
  {
    id:              'lexpress-mg',
    name:            'L\'Express de Madagascar',
    feedUrl:         'https://www.lexpress.mg/feeds/posts/default?alt=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MG',
    defaultLat:      -18.88,
    defaultLng:      47.51,
    defaultLocation: 'Antananarivo, Madagascar',
    extraTags:       ['madagascar', 'indian-ocean', 'africa'],
    language:        'fr',
  },
  // Antananarivo daily
  {
    id:              'midi-madagasikara',
    name:            'Midi Madagasikara',
    feedUrl:         'https://midi-madagasikara.mg/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'MG',
    defaultLat:      -18.88,
    defaultLng:      47.51,
    defaultLocation: 'Antananarivo, Madagascar',
    extraTags:       ['madagascar', 'indian-ocean', 'africa'],
    language:        'fr',
  },
  // Bamako news site
  {
    id:              'journal-du-mali',
    name:            'Journal du Mali',
    feedUrl:         'https://journaldumali.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'ML',
    defaultLat:      12.64,
    defaultLng:      -8,
    defaultLocation: 'Bamako, Mali',
    extraTags:       ['mali', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // N'Djamena news site
  {
    id:              'tchadinfos',
    name:            'Tchadinfos (Chad)',
    feedUrl:         'https://tchadinfos.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'TD',
    defaultLat:      12.13,
    defaultLng:      15.06,
    defaultLocation: 'N\'Djamena, Chad',
    extraTags:       ['chad', 'sahel', 'central-africa', 'africa'],
    language:        'fr',
  },
  // Conakry news site; its legal page allows short extracts with a link and forbids systematic copying of whole articles (we keep headline, summary and link)
  {
    id:              'guineenews',
    name:            'Guinéenews (Guinea)',
    feedUrl:         'https://guineenews.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'GN',
    defaultLat:      9.64,
    defaultLng:      -13.58,
    defaultLocation: 'Conakry, Guinea',
    extraTags:       ['guinea', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Papeete news site
  {
    id:              'tahiti-infos',
    name:            'Tahiti Infos (French Polynesia)',
    feedUrl:         'https://www.tahiti-infos.com/xml/syndication.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'PF',
    defaultLat:      -17.54,
    defaultLng:      -149.57,
    defaultLocation: 'Papeete, French Polynesia',
    extraTags:       ['french-polynesia', 'pacific', 'oceania'],
    language:        'fr',
  },
  // ── Added Oct 20, 2026 (Q5: past 300 feeds, round 2) ──────────────────────
  // 78 more from a second round of four regional searches, checked the same
  // way (the server's own request, the reader's own parser, terms read where
  // the site links them; a site whose terms forbid robots, crawling, scraping
  // or data mining is left out: Semana, Le National, Kyodo, Thai Examiner, NZ
  // Herald, Majorca Daily Bulletin, LIGA.net, and others in the searches' notes).
  // Spanish, Portuguese and French feeds get no home pin.
  // Europe
  // English edition of the Athens newspaper Proto Thema; Greece is on 2 of the 8 items the place-finder placed, so no home pin
  {
    id:              'protothema-en',
    name:            'Proto Thema (English)',
    feedUrl:         'https://en.protothema.gr/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'GR',
    defaultLat:      37.98,
    defaultLng:      23.73,
    defaultLocation: 'Athens, Greece',
    extraTags:       ['greece', 'southern-europe', 'europe'],
    language:        'en',
  },
  // English-language news site in Belgrade (politics, economy, business)
  {
    id:              'serbian-monitor',
    name:            'Serbian Monitor',
    feedUrl:         'https://www.serbianmonitor.com/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'RS',
    defaultLat:      44.79,
    defaultLng:      20.45,
    defaultLocation: 'Belgrade, Serbia',
    extraTags:       ['serbia', 'balkans', 'europe'],
    language:        'en',
  },
  // English-language business news site in Bucharest (Bloc Notes Media Network); its terms bar copying for commercial use (we keep headline, summary and link only)
  {
    id:              'business-review-ro',
    name:            'Business Review (Romania)',
    feedUrl:         'https://business-review.eu/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'RO',
    defaultLat:      44.43,
    defaultLng:      26.1,
    defaultLocation: 'Bucharest, Romania',
    extraTags:       ['romania', 'eastern-europe', 'europe', 'business'],
    language:        'en',
  },
  // English-language local news site in Brno, Czechia's second city; local, so no home pin; its terms bar commercial use without written consent (we keep headline, summary and link only)
  {
    id:              'brno-daily',
    name:            'Brno Daily',
    feedUrl:         'https://brnodaily.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'CZ',
    defaultLat:      49.2,
    defaultLng:      16.61,
    defaultLocation: 'Brno, Czechia',
    extraTags:       ['czechia', 'central-europe', 'europe'],
    language:        'en',
  },
  // Rome English-language news site and magazine ("Italy's news in English since 1985"); much city news
  {
    id:              'wanted-in-rome',
    name:            'Wanted in Rome',
    feedUrl:         'https://www.wantedinrome.com/?format=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'IT',
    defaultLat:      41.9,
    defaultLng:      12.5,
    defaultLocation: 'Rome, Italy',
    extraTags:       ['italy', 'southern-europe', 'europe'],
    language:        'en',
  },
  // English news of the Belarusian Association of Journalists, on press freedom and repression in Belarus; its editorial policy allows reuse with the author and a link; an association's news service, not a national newsroom, so no home pin
  {
    id:              'baj-belarus-en',
    name:            'Belarusian Association of Journalists (English)',
    feedUrl:         'https://baj.media/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'BY',
    defaultLat:      53.9,
    defaultLng:      27.57,
    defaultLocation: 'Minsk, Belarus',
    extraTags:       ['belarus', 'eastern-europe', 'europe', 'press-freedom', 'independent-media'],
    language:        'en',
  },
  // news agency of the Metamorphosis Foundation in Skopje, English edition; a few items a week; North Macedonia is on 4 of the 11 items placed, so no home pin; its terms allow republishing with the source named (Creative Commons) but bar storing or commercial use without consent (we keep headline, summary and link only)
  {
    id:              'meta-mk',
    name:            'Meta.mk (North Macedonia)',
    feedUrl:         'https://meta.mk/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MK',
    defaultLat:      42,
    defaultLng:      21.43,
    defaultLocation: 'Skopje, North Macedonia',
    extraTags:       ['north-macedonia', 'balkans', 'europe', 'independent-media'],
    language:        'en',
  },
  // English-language newspaper in Budapest (BZT Media, which also publishes the Budapester Zeitung); the place-finder placed none of its 10 items, all Hungarian domestic politics, so a home pin is what puts them in Hungary
  {
    id:              'budapest-times',
    name:            'The Budapest Times',
    feedUrl:         'https://www.budapesttimes.hu/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'HU',
    defaultLat:      47.5,
    defaultLng:      19.04,
    defaultLocation: 'Budapest, Hungary',
    extraTags:       ['hungary', 'central-europe', 'europe'],
    language:        'en',
  },
  // English-language news site in Prague; much lifestyle and expat content; Czechia is on 2 of the 8 items placed, so no home pin
  {
    id:              'prague-morning',
    name:            'Prague Morning',
    feedUrl:         'https://praguemorning.cz/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'CZ',
    defaultLat:      50.08,
    defaultLng:      14.44,
    defaultLocation: 'Prague, Czechia',
    extraTags:       ['czechia', 'central-europe', 'europe'],
    language:        'en',
  },
  // English edition of the Málaga daily SUR (Prensa Malagueña); its latest-news feed; regional (Málaga, Costa del Sol, Andalusia), so no home pin
  {
    id:              'sur-in-english',
    name:            'Sur in English',
    feedUrl:         'https://www.surinenglish.com/rss/2.0/?section=/ultima-hora',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'ES',
    defaultLat:      36.72,
    defaultLng:      -4.42,
    defaultLocation: 'Málaga, Spain',
    extraTags:       ['spain', 'southern-europe', 'europe'],
    language:        'en',
  },
  // English-language news and analysis site on Italy and geopolitics, a spin-off of the Rome outlet Formiche; Italy is on 4 of the 9 items placed, so no home pin
  {
    id:              'decode39',
    name:            'Decode39 (Italy)',
    feedUrl:         'https://decode39.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'IT',
    defaultLat:      41.9,
    defaultLng:      12.5,
    defaultLocation: 'Rome, Italy',
    extraTags:       ['italy', 'southern-europe', 'europe', 'analysis'],
    language:        'en',
  },
  // Iceland's longest-running English-language publication (founded 1963), now online with daily news
  {
    id:              'iceland-review',
    name:            'Iceland Review',
    feedUrl:         'https://www.icelandreview.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'IS',
    defaultLat:      64.15,
    defaultLng:      -21.94,
    defaultLocation: 'Reykjavik, Iceland',
    extraTags:       ['iceland', 'nordics', 'europe'],
    language:        'en',
  },
  // Reykjavík English-language magazine; mostly culture, some news
  {
    id:              'reykjavik-grapevine',
    name:            'The Reykjavík Grapevine',
    feedUrl:         'https://grapevine.is/feed/',
    category:        'culture',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'IS',
    defaultLat:      64.15,
    defaultLng:      -21.94,
    defaultLocation: 'Reykjavik, Iceland',
    extraTags:       ['iceland', 'nordics', 'europe', 'culture'],
    language:        'en',
  },
  // Swiss public broadcaster RTS, its all-news feed in French; French, so no home pin
  {
    id:              'rts-info-fr',
    name:            'RTS Info (Switzerland)',
    feedUrl:         'https://www.rts.ch/info/toute-info/?format=rss/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'CH',
    defaultLat:      46.95,
    defaultLng:      7.45,
    defaultLocation: 'Bern, Switzerland',
    extraTags:       ['switzerland', 'europe', 'public-broadcaster', 'french'],
    language:        'fr',
  },
  // Swiss French-language daily; French, so no home pin
  {
    id:              'le-temps-ch',
    name:            'Le Temps (Switzerland)',
    feedUrl:         'https://www.letemps.ch/articles.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'CH',
    defaultLat:      46.95,
    defaultLng:      7.45,
    defaultLocation: 'Bern, Switzerland',
    extraTags:       ['switzerland', 'europe', 'french'],
    language:        'fr',
  },
  // Portugal's public broadcaster, its national (País) news feed; Portuguese, so no home pin
  {
    id:              'rtp-noticias',
    name:            'RTP Notícias (Portugal)',
    feedUrl:         'https://www.rtp.pt/noticias/rss/pais',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'PT',
    defaultLat:      38.72,
    defaultLng:      -9.14,
    defaultLocation: 'Lisbon, Portugal',
    extraTags:       ['portugal', 'southern-europe', 'europe', 'public-broadcaster', 'portuguese'],
    language:        'pt',
  },
  // Lisbon online daily; Portuguese, so no home pin; its terms say content may not be used without consent except private use (we keep headline, summary and link only)
  {
    id:              'observador-pt',
    name:            'Observador (Portugal)',
    feedUrl:         'https://observador.pt/feed/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.78,
    countryCode:     'PT',
    defaultLat:      38.72,
    defaultLng:      -9.14,
    defaultLocation: 'Lisbon, Portugal',
    extraTags:       ['portugal', 'southern-europe', 'europe', 'portuguese'],
    language:        'pt',
  },
  // Asia and the Pacific
  // Colombo news site (Wire Digital); about 4 items an hour
  {
    id:              'newswire-lk',
    name:            'Newswire (Sri Lanka)',
    feedUrl:         'https://www.newswire.lk/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LK',
    defaultLat:      6.93,
    defaultLng:      79.86,
    defaultLocation: 'Colombo, Sri Lanka',
    extraTags:       ['sri-lanka', 'south-asia'],
    language:        'en',
  },
  // Republica, the Kathmandu English daily (Nepal Republic Media); its feed is mostly world news (Nepal on 1 of 14 placed items), so no home pin
  {
    id:              'myrepublica-np',
    name:            'Myrepublica (Nepal)',
    feedUrl:         'https://myrepublica.nagariknetwork.com/feeds',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'NP',
    defaultLat:      27.72,
    defaultLng:      85.32,
    defaultLocation: 'Kathmandu, Nepal',
    extraTags:       ['nepal', 'south-asia'],
    language:        'en',
  },
  // independent newsroom (with Etilaatroz) that moved its base to Silver Spring, Maryland after 2021, so no home pin
  {
    id:              'kabulnow',
    name:            'KabulNow (Afghanistan)',
    feedUrl:         'https://kabulnow.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'AF',
    defaultLat:      34.56,
    defaultLng:      69.21,
    defaultLocation: 'Kabul, Afghanistan',
    extraTags:       ['afghanistan', 'south-asia', 'independent-media', 'exile-media'],
    language:        'en',
  },
  // Kabul TV channel's English news site; it works under Taliban media rules, hence 0.60; much foreign news (Afghanistan on 9 of 20 placed items), so no home pin
  {
    id:              'ariana-news-af',
    name:            'Ariana News (Afghanistan)',
    feedUrl:         'https://www.ariananews.af/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'AF',
    defaultLat:      34.56,
    defaultLng:      69.21,
    defaultLocation: 'Kabul, Afghanistan',
    extraTags:       ['afghanistan', 'south-asia'],
    language:        'en',
  },
  // Democratic Voice of Burma, a non-profit newsroom registered in Thailand that works in exile since the junta revoked its licence in 2021, so no home pin
  {
    id:              'dvb-en',
    name:            'DVB English (Myanmar)',
    feedUrl:         'https://english.dvb.no/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'MM',
    defaultLat:      19.76,
    defaultLng:      96.08,
    defaultLocation: 'Naypyidaw, Myanmar',
    extraTags:       ['myanmar', 'southeast-asia', 'independent-media', 'exile-media'],
    language:        'en',
  },
  // Hong Kong's public broadcaster, run as a government department (its news desk writes from an rthk.gov.hk address), hence state media under 0.6; its local news feed
  {
    id:              'rthk-en',
    name:            'RTHK English News (Hong Kong)',
    feedUrl:         'https://rthk9.rthk.hk/rthk/news/rss/e_expressnews_elocal.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'HK',
    defaultLat:      22.32,
    defaultLng:      114.17,
    defaultLocation: 'Hong Kong, Hong Kong',
    extraTags:       ['hong-kong', 'china', 'asia-pacific', 'public-broadcaster', 'state-media'],
    language:        'en',
  },
  // the Sankei Shimbun's English-language site; conservative editorial line; a few items a day
  {
    id:              'japan-forward',
    name:            'Japan Forward (Sankei)',
    feedUrl:         'https://japan-forward.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.72,
    countryCode:     'JP',
    defaultLat:      35.68,
    defaultLng:      139.65,
    defaultLocation: 'Tokyo, Japan',
    extraTags:       ['japan', 'east-asia', 'asia-pacific'],
    language:        'en',
  },
  // TVNZ's news service; the place-finder knows few New Zealand places (an Auckland story went unplaced), so its stories that name no place are pinned at home
  {
    id:              '1news-nz',
    name:            '1News (TVNZ)',
    feedUrl:         'https://www.1news.co.nz/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'NZ',
    defaultLat:      -41.29,
    defaultLng:      174.78,
    defaultLocation: 'Wellington, New Zealand',
    extraTags:       ['new-zealand', 'oceania', 'public-broadcaster'],
    language:        'en',
  },
  // Guam news site that also covers the Northern Mariana Islands; outspoken headlines, hence 0.62; covers two territories, so no home pin
  {
    id:              'kandit-news',
    name:            'Kandit News (Guam)',
    feedUrl:         'https://kanditnews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'GU',
    defaultLat:      13.47,
    defaultLng:      144.75,
    defaultLocation: 'Hagåtña, Guam',
    extraTags:       ['guam', 'northern-mariana-islands', 'micronesia', 'pacific', 'oceania'],
    language:        'en',
  },
  // Latin America and the Caribbean
  // Bogotá analysis site; its footer licenses content CC BY-NC-SA 3.0; about 7 items a day
  {
    id:              'razon-publica-co',
    name:            'Razón Pública (Colombia)',
    feedUrl:         'https://razonpublica.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'CO',
    defaultLat:      4.71,
    defaultLng:      -74.07,
    defaultLocation: 'Bogotá, Colombia',
    extraTags:       ['colombia', 'south-america', 'latin-america', 'analysis'],
    language:        'es',
  },
  // Bogotá's English-language newspaper; no terms page; robots.txt allows all; about
  // 5 items a week (Oct 21, 2026, Q5 round 6: Colombia Reports' feed now answers with
  // a web page)
  {
    id:              'city-paper-bogota',
    name:            'The City Paper Bogotá',
    feedUrl:         'https://thecitypaperbogota.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CO',
    defaultLat:      4.71,
    defaultLng:      -74.07,
    defaultLocation: 'Bogotá, Colombia',
    extraTags:       ['colombia', 'south-america', 'latin-america'],
    language:        'en',
  },
  // Santiago news radio, all-news feed (about 3 items an hour)
  {
    id:              'cooperativa-cl',
    name:            'Radio Cooperativa (Chile)',
    feedUrl:         'https://www.cooperativa.cl/noticias/site/tax/port/all/rss____1.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'CL',
    defaultLat:      -33.45,
    defaultLng:      -70.67,
    defaultLocation: 'Santiago, Chile',
    extraTags:       ['chile', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Santiago daily (Copesa); site-wide feed
  {
    id:              'la-tercera-cl',
    name:            'La Tercera (Chile)',
    feedUrl:         'https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.78,
    countryCode:     'CL',
    defaultLat:      -33.45,
    defaultLng:      -70.67,
    defaultLocation: 'Santiago, Chile',
    extraTags:       ['chile', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Montevideo daily; its help pages invite readers to follow it by RSS
  {
    id:              'la-diaria-uy',
    name:            'la diaria (Uruguay)',
    feedUrl:         'https://ladiaria.com.uy/feeds/articulos/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'UY',
    defaultLat:      -34.9,
    defaultLng:      -56.16,
    defaultLocation: 'Montevideo, Uruguay',
    extraTags:       ['uruguay', 'south-america', 'latin-america'],
    language:        'es',
  },
  // São Paulo investigative newsroom (labour, supply chains, environment); open licence for reproduction; 4 of 10 items read as English
  {
    id:              'reporter-brasil',
    name:            'Repórter Brasil',
    feedUrl:         'https://reporterbrasil.org.br/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'BR',
    defaultLat:      -15.8,
    defaultLng:      -47.89,
    defaultLocation: 'Brasília, Brazil',
    extraTags:       ['brazil', 'south-america', 'latin-america', 'investigative', 'labour-rights', 'environment'],
    language:        'pt',
  },
  // University of Costa Rica newspaper, San José
  {
    id:              'semanario-universidad-cr',
    name:            'Semanario Universidad (Costa Rica)',
    feedUrl:         'https://semanariouniversidad.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'CR',
    defaultLat:      9.93,
    defaultLng:      -84.08,
    defaultLocation: 'San José, Costa Rica',
    extraTags:       ['costa-rica', 'central-america', 'latin-america'],
    language:        'es',
  },
  // Haitian French-language news site; a few items a day
  {
    id:              'juno7-ht',
    name:            'Juno7 (Haiti)',
    feedUrl:         'https://www.juno7.ht/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'HT',
    defaultLat:      18.54,
    defaultLng:      -72.34,
    defaultLocation: 'Port-au-Prince, Haiti',
    extraTags:       ['haiti', 'caribbean', 'latin-america'],
    language:        'fr',
  },
  // independent English-language site on Cuba that also covers Nicaragua and the region, so no home pin
  {
    id:              'havana-times',
    name:            'Havana Times',
    feedUrl:         'https://havanatimes.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CU',
    defaultLat:      23.11,
    defaultLng:      -82.37,
    defaultLocation: 'Havana, Cuba',
    extraTags:       ['cuba', 'caribbean', 'latin-america', 'independent-media'],
    language:        'en',
  },
  // St. George's news site; a national outlet, so stories that name no place are pinned at home
  {
    id:              'now-grenada',
    name:            'NOW Grenada',
    feedUrl:         'https://nowgrenada.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'GD',
    defaultLat:      12.06,
    defaultLng:      -61.75,
    defaultLocation: 'St. George\'s, Grenada',
    extraTags:       ['grenada', 'caribbean'],
    language:        'en',
  },
  // Kingstown news site, about one item a day with much opinion; the place-finder doesn't know St Vincent, so its home is set by hand and its stories that name no place are pinned there
  {
    id:              'iwitness-news-vc',
    name:            'iWitness News (St Vincent)',
    feedUrl:         'https://www.iwnsvg.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'VC',
    defaultLat:      13.16,
    defaultLng:      -61.22,
    defaultLocation: 'Kingstown, Saint Vincent and the Grenadines',
    extraTags:       ['saint-vincent-and-the-grenadines', 'caribbean'],
    language:        'en',
  },
  // Hamilton news site; the place-finder doesn't know Bermuda, so its home is set by hand and its stories that name no place are pinned there
  {
    id:              'bernews-bm',
    name:            'Bernews (Bermuda)',
    feedUrl:         'https://bernews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BM',
    defaultLat:      32.29,
    defaultLng:      -64.78,
    defaultLocation: 'Hamilton, Bermuda',
    extraTags:       ['bermuda', 'caribbean', 'atlantic'],
    language:        'en',
  },
  // George Town news site; the place-finder doesn't know the Cayman Islands, so its home is set by hand and its stories that name no place are pinned there
  {
    id:              'cayman-news-service',
    name:            'Cayman News Service',
    feedUrl:         'https://caymannewsservice.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'KY',
    defaultLat:      19.29,
    defaultLng:      -81.38,
    defaultLocation: 'George Town, Cayman Islands',
    extraTags:       ['cayman-islands', 'caribbean'],
    language:        'en',
  },
  // Guayaquil daily; site-wide feed that also carries older items
  {
    id:              'el-universo-ec',
    name:            'El Universo (Ecuador)',
    feedUrl:         'https://www.eluniverso.com/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'EC',
    defaultLat:      -0.18,
    defaultLng:      -78.47,
    defaultLocation: 'Quito, Ecuador',
    extraTags:       ['ecuador', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Quito daily; its terms forbid unauthorised commercial use
  {
    id:              'el-comercio-ec',
    name:            'El Comercio (Ecuador)',
    feedUrl:         'https://www.elcomercio.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'EC',
    defaultLat:      -0.18,
    defaultLng:      -78.47,
    defaultLocation: 'Quito, Ecuador',
    extraTags:       ['ecuador', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Asunción daily
  {
    id:              'la-nacion-py',
    name:            'La Nación (Paraguay)',
    feedUrl:         'https://www.lanacion.com.py/arc/outboundfeeds/rss/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.68,
    countryCode:     'PY',
    defaultLat:      -25.26,
    defaultLng:      -57.58,
    defaultLocation: 'Asunción, Paraguay',
    extraTags:       ['paraguay', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Tegucigalpa news site
  {
    id:              'proceso-digital-hn',
    name:            'Proceso Digital (Honduras)',
    feedUrl:         'https://proceso.hn/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'HN',
    defaultLat:      14.07,
    defaultLng:      -87.19,
    defaultLocation: 'Tegucigalpa, Honduras',
    extraTags:       ['honduras', 'central-america', 'latin-america'],
    language:        'es',
  },
  // independent Nicaraguan news site
  {
    id:              'despacho-505',
    name:            'Despacho 505 (Nicaragua)',
    feedUrl:         'https://despacho505.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'NI',
    defaultLat:      12.11,
    defaultLng:      -86.24,
    defaultLocation: 'Managua, Nicaragua',
    extraTags:       ['nicaragua', 'central-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // Guatemalan community and indigenous-rights newsroom; about 5 items a day
  {
    id:              'prensa-comunitaria-gt',
    name:            'Prensa Comunitaria (Guatemala)',
    feedUrl:         'https://prensacomunitaria.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.76,
    countryCode:     'GT',
    defaultLat:      14.63,
    defaultLng:      -90.51,
    defaultLocation: 'Guatemala City, Guatemala',
    extraTags:       ['guatemala', 'central-america', 'latin-america', 'indigenous-rights', 'independent-media'],
    language:        'es',
  },
  // Port of Spain TV news; a national outlet, so stories that name no place are pinned at home
  {
    id:              'cnc3-tt',
    name:            'CNC3 (Trinidad and Tobago)',
    feedUrl:         'https://www.cnc3.co.tt/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'TT',
    defaultLat:      10.65,
    defaultLng:      -61.51,
    defaultLocation: 'Port of Spain, Trinidad and Tobago',
    extraTags:       ['trinidad-and-tobago', 'caribbean'],
    language:        'en',
  },
  // Tijuana investigative weekly and site
  {
    id:              'zeta-tijuana',
    name:            'Zeta Tijuana',
    feedUrl:         'https://zetatijuana.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'MX',
    defaultLat:      19.43,
    defaultLng:      -99.13,
    defaultLocation: 'Mexico City, Mexico',
    extraTags:       ['mexico', 'north-america', 'latin-america', 'investigative'],
    language:        'es',
  },
  // Mexico City news site (its Mexico feed, from the RSS channels it publishes)
  {
    id:              'aristegui-noticias',
    name:            'Aristegui Noticias (Mexico)',
    feedUrl:         'https://editorial.aristeguinoticias.com/category/mexico/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.76,
    countryCode:     'MX',
    defaultLat:      19.43,
    defaultLng:      -99.13,
    defaultLocation: 'Mexico City, Mexico',
    extraTags:       ['mexico', 'north-america', 'latin-america', 'investigative'],
    language:        'es',
  },
  // the federal news agency of EBC, Brazil's government-owned media company; its terms allow reproduction with credit
  {
    id:              'agencia-brasil',
    name:            'Agência Brasil',
    feedUrl:         'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'BR',
    defaultLat:      -15.8,
    defaultLng:      -47.89,
    defaultLocation: 'Brasília, Brazil',
    extraTags:       ['brazil', 'south-america', 'latin-america', 'state-media'],
    language:        'pt',
  },
  // Buenos Aires digital daily
  {
    id:              'eldiarioar',
    name:            'elDiarioAR (Argentina)',
    feedUrl:         'https://www.eldiarioar.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.78,
    countryCode:     'AR',
    defaultLat:      -34.6,
    defaultLng:      -58.38,
    defaultLocation: 'Buenos Aires, Argentina',
    extraTags:       ['argentina', 'south-america', 'latin-america'],
    language:        'es',
  },
  // independent Venezuelan news site
  {
    id:              'el-pitazo',
    name:            'El Pitazo (Venezuela)',
    feedUrl:         'https://elpitazo.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'VE',
    defaultLat:      10.49,
    defaultLng:      -66.88,
    defaultLocation: 'Caracas, Venezuela',
    extraTags:       ['venezuela', 'south-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // Panama City TV news; its terms forbid copying content (we keep headline, summary and link only)
  {
    id:              'tvn-panama',
    name:            'TVN Noticias (Panama)',
    feedUrl:         'https://www.tvn-2.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'PA',
    defaultLat:      8.98,
    defaultLng:      -79.52,
    defaultLocation: 'Panama City, Panama',
    extraTags:       ['panama', 'central-america', 'latin-america'],
    language:        'es',
  },
  // Africa and the Middle East
  // Zambian online news site; first outlet for Zambia
  {
    id:              'zambia-monitor',
    name:            'Zambia Monitor',
    feedUrl:         'https://www.zambiamonitor.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'ZM',
    defaultLat:      -15.39,
    defaultLng:      28.32,
    defaultLocation: 'Lusaka, Zambia',
    extraTags:       ['zambia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Centre for Innovation and Technology, Bulawayo; calls itself the leading independent news source for Zimbabwe South
  {
    id:              'cite-zw',
    name:            'CITE (Zimbabwe)',
    feedUrl:         'https://cite.org.zw/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'ZW',
    defaultLat:      -17.83,
    defaultLng:      31.05,
    defaultLocation: 'Harare, Zimbabwe',
    extraTags:       ['zimbabwe', 'southern-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // Zimbabwean online news site; no terms page found
  {
    id:              '263chat-zw',
    name:            '263Chat',
    feedUrl:         'https://www.263chat.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'ZW',
    defaultLat:      -17.83,
    defaultLng:      31.05,
    defaultLocation: 'Harare, Zimbabwe',
    extraTags:       ['zimbabwe', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Botswana newspaper site; its editorial policy stresses independence
  {
    id:              'sunday-standard-bw',
    name:            'Sunday Standard (Botswana)',
    feedUrl:         'https://www.sundaystandard.info/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BW',
    defaultLat:      -24.65,
    defaultLng:      25.91,
    defaultLocation: 'Gaborone, Botswana',
    extraTags:       ['botswana', 'southern-africa', 'africa'],
    language:        'en',
    parked:          'bot check page (HTTP 403), Nov 5, 2026',
  },
  // Botswana newspaper site; about 2 stories a day
  {
    id:              'botswana-gazette',
    name:            'The Botswana Gazette',
    feedUrl:         'https://www.thegazette.news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'BW',
    defaultLat:      -24.65,
    defaultLng:      25.91,
    defaultLocation: 'Gaborone, Botswana',
    extraTags:       ['botswana', 'southern-africa', 'africa'],
    language:        'en',
  },
  // daily of Tanzania Standard Newspapers (state-owned); labelled state media
  {
    id:              'daily-news-tz',
    name:            'Daily News (Tanzania)',
    feedUrl:         'https://dailynews.co.tz/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'TZ',
    defaultLat:      -6.16,
    defaultLng:      35.75,
    defaultLocation: 'Dodoma, Tanzania',
    extraTags:       ['tanzania', 'east-africa', 'africa', 'state-media'],
    language:        'en',
  },
  // English-language news on Mozambique, edited in Maputo and London; about 1 story a day
  {
    id:              'zitamar-mz',
    name:            'Zitamar News',
    feedUrl:         'https://www.zitamar.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'MZ',
    defaultLat:      -25.97,
    defaultLng:      32.57,
    defaultLocation: 'Maputo, Mozambique',
    extraTags:       ['mozambique', 'southern-africa', 'africa', 'cabo-delgado'],
    language:        'en',
  },
  // Mozambican news site in Portuguese; no home pin
  {
    id:              'carta-mz',
    name:            'Carta de Moçambique',
    feedUrl:         'https://cartamz.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'MZ',
    defaultLat:      -25.97,
    defaultLng:      32.57,
    defaultLocation: 'Maputo, Mozambique',
    extraTags:       ['mozambique', 'southern-africa', 'africa', 'portuguese'],
    language:        'pt',
  },
  // Angolan anti-corruption investigative site in Portuguese; slow (about 1 story every 3 days); no home pin
  {
    id:              'maka-angola',
    name:            'Maka Angola',
    feedUrl:         'https://www.makaangola.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'AO',
    defaultLat:      -8.84,
    defaultLng:      13.23,
    defaultLocation: 'Luanda, Angola',
    extraTags:       ['angola', 'southern-africa', 'africa', 'corruption', 'portuguese'],
    language:        'pt',
  },
  // Eswatini's oldest daily (founded as the Times of Swaziland)
  {
    id:              'times-of-eswatini',
    name:            'Times of Eswatini',
    feedUrl:         'https://times.co.sz/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SZ',
    defaultLat:      -26.31,
    defaultLng:      31.14,
    defaultLocation: 'Mbabane, Eswatini',
    extraTags:       ['eswatini', 'southern-africa', 'africa'],
    language:        'en',
  },
  // English edition of Togo's business news site; first outlet for Togo
  {
    id:              'togo-first',
    name:            'Togo First',
    feedUrl:         'https://www.togofirst.com/en/rss-en',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'TG',
    defaultLat:      6.13,
    defaultLng:      1.22,
    defaultLocation: 'Lomé, Togo',
    extraTags:       ['togo', 'west-africa', 'africa', 'business'],
    language:        'en',
  },
  // Beninese news site in French; carries much world news; no home pin
  {
    id:              'nouvelle-tribune-bj',
    name:            'La Nouvelle Tribune (Benin)',
    feedUrl:         'https://lanouvelletribune.info/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'BJ',
    defaultLat:      6.5,
    defaultLng:      2.6,
    defaultLocation: 'Porto-Novo, Benin',
    extraTags:       ['benin', 'west-africa', 'africa', 'francophone'],
    language:        'fr',
  },
  // Ivorian news site in French; no home pin
  {
    id:              'linfodrome-ci',
    name:            'Linfodrome',
    feedUrl:         'https://www.linfodrome.com/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'CI',
    defaultLat:      5.36,
    defaultLng:      -4.01,
    defaultLocation: 'Abidjan, Côte d\'Ivoire',
    extraTags:       ['cote-divoire', 'west-africa', 'africa', 'francophone'],
    language:        'fr',
  },
  // Nigerien news site in French; separate stories; headlines follow the military government line; no home pin
  {
    id:              'tamtaminfo-ne',
    name:            'Tamtaminfo (Niger)',
    feedUrl:         'https://tamtaminfo.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.58,
    countryCode:     'NE',
    defaultLat:      13.51,
    defaultLng:      2.11,
    defaultLocation: 'Niamey, Niger',
    extraTags:       ['niger', 'sahel', 'africa', 'francophone'],
    language:        'fr',
  },
  // English-language news agency based in Limbe; about 1 story a day
  {
    id:              'cameroon-news-agency',
    name:            'Cameroon News Agency',
    feedUrl:         'https://cameroonnewsagency.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'CM',
    defaultLat:      3.85,
    defaultLng:      11.5,
    defaultLocation: 'Yaoundé, Cameroon',
    extraTags:       ['cameroon', 'central-africa', 'africa', 'anglophone-crisis'],
    language:        'en',
  },
  // Congolese news site in French; first national outlet for DR Congo; no home pin
  {
    id:              'actualite-cd',
    name:            'Actualite.cd',
    feedUrl:         'https://actualite.cd/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'CD',
    defaultLat:      -4.44,
    defaultLng:      15.27,
    defaultLocation: 'Kinshasa, DR Congo',
    extraTags:       ['dr-congo', 'central-africa', 'africa', 'francophone'],
    language:        'fr',
  },
  // Gabonese news site in French; no home pin
  {
    id:              'gabonreview',
    name:            'Gabonreview',
    feedUrl:         'https://www.gabonreview.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'GA',
    defaultLat:      0.39,
    defaultLng:      9.45,
    defaultLocation: 'Libreville, Gabon',
    extraTags:       ['gabon', 'central-africa', 'africa', 'francophone'],
    language:        'fr',
  },
  // Burundian news site, French feed (its English feed stopped years ago); no home pin
  {
    id:              'iwacu-burundi',
    name:            'Iwacu (Burundi)',
    feedUrl:         'https://www.iwacu-burundi.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'BI',
    defaultLat:      -3.43,
    defaultLng:      29.93,
    defaultLocation: 'Gitega, Burundi',
    extraTags:       ['burundi', 'great-lakes', 'africa', 'independent-media', 'francophone'],
    language:        'fr',
  },
  // Eritrean news and opinion site run from abroad; slow (under 1 a day); no home pin
  {
    id:              'awate-er',
    name:            'Awate.com (Eritrea)',
    feedUrl:         'https://awate.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'ER',
    defaultLat:      15.32,
    defaultLng:      38.93,
    defaultLocation: 'Asmara, Eritrea',
    extraTags:       ['eritrea', 'horn-of-africa', 'africa', 'exile-media', 'opinion'],
    language:        'en',
  },
  // Tunisian news site in French; footer says all rights reserved; no home pin
  {
    id:              'kapitalis-tn',
    name:            'Kapitalis (Tunisia)',
    feedUrl:         'https://kapitalis.com/tunisie/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'TN',
    defaultLat:      36.81,
    defaultLng:      10.18,
    defaultLocation: 'Tunis, Tunisia',
    extraTags:       ['tunisia', 'north-africa', 'africa', 'francophone'],
    language:        'fr',
  },
  // English edition of a Yemeni news site; anti-Houthi framing; first outlet for Yemen
  {
    id:              'yemen-monitor',
    name:            'Yemen Monitor',
    feedUrl:         'https://www.yemenmonitor.com/en/feed',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'YE',
    defaultLat:      15.37,
    defaultLng:      44.19,
    defaultLocation: 'Sanaa, Yemen',
    extraTags:       ['yemen', 'middle-east', 'gulf', 'houthis'],
    language:        'en',
  },
  // Palestinian news network, English site; first outlet for Palestine
  {
    id:              'pnn-english',
    name:            'Palestine News Network (English)',
    feedUrl:         'https://english.pnn.ps/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'PS',
    defaultLat:      31.5,
    defaultLng:      34.47,
    defaultLocation: 'Gaza, Palestine',
    extraTags:       ['palestine', 'west-bank', 'gaza', 'middle-east'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (Q5: past 400 feeds, round 3) ──────────────────────
  // 43 more from a third round of four regional searches, aimed at the
  // countries that had no outlet or only one; checked the same way (the
  // server's own request, the reader's own parser, terms read where the site
  // links them). Spanish, Portuguese and French feeds get no home pin.
  // Algiers news site founded in 2009 (its footer); national news with much service news (exchange rates, visas, pensions)
  {
    id:              'algerie360',
    name:            'Algérie 360',
    feedUrl:         'https://www.algerie360.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'DZ',
    defaultLat:      36.75,
    defaultLng:      3.06,
    defaultLocation: 'Algiers, Algeria',
    extraTags:       ['algeria', 'maghreb', 'north-africa', 'africa'],
    language:        'fr',
  },
  // Djibouti's state news agency; the only Djibouti feed that answered the server (La Nation and Human Village failed TLS)
  {
    id:              'adi-djibouti',
    name:            'ADI (Agence Djiboutienne d’Information)',
    feedUrl:         'https://www.adi.dj/rss',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'DJ',
    defaultLat:      11.59,
    defaultLng:      43.15,
    defaultLocation: 'Djibouti, Djibouti',
    extraTags:       ['djibouti', 'horn-of-africa', 'east-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // Gambian online news and TV outlet with bylined reporting; mostly Gambian politics
  {
    id:              'kerr-fatou-gm',
    name:            'Kerr Fatou (Gambia)',
    feedUrl:         'https://www.kerrfatou.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'GM',
    defaultLat:      13.45,
    defaultLng:      -16.58,
    defaultLocation: 'Banjul, Gambia',
    extraTags:       ['gambia', 'west-africa', 'africa'],
    language:        'en',
  },
  // Freetown news site, its politics section (the site-wide feed is mostly music and entertainment); a few items a day
  {
    id:              'sierraloaded-sl',
    name:            'Sierraloaded (Sierra Leone)',
    feedUrl:         'https://sierraloaded.sl/category/politics/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'SL',
    defaultLat:      8.48,
    defaultLng:      -13.23,
    defaultLocation: 'Freetown, Sierra Leone',
    extraTags:       ['sierra-leone', 'west-africa', 'africa'],
    language:        'en',
  },
  // Bangui radio of the Fondation Hirondelle (like Studio Tamani); its legal notice needs written consent for reproduction
  {
    id:              'radio-ndeke-luka',
    name:            'Radio Ndeke Luka (Central African Republic)',
    feedUrl:         'https://www.radiondekeluka.org/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'CF',
    defaultLat:      4.39,
    defaultLng:      18.56,
    defaultLocation: 'Bangui, Central African Republic',
    extraTags:       ['central-african-republic', 'central-africa', 'africa', 'independent-media'],
    language:        'fr',
  },
  // Praia weekly and news site; some world news is wire copy
  {
    id:              'expresso-das-ilhas',
    name:            'Expresso das Ilhas (Cabo Verde)',
    feedUrl:         'https://expressodasilhas.cv/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'CV',
    defaultLat:      14.93,
    defaultLng:      -23.51,
    defaultLocation: 'Praia, Cabo Verde',
    extraTags:       ['cabo-verde', 'west-africa', 'africa'],
    language:        'pt',
  },
  // Praia independent weekly; Cabo Verde's second outlet, so its stories can reach 2+ outlets
  {
    id:              'a-nacao-cv',
    name:            'A Nação (Cabo Verde)',
    feedUrl:         'https://www.anacao.cv/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CV',
    defaultLat:      14.93,
    defaultLng:      -23.51,
    defaultLocation: 'Praia, Cabo Verde',
    extraTags:       ['cabo-verde', 'west-africa', 'africa'],
    language:        'pt',
  },
  // Bissau newspaper and news site; a few items a day
  {
    id:              'o-democrata-gw',
    name:            'O Democrata (Guinea-Bissau)',
    feedUrl:         'https://www.odemocratagb.com/?feed=rss2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'GW',
    defaultLat:      11.86,
    defaultLng:      -15.6,
    defaultLocation: 'Bissau, Guinea-Bissau',
    extraTags:       ['guinea-bissau', 'west-africa', 'africa'],
    language:        'pt',
  },
  // Moroni news site; its about page lets anyone reproduce content with credit and a link
  {
    id:              'comores-infos',
    name:            'Comores Infos',
    feedUrl:         'https://www.comoresinfos.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'KM',
    defaultLat:      -11.7,
    defaultLng:      43.26,
    defaultLocation: 'Moroni, Comoros',
    extraTags:       ['comoros', 'indian-ocean', 'africa'],
    language:        'fr',
  },
  // Nouakchott news agency, French edition; republishing allowed with a link and no changes
  {
    id:              'sahara-medias-fr',
    name:            'Sahara Médias (Mauritania, French)',
    feedUrl:         'https://fr.saharamedias.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MR',
    defaultLat:      18.08,
    defaultLng:      -15.98,
    defaultLocation: 'Nouakchott, Mauritania',
    extraTags:       ['mauritania', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // São Tomé digital daily founded in 2000 (its about page); a few items a day, often in one batch
  {
    id:              'tela-non-st',
    name:            'Téla Nón (São Tomé and Príncipe)',
    feedUrl:         'https://www.telanon.info/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'ST',
    defaultLat:      0.34,
    defaultLng:      6.73,
    defaultLocation: 'São Tomé, São Tomé and Príncipe',
    extraTags:       ['sao-tome-and-principe', 'central-africa', 'africa'],
    language:        'pt',
  },
  // English-language Libya news site; leans to the eastern (Benghazi) authorities' framing, hence 0.62
  {
    id:              'libya-review',
    name:            'Libya Review',
    feedUrl:         'https://libyareview.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'LY',
    defaultLat:      32.89,
    defaultLng:      13.19,
    defaultLocation: 'Tripoli, Libya',
    extraTags:       ['libya', 'north-africa', 'africa'],
    language:        'en',
  },
  // Libreville news site (round 2's saved answer)
  {
    id:              'gabonactu',
    name:            'Gabonactu',
    feedUrl:         'https://gabonactu.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'GA',
    defaultLat:      0.39,
    defaultLng:      9.45,
    defaultLocation: 'Libreville, Gabon',
    extraTags:       ['gabon', 'central-africa', 'africa'],
    language:        'fr',
  },
  // collective of Burundian journalists, many working from exile (round 2's saved answer)
  {
    id:              'sos-medias-burundi',
    name:            'SOS Médias Burundi',
    feedUrl:         'https://www.sosmediasburundi.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BI',
    defaultLat:      -3.43,
    defaultLng:      29.93,
    defaultLocation: 'Gitega, Burundi',
    extraTags:       ['burundi', 'great-lakes', 'east-africa', 'africa', 'independent-media'],
    language:        'fr',
  },
  // Cotonou news site, its Benin section (round 2's saved answer); its legal notice forbids reproduction without the publisher's express permission
  {
    id:              'benin-web-tv',
    name:            'Benin Web TV',
    feedUrl:         'https://beninwebtv.com/pays/afrique/afrique-de-louest/benin/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'BJ',
    defaultLat:      6.5,
    defaultLng:      2.6,
    defaultLocation: 'Porto-Novo, Benin',
    extraTags:       ['benin', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Ouagadougou news site; independent reporting under the military government is restricted, hence 0.68; its legal notice forbids reproduction without the publisher's express permission
  {
    id:              'burkina24',
    name:            'Burkina24 (Burkina Faso)',
    feedUrl:         'https://burkina24.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'BF',
    defaultLat:      12.37,
    defaultLng:      -1.52,
    defaultLocation: 'Ouagadougou, Burkina Faso',
    extraTags:       ['burkina-faso', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Togolese news site ('le portail togolais', its title); mostly Togo politics and society
  {
    id:              'icilome-tg',
    name:            'iciLomé (Togo)',
    feedUrl:         'https://icilome.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'TG',
    defaultLat:      6.13,
    defaultLng:      1.22,
    defaultLocation: 'Lomé, Togo',
    extraTags:       ['togo', 'west-africa', 'africa'],
    language:        'fr',
  },
  // N'Djamena news site; some items are in Arabic and fail the reader's language check; its legal notice forbids reproduction without written permission
  {
    id:              'alwihda-info',
    name:            'Alwihda Info (Chad)',
    feedUrl:         'https://www.alwihdainfo.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'TD',
    defaultLat:      12.13,
    defaultLng:      15.06,
    defaultLocation: 'N\'Djamena, Chad',
    extraTags:       ['chad', 'sahel', 'central-africa', 'africa'],
    language:        'fr',
  },
  // Kigali news site founded in 2014 (its about page); independent reporting in Rwanda is restricted, hence 0.62
  {
    id:              'kt-press-rw',
    name:            'KT Press (Rwanda)',
    feedUrl:         'https://www.ktpress.rw/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'RW',
    defaultLat:      -1.94,
    defaultLng:      30.06,
    defaultLocation: 'Kigali, Rwanda',
    extraTags:       ['rwanda', 'east-africa', 'great-lakes', 'africa'],
    language:        'en',
  },
  // Windhoek weekly and daily news site
  {
    id:              'windhoek-observer',
    name:            'Windhoek Observer (Namibia)',
    feedUrl:         'https://observer24.com.na/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'NA',
    defaultLat:      -22.56,
    defaultLng:      17.08,
    defaultLocation: 'Windhoek, Namibia',
    extraTags:       ['namibia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Yerevan investigative news site (Hetq Ltd., since 2001), English edition
  {
    id:              'hetq-am',
    name:            'Hetq (Armenia)',
    feedUrl:         'https://hetq.am/en/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'AM',
    defaultLat:      40.18,
    defaultLng:      44.51,
    defaultLocation: 'Yerevan, Armenia',
    extraTags:       ['armenia', 'caucasus', 'investigative', 'independent-media'],
    language:        'en',
  },
  // Yerevan magazine of reporting and analysis (EVN News Foundation, 2017); about one item a day
  {
    id:              'evn-report',
    name:            'EVN Report (Armenia)',
    feedUrl:         'https://evnreport.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'AM',
    defaultLat:      40.18,
    defaultLng:      44.51,
    defaultLocation: 'Yerevan, Armenia',
    extraTags:       ['armenia', 'caucasus', 'analysis', 'independent-media'],
    language:        'en',
  },
  // Armenian-American weekly of the Hairenik Association (it also carries ARF party news); diaspora, so no home pin
  {
    id:              'armenian-weekly',
    name:            'The Armenian Weekly',
    feedUrl:         'https://armenianweekly.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'AM',
    defaultLat:      40.18,
    defaultLng:      44.51,
    defaultLocation: 'Yerevan, Armenia',
    extraTags:       ['armenia', 'caucasus', 'diaspora'],
    language:        'en',
  },
  // independent Azerbaijani newsroom in exile (publisher registered in Berlin), so no home pin; slow English feed (10 items over 47 days)
  {
    id:              'meydan-tv-en',
    name:            'Meydan TV (Azerbaijan, English)',
    feedUrl:         'https://www.meydan.tv/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'AZ',
    defaultLat:      40.41,
    defaultLng:      49.87,
    defaultLocation: 'Baku, Azerbaijan',
    extraTags:       ['azerbaijan', 'caucasus', 'independent-media', 'exile-media'],
    language:        'en',
  },
  // Turkmenistan's state news agency (headlines only, no summaries); no independent English feed works today, hence state media at 0.45
  {
    id:              'tdh-turkmenistan',
    name:            'TDH (Turkmenistan State News Agency)',
    feedUrl:         'https://tdh.gov.tm/en/rss.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'TM',
    defaultLat:      37.96,
    defaultLng:      58.33,
    defaultLocation: 'Ashgabat, Turkmenistan',
    extraTags:       ['turkmenistan', 'central-asia', 'asia', 'state-media'],
    language:        'en',
  },
  // Monaco's English-language news site; several items a day
  {
    id:              'monaco-life',
    name:            'Monaco Life',
    feedUrl:         'https://monacolife.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MC',
    defaultLat:      43.73,
    defaultLng:      7.42,
    defaultLocation: 'Monaco, Monaco',
    extraTags:       ['monaco', 'french-riviera', 'europe'],
    language:        'en',
  },
  // the Holy See's missionary news agency (Pontifical Mission Societies, since 1927; content under CC BY 4.0); it reports on churches worldwide, so no home pin
  {
    id:              'agenzia-fides',
    name:            'Agenzia Fides (Vatican)',
    feedUrl:         'https://www.fides.org/en/news/rss',
    category:        'culture',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'VA',
    defaultLat:      41.9,
    defaultLng:      12.45,
    defaultLocation: 'Vatican City, Vatican City',
    extraTags:       ['vatican', 'holy-see', 'catholic-church', 'religion', 'state-media'],
    language:        'en',
  },
  // Cyprus business weekly (since 1993) and site; Cyprus on 3 of 9 placed items, so no home pin
  {
    id:              'financial-mirror-cy',
    name:            'Financial Mirror (Cyprus)',
    feedUrl:         'https://www.financialmirror.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CY',
    defaultLat:      35.17,
    defaultLng:      33.36,
    defaultLocation: 'Nicosia, Cyprus',
    extraTags:       ['cyprus', 'eastern-mediterranean', 'europe', 'business'],
    language:        'en',
  },
  // Riga news site covering the Baltic states and the world; Latvia on 9 of 19 placed items, so no home pin
  {
    id:              'bnn-baltic',
    name:            'BNN (Baltic News Network)',
    feedUrl:         'https://bnn-news.com/feed.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LV',
    defaultLat:      56.95,
    defaultLng:      24.11,
    defaultLocation: 'Riga, Latvia',
    extraTags:       ['latvia', 'baltics', 'europe'],
    language:        'en',
  },
  // Maltese news site, English edition (Beacon Media Group, a company of the Archdiocese of Malta)
  {
    id:              'newsbook-mt',
    name:            'Newsbook (Malta)',
    feedUrl:         'https://newsbook.com.mt/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MT',
    defaultLat:      35.9,
    defaultLng:      14.51,
    defaultLocation: 'Valletta, Malta',
    extraTags:       ['malta', 'southern-europe', 'europe'],
    language:        'en',
  },
  // specialist newsroom on North Korea (8 of its 10 items placed there); it reports from outside the country, so no home pin
  {
    id:              'daily-nk-en',
    name:            'Daily NK (English)',
    feedUrl:         'https://www.dailynk.com/english/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'KP',
    defaultLat:      39.04,
    defaultLng:      125.76,
    defaultLocation: 'Pyongyang, North Korea',
    extraTags:       ['north-korea', 'east-asia', 'asia', 'independent-media'],
    language:        'en',
  },
  // Doha English daily (its Qatar section feed)
  {
    id:              'gulf-times-qatar',
    name:            'Gulf Times (Qatar)',
    feedUrl:         'https://www.gulf-times.com/rssFeed/8',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'QA',
    defaultLat:      25.29,
    defaultLng:      51.53,
    defaultLocation: 'Doha, Qatar',
    extraTags:       ['qatar', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Kuwait's first licensed English-language news website (founded 1996)
  {
    id:              'times-kuwait',
    name:            'The Times Kuwait',
    feedUrl:         'https://timeskuwait.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'KW',
    defaultLat:      29.38,
    defaultLng:      47.99,
    defaultLocation: 'Kuwait City, Kuwait',
    extraTags:       ['kuwait', 'gulf', 'middle-east'],
    language:        'en',
  },
  // business news on Iraq since 2010, published by a UK company; it covers only Iraq (18 of 20 items placed there), so stories that name no place are pinned at home
  {
    id:              'iraq-business-news',
    name:            'Iraq Business News',
    feedUrl:         'https://www.iraq-businessnews.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'IQ',
    defaultLat:      33.32,
    defaultLng:      44.37,
    defaultLocation: 'Baghdad, Iraq',
    extraTags:       ['iraq', 'middle-east', 'business', 'energy'],
    language:        'en',
  },
  // US-based independent news and opinion site on Palestine with reporters in Gaza; strongly pro-Palestinian framing, hence 0.60; based abroad, so no home pin
  {
    id:              'mondoweiss',
    name:            'Mondoweiss',
    feedUrl:         'https://mondoweiss.net/feed/',
    category:        'geopolitics',
    biasLabel:       'left',
    reliability:     0.60,
    countryCode:     'PS',
    defaultLat:      31.5,
    defaultLng:      34.47,
    defaultLocation: 'Gaza, Palestine',
    extraTags:       ['palestine', 'israel', 'middle-east', 'independent-media'],
    language:        'en',
  },
  // Antigua.news, its Antigua and Barbuda section; its about page calls it the official news channel of Antigua and Barbuda's embassy in Madrid, so labelled state media (0.55); the only Antigua outlet that let the container in
  {
    id:              'antigua-news',
    name:            'Antigua News (Antigua and Barbuda)',
    feedUrl:         'https://antigua.news/rss/antigua-and-barbuda.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'AG',
    defaultLat:      17.12,
    defaultLng:      -61.85,
    defaultLocation: 'St. John\'s, Antigua and Barbuda',
    extraTags:       ['antigua-and-barbuda', 'caribbean', 'state-media'],
    language:        'en',
  },
  // La Paz digital daily (its latest-news feed); Spanish, so no home pin
  {
    id:              'vision-360-bo',
    name:            'Visión 360 (Bolivia)',
    feedUrl:         'https://www.vision360.bo/rss/noticias',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BO',
    defaultLat:      -16.5,
    defaultLng:      -68.15,
    defaultLocation: 'La Paz, Bolivia',
    extraTags:       ['bolivia', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Channel 7's nightly newscast stories (Belize City); each night's stories carry that day's date at 00:00 UTC
  {
    id:              '7news-belize',
    name:            '7 News Belize',
    feedUrl:         'https://www.7newsbelize.com/rss.php',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BZ',
    defaultLat:      17.25,
    defaultLng:      -88.77,
    defaultLocation: 'Belmopan, Belize',
    extraTags:       ['belize', 'central-america', 'caribbean'],
    language:        'en',
  },
  // independent Georgetown news site; a few reports a day plus opinion columns
  {
    id:              'demerara-waves',
    name:            'Demerara Waves (Guyana)',
    feedUrl:         'https://demerarawaves.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'GY',
    defaultLat:      6.8,
    defaultLng:      -58.16,
    defaultLocation: 'Georgetown, Guyana',
    extraTags:       ['guyana', 'caribbean', 'south-america', 'independent-media'],
    language:        'en',
  },
  // Kingston daily (its news feed); Jamaica's oldest newspaper
  {
    id:              'jamaica-gleaner',
    name:            'The Gleaner (Jamaica)',
    feedUrl:         'https://jamaica-gleaner.com/feed/news.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'JM',
    defaultLat:      17.97,
    defaultLng:      -76.79,
    defaultLocation: 'Kingston, Jamaica',
    extraTags:       ['jamaica', 'caribbean'],
    language:        'en',
  },
  // Vanuatu's public broadcaster (Port Vila); 1 to 4 stories a day
  {
    id:              'vbtc-vu',
    name:            'VBTC (Vanuatu)',
    feedUrl:         'https://vbtc.vu/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'VU',
    defaultLat:      -17.73,
    defaultLng:      168.32,
    defaultLocation: 'Port Vila, Vanuatu',
    extraTags:       ['vanuatu', 'pacific', 'oceania', 'public-broadcaster'],
    language:        'en',
  },
  // ── Added Oct 20, 2026 (Q5: toward 500 feeds, round 4) ──────────────────────
  // 73 more from a fourth round of seven regional searches, aimed at the
  // countries that had no outlet or only one; checked the same way (the
  // server's own request, the reader's own parser, terms read where the site
  // links them), and each answered the server-style request within 10 seconds.
  // Spanish, Portuguese and French feeds get no home pin.
  // English edition of Euronews Albania, a Tirana news channel and site; Albania's first outlet
  {
    id:              'euronews-albania',
    name:            'Euronews Albania (English)',
    feedUrl:         'https://euronews.al/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'AL',
    defaultLat:      41.33,
    defaultLng:      19.82,
    defaultLocation: 'Tirana, Albania',
    extraTags:       ['albania', 'balkans', 'europe'],
    language:        'en',
  },
  // independent Belarusian newsroom (formerly Reform.by), working from Warsaw in exile since 2021; based abroad, so no home pin
  {
    id:              'reform-news-by',
    name:            'Reform.news (Belarus, English)',
    feedUrl:         'https://reform.news/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BY',
    defaultLat:      53.9,
    defaultLng:      27.57,
    defaultLocation: 'Minsk, Belarus',
    extraTags:       ['belarus', 'eastern-europe', 'europe', 'independent-media', 'exile-media'],
    language:        'en',
  },
  // Irish technology, science and start-up news site (online since 2001); most unplaced items are global tech stories, so no home pin
  {
    id:              'silicon-republic',
    name:            'Silicon Republic (Ireland)',
    feedUrl:         'https://www.siliconrepublic.com/feed/',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'IE',
    defaultLat:      53.35,
    defaultLng:      -6.26,
    defaultLocation: 'Dublin, Ireland',
    extraTags:       ['ireland', 'technology', 'science', 'business', 'europe'],
    language:        'en',
  },
  // the only English-language radio station based in Monaco, in its own words (site run by Global); covers Monaco and the French Riviera, so no home pin; a few celebrity items
  {
    id:              'riviera-radio-mc',
    name:            'Riviera Radio (Monaco)',
    feedUrl:         'https://www.rivieraradio.mc/feed/latest-news/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'MC',
    defaultLat:      43.73,
    defaultLng:      7.42,
    defaultLocation: 'Monaco, Monaco',
    extraTags:       ['monaco', 'france', 'riviera', 'europe'],
    language:        'en',
  },
  // Warsaw defence and security news site (Defence24 Sp. z o.o.), English edition; mostly international coverage, so no home pin
  {
    id:              'defence24-en',
    name:            'Defence24 (English)',
    feedUrl:         'https://defence24.com/_rss',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'PL',
    defaultLat:      52.23,
    defaultLng:      21.01,
    defaultLocation: 'Warsaw, Poland',
    extraTags:       ['poland', 'defence', 'security', 'nato', 'europe'],
    language:        'en',
  },
  // Madrid news site on Spanish politics, diplomacy and business (Expat Express SL), English edition
  {
    id:              'diplomat-in-spain',
    name:            'The Diplomat in Spain',
    feedUrl:         'https://thediplomatinspain.com/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'ES',
    defaultLat:      40.42,
    defaultLng:      -3.7,
    defaultLocation: 'Madrid, Spain',
    extraTags:       ['spain', 'southern-europe', 'europe', 'diplomacy'],
    language:        'en',
  },
  // English service of Ziarul Financiar, Romania's business daily
  {
    id:              'zf-english-ro',
    name:            'ZF English (Ziarul Financiar)',
    feedUrl:         'https://www.zfenglish.com/rss/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'RO',
    defaultLat:      44.43,
    defaultLng:      26.1,
    defaultLocation: 'Bucharest, Romania',
    extraTags:       ['romania', 'eastern-europe', 'europe', 'business'],
    language:        'en',
  },
  // English site of the Amman news site Ammon News, which calls itself an alternative media outlet (its Jordan News section feed; JO on 5 of its 8 placed items); many items are translations from the Arabic site
  {
    id:              'ammon-news-en',
    name:            'Ammon News (English)',
    feedUrl:         'https://en.ammonnews.net/rss.php?type=news&id=2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'JO',
    defaultLat:      31.95,
    defaultLng:      35.93,
    defaultLocation: 'Amman, Jordan',
    extraTags:       ['jordan', 'levant', 'middle-east'],
    language:        'en',
  },
  // news service on Turkmenistan with an editorial presence there (administrative office in Pakistan); close to the official line, hence 0.52; about half its items are Russian versions, which fail the language check
  {
    id:              'news-central-asia-tm',
    name:            'News Central Asia (nCa)',
    feedUrl:         'https://feeds.feedburner.com/NewsCentralAsia',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.52,
    countryCode:     'TM',
    defaultLat:      37.96,
    defaultLng:      58.33,
    defaultLocation: 'Ashgabat, Turkmenistan',
    extraTags:       ['turkmenistan', 'central-asia', 'asia'],
    language:        'en',
  },
  // English edition of Tengrinews, by its own account Kazakhstan's No. 1 news site (founded 2010; KZ on 8 of its 10 placed items); some lifestyle items, and independent reporting in Kazakhstan is restricted, hence 0.64
  {
    id:              'tengrinews-en',
    name:            'Tengrinews (English)',
    feedUrl:         'https://en.tengrinews.kz/news.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'KZ',
    defaultLat:      51.17,
    defaultLng:      71.45,
    defaultLocation: 'Astana, Kazakhstan',
    extraTags:       ['kazakhstan', 'central-asia', 'asia'],
    language:        'en',
  },
  // private Tashkent news site (Gazeta News LLC), English edition; UZ on 14 of its 18 placed items
  {
    id:              'gazeta-uz-en',
    name:            'Gazeta.uz (English)',
    feedUrl:         'https://www.gazeta.uz/en/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'UZ',
    defaultLat:      41.3,
    defaultLng:      69.24,
    defaultLocation: 'Tashkent, Uzbekistan',
    extraTags:       ['uzbekistan', 'central-asia', 'asia'],
    language:        'en',
  },
  // English edition of Israel's business daily (its All News feed); IL on 11 of its 13 placed items
  {
    id:              'globes-en',
    name:            'Globes (English)',
    feedUrl:         'https://en.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=1725',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'IL',
    defaultLat:      31.77,
    defaultLng:      35.21,
    defaultLocation: 'Jerusalem, IL',
    extraTags:       ['israel', 'middle-east', 'business', 'technology'],
    language:        'en',
  },
  // Macau Portuguese-language newspaper (Praia Grande Edições); one batch per edition; in Portuguese, so no home pin
  {
    id:              'ponto-final-mo',
    name:            'Ponto Final (Macau)',
    feedUrl:         'https://pontofinal-macau.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'MO',
    defaultLat:      22.2,
    defaultLng:      113.54,
    defaultLocation: 'Macau, Macau',
    extraTags:       ['macau', 'china', 'east-asia', 'portuguese'],
    language:        'pt',
  },
  // Shanghai English-language site on Chinese society, state-owned; about one item a day
  {
    id:              'sixth-tone',
    name:            'Sixth Tone (China)',
    feedUrl:         'https://api.sixthtone.com/cont/output/rssApi',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'CN',
    defaultLat:      39.9,
    defaultLng:      116.41,
    defaultLocation: 'Beijing, CN',
    extraTags:       ['china', 'east-asia', 'state-media'],
    language:        'en',
  },
  // English service of Taiwan's Central News Agency (its FeedBurner feed)
  {
    id:              'focus-taiwan',
    name:            'Focus Taiwan (CNA English)',
    feedUrl:         'https://feeds.feedburner.com/rsscna/engnews/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'TW',
    defaultLat:      25.03,
    defaultLng:      121.57,
    defaultLocation: 'Taipei, Taiwan',
    extraTags:       ['taiwan', 'east-asia', 'asia-pacific', 'wire'],
    language:        'en',
  },
  // Taiwan online magazine founded by students and activists after the 2014 Sunflower Movement; about one item a day
  {
    id:              'new-bloom',
    name:            'New Bloom (Taiwan)',
    feedUrl:         'https://newbloommag.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.68,
    countryCode:     'TW',
    defaultLat:      25.03,
    defaultLng:      121.57,
    defaultLocation: 'Taipei, Taiwan',
    extraTags:       ['taiwan', 'east-asia', 'asia-pacific', 'independent-media'],
    language:        'en',
  },
  // Phnom Penh business news site; much corporate and event news
  {
    id:              'cambodia-investment-review',
    name:            'Cambodia Investment Review',
    feedUrl:         'https://cambodiainvestmentreview.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'KH',
    defaultLat:      11.56,
    defaultLng:      104.92,
    defaultLocation: 'Phnom Penh, Cambodia',
    extraTags:       ['cambodia', 'southeast-asia', 'business'],
    language:        'en',
  },
  // English-language Bali news site, tourism-heavy; local, so no home pin
  {
    id:              'bali-times',
    name:            'The Bali Times',
    feedUrl:         'https://thebalitimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'ID',
    defaultLat:      -6.21,
    defaultLng:      106.85,
    defaultLocation: 'Jakarta, ID',
    extraTags:       ['indonesia', 'bali', 'southeast-asia'],
    language:        'en',
  },
  // English edition of the Nepali news portal Khabarhub
  {
    id:              'khabarhub-en',
    name:            'Khabarhub English (Nepal)',
    feedUrl:         'https://english.khabarhub.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'NP',
    defaultLat:      27.72,
    defaultLng:      85.32,
    defaultLocation: 'Kathmandu, Nepal',
    extraTags:       ['nepal', 'south-asia'],
    language:        'en',
  },
  // Malaysian online news site (Mkini Dotcom), its English news feed; home pin kept because the place-finder knows few Malaysian places
  {
    id:              'malaysiakini-en',
    name:            'Malaysiakini (English)',
    feedUrl:         'https://www.malaysiakini.com/en/rss/news.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'MY',
    defaultLat:      3.14,
    defaultLng:      101.69,
    defaultLocation: 'Kuala Lumpur, Malaysia',
    extraTags:       ['malaysia', 'southeast-asia', 'independent-media'],
    language:        'en',
  },
  // English site of the Vietnam News Agency (VNA)
  {
    id:              'vietnamplus-en',
    name:            'VietnamPlus (English)',
    feedUrl:         'https://en.vietnamplus.vn/rss/home.rss',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'VN',
    defaultLat:      21.03,
    defaultLng:      105.85,
    defaultLocation: 'Hanoi, Vietnam',
    extraTags:       ['vietnam', 'southeast-asia', 'state-media'],
    language:        'en',
  },
  // Fiji TV's newsroom (Suva; the country's first commercial TV station, 1994); about 10 stories a day; 6 of 10 were sport or business releases on Oct 20
  {
    id:              'fiji-one-news',
    name:            'Fiji One News',
    feedUrl:         'https://fijionenews.com.fj/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'FJ',
    defaultLat:      -18.14,
    defaultLng:      178.44,
    defaultLocation: 'Suva, Fiji',
    extraTags:       ['fiji', 'pacific', 'oceania', 'broadcaster'],
    language:        'en',
  },
  // Honiara daily newspaper (its local-news stories, bylined); about 10 a day
  {
    id:              'island-sun-sb',
    name:            'Island Sun (Solomon Islands)',
    feedUrl:         'https://theislandsun.com.sb/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SB',
    defaultLat:      -9.43,
    defaultLng:      159.95,
    defaultLocation: 'Honiara, Solomon Islands',
    extraTags:       ['solomon-islands', 'pacific', 'oceania'],
    language:        'en',
  },
  // non-profit investigative newsroom in Honiara; 2 to 5 stories a day
  {
    id:              'in-depth-solomons',
    name:            'In-depth Solomons',
    feedUrl:         'https://indepthsolomons.com.sb/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'SB',
    defaultLat:      -9.43,
    defaultLng:      159.95,
    defaultLocation: 'Honiara, Solomon Islands',
    extraTags:       ['solomon-islands', 'pacific', 'oceania', 'independent-media', 'investigative'],
    language:        'en',
  },
  // the Dominica Prime Minister's Office press room (Roseau); government statements, so labelled state media (0.50); Dominica's private outlets turned the container away or are stale; about one item a day
  {
    id:              'opm-pressroom-dm',
    name:            'OPM Press Room (Dominica)',
    feedUrl:         'https://pressroomopm.gov.dm/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'DM',
    defaultLat:      15.3,
    defaultLng:      -61.39,
    defaultLocation: 'Roseau, Dominica',
    extraTags:       ['dominica', 'caribbean', 'state-media'],
    language:        'en',
  },
  // Lima business daily (Grupo El Comercio); its terms forbid reproduction without permission (no robot clause); Spanish, so no home pin
  {
    id:              'gestion-pe',
    name:            'Gestión (Peru)',
    feedUrl:         'https://gestion.pe/arc/outboundfeeds/rss/?outputType=xml',
    category:        'economy',
    biasLabel:       'center-right',
    reliability:     0.78,
    countryCode:     'PE',
    defaultLat:      -12.05,
    defaultLng:      -77.04,
    defaultLocation: 'Lima, Peru',
    extraTags:       ['peru', 'south-america', 'latin-america', 'business'],
    language:        'es',
  },
  // independent digital outlet in Arequipa covering Peru's regions; many items are video reports; Spanish, so no home pin
  {
    id:              'el-buho-pe',
    name:            'El Búho (Peru)',
    feedUrl:         'https://elbuho.pe/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'PE',
    defaultLat:      -16.41,
    defaultLng:      -71.54,
    defaultLocation: 'Arequipa, Peru',
    extraTags:       ['peru', 'south-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // San Juan news radio (1320 AM) and site; Spanish, so no home pin
  {
    id:              'radio-isla-pr',
    name:            'Radio Isla (Puerto Rico)',
    feedUrl:         'https://radioisla.tv/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'PR',
    defaultLat:      18.47,
    defaultLng:      -66.11,
    defaultLocation: 'San Juan, Puerto Rico',
    extraTags:       ['puerto-rico', 'caribbean', 'latin-america'],
    language:        'es',
  },
  // independent San Salvador digital daily; no terms page (footer: all rights reserved); Spanish, so no home pin
  {
    id:              'contrapunto-sv',
    name:            'ContraPunto (El Salvador)',
    feedUrl:         'https://www.contrapunto.com.sv/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.70,
    countryCode:     'SV',
    defaultLat:      13.69,
    defaultLng:      -89.22,
    defaultLocation: 'San Salvador, El Salvador',
    extraTags:       ['el-salvador', 'central-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // the Jesuit UCA university's news radio (San Salvador); its terms allow reproduction with credit, for personal, non-commercial use; Spanish, so no home pin
  {
    id:              'ysuca-sv',
    name:            'YSUCA (El Salvador)',
    feedUrl:         'https://ysuca.org.sv/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.76,
    countryCode:     'SV',
    defaultLat:      13.69,
    defaultLng:      -89.22,
    defaultLocation: 'San Salvador, El Salvador',
    extraTags:       ['el-salvador', 'central-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // English-language news site in Panama City; about 9 items a day
  {
    id:              'newsroom-panama',
    name:            'Newsroom Panama',
    feedUrl:         'https://newsroompanama.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'PA',
    defaultLat:      8.98,
    defaultLng:      -79.52,
    defaultLocation: 'Panama City, Panama',
    extraTags:       ['panama', 'central-america', 'latin-america'],
    language:        'en',
  },
  // Santo Domingo daily; no terms page (footer: all rights reserved); Spanish, so no home pin
  {
    id:              'el-dia-do',
    name:            'El Día (Dominican Republic)',
    feedUrl:         'https://eldia.com.do/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'DO',
    defaultLat:      18.49,
    defaultLng:      -69.93,
    defaultLocation: 'Santo Domingo, Dominican Republic',
    extraTags:       ['dominican-republic', 'caribbean', 'latin-america'],
    language:        'es',
  },
  // Universidad Rafael Landívar's investigative outlet (Guatemala City); Creative Commons licence; about two items a day; Spanish, so no home pin
  {
    id:              'plaza-publica-gt',
    name:            'Plaza Pública (Guatemala)',
    feedUrl:         'https://plazapublica.com.gt/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'GT',
    defaultLat:      14.63,
    defaultLng:      -90.51,
    defaultLocation: 'Guatemala City, Guatemala',
    extraTags:       ['guatemala', 'central-america', 'latin-america', 'investigative'],
    language:        'es',
  },
  // Jesuit-run radio in El Progreso; about one item a day, with many editorials; Spanish, so no home pin
  {
    id:              'radio-progreso-hn',
    name:            'Radio Progreso (Honduras)',
    feedUrl:         'https://www.radioprogresohn.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.72,
    countryCode:     'HN',
    defaultLat:      14.07,
    defaultLng:      -87.19,
    defaultLocation: 'Tegucigalpa, Honduras',
    extraTags:       ['honduras', 'central-america', 'latin-america', 'rights'],
    language:        'es',
  },
  // Port-au-Prince news site; no terms page (footer: all rights reserved); French, so no home pin
  {
    id:              'vant-bef-info-ht',
    name:            'Vant Bèf Info (Haiti)',
    feedUrl:         'https://vantbefinfo.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'HT',
    defaultLat:      18.54,
    defaultLng:      -72.34,
    defaultLocation: 'Port-au-Prince, Haiti',
    extraTags:       ['haiti', 'caribbean', 'latin-america'],
    language:        'fr',
    parked:          'script cookie check (HTTP 409), Nov 5, 2026',
  },
  // Nicaraguan newsroom working in exile; also covers the region; Spanish, so no home pin
  {
    id:              'nicaragua-investiga',
    name:            'Nicaragua Investiga',
    feedUrl:         'https://nicaraguainvestiga.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'NI',
    defaultLat:      12.11,
    defaultLng:      -86.24,
    defaultLocation: 'Managua, Nicaragua',
    extraTags:       ['nicaragua', 'central-america', 'latin-america', 'exile-media'],
    language:        'es',
  },
  // independent Caracas news site focused on rights and politics; Spanish, so no home pin
  {
    id:              'runrunes-ve',
    name:            'Runrunes (Venezuela)',
    feedUrl:         'https://runrun.es/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'VE',
    defaultLat:      10.49,
    defaultLng:      -66.88,
    defaultLocation: 'Caracas, Venezuela',
    extraTags:       ['venezuela', 'south-america', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // La Paz daily, founded 1904; privacy page only; Spanish, so no home pin
  {
    id:              'el-diario-bo',
    name:            'El Diario (Bolivia)',
    feedUrl:         'https://www.eldiario.net/portal/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BO',
    defaultLat:      -16.5,
    defaultLng:      -68.15,
    defaultLocation: 'La Paz, Bolivia',
    extraTags:       ['bolivia', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Nassau TV news (Cable 12); some rewritten foreign stories; round 3's saved answer
  {
    id:              'our-news-bs',
    name:            'Our News (Bahamas)',
    feedUrl:         'https://ournews.bs/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'BS',
    defaultLat:      25.05,
    defaultLng:      -77.35,
    defaultLocation: 'Nassau, Bahamas',
    extraTags:       ['bahamas', 'caribbean'],
    language:        'en',
  },
  // English edition of the Casablanca news site Le360 (Web News), its politics section; headlines only, no summaries; follows the official line on the Sahara, hence 0.62
  {
    id:              'le360-en',
    name:            'Le360 (English, politics)',
    feedUrl:         'https://en.le360.ma/arc/outboundfeeds/rss/category/politics/?outputType=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'MA',
    defaultLat:      34.02,
    defaultLng:      -6.84,
    defaultLocation: 'Rabat, Morocco',
    extraTags:       ['morocco', 'maghreb', 'north-africa', 'africa'],
    language:        'en',
  },
  // Casablanca news portal (Web Stratégie) on Morocco and Moroccans abroad; much on Spain, Ceuta and migration
  {
    id:              'yabiladi',
    name:            'Yabiladi (Morocco)',
    feedUrl:         'https://www.yabiladi.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'MA',
    defaultLat:      34.02,
    defaultLng:      -6.84,
    defaultLocation: 'Rabat, Morocco',
    extraTags:       ['morocco', 'maghreb', 'north-africa', 'africa'],
    language:        'fr',
  },
  // English edition of the Libyan news site Al Marsad ('Libyan Daily Comprehensive', its footer); short reports on Libya only, often posted in batches
  {
    id:              'almarsad-en',
    name:            'Al Marsad (English, Libya)',
    feedUrl:         'https://en.almarsad.co/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'LY',
    defaultLat:      32.89,
    defaultLng:      13.19,
    defaultLocation: 'Tripoli, Libya',
    extraTags:       ['libya', 'north-africa', 'africa'],
    language:        'en',
  },
  // Tunis news magazine founded in 1979; its about page recounts seizures and trials for its independent line
  {
    id:              'realites-tn',
    name:            'Réalités (Tunisia)',
    feedUrl:         'https://realites.com.tn/fr/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'TN',
    defaultLat:      36.81,
    defaultLng:      10.18,
    defaultLocation: 'Tunis, Tunisia',
    extraTags:       ['tunisia', 'maghreb', 'north-africa', 'africa'],
    language:        'fr',
  },
  // Nouakchott independent weekly (round 3's saved answer); headlines only, about 1.5 items a day
  {
    id:              'le-calame',
    name:            'Le Calame (Mauritania)',
    feedUrl:         'https://lecalame.info/?q=rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'MR',
    defaultLat:      18.08,
    defaultLng:      -15.98,
    defaultLocation: 'Nouakchott, Mauritania',
    extraTags:       ['mauritania', 'sahel', 'west-africa', 'africa', 'independent-media'],
    language:        'fr',
  },
  // Conakry news site founded in 2013 (its footer); Guinea news plus some regional and world news
  {
    id:              'guineematin',
    name:            'Guinéematin (Guinea)',
    feedUrl:         'https://guineematin.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'GN',
    defaultLat:      9.64,
    defaultLng:      -13.58,
    defaultLocation: 'Conakry, Guinea',
    extraTags:       ['guinea', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Monrovia daily; posts its edition in one morning batch
  {
    id:              'analyst-liberia',
    name:            'The Analyst (Liberia)',
    feedUrl:         'https://analystliberiaonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'LR',
    defaultLat:      6.3,
    defaultLng:      -10.8,
    defaultLocation: 'Monrovia, Liberia',
    extraTags:       ['liberia', 'west-africa', 'africa'],
    language:        'en',
  },
  // Abidjan daily founded in 2003; its site lists a Journalism Trust Initiative certification and an AI charter
  {
    id:              'lintelligent-dabidjan',
    name:            'L\'Intelligent d\'Abidjan (Côte d\'Ivoire)',
    feedUrl:         'https://www.lintelligentdabidjan.info/news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CI',
    defaultLat:      5.36,
    defaultLng:      -4.01,
    defaultLocation: 'Abidjan, Côte d\'Ivoire',
    extraTags:       ['cote-divoire', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Niger's state news agency under the military government; picked only because no independent Niger feed passed (ActuNiger politics 100 h old, Le Sahel 148 h)
  {
    id:              'anp-niger',
    name:            'ANP (Agence Nigérienne de Presse)',
    feedUrl:         'https://anp.ne/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'NE',
    defaultLat:      13.51,
    defaultLng:      2.11,
    defaultLocation: 'Niamey, Niger',
    extraTags:       ['niger', 'sahel', 'west-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // Tunis online daily that calls itself editorially and economically independent; mostly national news
  {
    id:              'webdo-tn',
    name:            'Webdo (Tunisia)',
    feedUrl:         'https://www.webdo.tn/fr/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'TN',
    defaultLat:      36.81,
    defaultLng:      10.18,
    defaultLocation: 'Tunis, Tunisia',
    extraTags:       ['tunisia', 'maghreb', 'north-africa', 'africa'],
    language:        'fr',
  },
  // Conakry news site; local courts, unions and public companies
  {
    id:              'mosaique-guinee',
    name:            'Mosaïque Guinée',
    feedUrl:         'https://mosaiqueguinee.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'GN',
    defaultLat:      9.64,
    defaultLng:      -13.58,
    defaultLocation: 'Conakry, Guinea',
    extraTags:       ['guinea', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Dakar online daily; about 20 items in 5 hours
  {
    id:              'pressafrik',
    name:            'PressAfrik (Senegal)',
    feedUrl:         'https://www.pressafrik.com/xml/syndication.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'SN',
    defaultLat:      14.72,
    defaultLng:      -17.47,
    defaultLocation: 'Dakar, Senegal',
    extraTags:       ['senegal', 'west-africa', 'africa'],
    language:        'fr',
  },
  // news site of Media General (MG Digital Media, Accra; its footer); national politics, courts and economy, about 20 items in 6 hours
  {
    id:              '3news-gh',
    name:            '3News (Ghana)',
    feedUrl:         'https://3news.com/feed.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'GH',
    defaultLat:      5.6,
    defaultLng:      -0.19,
    defaultLocation: 'Accra, Ghana',
    extraTags:       ['ghana', 'west-africa', 'africa'],
    language:        'en',
  },
  // independent English-language Egyptian news site (ES Media Network FZ LLC, its about page; round 2's saved answer); slow, 9 items in 56 hours
  {
    id:              'egyptian-streets',
    name:            'Egyptian Streets',
    feedUrl:         'https://egyptianstreets.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'EG',
    defaultLat:      30.04,
    defaultLng:      31.24,
    defaultLocation: 'Cairo, Egypt',
    extraTags:       ['egypt', 'north-africa', 'middle-east', 'africa', 'independent-media'],
    language:        'en',
  },
  // Maseru newspaper and news site (Newsday Media); a few local stories a day
  {
    id:              'newsday-ls',
    name:            'Newsday (Lesotho)',
    feedUrl:         'https://newsdayonline.co.ls/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LS',
    defaultLat:      -29.31,
    defaultLng:      27.48,
    defaultLocation: 'Maseru, Lesotho',
    extraTags:       ['lesotho', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Maseru news site (Barumuoa Communications); about one or two stories a day
  {
    id:              'the-reporter-ls',
    name:            'The Reporter (Lesotho)',
    feedUrl:         'https://www.thereporter.co.ls/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'LS',
    defaultLat:      -29.31,
    defaultLng:      27.48,
    defaultLocation: 'Maseru, Lesotho',
    extraTags:       ['lesotho', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Maseru weekly; most items arrive with Sunday's edition
  {
    id:              'sunday-express-ls',
    name:            'Sunday Express (Lesotho)',
    feedUrl:         'https://sundayexpress.co.ls/?feed=rss2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'LS',
    defaultLat:      -29.31,
    defaultLng:      27.48,
    defaultLocation: 'Maseru, Lesotho',
    extraTags:       ['lesotho', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Spanish-language investigative site on Equatorial Guinea, run from Spain; critical of the government; about one item a day
  {
    id:              'diario-rombe-gq',
    name:            'Diario Rombe (Equatorial Guinea)',
    feedUrl:         'https://diariorombe.es/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'GQ',
    defaultLat:      3.75,
    defaultLng:      8.78,
    defaultLocation: 'Malabo, Equatorial Guinea',
    extraTags:       ['equatorial-guinea', 'central-africa', 'africa', 'exile-media', 'investigative'],
    language:        'es',
  },
  // Luanda news site in Portuguese; about ten items a day
  {
    id:              'correio-da-kianda-ao',
    name:            'Correio da Kianda (Angola)',
    feedUrl:         'https://correiokianda.info/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'AO',
    defaultLat:      -8.84,
    defaultLng:      13.23,
    defaultLocation: 'Luanda, Angola',
    extraTags:       ['angola', 'southern-africa', 'africa'],
    language:        'pt',
  },
  // Bangui news site in French; posts in batches; carries the odd notice (a UNDP tender)
  {
    id:              'oubangui-medias-cf',
    name:            'Oubangui Médias (Central African Republic)',
    feedUrl:         'https://oubanguimedias.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.58,
    countryCode:     'CF',
    defaultLat:      4.39,
    defaultLng:      18.56,
    defaultLocation: 'Bangui, Central African Republic',
    extraTags:       ['central-african-republic', 'central-africa', 'africa'],
    language:        'fr',
  },
  // Comorian news agency site in French (Blogger); news plus some opinion
  {
    id:              'habari-za-comores-km',
    name:            'HZK-Presse / Habari za Comores',
    feedUrl:         'https://www.habarizacomores.com/feeds/posts/default?alt=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'KM',
    defaultLat:      -11.7,
    defaultLng:      43.26,
    defaultLocation: 'Moroni, Comoros',
    extraTags:       ['comoros', 'indian-ocean', 'africa'],
    language:        'fr',
  },
  // English service of the Darfur 24 Media Network; reports the war from Darfur and Kordofan; Darfur-focused and its base isn't stated, so no home pin
  {
    id:              'darfur24-sd',
    name:            'Darfur24 (Sudan)',
    feedUrl:         'https://darfur24.com/en/feed/',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'SD',
    defaultLat:      15.5,
    defaultLng:      32.56,
    defaultLocation: 'Khartoum, Sudan',
    extraTags:       ['sudan', 'darfur', 'east-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // Hargeisa English-language news site covering Somaliland and Somalia; frames Somaliland as independent; no home pin (Somalia's home point is Mogadishu)
  {
    id:              'somaliland-standard',
    name:            'Somaliland Standard',
    feedUrl:         'https://somalilandstandard.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'SO',
    defaultLat:      2.05,
    defaultLng:      45.32,
    defaultLocation: 'Mogadishu, Somalia',
    extraTags:       ['somalia', 'somaliland', 'horn-of-africa', 'africa'],
    language:        'en',
  },
  // English-language Somali news and analysis site (much opinion); its base isn't stated, so no home pin
  {
    id:              'wardheer-news-so',
    name:            'WardheerNews (Somalia)',
    feedUrl:         'https://wardheernews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'SO',
    defaultLat:      2.05,
    defaultLng:      45.32,
    defaultLocation: 'Mogadishu, Somalia',
    extraTags:       ['somalia', 'horn-of-africa', 'africa'],
    language:        'en',
  },
  // Tanzania business and investment news; slow (about one item a day); its operator is registered in Victoria, Seychelles, so no home pin
  {
    id:              'tanzaniainvest-tz',
    name:            'TanzaniaInvest',
    feedUrl:         'https://www.tanzaniainvest.com/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'TZ',
    defaultLat:      -6.16,
    defaultLng:      35.75,
    defaultLocation: 'Dodoma, Tanzania',
    extraTags:       ['tanzania', 'east-africa', 'africa', 'business'],
    language:        'en',
  },
  // Lusaka business news site
  {
    id:              'zambian-business-times',
    name:            'Zambian Business Times',
    feedUrl:         'https://zambianbusinesstimes.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'ZM',
    defaultLat:      -15.39,
    defaultLng:      28.32,
    defaultLocation: 'Lusaka, Zambia',
    extraTags:       ['zambia', 'southern-africa', 'africa', 'business'],
    language:        'en',
  },
  // the UN-backed national radio (MONUSCO and Fondation Hirondelle), French; its feedburner feed (its own feed is weeks stale)
  {
    id:              'radio-okapi-cd',
    name:            'Radio Okapi (DR Congo)',
    feedUrl:         'https://feeds.feedburner.com/radiookapi/actu?format=xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'CD',
    defaultLat:      -4.44,
    defaultLng:      15.27,
    defaultLocation: 'Kinshasa, DR Congo',
    extraTags:       ['dr-congo', 'great-lakes', 'central-africa', 'africa', 'public-service'],
    language:        'fr',
  },
  // Addis Ababa business weekly; a few items a day
  {
    id:              'capital-ethiopia',
    name:            'Capital (Ethiopia)',
    feedUrl:         'https://capitalethiopia.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'ET',
    defaultLat:      9.03,
    defaultLng:      38.75,
    defaultLocation: 'Addis Ababa, Ethiopia',
    extraTags:       ['ethiopia', 'horn-of-africa', 'africa', 'business'],
    language:        'en',
  },
  // Harare investigative news site; about one item a day
  {
    id:              'newshawks-zw',
    name:            'The NewsHawks (Zimbabwe)',
    feedUrl:         'https://thenewshawks.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'ZW',
    defaultLat:      -17.83,
    defaultLng:      31.05,
    defaultLocation: 'Harare, Zimbabwe',
    extraTags:       ['zimbabwe', 'southern-africa', 'africa', 'investigative'],
    language:        'en',
  },
  // Maputo daily (SOICO group) in Portuguese
  {
    id:              'o-pais-mz',
    name:            'O País (Mozambique)',
    feedUrl:         'https://opais.co.mz/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'MZ',
    defaultLat:      -25.97,
    defaultLng:      32.57,
    defaultLocation: 'Maputo, Mozambique',
    extraTags:       ['mozambique', 'southern-africa', 'africa'],
    language:        'pt',
  },
  // South Africa's public broadcaster; about ten items a day
  {
    id:              'sabc-news',
    name:            'SABC News (South Africa)',
    feedUrl:         'https://www.sabcnews.com/sabcnews/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'ZA',
    defaultLat:      -25.75,
    defaultLng:      28.23,
    defaultLocation: 'Pretoria, ZA',
    extraTags:       ['south-africa', 'southern-africa', 'africa', 'public-broadcaster'],
    language:        'en',
  },
  // ── Added Oct 21, 2026 (Q5: past 500 feeds, round 5) ──────────────────────
  // 46 more from a fifth round of eight regional searches, aimed at the
  // countries that had no outlet or only one; checked the same way (the
  // server's own request, the reader's own parser, terms read where the site
  // links them), and each answered the server-style request within 10 seconds.
  // Spanish, Portuguese and French feeds get no home pin.
  // Luxembourg City news-and-guides site (Relotech S.a r.l.), English edition; about 2 items a day
  {
    id:              'luxtoday-lu',
    name:            'Luxtoday (Luxembourg)',
    feedUrl:         'https://luxtoday.lu/feed.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'LU',
    defaultLat:      49.61,
    defaultLng:      6.13,
    defaultLocation: 'Luxembourg, Luxembourg',
    extraTags:       ['luxembourg', 'europe'],
    language:        'en',
  },
  // small Dublin investigative newsroom (Press Council member); about one item every two days
  {
    id:              'the-ditch-ie',
    name:            'The Ditch (Ireland)',
    feedUrl:         'https://www.ontheditch.com/rss/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.70,
    countryCode:     'IE',
    defaultLat:      53.35,
    defaultLng:      -6.26,
    defaultLocation: 'Dublin, Ireland',
    extraTags:       ['ireland', 'europe', 'investigative', 'independent-media'],
    language:        'en',
  },
  // Albania's English-language weekly (founded 2005; "Albania's newspaper of record in English", in its own words); about one item a day
  {
    id:              'tirana-times',
    name:            'Tirana Times',
    feedUrl:         'https://www.tiranatimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'AL',
    defaultLat:      41.33,
    defaultLng:      19.82,
    defaultLocation: 'Tirana, Albania',
    extraTags:       ['albania', 'balkans', 'europe'],
    language:        'en',
  },
  // Sarajevo investigative newsroom, English edition; slow (9 items in 45 days), with an occasional grant call
  {
    id:              'cin-ba-en',
    name:            'CIN (Center for Investigative Reporting, Sarajevo)',
    feedUrl:         'https://cin.ba/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'BA',
    defaultLat:      43.86,
    defaultLng:      18.41,
    defaultLocation: 'Sarajevo, Bosnia and Herzegovina',
    extraTags:       ['bosnia', 'balkans', 'europe', 'investigative', 'independent-media'],
    language:        'en',
  },
  // Kyiv's English-language newspaper (footer: copyright 1995-2026, BISNESGROUPP LLC)
  {
    id:              'kyiv-post',
    name:            'Kyiv Post',
    feedUrl:         'https://www.kyivpost.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'UA',
    defaultLat:      50.45,
    defaultLng:      30.52,
    defaultLocation: 'Kyiv, Ukraine',
    extraTags:       ['kyiv-post', 'ukraine', 'eastern-europe', 'europe'],
    language:        'en',
  },
  // Kyiv news agency (Interfax-Ukraine News Agency LLC), English service; a Ukrainian company, not Russia's Interfax; about 20 items every 3-4 hours
  {
    id:              'interfax-ukraine-en',
    name:            'Interfax-Ukraine (English)',
    feedUrl:         'https://en.interfax.com.ua/news/last.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'UA',
    defaultLat:      50.45,
    defaultLng:      30.52,
    defaultLocation: 'Kyiv, Ukraine',
    extraTags:       ['interfax-ukraine', 'ukraine', 'eastern-europe', 'news-agency'],
    language:        'en',
  },
  // Greek news in English since March 2010 (a news blog: hard news with a personal comment, in its own words); about 5 items a day
  {
    id:              'keep-talking-greece',
    name:            'Keep Talking Greece',
    feedUrl:         'https://www.keeptalkinggreece.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'GR',
    defaultLat:      37.98,
    defaultLng:      23.73,
    defaultLocation: 'Athens, Greece',
    extraTags:       ['greece', 'southern-europe', 'europe'],
    language:        'en',
  },
  // English-language weekly of North Cyprus (A-N Graphics (Kibris) Ltd, Lefkosa), its news-section feed; Cyprus is on under half of its placed items (Turkey and Greece on many), so no home pin
  {
    id:              'cyprus-today',
    name:            'Cyprus Today (North Cyprus)',
    feedUrl:         'https://cyprustodayonline.com/rss/category/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'CY',
    defaultLat:      35.17,
    defaultLng:      33.36,
    defaultLocation: 'Nicosia, Cyprus',
    extraTags:       ['cyprus', 'north-cyprus', 'turkish-cypriot', 'europe'],
    language:        'en',
  },
  // Muscat digital news site; staff-written Oman news, often relaying ministry figures
  {
    id:              'the-arabian-stories',
    name:            'The Arabian Stories (Oman)',
    feedUrl:         'https://www.thearabianstories.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'OM',
    defaultLat:      23.59,
    defaultLng:      58.41,
    defaultLocation: 'Muscat, Oman',
    extraTags:       ['oman', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Dubai daily (Galadari Printing and Publishing), its UAE news section
  {
    id:              'khaleej-times-uae',
    name:            'Khaleej Times (UAE section)',
    feedUrl:         'https://www.khaleejtimes.com/api/v1/collections/uae.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'AE',
    defaultLat:      25.2,
    defaultLng:      55.27,
    defaultLocation: 'Dubai, United Arab Emirates',
    extraTags:       ['uae', 'gulf', 'middle-east'],
    language:        'en',
  },
  // private news agency in Kazakhstan (Kazakhstan Today Media Group); headlines only, heavy on trade and government news
  {
    id:              'kazakhstan-today-en',
    name:            'Kazakhstan Today (English)',
    feedUrl:         'https://www.kt.kz/eng/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'KZ',
    defaultLat:      51.17,
    defaultLng:      71.45,
    defaultLocation: 'Astana, Kazakhstan',
    extraTags:       ['kazakhstan', 'central-asia'],
    language:        'en',
  },
  // regional business news site in Sharjah Media City (JC Media Group); regional, so no home pin
  {
    id:              'economy-middle-east',
    name:            'Economy Middle East',
    feedUrl:         'https://economymiddleeast.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'AE',
    defaultLat:      25.2,
    defaultLng:      55.27,
    defaultLocation: 'Dubai, United Arab Emirates',
    extraTags:       ['uae', 'gulf', 'middle-east', 'business'],
    language:        'en',
  },
  // English news site in Dhaka (Bangladesh News 24 Hours Ltd); site-wide feed, about 5 items an hour, mixed with world, sport and lifestyle
  {
    id:              'bdnews24',
    name:            'bdnews24.com (Bangladesh)',
    feedUrl:         'https://bdnews24.com/stories.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'BD',
    defaultLat:      23.81,
    defaultLng:      90.41,
    defaultLocation: 'Dhaka, Bangladesh',
    extraTags:       ['bangladesh', 'south-asia', 'asia'],
    language:        'en',
  },
  // English-language daily in Dhaka (2A Media); about 3 items an hour
  {
    id:              'dhaka-tribune',
    name:            'Dhaka Tribune',
    feedUrl:         'https://www.dhakatribune.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'BD',
    defaultLat:      23.81,
    defaultLng:      90.41,
    defaultLocation: 'Dhaka, Bangladesh',
    extraTags:       ['bangladesh', 'south-asia', 'asia'],
    language:        'en',
  },
  // Colombo business news site since 2001; news plus opinion, about 3 to 5 items a day
  {
    id:              'lanka-business-online',
    name:            'Lanka Business Online (Sri Lanka)',
    feedUrl:         'https://www.lankabusinessonline.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'LK',
    defaultLat:      6.93,
    defaultLng:      79.86,
    defaultLocation: 'Colombo, Sri Lanka',
    extraTags:       ['sri-lanka', 'south-asia', 'business', 'markets'],
    language:        'en',
  },
  // national news site of The Pattaya News Co.; some promotional items, hence 0.62
  {
    id:              'tpn-national-th',
    name:            'TPN National (Thailand)',
    feedUrl:         'https://tpnnational.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'TH',
    defaultLat:      13.76,
    defaultLng:      100.5,
    defaultLocation: 'Bangkok, Thailand',
    extraTags:       ['thailand', 'southeast-asia', 'asia'],
    language:        'en',
  },
  // the New Caledonia government's press releases (its espace presse feed; 10 in 22 days, 3 on Oct 20; headline and link only, no summaries); a government press office, not a newsroom, so labelled state media (0.50); its legal notice reserves reproduction rights; French, so no home pin
  {
    id:              'gouvernement-nouvelle-caledonie',
    name:            'Gouvernement de la Nouvelle-Calédonie (press releases)',
    feedUrl:         'https://gouv.nc/espace-presse/rss.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'NC',
    defaultLat:      -22.27,
    defaultLng:      166.44,
    defaultLocation: 'Nouméa, New Caledonia',
    extraTags:       ['new-caledonia', 'pacific', 'oceania', 'french-language', 'state-media', 'government'],
    language:        'fr',
  },
  // Guam daily newspaper (Tamuning; its local-news section, BLOX feed c=news/local); about 10 stories a day; each item carries its day's date at 00:00 Guam time, so it looks up to a day older than it is; terms: private, non-commercial use only; same TownNews platform as Pacific Daily News, which timed out from the server
  {
    id:              'guam-daily-post',
    name:            'The Guam Daily Post',
    feedUrl:         'https://www.postguam.com/search/?f=rss&t=article&c=news/local&l=50&s=start_time&sd=desc',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'GU',
    defaultLat:      13.47,
    defaultLng:      144.75,
    defaultLocation: 'Hagåtña, Guam',
    extraTags:       ['guam', 'micronesia', 'pacific', 'oceania'],
    language:        'en',
  },
  // Algiers news site; national news plus many signed opinion pieces with a strongly nationalist, anti-French line, hence 0.56
  {
    id:              'algerie-patriotique',
    name:            'Algérie Patriotique',
    feedUrl:         'https://algeriepatriotique.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.56,
    countryCode:     'DZ',
    defaultLat:      36.75,
    defaultLng:      3.06,
    defaultLocation: 'Algiers, Algeria',
    extraTags:       ['algeria', 'maghreb', 'north-africa', 'africa'],
    language:        'fr',
  },
  // Freetown news and business site (explainers, investigations, ESG); slow, 10 items in 18 days
  {
    id:              'fritong-post',
    name:            'Fritong Post (Sierra Leone)',
    feedUrl:         'https://fritongpost.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SL',
    defaultLat:      8.48,
    defaultLng:      -13.23,
    defaultLocation: 'Freetown, Sierra Leone',
    extraTags:       ['sierra-leone', 'west-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // independent Gambian news platform (its about page); courts, parliament and Jammeh-era reparations, some opinion columns
  {
    id:              'gambiana',
    name:            'Gambiana',
    feedUrl:         'https://gambiana.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'GM',
    defaultLat:      13.45,
    defaultLng:      -16.58,
    defaultLocation: 'Banjul, Gambia',
    extraTags:       ['gambia', 'west-africa', 'africa', 'independent-media'],
    language:        'en',
  },
  // Algiers economic news site founded in 2010, now edited by IalemNet SARL (its legal notice); prices, the dinar and politics
  {
    id:              'maghreb-emergent',
    name:            'Maghreb Émergent',
    feedUrl:         'https://maghrebemergent.news/fr/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'DZ',
    defaultLat:      36.75,
    defaultLng:      3.06,
    defaultLocation: 'Algiers, Algeria',
    extraTags:       ['algeria', 'maghreb', 'north-africa', 'africa', 'business'],
    language:        'fr',
  },
  // Dakar news site; national politics, strikes and the regions
  {
    id:              'emedia-sn',
    name:            'Emedia (Senegal)',
    feedUrl:         'https://emedia.sn/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SN',
    defaultLat:      14.72,
    defaultLng:      -17.47,
    defaultLocation: 'Dakar, Senegal',
    extraTags:       ['senegal', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Dakar-based regional news site (Ouestaf Multimédia) covering West Africa; regional, so no home pin
  {
    id:              'ouestaf-news',
    name:            'Ouestaf News',
    feedUrl:         'https://www.ouestaf.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'SN',
    defaultLat:      14.72,
    defaultLng:      -17.47,
    defaultLocation: 'Dakar, Senegal',
    extraTags:       ['west-africa', 'sahel', 'senegal', 'africa'],
    language:        'fr',
  },
  // Casablanca economic daily founded in 2009 (its about page; Horizon Press Group)
  {
    id:              'leseco-ma',
    name:            'LesEco.ma (Morocco)',
    feedUrl:         'https://leseco.ma/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MA',
    defaultLat:      34.02,
    defaultLng:      -6.84,
    defaultLocation: 'Rabat, Morocco',
    extraTags:       ['morocco', 'maghreb', 'north-africa', 'africa', 'business'],
    language:        'fr',
  },
  // Bamako online outlet registered in 2021 (its terms); Mali and Sahel news under military rule, hence 0.58; every summary starts with a 'Decouvrez plus sur notre blog' line
  {
    id:              'sahel-tribune',
    name:            'Sahel Tribune (Mali)',
    feedUrl:         'https://saheltribune.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.58,
    countryCode:     'ML',
    defaultLat:      12.64,
    defaultLng:      -8,
    defaultLocation: 'Bamako, Mali',
    extraTags:       ['mali', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // independent Burkinabè online outlet (its editorial charter); the press works under military rule, hence 0.64
  {
    id:              'libreinfo-bf',
    name:            'Libreinfo.net (Burkina Faso)',
    feedUrl:         'https://libreinfo.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'BF',
    defaultLat:      12.37,
    defaultLng:      -1.52,
    defaultLocation: 'Ouagadougou, Burkina Faso',
    extraTags:       ['burkina-faso', 'sahel', 'west-africa', 'africa', 'independent-media'],
    language:        'fr',
  },
  // Monrovia online outlet of Smart Media Group (its terms page); all-caps headlines, editorials mixed in; round 4's saved answer
  {
    id:              'smart-news-liberia',
    name:            'Smart News Liberia',
    feedUrl:         'https://smartnewsliberia.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'LR',
    defaultLat:      6.3,
    defaultLng:      -10.8,
    defaultLocation: 'Monrovia, Liberia',
    extraTags:       ['liberia', 'west-africa', 'africa'],
    language:        'en',
  },
  // Cotonou daily; posts its edition in one early-morning batch
  {
    id:              'matin-libre-bj',
    name:            'Matin Libre (Benin)',
    feedUrl:         'https://matinlibre.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'BJ',
    defaultLat:      6.5,
    defaultLng:      2.6,
    defaultLocation: 'Porto-Novo, Benin',
    extraTags:       ['benin', 'west-africa', 'africa'],
    language:        'fr',
  },
  // news portal of northern Cabo Verde (São Vicente); local news plus some world items that read like wire copy
  {
    id:              'noticias-do-norte-cv',
    name:            'Notícias do Norte (Cabo Verde)',
    feedUrl:         'https://noticiasdonorte.publ.cv/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'CV',
    defaultLat:      14.93,
    defaultLng:      -23.51,
    defaultLocation: 'Praia, Cabo Verde',
    extraTags:       ['cabo-verde', 'west-africa', 'africa'],
    language:        'pt',
  },
  // Mauritian private radio's news site (since 2002), its Politique section feed; home pin since Nov 5, 2026 (HOME_PIN_SOURCES)
  {
    id:              'top-fm-mu',
    name:            'Top FM (Mauritius)',
    feedUrl:         'https://www.topfm.mu/taxonomy/term/9/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MU',
    defaultLat:      -20.16,
    defaultLng:      57.5,
    defaultLocation: 'Port Louis, Mauritius',
    extraTags:       ['mauritius', 'indian-ocean', 'africa', 'francophone'],
    language:        'fr',
  },
  // Congo-Brazzaville's state news agency (French); headlines say bare "Congo", which the place-finder reads as DR Congo
  {
    id:              'aci-congo',
    name:            'ACI (Agence Congolaise d\'Information)',
    feedUrl:         'https://www.aci.cg/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'CG',
    defaultLat:      -4.27,
    defaultLng:      15.28,
    defaultLocation: 'Brazzaville, Republic of the Congo',
    extraTags:       ['congo-brazzaville', 'central-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // Malawian online news site; partisan tone in some headlines, plus opinion and letters
  {
    id:              'malawi-voice',
    name:            'Malawi Voice',
    feedUrl:         'https://www.malawivoice.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'MW',
    defaultLat:      -13.96,
    defaultLng:      33.79,
    defaultLocation: 'Lilongwe, Malawi',
    extraTags:       ['malawi', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Malawian news site with datelines from Lilongwe and Washington; mixes regional and world news, so no home pin
  {
    id:              'maravi-post',
    name:            'The Maravi Post (Malawi)',
    feedUrl:         'https://www.maravipost.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'MW',
    defaultLat:      -13.96,
    defaultLng:      33.79,
    defaultLocation: 'Lilongwe, Malawi',
    extraTags:       ['malawi', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Malabo news site in Spanish; follows the government's line (decrees, appointments); Spanish, so no home pin
  {
    id:              'real-equatorial-guinea',
    name:            'Real Equatorial Guinea',
    feedUrl:         'https://realequatorialguinea.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.55,
    countryCode:     'GQ',
    defaultLat:      3.75,
    defaultLng:      8.78,
    defaultLocation: 'Malabo, Equatorial Guinea',
    extraTags:       ['equatorial-guinea', 'central-africa', 'africa', 'spanish-language'],
    language:        'es',
  },
  // Kampala online daily
  {
    id:              'pml-daily-ug',
    name:            'PML Daily (Uganda)',
    feedUrl:         'https://pmldaily.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'UG',
    defaultLat:      0.35,
    defaultLng:      32.58,
    defaultLocation: 'Kampala, Uganda',
    extraTags:       ['uganda', 'east-africa', 'africa'],
    language:        'en',
  },
  // Gaborone weekly; posts its stories over a few days each week
  {
    id:              'weekend-post-bw',
    name:            'Weekend Post (Botswana)',
    feedUrl:         'https://weekendpost.co.bw/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BW',
    defaultLat:      -24.65,
    defaultLng:      25.91,
    defaultLocation: 'Gaborone, Botswana',
    extraTags:       ['botswana', 'southern-africa', 'africa'],
    language:        'en',
  },
  // Luanda daily (Socijornal); Portuguese, so no home pin
  {
    id:              'o-pais-ao',
    name:            'O País (Angola)',
    feedUrl:         'https://opais.ao/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'AO',
    defaultLat:      -8.84,
    defaultLng:      13.23,
    defaultLocation: 'Luanda, Angola',
    extraTags:       ['angola', 'southern-africa', 'africa', 'lusophone'],
    language:        'pt',
  },
  // Antananarivo news site; French, so no home pin
  {
    id:              '2424-mg',
    name:            '2424.mg (Madagascar)',
    feedUrl:         'https://www.2424.mg/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'MG',
    defaultLat:      -18.88,
    defaultLng:      47.51,
    defaultLocation: 'Antananarivo, Madagascar',
    extraTags:       ['madagascar', 'indian-ocean', 'africa', 'francophone'],
    language:        'fr',
  },
  // news site on Cuba (© OnCuba Fuego Enterprises, Inc.); its terms allow reproduction with credit to OnCuba, no robot clause; its English feed is 8 days old, so the Spanish feed is used; Spanish, so no home pin
  {
    id:              'oncuba-news-cu',
    name:            'OnCuba News',
    feedUrl:         'https://oncubanews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CU',
    defaultLat:      23.11,
    defaultLng:      -82.37,
    defaultLocation: 'Havana, Cuba',
    extraTags:       ['cuba', 'caribbean', 'latin-america', 'independent-media'],
    language:        'es',
  },
  // San José digital daily; no terms page linked (footer: all rights reserved); it includes some sport; Spanish, so no home pin
  {
    id:              'el-mundo-cr',
    name:            'El Mundo CR (Costa Rica)',
    feedUrl:         'https://elmundo.cr/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'CR',
    defaultLat:      9.93,
    defaultLng:      -84.08,
    defaultLocation: 'San José, Costa Rica',
    extraTags:       ['costa-rica', 'central-america', 'latin-america'],
    language:        'es',
  },
  // Montevideo news portal (Montevideo COMM), its news-channel feed; its RSS page offers the feeds as a free service; its privacy and conditions page has no reuse or robot clause; Spanish, so no home pin
  {
    id:              'montevideo-portal-uy',
    name:            'Montevideo Portal (Uruguay)',
    feedUrl:         'https://www.montevideo.com.uy/anxml.aspx?59',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'UY',
    defaultLat:      -34.9,
    defaultLng:      -56.16,
    defaultLocation: 'Montevideo, Uruguay',
    extraTags:       ['uruguay', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Paraguayan digital daily founded in 2020 (its about page); no terms page (footer: all rights reserved); Spanish, so no home pin
  {
    id:              'el-nacional-py',
    name:            'El Nacional (Paraguay)',
    feedUrl:         'https://elnacional.com.py/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'PY',
    defaultLat:      -25.26,
    defaultLng:      -57.58,
    defaultLocation: 'Asunción, Paraguay',
    extraTags:       ['paraguay', 'south-america', 'latin-america'],
    language:        'es',
  },
  // Puerto Rico business news site; its feed holds only the 3 newest items; no terms page linked (footer: © 2025 Sin Comillas); round 4's saved answer; Spanish, so no home pin
  {
    id:              'sin-comillas-pr',
    name:            'Sin Comillas (Puerto Rico)',
    feedUrl:         'https://sincomillas.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'PR',
    defaultLat:      18.47,
    defaultLng:      -66.11,
    defaultLocation: 'San Juan, Puerto Rico',
    extraTags:       ['puerto-rico', 'caribbean', 'latin-america', 'business'],
    language:        'es',
  },
  // Guyana news site; leans to the government and often prints ministry statements in full; no terms page linked (footer: © 2025 INEWS Guyana); round 3's saved answer
  {
    id:              'inews-guyana',
    name:            'iNews Guyana',
    feedUrl:         'https://inewsguyana.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.60,
    countryCode:     'GY',
    defaultLat:      6.8,
    defaultLng:      -58.16,
    defaultLocation: 'Georgetown, Guyana',
    extraTags:       ['guyana', 'caribbean', 'south-america'],
    language:        'en',
  },
  // Iran's first outlet (plan R2, H-0033): a Tehran daily in English that follows the government's line, so flagged state media like Anadolu and CGTN; the feed's channel title is empty, hence the name here; Sage's Oct 28 check: 30 items, newest that day
  {
    id:              'tehran-times',
    name:            'Tehran Times',
    feedUrl:         'https://www.tehrantimes.com/rss',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'IR',
    defaultLat:      35.69,
    defaultLng:      51.39,
    defaultLocation: 'Tehran, Iran',
    extraTags:       ['tehran-times', 'iran', 'middle-east', 'state-media'],
    language:        'en',
  },
  // ── Sources round 6 (Q9, Oct 31, 2026): the countries with no outlet in English, or none at all. Six helpers
  // searched one region each; every feed answered our request, was fresh, and had terms that allow headlines with
  // links. Feeds in the round's new languages find their places through pipeline/local-names.ts
  // English edition of the Cotonou outlet Bénin Web TV (its French feed is read); its news section mixes Benin, West African and world stories (about 1 in 10 on Benin); its legal notice bans reproduction without permission, as for the French feed; no home pin
  {
    id:              'benin-web-tv-en',
    name:            'Bénin Web TV English (Benin)',
    feedUrl:         'https://beninwebtv.com/en/news-benews/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'BJ',
    defaultLat:      6.37,
    defaultLng:      2.39,
    defaultLocation: 'Cotonou, Benin',
    extraTags:       ['benin', 'west-africa', 'africa'],
    language:        'en',
  },
  // English edition of AMI, Mauritania's state news agency: mostly the president's and ministers' news; no terms page
  {
    id:              'ami-mauritania-en',
    name:            'AMI Mauritanian News Agency, English (Mauritania)',
    feedUrl:         'https://ami.mr/en/feed',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'MR',
    defaultLat:      18.07,
    defaultLng:      -15.96,
    defaultLocation: 'Nouakchott, Mauritania',
    extraTags:       ['mauritania', 'sahel', 'west-africa', 'africa', 'state-media'],
    language:        'en',
  },
  // English edition of the Tunisian business site African Manager (Ariana); its terms allow a headline, a link and a short excerpt with the outlet named
  {
    id:              'african-manager-en',
    name:            'African Manager (English, Tunisia)',
    feedUrl:         'https://en.africanmanager.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'TN',
    defaultLat:      36.81,
    defaultLng:      10.18,
    defaultLocation: 'Tunis, Tunisia',
    extraTags:       ['tunisia', 'north-africa', 'maghreb', 'business'],
    language:        'en',
  },
  // English section of Echorouk Online, the site of the Algiers daily Echorouk El Yawmi; about 2 a day, close to the official line; the feed says Arabic, its items are English; no terms page
  {
    id:              'echorouk-en',
    name:            'Echorouk Online (English, Algeria)',
    feedUrl:         'https://www.echoroukonline.com/english/feed',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.60,
    countryCode:     'DZ',
    defaultLat:      36.75,
    defaultLng:      3.06,
    defaultLocation: 'Algiers, Algeria',
    extraTags:       ['algeria', 'north-africa', 'maghreb'],
    language:        'en',
  },
  // The Marshall Islands' weekly paper (Majuro): about 5 stories go up each Wednesday and Thursday; no terms page, and its homepage links this feed
  {
    id:              'marshall-islands-journal',
    name:            'The Marshall Islands Journal (Marshall Islands)',
    feedUrl:         'https://marshallislandsjournal.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'MH',
    defaultLat:      7.09,
    defaultLng:      171.38,
    defaultLocation: 'Majuro, Marshall Islands',
    extraTags:       ['marshall-islands', 'micronesia', 'pacific'],
    language:        'en',
  },
  // Suriname's oldest daily (1957), Paramaribo; no terms page; in Dutch
  {
    id:              'de-ware-tijd-sr',
    name:            'De Ware Tijd (Suriname)',
    feedUrl:         'https://dwtonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'SR',
    defaultLat:      5.85,
    defaultLng:      -55.2,
    defaultLocation: 'Paramaribo, Suriname',
    extraTags:       ['suriname', 'south-america'],
    language:        'nl',
  },
  // Suriname's busiest independent news site, Paramaribo; about a third is foreign news, most of it naming its country; no terms page (its colofon: all rights reserved); in Dutch
  {
    id:              'starnieuws-sr',
    name:            'Starnieuws (Suriname)',
    feedUrl:         'https://www.starnieuws.com/rss/starnieuws.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'SR',
    defaultLat:      5.85,
    defaultLng:      -55.2,
    defaultLocation: 'Paramaribo, Suriname',
    extraTags:       ['suriname', 'south-america'],
    language:        'nl',
  },
  // Daily news site of Time Media, Paramaribo; its disclaimer bars republishing without permission (we show headlines with links, as for the other feeds); in Dutch
  {
    id:              'suriname-herald-sr',
    name:            'Suriname Herald',
    feedUrl:         'https://www.srherald.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'SR',
    defaultLat:      5.85,
    defaultLng:      -55.2,
    defaultLocation: 'Paramaribo, Suriname',
    extraTags:       ['suriname', 'south-america'],
    language:        'nl',
  },
  // Voice of Nevis radio's newsline (Charlestown, Nevis); posts in bursts; no terms page
  {
    id:              'von-radio-kn',
    name:            'VON Radio (Saint Kitts and Nevis)',
    feedUrl:         'https://vonradio.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'KN',
    defaultLat:      17.14,
    defaultLng:      -62.62,
    defaultLocation: 'Charlestown, Nevis, Saint Kitts and Nevis',
    extraTags:       ['saint-kitts-and-nevis', 'nevis', 'caribbean'],
    language:        'en',
  },
  // English-language Ecuador news site in Cuenca, run by expats; many items sum up the Ecuadorian press; no clause on reuse
  {
    id:              'cuenca-high-life-ec',
    name:            'CuencaHighLife (Ecuador)',
    feedUrl:         'https://cuencahighlife.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'EC',
    defaultLat:      -2.9,
    defaultLng:      -79.0,
    defaultLocation: 'Cuenca, Ecuador',
    extraTags:       ['ecuador', 'south-america'],
    language:        'en',
    parked:          'browser check page (HTTP 403), Nov 5, 2026',
  },
  // Paraguay's English-language paper (Asunción); its terms bar collecting data by automated means without permission, a clause aimed at scraping (the site offers this feed)
  {
    id:              'asuncion-times-py',
    name:            'The Asunción Times (Paraguay)',
    feedUrl:         'https://asunciontimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'PY',
    defaultLat:      -25.28,
    defaultLng:      -57.64,
    defaultLocation: 'Asunción, Paraguay',
    extraTags:       ['paraguay', 'south-america'],
    language:        'en',
  },
  // The Seychelles president's office (State House): a government press office, read because no Seychelles newsroom has a working English feed (the news agency turns us away); its dates carry no time
  {
    id:              'statehouse-seychelles',
    name:            'State House (Seychelles)',
    feedUrl:         'https://www.statehouse.gov.sc/rss/news',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'SC',
    defaultLat:      -4.62,
    defaultLng:      55.45,
    defaultLocation: 'Victoria, Seychelles',
    extraTags:       ['seychelles', 'indian-ocean', 'africa', 'state-media', 'government'],
    language:        'en',
  },
  // English edition of Rafael Marques de Morais's anti-corruption site Maka Angola (its Portuguese feed is read); slow: 10 items in 49 days; no terms page
  {
    id:              'maka-angola-en',
    name:            'Maka Angola English (Angola)',
    feedUrl:         'https://www.makaangola.org/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'AO',
    defaultLat:      -8.81,
    defaultLng:      13.23,
    defaultLocation: 'Luanda, Angola',
    extraTags:       ['angola', 'southern-africa', 'africa', 'investigative', 'corruption'],
    language:        'en',
  },
  // The Local's Austria edition (Vienna): news and explainers in English for people living in Austria; same publisher and terms as The Local Switzerland; its old explainers in the feed are skipped as old
  {
    id:              'thelocal-at',
    name:            'The Local Austria',
    feedUrl:         'https://feeds.thelocal.com/rss/at',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'AT',
    defaultLat:      48.21,
    defaultLng:      16.37,
    defaultLocation: 'Vienna, Austria',
    extraTags:       ['austria', 'europe'],
    language:        'en',
  },
  // Vienna quality daily (Styria Media Group): Austrian and world news, many items paywalled; its terms bar redistribution without permission and reserve its texts against mining for AI training, which we don't do; in German; no home pin
  {
    id:              'die-presse-at',
    name:            'Die Presse (Austria)',
    feedUrl:         'https://www.diepresse.com/rss',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.76,
    countryCode:     'AT',
    defaultLat:      48.21,
    defaultLng:      16.37,
    defaultLocation: 'Vienna, Austria',
    extraTags:       ['austria', 'europe'],
    language:        'de',
  },
  // Ljubljana national daily (Dnevnik Mediji): Slovenian, world and celebrity news; the feed also holds old promotional items, which the reader skips as old; no site terms; in Slovene; no home pin
  {
    id:              'dnevnik-si',
    name:            'Dnevnik (Slovenia)',
    feedUrl:         'https://www.dnevnik.si/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.72,
    countryCode:     'SI',
    defaultLat:      46.06,
    defaultLng:      14.51,
    defaultLocation: 'Ljubljana, Slovenia',
    extraTags:       ['slovenia', 'europe'],
    language:        'sl',
  },
  // The Slovenia section of the public broadcaster RTV Slovenija (MMC); its terms bar republishing without permission and scraping with bots without consent (we read the feed it publishes); in Slovene
  {
    id:              'rtv-slo-slovenija',
    name:            'RTV Slovenija (Slovenia)',
    feedUrl:         'https://img.rtvslo.si/feeds/01.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'SI',
    defaultLat:      46.06,
    defaultLng:      14.51,
    defaultLocation: 'Ljubljana, Slovenia',
    extraTags:       ['slovenia', 'europe'],
    language:        'sl',
  },
  // English-language Moldova news site of the Realitatea Press Group (Chișinău); it also sells paid promotion packages, hence the lower score; no terms page
  {
    id:              'moldovalive-md',
    name:            'MoldovaLive (Moldova)',
    feedUrl:         'https://moldovalive.md/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'MD',
    defaultLat:      47.01,
    defaultLng:      28.86,
    defaultLocation: 'Chișinău, Moldova',
    extraTags:       ['moldova', 'europe'],
    language:        'en',
  },
  // Ziarul de Gardă, Moldova's investigative weekly and news site (Chișinău); no terms page; in Romanian
  {
    id:              'zdg-md',
    name:            'Ziarul de Gardă (Moldova)',
    feedUrl:         'https://www.zdg.md/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'MD',
    defaultLat:      47.01,
    defaultLng:      28.86,
    defaultLocation: 'Chișinău, Moldova',
    extraTags:       ['moldova', 'europe'],
    language:        'ro',
  },
  // Independent Chișinău TV station's news site; reuse is allowed with the source named and a link; the feed holds the newest 10 items; in Romanian
  {
    id:              'tv8-md',
    name:            'TV8 (Moldova)',
    feedUrl:         'https://tv8.md/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'MD',
    defaultLat:      47.01,
    defaultLng:      28.86,
    defaultLocation: 'Chișinău, Moldova',
    extraTags:       ['moldova', 'europe'],
    language:        'ro',
  },
  // Podgorica news portal; some political pieces are strongly partisan and the site names no owner, hence the low score; its terms only claim copyright; in Montenegrin
  {
    id:              'aktuelno-me',
    name:            'Aktuelno (Montenegro)',
    feedUrl:         'https://rss.aktuelno.me',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'ME',
    defaultLat:      42.43,
    defaultLng:      19.26,
    defaultLocation: 'Podgorica, Montenegro',
    extraTags:       ['montenegro', 'europe', 'balkans'],
    language:        'sr',
  },
  // Radio-Television Nikšić, the municipal public broadcaster of Montenegro's second city; no terms; in Montenegrin
  {
    id:              'rtnk-me',
    name:            'Radio-Televizija Nikšić (Montenegro)',
    feedUrl:         'https://rtnk.me/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'ME',
    defaultLat:      42.77,
    defaultLng:      18.94,
    defaultLocation: 'Nikšić, Montenegro',
    extraTags:       ['montenegro', 'europe', 'balkans'],
    language:        'sr',
  },
  // BIRN Kosovo's English-language news site (Pristina); about one story a day; no terms page
  {
    id:              'prishtina-insight',
    name:            'Prishtina Insight (Kosovo)',
    feedUrl:         'https://prishtinainsight.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'XK',
    defaultLat:      42.66,
    defaultLng:      21.17,
    defaultLocation: 'Pristina, Kosovo',
    extraTags:       ['kosovo', 'europe', 'balkans'],
    language:        'en',
  },
  // Pristina news portal; no terms page; in Albanian
  {
    id:              'lajmi-net-xk',
    name:            'Lajmi.net (Kosovo)',
    feedUrl:         'https://lajmi.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'XK',
    defaultLat:      42.66,
    defaultLng:      21.17,
    defaultLocation: 'Pristina, Kosovo',
    extraTags:       ['kosovo', 'europe', 'balkans'],
    language:        'sq',
  },
  // Andorra la Vella daily since 1997; almost all items Andorran; its legal notice bars reproduction without permission; in Catalan
  {
    id:              'el-periodic-andorra',
    name:            'El Periòdic d\'Andorra (Andorra)',
    feedUrl:         'https://elperiodic.ad/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'AD',
    defaultLat:      42.51,
    defaultLng:      1.52,
    defaultLocation: 'Andorra la Vella, Andorra',
    extraTags:       ['andorra', 'europe'],
    language:        'ca',
  },
  // San Marino's public broadcaster (ERAS and RAI); its legal notice allows abstracts of up to 15% of an article with a link and the author named; about a quarter press releases; in Italian
  {
    id:              'san-marino-rtv',
    name:            'San Marino RTV (San Marino)',
    feedUrl:         'https://www.sanmarinortv.sm/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'SM',
    defaultLat:      43.94,
    defaultLng:      12.45,
    defaultLocation: 'San Marino, San Marino',
    extraTags:       ['san-marino', 'europe'],
    language:        'it',
  },
  // ── Sources round 7 (Q9, Oct 31, 2026; Devon: "2 yes"): an English regional newsroom's feed for one country
  // counts too, for the countries still without English. Fresh enough here means the newest item under 7 days
  // and 4 or more in 30 days
  // Confidencial's English edition (the Nicaraguan newsroom; its Spanish feed is read); posts in batches, so its newest item can be 3 days old; no terms published
  {
    id:              'confidencial-en',
    name:            'Confidencial English (Nicaragua)',
    feedUrl:         'https://confidencial.digital/en/english/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'NI',
    defaultLat:      12.14,
    defaultLng:      -86.25,
    defaultLocation: 'Managua, Nicaragua',
    extraTags:       ['nicaragua', 'central-america', 'ortega'],
    language:        'en',
  },
  // Islands Business, the Pacific regional newsroom (Suva): its Kiribati tag, written by its correspondents there; no terms page
  {
    id:              'islands-business-kiribati',
    name:            'Islands Business (Kiribati)',
    feedUrl:         'https://islandsbusiness.com/tag/kiribati/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'KI',
    defaultLat:      1.33,
    defaultLng:      172.98,
    defaultLocation: 'Tarawa, Kiribati',
    extraTags:       ['kiribati', 'pacific', 'oceania'],
    language:        'en',
  },
  // Islands Business: its Tuvalu tag, about 6 stories a month (its newest was 11 days old on the check, past round 7's 7-day rule, kept because nothing else covers Tuvalu); no terms page
  {
    id:              'islands-business-tuvalu',
    name:            'Islands Business (Tuvalu)',
    feedUrl:         'https://islandsbusiness.com/tag/tuvalu/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'TV',
    defaultLat:      -8.52,
    defaultLng:      179.2,
    defaultLocation: 'Funafuti, Tuvalu',
    extraTags:       ['tuvalu', 'pacific'],
    language:        'en',
  },
  // Fresh Fruit Portal, a fruit-trade newsroom (Santiago): its Chile tag, fruit exports only; no terms page
  {
    id:              'fresh-fruit-portal-chile',
    name:            'Fresh Fruit Portal (Chile)',
    feedUrl:         'https://www.freshfruitportal.com/tag/chile/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'CL',
    defaultLat:      -33.45,
    defaultLng:      -70.67,
    defaultLocation: 'Santiago, Chile',
    extraTags:       ['chile', 'agriculture', 'exports', 'south-america'],
    language:        'en',
  },
  // Fresh Fruit Portal (Santiago): its Peru tag, fruit exports only; no terms page
  {
    id:              'fresh-fruit-portal-peru',
    name:            'Fresh Fruit Portal (Peru)',
    feedUrl:         'https://www.freshfruitportal.com/tag/peru/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'PE',
    defaultLat:      -12.05,
    defaultLng:      -77.04,
    defaultLocation: 'Lima, Peru',
    extraTags:       ['peru', 'agriculture', 'exports', 'south-america'],
    language:        'en',
  },
  // The Micronesian president's office (Palikir): a government press office, read because no FSM newsroom has a feed (the Kaselehlie Press's website is gone); no terms page
  {
    id:              'fsm-president-office',
    name:            'FSM Government, Office of the President (Micronesia)',
    feedUrl:         'https://gov.fm/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'FM',
    defaultLat:      6.92,
    defaultLng:      158.16,
    defaultLocation: 'Palikir, Micronesia',
    extraTags:       ['micronesia', 'fsm', 'pacific', 'government', 'state-media'],
    language:        'en',
  },
  // SOS Médias Burundi's English edition (its French feed is read); posts in batches; no terms page
  {
    id:              'sos-medias-burundi-en',
    name:            'SOS Médias Burundi English (Burundi)',
    feedUrl:         'https://www.sosmediasburundi.org/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'BI',
    defaultLat:      -3.38,
    defaultLng:      29.36,
    defaultLocation: 'Bujumbura, Burundi',
    extraTags:       ['burundi', 'great-lakes', 'africa'],
    language:        'en',
  },
  // The Mauritius Times (Port Louis), a weekly opinion paper: its Features section (its main feed goes through follow.it's tracking links); no terms page
  {
    id:              'mauritius-times',
    name:            'Mauritius Times (Mauritius)',
    feedUrl:         'https://www.mauritiustimes.com/mt/category/features/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.60,
    countryCode:     'MU',
    defaultLat:      -20.16,
    defaultLng:      57.5,
    defaultLocation: 'Port Louis, Mauritius',
    extraTags:       ['mauritius', 'indian-ocean', 'africa'],
    language:        'en',
  },
  // ── Added Oct 31, 2026 (Q9, the last four places) ──────────────────────────
  // Devon, Oct 31, 12:33 PM: "Let's close the gap and try to find signals for Brunei, Greenland,
  // Liechtenstein and Nauru". Brunei's newsrooms turn our requests away (Borneo Bulletin, Media
  // Permata), stopped (RTB's feed, in June), post about once a month (The Scoop) or are for
  // personal use only (The Bruneian's terms). Greenland's have a dead feed (KNR, last item 2017),
  // allow private use only (Sermitsiaq.AG) or reserve their texts against data mining (Altinget
  // Arktis). So both are read through their governments' press offices, as state media, the way
  // Micronesia and Seychelles are. Liechtenstein's papers have no feed or bar reuse, so it is read
  // through its government's releases too (below). Nauru has no newsroom with a feed: a regional
  // newsroom's Nauru tag (Islands Business), slow, is all there is.
  // The Prime Minister's Office of Brunei: its News section, in English (the whole feed adds the sultan's speeches in Malay and tender notices); about 10 a month (its newest was 8 days old on the check, past round 7's 7-day rule, kept because nothing else covers Brunei, as with Tuvalu); its site's only notice is "Copyright Government of Brunei Darussalam"
  {
    id:              'pmo-brunei',
    name:            "Prime Minister's Office (Brunei)",
    feedUrl:         'https://www.pmo.gov.bn/category/news/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'BN',
    defaultLat:      4.90,
    defaultLng:      114.94,
    defaultLocation: 'Bandar Seri Begawan, Brunei',
    extraTags:       ['brunei', 'southeast-asia', 'asean', 'government', 'state-media'],
    language:        'en',
  },
  // The Government of Greenland (Naalakkersuisut, Nuuk): its news in Danish (the same news is in Greenlandic); about 45 a month; the feed dates nothing, so each item's date comes from its link (dateFromLink); no terms page
  {
    id:              'naalakkersuisut-gl',
    name:            'Naalakkersuisut (Greenland)',
    feedUrl:         'https://naalakkersuisut.gl/rss/rssda.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'GL',
    defaultLat:      64.18,
    defaultLng:      -51.72,
    defaultLocation: 'Nuuk, Greenland',
    extraTags:       ['greenland', 'arctic', 'nordics', 'government', 'state-media'],
    language:        'da',
  },
  // The Government of Liechtenstein's releases (its information office, Vaduz), sent out through presseportal.ch (news aktuell), about 45 a month, in German. presseportal's terms ask a website that takes the releases in automatically to apply for a key first; Devon, Oct 31, 1:40 PM: "Do it without the key". Each item links back to its release on presseportal. The government's own feed (llv.li) answers our requests with a bot check
  {
    id:              'regierung-li',
    name:            'Government of Liechtenstein',
    feedUrl:         'https://www.presseportal.ch/de/rss/pm_100000148.rss2?langid=1',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'LI',
    defaultLat:      47.14,
    defaultLng:      9.52,
    defaultLocation: 'Vaduz, Liechtenstein',
    extraTags:       ['liechtenstein', 'europe', 'government', 'state-media'],
    language:        'de',
  },
  // Islands Business (Suva): its Naoero tag (Nauru's name since Aug 2026; its Nauru tag stopped in June), about 2 stories a month (its newest was 29 days old on the check, far past round 7's 7-day rule; kept because nothing else covers Nauru: the government's site has no feed, PINA's feeds answer "No Feed Access" and the Guardian's Nauru tag is mostly Australia's detention politics); no terms page
  {
    id:              'islands-business-nauru',
    name:            'Islands Business (Nauru)',
    feedUrl:         'https://islandsbusiness.com/tag/naoero/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'NR',
    defaultLat:      -0.55,
    defaultLng:      166.92,
    defaultLocation: 'Yaren, Nauru',
    extraTags:       ['nauru', 'naoero', 'pacific', 'oceania'],
    language:        'en',
  },
  // ── Added Oct 31, 2026 (round 8: depth for the places with one or two feeds) ──
  // Devon, Oct 31, 2:43 PM: "let's now [go through] every place with only 1 or 2 sources to create
  // more depth", with helpers. Eight helpers searched the 105 places region by region under rounds 6
  // and 7's rules: each feed answers the server's own request with fresh, dated items, and its terms
  // allow headlines with links (any clause about reuse is noted); every pick was checked again before
  // it went in: 63 feeds for 48 places. Left out: Shabait (Eritrea; terms unread; added at 7:02 PM on
  // Devon's call, below), Kuensel (Bhutan)
  // and NBC Radio (Saint Vincent) on terms, Levant24 (Syria; written up from other outlets' reports),
  // Times Caribbean (Saint Kitts and Nevis; 3 of its 10 newest stories carry an AI chat tool's search
  // citations, "<Cite ref=turn480065search23/>", so they're written up from others' reports too) and
  // Business Advantage PNG (magazine features). The helpers' notes are in the HQ's
  // departments/research/sources-round-8-2026-10-31.md.
  // Taken out after it went in: Gazeta Express (Kosovo), which turned the server away (403) on its first two
  // reads (Oct 31, about 4:30 and 5:00 PM).
  // Altaveu, an Andorran digital daily (Andorra la Vella), in Catalan; its legal notice covers data and links only
  {
    id:              'altaveu-ad',
    name:            'Altaveu (Andorra)',
    feedUrl:         'https://www.altaveu.com/uploads/feeds/feed_altaveu_ca.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'AD',
    defaultLat:      42.51,
    defaultLng:      1.52,
    defaultLocation: 'Andorra la Vella, Andorra',
    extraTags:       ['andorra', 'pyrenees', 'europe'],
    language:        'ca',
  },
  // ABS TV Radio, Antigua and Barbuda's state broadcaster: about 6 local stories a day; no terms page
  {
    id:              'abs-tv-radio-ag',
    name:            'ABS TV Radio (Antigua and Barbuda)',
    feedUrl:         'https://abstvradio.com/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'AG',
    defaultLat:      17.13,
    defaultLng:      -61.85,
    defaultLocation: 'St John\'s, Antigua and Barbuda',
    extraTags:       ['antigua-and-barbuda', 'caribbean', 'state-media'],
    language:        'en',
  },
  // The Daily Observer, Antigua's independent daily: each weekday edition goes up in one nightly batch, so its newest item passes 48 h at weekends; no terms page
  {
    id:              'antigua-observer-ag',
    name:            'Antigua Observer',
    feedUrl:         'https://antiguaobserver.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'AG',
    defaultLat:      17.13,
    defaultLng:      -61.85,
    defaultLocation: 'St John\'s, Antigua and Barbuda',
    extraTags:       ['antigua-and-barbuda', 'caribbean'],
    language:        'en',
  },
  // Balkanweb, the news portal of Tirana's News24 TV, in Albanian; no terms page
  {
    id:              'balkanweb-al',
    name:            'Balkanweb (Albania)',
    feedUrl:         'https://www.balkanweb.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'AL',
    defaultLat:      41.33,
    defaultLng:      19.82,
    defaultLocation: 'Tirana, Albania',
    extraTags:       ['albania', 'balkans', 'europe'],
    language:        'sq',
  },
  // RTSH, Albania's public broadcaster: its domestic news section (the main feed mixes in world and football news), in Albanian; its footer bars unauthorised reproduction
  {
    id:              'rtsh-al',
    name:            'RTSH (Albania)',
    feedUrl:         'https://rtsh.al/kategoria/aktualitet/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'AL',
    defaultLat:      41.33,
    defaultLng:      19.82,
    defaultLocation: 'Tirana, Albania',
    extraTags:       ['albania', 'balkans', 'europe'],
    language:        'sq',
  },
  // Kleine Zeitung (Graz; Styria Media Group, like Die Presse): its Austria feed (the main feed is mostly wire world news), in German; its terms reserve its texts against mining for AI training, which we don't do
  {
    id:              'kleine-zeitung-at',
    name:            'Kleine Zeitung (Austria)',
    feedUrl:         'https://www.kleinezeitung.at/rss/orte/oesterreich',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'AT',
    defaultLat:      47.07,
    defaultLng:      15.44,
    defaultLocation: 'Graz, Austria',
    extraTags:       ['austria', 'styria', 'carinthia', 'europe'],
    language:        'de',
  },
  // AZERTAC, Azerbaijan's state news agency, in English: the only daily English Azerbaijani feed that answers; its footer asks for a link when its content is used
  {
    id:              'azertac-en',
    name:            'AZERTAC (Azerbaijan State News Agency, English)',
    feedUrl:         'https://azertag.az/en/rss',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'AZ',
    defaultLat:      40.41,
    defaultLng:      49.87,
    defaultLocation: 'Baku, Azerbaijan',
    extraTags:       ['azerbaijan', 'caucasus', 'asia', 'state-media'],
    language:        'en',
  },
  // CBC, Barbados's state broadcaster: about 15 items a day, mostly local, a few wire reprints; no terms page
  {
    id:              'cbc-barbados-bb',
    name:            'Caribbean Broadcasting Corporation (Barbados)',
    feedUrl:         'https://www.cbc.bb/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'BB',
    defaultLat:      13.10,
    defaultLng:      -59.62,
    defaultLocation: 'Bridgetown, Barbados',
    extraTags:       ['barbados', 'caribbean', 'state-media'],
    language:        'en',
  },
  // The Business Standard (Dhaka): its Bangladesh section (the site-wide feed stopped in 2021); no terms page
  {
    id:              'tbs-bangladesh',
    name:            'The Business Standard (Bangladesh)',
    feedUrl:         'https://www.tbsnews.net/bangladesh/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'BD',
    defaultLat:      23.81,
    defaultLng:      90.41,
    defaultLocation: 'Dhaka, Bangladesh',
    extraTags:       ['bangladesh', 'south-asia', 'asia'],
    language:        'en',
  },
  // The Sofia Globe, an independent English news site in Sofia: its Bulgaria category (the main feed redirects to a FeedBurner copy frozen in 2025); its copyright note bars reproduction without permission
  {
    id:              'sofia-globe-bg',
    name:            'The Sofia Globe',
    feedUrl:         'https://sofiaglobe.com/category/bulgaria/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BG',
    defaultLat:      42.70,
    defaultLng:      23.32,
    defaultLocation: 'Sofia, Bulgaria',
    extraTags:       ['bulgaria', 'balkans', 'europe'],
    language:        'en',
  },
  // ZNS, the Broadcasting Corporation of The Bahamas (state): its own reports and government releases in full; no terms page
  {
    id:              'zns-bahamas-bs',
    name:            'ZNS (Bahamas)',
    feedUrl:         'https://znsbahamas.com/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'BS',
    defaultLat:      25.05,
    defaultLng:      -77.36,
    defaultLocation: 'Nassau, Bahamas',
    extraTags:       ['bahamas', 'caribbean', 'state-media'],
    language:        'en',
  },
  // Love FM, a private national broadcaster in Belize City: about 10 stories a night after the evening news (the feed holds 100); no terms page
  {
    id:              'love-fm-bz',
    name:            'Love FM (Belize)',
    feedUrl:         'https://lovefm.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'BZ',
    defaultLat:      17.50,
    defaultLng:      -88.19,
    defaultLocation: 'Belize City, Belize',
    extraTags:       ['belize', 'central-america', 'caribbean'],
    language:        'en',
  },
  // The San Pedro Sun, Ambergris Caye's newspaper since 1991: town and national news, 4 to 5 a day; no terms page
  {
    id:              'san-pedro-sun-bz',
    name:            'The San Pedro Sun (Belize)',
    feedUrl:         'https://www.sanpedrosun.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'BZ',
    defaultLat:      17.92,
    defaultLng:      -87.96,
    defaultLocation: 'San Pedro, Ambergris Caye, Belize',
    extraTags:       ['belize', 'central-america', 'caribbean'],
    language:        'en',
  },
  // Corbeau News Centrafrique, an independent Bangui news site critical of the government and of the Wagner presence (blocked by the government in 2021), in French; no terms page
  {
    id:              'corbeau-news-centrafrique',
    name:            'Corbeau News Centrafrique (CNC)',
    feedUrl:         'https://corbeaunews-centrafrique.org/feed/',
    category:        'geopolitics',
    biasLabel:       'unknown',
    reliability:     0.58,
    countryCode:     'CF',
    defaultLat:      4.39,
    defaultLng:      18.56,
    defaultLocation: 'Bangui, Central African Republic',
    extraTags:       ['central-african-republic', 'central-africa', 'africa'],
    language:        'fr',
  },
  // Journal de Brazza, the Congo site of the Yogam Group (Paris; Journal du Mali is read), in French: short signed reports, probably from a shared desk; its legal notice covers its trademark only
  {
    id:              'journal-de-brazza-cg',
    name:            'Journal de Brazza (Republic of the Congo)',
    feedUrl:         'https://www.journaldebrazza.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'CG',
    defaultLat:      -4.26,
    defaultLng:      15.24,
    defaultLocation: 'Brazzaville, Republic of the Congo',
    extraTags:       ['republic-of-the-congo', 'central-africa', 'africa'],
    language:        'fr',
  },
  // AIP, Côte d'Ivoire's state news agency (bureaus across the country), in French; no terms page
  {
    id:              'aip-cote-divoire',
    name:            'AIP (Agence Ivoirienne de Presse)',
    feedUrl:         'https://www.aip.ci/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.52,
    countryCode:     'CI',
    defaultLat:      5.36,
    defaultLng:      -4.01,
    defaultLocation: 'Abidjan, Côte d\'Ivoire',
    extraTags:       ['cote-divoire', 'west-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // RTI Info, Côte d'Ivoire's public broadcaster, in French: mostly national news (14 of its latest 20); no terms page
  {
    id:              'rti-info-ci',
    name:            'RTI Info (Côte d\'Ivoire)',
    feedUrl:         'https://rti.info/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.52,
    countryCode:     'CI',
    defaultLat:      5.36,
    defaultLng:      -4.01,
    defaultLocation: 'Abidjan, Côte d\'Ivoire',
    extraTags:       ['cote-divoire', 'west-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // Business in Cameroon, the English edition of Investir au Cameroun (Stratline, publisher of Togo First): economy, mining and public finance; no terms page
  {
    id:              'business-in-cameroon',
    name:            'Business in Cameroon',
    feedUrl:         'https://www.businessincameroon.com/index.php/component/obrss/fullrss',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'CM',
    defaultLat:      3.85,
    defaultLng:      11.50,
    defaultLocation: 'Yaoundé, Cameroon',
    extraTags:       ['cameroon', 'central-africa', 'africa'],
    language:        'en',
  },
  // DataCameroon, a Douala data-journalism outlet with an ethics charter, in French; no terms page
  {
    id:              'datacameroon',
    name:            'DataCameroon',
    feedUrl:         'https://datacameroon.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'CM',
    defaultLat:      4.05,
    defaultLng:      9.77,
    defaultLocation: 'Douala, Cameroon',
    extraTags:       ['cameroon', 'central-africa', 'africa'],
    language:        'fr',
  },
  // China Digital Times (Berkeley): translations of censored Chinese posts and its own reports on censorship, about 3 a week (fresh by the one-country rule); its permissions page welcomes excerpts with credit and a link; no home pin
  {
    id:              'china-digital-times',
    name:            'China Digital Times',
    feedUrl:         'https://chinadigitaltimes.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'CN',
    defaultLat:      37.87,
    defaultLng:      -122.27,
    defaultLocation: 'Berkeley, United States',
    extraTags:       ['china', 'east-asia', 'asia', 'censorship'],
    language:        'en',
  },
  // Direct Infos Gabon, a Libreville economic news site run by independent journalists, in French: morning batches; no terms page
  {
    id:              'direct-infos-gabon',
    name:            'Direct Infos Gabon',
    feedUrl:         'https://directinfosgabon.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'GA',
    defaultLat:      0.42,
    defaultLng:      9.47,
    defaultLocation: 'Libreville, Gabon',
    extraTags:       ['gabon', 'central-africa', 'africa'],
    language:        'fr',
  },
  // L'Union, Gabon's daily since 1973 (the state-controlled Sonapresse), in French: Drupal's front-page feed; no terms page
  {
    id:              'lunion-gabon',
    name:            'L\'Union (Gabon)',
    feedUrl:         'https://www.union.sonapresse.com/rss.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.52,
    countryCode:     'GA',
    defaultLat:      0.42,
    defaultLng:      9.47,
    defaultLocation: 'Libreville, Gabon',
    extraTags:       ['gabon', 'central-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // e-Global (a Lisbon online daily on the Portuguese-speaking countries): its Equatorial Guinea category, in Portuguese, close to the government's announcements, about one a day; no terms page
  {
    id:              'e-global-equatorial-guinea',
    name:            'e-Global (Equatorial Guinea)',
    feedUrl:         'https://e-global.pt/feed/?category_name=guine-equatorial',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.58,
    countryCode:     'GQ',
    defaultLat:      3.75,
    defaultLng:      8.78,
    defaultLocation: 'Malabo, Equatorial Guinea',
    extraTags:       ['equatorial-guinea', 'central-africa', 'africa'],
    language:        'pt',
  },
  // ANG, Guinea-Bissau's state news agency, in Portuguese: its main feed without the international category (cat=-18); its terms bar copying without permission but allow citation
  {
    id:              'ang-guinea-bissau',
    name:            'ANG (Agência de Notícias da Guiné)',
    feedUrl:         'https://ang.gw/feed/?cat=-18',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'GW',
    defaultLat:      11.86,
    defaultLng:      -15.60,
    defaultLocation: 'Bissau, Guinea-Bissau',
    extraTags:       ['guinea-bissau', 'west-africa', 'africa', 'state-media'],
    language:        'pt',
  },
  // e-Global (Lisbon): its Guinea-Bissau category, in Portuguese (the category's own feed path is a 404, so the main feed is filtered); no terms page
  {
    id:              'e-global-guinea-bissau',
    name:            'e-Global (Guinea-Bissau)',
    feedUrl:         'https://e-global.pt/feed/?category_name=guine-bissau',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'GW',
    defaultLat:      11.86,
    defaultLng:      -15.60,
    defaultLocation: 'Bissau, Guinea-Bissau',
    extraTags:       ['guinea-bissau', 'west-africa', 'africa'],
    language:        'pt',
  },
  // Balkan Green Energy News (Belgrade): its Croatia feed, energy and climate only, about 2 a week (fresh by the one-country rule); its disclaimer lets websites use its texts with credit and a live link
  {
    id:              'bgen-croatia',
    name:            'Balkan Green Energy News (Croatia)',
    feedUrl:         'https://balkangreenenergynews.com/country/croatia/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'HR',
    defaultLat:      45.81,
    defaultLng:      15.98,
    defaultLocation: 'Zagreb, Croatia',
    extraTags:       ['croatia', 'energy', 'balkans', 'europe'],
    language:        'en',
  },
  // Shafaq News: its Kurdistan Region section, whose stories aren't in its Iraq feed (read since round 2)
  {
    id:              'shafaq-kurdistan',
    name:            'Shafaq News (Kurdistan Region, Iraq)',
    feedUrl:         'https://shafaq.com/rss/en/Kurdistan',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'IQ',
    defaultLat:      36.19,
    defaultLng:      44.01,
    defaultLocation: 'Erbil, Iraq',
    extraTags:       ['iraq', 'kurdistan', 'middle-east'],
    language:        'en',
  },
  // Nationwide News Network, the newsroom of Kingston's Nationwide 90FM (independent of the Observer and the Gleaner group): large evening batches; no terms page
  {
    id:              'nationwide-news-jm',
    name:            'Nationwide News Network (Jamaica)',
    feedUrl:         'https://nationwideradiojm.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'JM',
    defaultLat:      18.00,
    defaultLng:      -76.79,
    defaultLocation: 'Kingston, Jamaica',
    extraTags:       ['jamaica', 'caribbean'],
    language:        'en',
  },
  // Kuwait Times: its Kuwait section (the site-wide feed is mostly wire world and sports copy); its copyright page asks permission to republish
  {
    id:              'kuwait-times-kw',
    name:            'Kuwait Times (Kuwait section)',
    feedUrl:         'https://kuwaittimes.com/rssfeed/14/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'KW',
    defaultLat:      29.38,
    defaultLng:      47.99,
    defaultLocation: 'Kuwait City, Kuwait',
    extraTags:       ['kuwait', 'gulf', 'middle-east'],
    language:        'en',
  },
  // The Voice, Saint Lucia's long-running newspaper: afternoon batches, gaps up to about 50 h; no terms page
  {
    id:              'the-voice-lc',
    name:            'The Voice (Saint Lucia)',
    feedUrl:         'https://thevoiceslu.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'LC',
    defaultLat:      14.01,
    defaultLng:      -60.99,
    defaultLocation: 'Castries, Saint Lucia',
    extraTags:       ['saint-lucia', 'caribbean'],
    language:        'en',
  },
  // LSM (Latvian Public Service Media) in English: read until Oct 21 as lsm-en and taken out when the server failed every poll that day; it answers the server's request again, so it's tried once more (out again if the server's polls fail); its RSS page invites feed readers
  {
    id:              'lsm-english-lv',
    name:            'LSM English (Latvian Public Service Media)',
    feedUrl:         'https://eng.lsm.lv/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'LV',
    defaultLat:      56.95,
    defaultLng:      24.11,
    defaultLocation: 'Riga, Latvia',
    extraTags:       ['latvia', 'baltics', 'europe'],
    language:        'en',
  },
  // Hello Monaco, a Monaco magazine with a daily English news section (government, National Council, courts, the palace); no terms page
  {
    id:              'hello-monaco',
    name:            'Hello Monaco',
    feedUrl:         'https://www.hellomonaco.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'MC',
    defaultLat:      43.74,
    defaultLng:      7.42,
    defaultLocation: 'Monaco, Monaco',
    extraTags:       ['monaco', 'riviera', 'europe'],
    language:        'en',
  },
  // Borba, a Podgorica news portal in Serbian (Latin script) with a pro-Serbian line; its terms cover personal data only
  {
    id:              'borba-me',
    name:            'Borba (Montenegro)',
    feedUrl:         'https://borba.me/feed/',
    category:        'geopolitics',
    biasLabel:       'right',
    reliability:     0.60,
    countryCode:     'ME',
    defaultLat:      42.44,
    defaultLng:      19.26,
    defaultLocation: 'Podgorica, Montenegro',
    extraTags:       ['montenegro', 'balkans', 'europe'],
    language:        'sr',
    parked:          'bot check page (HTTP 403), Nov 5, 2026',
  },
  // Portalb, an independent Albanian-language portal in Skopje: its content may be taken with a hyperlink to the source (Creative Commons)
  {
    id:              'portalb-mk',
    name:            'Portalb (North Macedonia)',
    feedUrl:         'https://portalb.mk/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MK',
    defaultLat:      42.00,
    defaultLng:      21.43,
    defaultLocation: 'Skopje, North Macedonia',
    extraTags:       ['north-macedonia', 'balkans', 'europe'],
    language:        'sq',
  },
  // TV21, a Skopje station broadcasting mostly in Albanian: about half of its items are regional and world news; no terms page
  {
    id:              'tv21-mk',
    name:            'TV21 (North Macedonia)',
    feedUrl:         'https://tv21.tv/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'MK',
    defaultLat:      42.00,
    defaultLng:      21.43,
    defaultLocation: 'Skopje, North Macedonia',
    extraTags:       ['north-macedonia', 'balkans', 'europe'],
    language:        'sq',
  },
  // Maldives Voice, the English edition of voice.mv (Malé): its terms let readers share its stories but not republish them commercially
  {
    id:              'maldives-voice-mv',
    name:            'Maldives Voice (English)',
    feedUrl:         'https://maldivesvoice.mv/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'MV',
    defaultLat:      4.18,
    defaultLng:      73.51,
    defaultLocation: 'Malé, Maldives',
    extraTags:       ['maldives', 'south-asia', 'asia'],
    language:        'en',
  },
  // Maldives Financial Review (Malé), business and economy: posts in batches, so its newest can be days old; no terms page
  {
    id:              'mfr-maldives',
    name:            'Maldives Financial Review',
    feedUrl:         'https://mfr.mv/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'MV',
    defaultLat:      4.18,
    defaultLng:      73.51,
    defaultLocation: 'Malé, Maldives',
    extraTags:       ['maldives', 'south-asia', 'asia', 'business'],
    language:        'en',
  },
  // Namibian Sun (Windhoek, Network Media Hub): its Local News section (the top-level News feed is empty); no terms page
  {
    id:              'namibian-sun-na',
    name:            'Namibian Sun',
    feedUrl:         'https://www.namibiansun.com/rssFeed/137',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'NA',
    defaultLat:      -22.56,
    defaultLng:      17.07,
    defaultLocation: 'Windhoek, Namibia',
    extraTags:       ['namibia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // New Era, Namibia's state-owned daily: its National section (the site-wide feed is often in Oshiwambo); weekday editions in batches; no terms page
  {
    id:              'new-era-na',
    name:            'New Era (Namibia)',
    feedUrl:         'https://neweralive.na/category/national/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'NA',
    defaultLat:      -22.56,
    defaultLng:      17.07,
    defaultLocation: 'Windhoek, Namibia',
    extraTags:       ['namibia', 'southern-africa', 'africa', 'state-media'],
    language:        'en',
  },
  // ActuNiger (Niamey): its politics section (no all-news feed), in French, 4 to 5 a week; no terms page
  {
    id:              'actuniger-politique',
    name:            'ActuNiger (Politique)',
    feedUrl:         'https://www.actuniger.com/component/joomrss/politique?Itemid=101',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'NE',
    defaultLat:      13.51,
    defaultLng:      2.13,
    defaultLocation: 'Niamey, Niger',
    extraTags:       ['niger', 'sahel', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Le Sahel, Niger's state daily (ONEP), in French: official communiqués beside its own reports; no terms page
  {
    id:              'le-sahel-niger',
    name:            'Le Sahel (Niger)',
    feedUrl:         'https://www.lesahel.org/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.48,
    countryCode:     'NE',
    defaultLat:      13.51,
    defaultLng:      2.13,
    defaultLocation: 'Niamey, Niger',
    extraTags:       ['niger', 'sahel', 'west-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // Qatar Tribune (Doha): its Latest News feed (its Nation feed is the print edition in one nightly batch); its RSS page invites aggregators
  {
    id:              'qatar-tribune',
    name:            'Qatar Tribune',
    feedUrl:         'https://www.qatar-tribune.com/rssFeed/62',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'QA',
    defaultLat:      25.29,
    defaultLng:      51.53,
    defaultLocation: 'Doha, Qatar',
    extraTags:       ['qatar', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Rwanda Dispatch, a Kigali news magazine (since 2008): politics, the DRC accords, business; partnered with ministries, so 0.62 as for KT Press; no terms page
  {
    id:              'rwanda-dispatch-rw',
    name:            'Rwanda Dispatch',
    feedUrl:         'https://rwandadispatch.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'RW',
    defaultLat:      -1.94,
    defaultLng:      30.06,
    defaultLocation: 'Kigali, Rwanda',
    extraTags:       ['rwanda', 'east-africa', 'great-lakes', 'africa'],
    language:        'en',
  },
  // Primorske novice, the Koper regional daily (since 1947), in Slovene: the feed opens with six pinned features from March, then current news; no terms page
  {
    id:              'primorske-novice-si',
    name:            'Primorske novice (Slovenia)',
    feedUrl:         'https://primorske.si/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'SI',
    defaultLat:      45.55,
    defaultLng:      13.73,
    defaultLocation: 'Koper, Slovenia',
    extraTags:       ['slovenia', 'primorska', 'europe'],
    language:        'sl',
  },
  // The Calabash Newspaper, an independent Freetown paper (since 2017): courts, party politics, business; posts in batches; no terms page
  {
    id:              'calabash-newspaper-sl',
    name:            'The Calabash Newspaper (Sierra Leone)',
    feedUrl:         'https://thecalabashnewspaper.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'SL',
    defaultLat:      8.47,
    defaultLng:      -13.23,
    defaultLocation: 'Freetown, Sierra Leone',
    extraTags:       ['sierra-leone', 'west-africa', 'africa'],
    language:        'en',
  },
  // Corriere Romagna, the Rimini regional daily: its San Marino section, in Italian, about one a day; no terms page
  {
    id:              'corriere-romagna-sm',
    name:            'Corriere Romagna (San Marino)',
    feedUrl:         'https://www.corriereromagna.it/rss/san-marino.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'SM',
    defaultLat:      43.94,
    defaultLng:      12.45,
    defaultLocation: 'San Marino, San Marino',
    extraTags:       ['san-marino', 'europe'],
    language:        'it',
  },
  // The Dawn, a Juba English daily: Warrap and Tonj violence, the elections commission, courts; no terms page
  {
    id:              'the-dawn-ss',
    name:            'The Dawn (South Sudan)',
    feedUrl:         'https://thedawn.com.ss/?feed=rss2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'SS',
    defaultLat:      4.86,
    defaultLng:      31.57,
    defaultLocation: 'Juba, South Sudan',
    extraTags:       ['south-sudan', 'east-africa', 'africa'],
    language:        'en',
  },
  // RSTP (Rádio Somos Todos Primos), a private São Tomé radio and news site, in Portuguese; its web agency's boilerplate leaves content rights to the authors
  {
    id:              'rstp-sao-tome',
    name:            'RSTP – Rádio Somos Todos Primos (São Tomé and Príncipe)',
    feedUrl:         'https://rstp.st/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'ST',
    defaultLat:      0.34,
    defaultLng:      6.73,
    defaultLocation: 'São Tomé, São Tomé and Príncipe',
    extraTags:       ['sao-tome-and-principe', 'central-africa', 'africa'],
    language:        'pt',
  },
  // STP-Press, São Tomé and Príncipe's state news agency, in Portuguese: about one item a day; no terms page
  {
    id:              'stp-press',
    name:            'STP-Press (São Tomé and Príncipe)',
    feedUrl:         'https://www.stp-press.st/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'ST',
    defaultLat:      0.34,
    defaultLng:      6.73,
    defaultLocation: 'São Tomé, São Tomé and Príncipe',
    extraTags:       ['sao-tome-and-principe', 'central-africa', 'africa', 'state-media'],
    language:        'pt',
  },
  // Eswatini Observer (formerly the Swazi Observer), owned by the royal fund Tibiyo Taka Ngwane, hence state media; its footer bars reproduction without permission
  {
    id:              'eswatini-observer-sz',
    name:            'Eswatini Observer',
    feedUrl:         'https://www.eswatiniobserver.com/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'SZ',
    defaultLat:      -26.31,
    defaultLng:      31.14,
    defaultLocation: 'Mbabane, Eswatini',
    extraTags:       ['eswatini', 'southern-africa', 'africa', 'state-media'],
    language:        'en',
  },
  // Eswatini Positive News, a small online newsroom with named staff: local reports, royal and government events, entertainment; no terms page
  {
    id:              'eswatini-positive-news-sz',
    name:            'Eswatini Positive News',
    feedUrl:         'https://eswatinipositivenews.online/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.60,
    countryCode:     'SZ',
    defaultLat:      -26.31,
    defaultLng:      31.14,
    defaultLocation: 'Mbabane, Eswatini',
    extraTags:       ['eswatini', 'southern-africa', 'africa'],
    language:        'en',
  },
  // ATPE, Chad's state news agency, in French (the site also has an Arabic section); no terms page
  {
    id:              'atpe-tchad',
    name:            'ATPE (Agence Tchadienne de Presse et d\'Édition)',
    feedUrl:         'https://www.atpe.td/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'TD',
    defaultLat:      12.13,
    defaultLng:      15.06,
    defaultLocation: 'N\'Djamena, Chad',
    extraTags:       ['chad', 'central-africa', 'africa', 'state-media'],
    language:        'fr',
  },
  // 24heureinfo, a private Lomé news site, in French: Togolese politics, economy and justice, plus West African news; no terms page
  {
    id:              '24heureinfo-tg',
    name:            '24heureinfo (Togo)',
    feedUrl:         'https://24heureinfo.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'TG',
    defaultLat:      6.14,
    defaultLng:      1.21,
    defaultLocation: 'Lomé, Togo',
    extraTags:       ['togo', 'west-africa', 'africa'],
    language:        'fr',
  },
  // Khovar, Tajikistan's state news agency, in English: mostly the president's and government's activities; the feed holds 10 items, so it can pass 48 h on quiet days; its footer asks permission to reproduce
  {
    id:              'khovar-en',
    name:            'Khovar (Tajikistan State News Agency, English)',
    feedUrl:         'https://eng.khovar.tj/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'TJ',
    defaultLat:      38.56,
    defaultLng:      68.79,
    defaultLocation: 'Dushanbe, Tajikistan',
    extraTags:       ['tajikistan', 'central-asia', 'asia', 'state-media'],
    language:        'en',
  },
  // Diligente, a Dili news site, in Portuguese: about one story a day; its terms keep its content's rights
  {
    id:              'diligente-tl',
    name:            'Diligente (Timor-Leste)',
    feedUrl:         'https://www.diligenteonline.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'TL',
    defaultLat:      -8.56,
    defaultLng:      125.57,
    defaultLocation: 'Dili, Timor-Leste',
    extraTags:       ['timor-leste', 'southeast-asia', 'asia'],
    language:        'pt',
  },
  // TTT, Trinidad and Tobago's state broadcaster: about 20 items a day, a third newsroom beside CNC3 and the Express; no terms page
  {
    id:              'ttt-news-tt',
    name:            'TTT News (Trinidad and Tobago)',
    feedUrl:         'https://www.ttt.live/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'TT',
    defaultLat:      10.65,
    defaultLng:      -61.50,
    defaultLocation: 'Port of Spain, Trinidad and Tobago',
    extraTags:       ['trinidad-and-tobago', 'caribbean', 'state-media'],
    language:        'en',
  },
  // Crux, an employee-owned Catholic newsroom with Rome correspondents: its Vatican section, about one a day; no terms page
  {
    id:              'crux-vatican',
    name:            'Crux (Vatican)',
    feedUrl:         'https://cruxnow.com/category/vatican/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'VA',
    defaultLat:      41.90,
    defaultLng:      12.45,
    defaultLocation: 'Vatican City, Vatican City',
    extraTags:       ['vatican', 'holy-see', 'pope', 'catholic-church', 'europe'],
    language:        'en',
  },
  // ZENIT, a Rome-based Catholic news agency: its section on the pope (named after Leo XIV, so the address changes at the next conclave); "Receiving ZENIT by email and RSS ... are free"
  {
    id:              'zenit-pope-va',
    name:            'ZENIT (Vatican)',
    feedUrl:         'https://zenit.org/category/pope-leon-xiv/feed/',
    category:        'culture',
    biasLabel:       'center-right',
    reliability:     0.65,
    countryCode:     'VA',
    defaultLat:      41.90,
    defaultLng:      12.45,
    defaultLocation: 'Vatican City, Vatican City',
    extraTags:       ['vatican', 'holy-see', 'pope', 'catholic-church'],
    language:        'en',
  },
  // Samoa Global News (Apia), an online paper with named reporters: some items are reposts of NZ and Australian stories or government releases in full; no terms page
  {
    id:              'samoa-global-news-ws',
    name:            'Samoa Global News',
    feedUrl:         'https://samoaglobalnews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'unknown',
    reliability:     0.60,
    countryCode:     'WS',
    defaultLat:      -13.83,
    defaultLng:      -171.75,
    defaultLocation: 'Apia, Samoa',
    extraTags:       ['samoa', 'pacific', 'pacific-islands', 'oceania'],
    language:        'en',
  },
  // Saba, the news agency of Yemen's internationally recognized government (sabanew.net, not the Houthi-run saba.ye), in English: home point Aden; its usage page is an unfilled template
  {
    id:              'saba-yemen-en',
    name:            'Saba News Agency (Yemen, English)',
    feedUrl:         'https://www.sabanew.net/rss.php?lang=en',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'YE',
    defaultLat:      12.79,
    defaultLng:      45.03,
    defaultLocation: 'Aden, Yemen',
    extraTags:       ['yemen', 'arabian-peninsula', 'middle-east', 'state-media'],
    language:        'en',
  },
  // Mwebantu, a Lusaka digital newsroom with editorial and fact-checking policies: about 3 a day, a few livestream notices; its terms bar copying without permission
  {
    id:              'mwebantu-zm',
    name:            'Mwebantu (Zambia)',
    feedUrl:         'https://www.mwebantu.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'ZM',
    defaultLat:      -15.39,
    defaultLng:      28.32,
    defaultLocation: 'Lusaka, Zambia',
    extraTags:       ['zambia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // News Diggers, an independent Lusaka daily (since 2016): paywalled, so its summaries are only a paywall line, which the cleaner removes; no terms page
  {
    id:              'news-diggers-zm',
    name:            'News Diggers (Zambia)',
    feedUrl:         'https://diggers.news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'ZM',
    defaultLat:      -15.39,
    defaultLng:      28.32,
    defaultLocation: 'Lusaka, Zambia',
    extraTags:       ['zambia', 'southern-africa', 'africa'],
    language:        'en',
  },
  // ── Added Oct 31, 2026, 7:02 PM (round 8: Devon's call on the feeds whose terms we couldn't read) ──
  // Round 8's helpers found these feeds passing every check but one: each site's pages turn automated
  // visitors away with a bot check, so nobody could read its terms. Devon: "add them anyway". Each was
  // checked again with the server's request at 7:05 PM. La Perla del Sur (Puerto Rico) is left out: its
  // feed itself now answers with a bot check. Monaco-Matin's address leads to Nice-Matin's Monaco section.
  // Taken out after it went in: Luxembourg Times, which turned the server away (403) on its first two reads
  // (about 7:40 and 8:15 PM), though it answers the workspace.
  // Dominica News Online, an independent Roseau news site (Dominica's other feed is the prime minister's press room); its pages show a bot check, so its terms are unread
  {
    id:              'dominica-news-online-dm',
    name:            'Dominica News Online',
    feedUrl:         'https://dominicanewsonline.com/news/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'DM',
    defaultLat:      15.30,
    defaultLng:      -61.39,
    defaultLocation: 'Roseau, Dominica',
    extraTags:       ['dominica', 'caribbean'],
    language:        'en',
  },
  // Doha News, an English news site in Qatar; its homepage shows a bot check, so its terms are unread
  {
    id:              'doha-news-qa',
    name:            'Doha News',
    feedUrl:         'https://dohanews.co/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'QA',
    defaultLat:      25.29,
    defaultLng:      51.53,
    defaultLocation: 'Doha, Qatar',
    extraTags:       ['qatar', 'gulf', 'middle-east'],
    language:        'en',
  },
  // Shabait, the Eritrean Ministry of Information's news site, its Local News section, in English: state media (Eritrea's other feed is the opposition site Awate.com); terms unread (bot check)
  {
    id:              'shabait-er',
    name:            'Shabait (Eritrea\'s Ministry of Information)',
    feedUrl:         'https://shabait.com/category/local-news/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.45,
    countryCode:     'ER',
    defaultLat:      15.33,
    defaultLng:      38.93,
    defaultLocation: 'Asmara, Eritrea',
    extraTags:       ['eritrea', 'horn-of-africa', 'africa', 'government', 'state-media'],
    language:        'en',
  },
  // Breaking Belize News, a Belize City news site; terms unread (bot check)
  {
    id:              'breaking-belize-news-bz',
    name:            'Breaking Belize News',
    feedUrl:         'https://www.breakingbelizenews.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'BZ',
    defaultLat:      17.50,
    defaultLng:      -88.20,
    defaultLocation: 'Belize City, Belize',
    extraTags:       ['belize', 'central-america', 'caribbean'],
    language:        'en',
  },
  // Starcom Network, a Barbados radio group's newsroom; terms unread (bot check)
  {
    id:              'starcom-barbados-bb',
    name:            'Starcom Network (Barbados)',
    feedUrl:         'https://starcomnetwork.net/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'BB',
    defaultLat:      13.10,
    defaultLng:      -59.62,
    defaultLocation: 'Bridgetown, Barbados',
    extraTags:       ['barbados', 'caribbean'],
    language:        'en',
  },
  // Inside Asian Gaming, a Macau trade publication on the gaming industry: its Macau tag (casinos, tourism and the economy); terms unread (bot check)
  {
    id:              'asgam-macau-mo',
    name:            'Inside Asian Gaming (Macau)',
    feedUrl:         'https://asgam.com/tag/macau/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MO',
    defaultLat:      22.20,
    defaultLng:      113.55,
    defaultLocation: 'Macau',
    extraTags:       ['macau', 'china', 'gaming', 'asia'],
    language:        'en',
  },
  // Libertas, a San Marino online daily, in Italian; terms unread (its pages show a security check)
  {
    id:              'libertas-sm',
    name:            'Libertas (San Marino)',
    feedUrl:         'https://www.libertas.sm/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.65,
    countryCode:     'SM',
    defaultLat:      43.94,
    defaultLng:      12.45,
    defaultLocation: 'San Marino',
    extraTags:       ['san-marino', 'europe'],
    language:        'it',
  },
  // Monaco-Matin, Nice-Matin's Monaco edition (monacomatin.mc now leads to its Monaco section), in French; terms unread (its terms page doesn't load for us)
  {
    id:              'nice-matin-monaco-mc',
    name:            'Monaco-Matin (Nice-Matin)',
    feedUrl:         'https://www.nicematin.com/monaco/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'MC',
    defaultLat:      43.74,
    defaultLng:      7.42,
    defaultLocation: 'Monaco',
    extraTags:       ['monaco', 'europe'],
    language:        'fr',
  },
  // OÖN, the Linz daily for Upper Austria, in German; its feed is ISO-8859-15, which decodeFeed reads from its prolog; terms unread (they load by script)
  {
    id:              'oon-at',
    name:            'Oberösterreichische Nachrichten (OÖN)',
    feedUrl:         'https://www.nachrichten.at/storage/rss/rss/nachrichten.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'AT',
    defaultLat:      48.31,
    defaultLng:      14.29,
    defaultLocation: 'Linz, Austria',
    extraTags:       ['austria', 'upper-austria', 'europe'],
    language:        'de',
  },
  // Alsat, a Skopje TV station broadcasting in Albanian: its news feed; terms unread (bot check)
  {
    id:              'alsat-mk',
    name:            'Alsat (North Macedonia)',
    feedUrl:         'https://alsat.mk/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'MK',
    defaultLat:      42.00,
    defaultLng:      21.43,
    defaultLocation: 'Skopje, North Macedonia',
    extraTags:       ['north-macedonia', 'balkans', 'europe'],
    language:        'sq',
  },
  // ── Added Oct 31, 2026, 9:32 PM (Devon: "Implement all of the improvements you've just suggested") ──
  // Round 8 found two feeds the reader itself kept out: IranWire lists its items oldest first, and Jordan News
  // dates its items about 3 hours ahead. The reader now takes a feed's newest items (newestFirst) and dates an
  // item from the future at the time it reads it (eventTimeOf). Jordan News stays out on its terms of use
  // (checked 9:55 PM: "personal, non-commercial use only", and they name RSS feeds), as This Is Beirut did.
  // IranWire: an independent newsroom on Iran, run from London since 2013; in English; 463 items, 115 in the
  // last week; its pages show a bot check, so its terms are unread (Devon's 7:02 PM call: "add them anyway");
  // its robots.txt allows every reader but the AI-training crawlers it names, with "search=yes" (links and
  // short excerpts, as here) and "ai-train=no" in its content signals
  {
    id:              'iranwire-en',
    name:            'IranWire',
    feedUrl:         'https://iranwire.com/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'IR',
    defaultLat:      35.69,
    defaultLng:      51.39,
    defaultLocation: 'Tehran, Iran',
    extraTags:       ['iran', 'middle-east', 'independent-media', 'exile-media'],
    language:        'en',
  },
  // ── Added Nov 3, 2026, 10 PM (Devon: "Can you bring them back? We need to maintain") ──
  // The failing list had 20 feeds that morning; requested the way the server asks (its User-Agent and
  // headers, from another network), 13 answered, so those sites were turning away the server's own address,
  // and 9 of them came back by themselves by evening (each paused feed is retried every 6 hours). Taken out
  // because the feed itself is gone: Renewable Energy World (refused the server since Oct 26, 33 reads in a
  // row), National Post (its feed addresses now lead to web pages), Défi Media (its new site has no feed) and
  // The East African (its feed answers 404 and the rest of the site shows a bot check). Kept, to come back on
  // their own: France 24 (refuses only the server), Nation News, Borba, Sunday Standard and Security Council
  // Report (a bot check to every reader since Oct 31-Nov 2, the kind sites switch off again).
  // Canary Media, in place of Renewable Energy World: an independent nonprofit newsroom on clean energy and
  // the climate (Canary Media, Inc., a 501(c)(3)); in English; about two stories a day, 100 items in its feed;
  // no terms of use, a republishing policy and the feed linked from every page
  {
    id:              'canary-media',
    name:            'Canary Media',
    feedUrl:         'https://www.canarymedia.com/rss.rss',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'United States',
    extraTags:       ['clean-energy', 'renewable-energy', 'energy-transition', 'climate'],
    language:        'en',
  },
  // KBC News, the Kenya Broadcasting Corporation's newsroom (Nairobi), Kenya's public broadcaster, owned by the
  // government, in English: so Kenya keeps three feeds without The East African; about ten stories a day; no
  // terms page (checked: none linked, the usual addresses answer 404)
  {
    id:              'kbc-ke',
    name:            'KBC News (Kenya)',
    feedUrl:         'https://www.kbc.co.ke/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'KE',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['kenya', 'east-africa', 'africa', 'state-media'],
    language:        'en',
  },
  // ── Added Nov 5, 2026 (Devon: "replace broken feeds if they're not live and give us time to fix the broken
  // feeds"): outlets for the places left thin by the six feeds parked behind a bot check and the four sites
  // that are down, under rounds 6 to 8's rules: fresh, dated items read with the poller's own reader, and
  // terms that don't limit use to personal or non-commercial use or ban robots (neither of these two sites
  // publishes terms). Held back on terms that morning, then added at 8:18 PM on Devon's call (the next
  // block): Barbados Today, Dan, Portal Analitika, Le Nouvelliste, The Observer (Uganda) and The Citizen
  // (Tanzania). Kuensel (Bhutan) stays out (Devon's call, Oct 31). Also left out: The Bhutanese (weekly;
  // newest item 5 days old), Business Bhutan (half its feed was paid casino reviews) and Metro Puerto Rico
  // (much of its feed is lifestyle and opinion) ──
  {
    id:              'haitilibre-ht',
    name:            'HaitiLibre',
    feedUrl:         'https://www.haitilibre.com/rss-flash.php',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'HT',
    defaultLat:      18.54,
    defaultLng:      -72.34,
    defaultLocation: 'Port-au-Prince, Haiti',
    extraTags:       ['haiti', 'caribbean', 'latin-america'],
    language:        'fr',
  },
  {
    id:              'noticel-pr',
    name:            'NotiCel (Puerto Rico)',
    feedUrl:         'https://www.noticel.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'PR',
    defaultLat:      18.47,
    defaultLng:      -66.11,
    defaultLocation: 'San Juan, Puerto Rico',
    extraTags:       ['puerto-rico', 'caribbean', 'latin-america'],
    language:        'es',
  },
  // ── Added Nov 5, 2026, 8:18 PM (Devon's call on the six held back on terms that morning: "Go in anyway") ──
  // Each answered the poller's own reader at 8:25 PM with stories from the last day (Le Nouvelliste's
  // English edition from the last two). What each site's terms say about use, noted as round 8 did:
  // Barbados Today, a Bridgetown news site; terms: no robots, spiders or other automatic access, no commercial use
  {
    id:              'barbados-today-bb',
    name:            'Barbados Today',
    feedUrl:         'https://barbadostoday.bb/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'BB',
    defaultLat:      13.10,
    defaultLng:      -59.62,
    defaultLocation: 'Bridgetown, Barbados',
    extraTags:       ['barbados', 'caribbean'],
    language:        'en',
  },
  // Dan, a Podgorica daily (pro-Serbian, conservative); terms: personal, non-commercial use only
  {
    id:              'dan-me',
    name:            'Dan (Montenegro)',
    feedUrl:         'https://www.dan.co.me/feed/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.62,
    countryCode:     'ME',
    defaultLat:      42.44,
    defaultLng:      19.26,
    defaultLocation: 'Podgorica, Montenegro',
    extraTags:       ['montenegro', 'balkans', 'europe'],
    language:        'sr',
  },
  // Portal Analitika, a Podgorica news portal; terms: personal use only
  {
    id:              'portal-analitika-me',
    name:            'Portal Analitika (Montenegro)',
    feedUrl:         'https://rss.portalanalitika.me',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.64,
    countryCode:     'ME',
    defaultLat:      42.44,
    defaultLng:      19.26,
    defaultLocation: 'Podgorica, Montenegro',
    extraTags:       ['montenegro', 'balkans', 'europe'],
    language:        'sr',
  },
  // Le Nouvelliste's English edition (Haiti's oldest daily); terms: personal, non-commercial use, no automatic cataloguing or monitoring
  {
    id:              'le-nouvelliste-ht',
    name:            'Le Nouvelliste (Haiti, English)',
    feedUrl:         'https://lenouvelliste.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'HT',
    defaultLat:      18.54,
    defaultLng:      -72.34,
    defaultLocation: 'Port-au-Prince, Haiti',
    extraTags:       ['haiti', 'caribbean', 'latin-america'],
    language:        'en',
  },
  // The Observer, a Kampala newspaper; terms: a limited licence for personal use
  {
    id:              'observer-ug',
    name:            'The Observer (Uganda)',
    feedUrl:         'https://observer.ug/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'UG',
    defaultLat:      0.35,
    defaultLng:      32.58,
    defaultLocation: 'Kampala, Uganda',
    extraTags:       ['uganda', 'east-africa', 'africa'],
    language:        'en',
  },
  // The Citizen, a Dar es Salaam daily (Mwananchi, Nation Media Group); about a third of its feed is world news, so no home pin; terms: personal, non-commercial use, no systematic copying into a database
  {
    id:              'the-citizen-tz',
    name:            'The Citizen (Tanzania)',
    feedUrl:         'https://www.thecitizen.co.tz/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'TZ',
    defaultLat:      -6.79,
    defaultLng:      39.21,
    defaultLocation: 'Dar es Salaam, Tanzania',
    extraTags:       ['tanzania', 'east-africa', 'africa'],
    language:        'en',
  },
  // ── Added Nov 5, 2026, 11:45 PM (Devon, 10:01 PM: "Second newsrooms for the 32 places that have only one feed,
  // starting with Lebanon, Syria, Jordan and the Baltics" and "Next signals: US and EU health alerts, US maritime
  // advisories, aviation news, space news, commodities news and research/education publications, once their terms
  // check out"). The standing method (plan Q15): each read with the poller's own reader at 11:20 PM, terms read
  // through a web search's link, headlines read. Syria gets its second newsroom (Levant24 answered too, but round 8
  // left it out on Oct 31 for writing up Arabic outlets' reports); Lebanon's, Jordan's and the Baltics' candidates
  // failed or wait on terms (departments/research/r5-second-newsrooms-2026-11-05.md).
  // North Press Agency (Qamishli, north-east Syria), its English site, taken out on Oct 21 when it failed every read
  // from the server; it answered other networks on Nov 5, but on its first reads here it turned the server away
  // again (HTTP 403), so it is parked (Nov 6): tried once a day, read as usual from the first time it answers.
  // Regional (Syria, Iraq's Kurdistan, Jordan), so no home pin; no terms published (its only policy page is about
  // readers' personal data)
  {
    id:              'north-press-sy',
    name:            'North Press Agency (Syria)',
    feedUrl:         'https://npasyria.com/en/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'SY',
    defaultLat:      37.05,
    defaultLng:      41.23,
    defaultLocation: 'Qamishli, Syria',
    extraTags:       ['syria', 'middle-east', 'kurdistan'],
    language:        'en',
    parked:          'turns the server away (HTTP 403), Oct 21 and Nov 6, 2026; answers other networks',
  },
  // ECDC, the EU's public health agency (Stockholm), its news: outbreaks, threat assessments and preparedness across
  // Europe; terms: CC BY 4.0, commercial use allowed with ECDC acknowledged as the creator
  {
    id:              'ecdc-news',
    name:            'ECDC (European Centre for Disease Prevention and Control)',
    feedUrl:         'https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'SE',
    defaultLat:      59.35,
    defaultLng:      18.02,
    defaultLocation: 'Stockholm, Sweden',
    extraTags:       ['ecdc', 'health', 'outbreak', 'europe', 'institutional'],
    language:        'en',
  },
  // NASA's news releases; NASA's media are "generally not subject to copyright in the United States" and news
  // outlets may use them without asking, with NASA named as the source and no endorsement implied
  {
    id:              'nasa-news',
    name:            'NASA News Releases',
    feedUrl:         'https://www.nasa.gov/news-release/feed/',
    category:        'space',
    biasLabel:       'center',
    reliability:     0.94,
    countryCode:     'US',
    defaultLat:      38.88,
    defaultLng:      -77.02,
    defaultLocation: 'Washington, United States',
    extraTags:       ['nasa', 'space', 'institutional'],
    language:        'en',
  },
  // AirlineGeeks, a US aviation news site: airlines, airports, aircraft makers, labour and safety, worldwide (no home
  // pin); terms: its content may not be copied or republished without permission, nothing on personal use or robots
  {
    id:              'airlinegeeks',
    name:            'AirlineGeeks',
    feedUrl:         'https://airlinegeeks.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['aviation', 'airlines', 'transport'],
    language:        'en',
  },
  // farmdoc daily, the University of Illinois' farm economics research (grain and oilseed markets, farm policy, crop
  // insurance), mostly the US's own (home pin); its policy: repost with the title, a link back and the author named
  {
    id:              'farmdoc-daily',
    name:            'farmdoc daily (University of Illinois)',
    feedUrl:         'https://farmdocdaily.illinois.edu/feed',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      40.11,
    defaultLng:      -88.23,
    defaultLocation: 'Urbana, Illinois, United States',
    extraTags:       ['agriculture', 'commodities', 'research', 'university'],
    language:        'en',
  },
  // The Conversation's Africa, France and Spain editions: academics' articles on research (the global edition is
  // above); CC BY-ND, republishing allowed
  {
    id:              'the-conversation-africa',
    name:            'The Conversation — Africa',
    feedUrl:         'https://theconversation.com/africa/articles.atom',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'ZA',
    defaultLat:      -26.20,
    defaultLng:      28.05,
    defaultLocation: 'Johannesburg, South Africa',
    extraTags:       ['the-conversation', 'academic', 'research', 'africa'],
    language:        'en',
  },
  {
    id:              'the-conversation-fr',
    name:            'The Conversation — France',
    feedUrl:         'https://theconversation.com/fr/articles.atom',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'FR',
    defaultLat:      48.86,
    defaultLng:      2.35,
    defaultLocation: 'Paris, France',
    extraTags:       ['the-conversation', 'academic', 'research', 'francophone'],
    language:        'fr',
  },
  {
    id:              'the-conversation-es',
    name:            'The Conversation — España',
    feedUrl:         'https://theconversation.com/es/articles.atom',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'ES',
    defaultLat:      40.42,
    defaultLng:      -3.70,
    defaultLocation: 'Madrid, Spain',
    extraTags:       ['the-conversation', 'academic', 'research'],
    language:        'es',
  },
  // ── Added Nov 6, 2026, 12:10 AM (plan R5, the places of Q10 with one newsroom first: Honduras's news came mostly from
  // Proceso Digital, Djibouti's all from ADI, Equatorial Guinea's mostly from Real Equatorial Guinea). Read with the
  // poller's own reader at 11:55 PM, terms searched for, headlines read (departments/research/r5-second-newsrooms-2026-11-05.md)
  // El Pulso, a Tegucigalpa news site (investigative reporting and the day's news); Honduras's own news, home pin;
  // no terms published
  {
    id:              'el-pulso-hn',
    name:            'El Pulso (Honduras)',
    feedUrl:         'https://elpulso.hn/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'HN',
    defaultLat:      14.07,
    defaultLng:      -87.19,
    defaultLocation: 'Tegucigalpa, Honduras',
    extraTags:       ['honduras', 'central-america', 'latin-america'],
    language:        'es',
  },
  // La Nation, Djibouti's national daily (state-owned), in French; home pin; no terms published
  {
    id:              'la-nation-dj',
    name:            'La Nation (Djibouti)',
    feedUrl:         'https://www.lanation.dj/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'DJ',
    defaultLat:      11.59,
    defaultLng:      43.15,
    defaultLocation: 'Djibouti, Djibouti',
    extraTags:       ['djibouti', 'horn-of-africa', 'africa', 'francophone', 'state-media'],
    language:        'fr',
  },
  // Ahora EG, the Equatorial Guinea government's news site, in Spanish; home pin; no terms published
  {
    id:              'ahora-eg-gq',
    name:            'Ahora EG (Equatorial Guinea)',
    feedUrl:         'https://www.ahoraeg.com/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.58,
    countryCode:     'GQ',
    defaultLat:      3.75,
    defaultLng:      8.78,
    defaultLocation: 'Malabo, Equatorial Guinea',
    extraTags:       ['equatorial-guinea', 'central-africa', 'africa', 'state-media'],
    language:        'es',
  },
  // ── Added Nov 6, 2026, 8 AM (Devon's call on the five held back on terms on Nov 5: "go in anyway to all of them") ──
  // Each answered the poller's own reader at 7:45 AM; robots.txt lets general readers in (each turns away only AI
  // crawlers by name). What each site's terms say about use, noted as round 8 did
  // (departments/research/r5-second-newsrooms-2026-11-05.md):
  // This is Beirut (Beirut and Washington), its news section; mostly the region (Iran, Israel, the Gulf, Syria) beside
  // Lebanon, so no home pin; terms: "a strictly personal license ... for private, non-commercial purposes", but
  // "citing the title and two lines of the article together with a link" is allowed
  {
    id:              'this-is-beirut-lb',
    name:            'This is Beirut (Lebanon)',
    feedUrl:         'https://thisisbeirut.com.lb/rss/news',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'LB',
    defaultLat:      33.89,
    defaultLng:      35.50,
    defaultLocation: 'Beirut, Lebanon',
    extraTags:       ['lebanon', 'middle-east'],
    language:        'en',
  },
  // 15min, a Vilnius news site, in Lithuanian; its site-wide feed less its world section (skipLinks: the place-finder
  // doesn't know Lithuanian names of foreign places), so the rest is Lithuania's own news, home pin; terms: "may be used
  // only for your private purposes", but clause 29.1 allows "the article headline" on a website, followed by "a link
  // to the full article". It has turned the server away (HTTP 403) since it came in, so it is parked (Nov 7): tried
  // once a day, read as usual from the first time it answers
  {
    id:              '15min-lt',
    name:            '15min (Lithuania)',
    feedUrl:         'https://www.15min.lt/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'LT',
    defaultLat:      54.69,
    defaultLng:      25.28,
    defaultLocation: 'Vilnius, Lithuania',
    extraTags:       ['lithuania', 'baltics', 'europe'],
    language:        'lt',
    skipLinks:       /\/pasaulis\//,
    parked:          'turns the server away (HTTP 403), Nov 6 and 7, 2026',
  },
  // LRT, Lithuania's public broadcaster, its "In Lithuania" section in Lithuanian, so that 15min's reports have a
  // report in the same language to be matched with (LRT English, lrt-en, is the same outlet); home pin; LRT publishes
  // no terms of use for its news (its FAQ is silent; robots.txt lets general readers in)
  {
    id:              'lrt-lt',
    name:            'LRT (Lithuania), in Lithuanian',
    feedUrl:         'https://www.lrt.lt/naujienos/lietuvoje?rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'LT',
    defaultLat:      54.69,
    defaultLng:      25.28,
    defaultLocation: 'Vilnius, Lithuania',
    extraTags:       ['lithuania', 'baltics', 'europe', 'public-broadcaster'],
    language:        'lt',
  },
  // Estonian World, an English-language magazine on Estonia (Tallinn); news, business, security and some culture,
  // a few items a day; home pin; terms: content is for "personal, non-commercial benefit", but "for commercial
  // purposes, a maximum of two sentences and a headline ... may be paraphrased", with a link
  {
    id:              'estonian-world-ee',
    name:            'Estonian World',
    feedUrl:         'https://estonianworld.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'EE',
    defaultLat:      59.44,
    defaultLng:      24.75,
    defaultLocation: 'Tallinn, Estonia',
    extraTags:       ['estonia', 'baltics', 'europe'],
    language:        'en',
  },
  // Spaceflight Now, launches, missions and the space station; terms: "personal, non-commercial use", but "brief
  // excerpts may be quoted with clear attribution and a link back"
  {
    id:              'spaceflight-now',
    name:            'Spaceflight Now',
    feedUrl:         'https://spaceflightnow.com/feed/',
    category:        'space',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      28.39,
    defaultLng:      -80.60,
    defaultLocation: 'Cape Canaveral, Florida, United States',
    extraTags:       ['space', 'spaceflight'],
    language:        'en',
  },
  // St Vincent Times, a Kingstown news site; mostly St Vincent's own news beside the region's, home pin; terms: "for
  // your personal and non-business use"
  {
    id:              'st-vincent-times-vc',
    name:            'St Vincent Times',
    feedUrl:         'https://www.stvincenttimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'VC',
    defaultLat:      13.16,
    defaultLng:      -61.22,
    defaultLocation: 'Kingstown, Saint Vincent and the Grenadines',
    extraTags:       ['saint-vincent', 'caribbean'],
    language:        'en',
  },
  // ── Added Nov 6, 2026, 10 AM (Devon, 8:45 AM: "Look into the 30 places that still only have 1 feed , what else can we
  // add there?"). Read with the poller's own reader at 9 AM, terms searched for, robots.txt read, headlines read; the rest
  // of the 30, and what each would take, in departments/research/r7-one-outlet-places-2026-11-06.md
  // Islands Business (Suva), its news section: the Pacific's stories from its Suva newsroom and its correspondents,
  // about 6 a day; a Fijian newsroom, so Fiji's second outlet; the region's, so no home pin (its stories go where they
  // name: Tonga, the Marshall Islands, PNG, the Cook Islands, Kiribati...). Not its PACNEWS bulletins ("PACNEWS ONE,
  // 06 NOVEMBER 2026"), which its country tags carry; no terms page; robots.txt allows all
  {
    id:              'islands-business-pacific',
    name:            'Islands Business (Pacific)',
    feedUrl:         'https://islandsbusiness.com/category/news-break/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'FJ',
    defaultLat:      -18.14,
    defaultLng:      178.44,
    defaultLocation: 'Suva, Fiji',
    extraTags:       ['pacific', 'oceania'],
    language:        'en',
    skipLinks:       /\/(?:pacnews|partner-news)\//,
  },
  // SKNIS, the St Kitts and Nevis Information Service: the government's communications department (Basseterre), a few
  // stories a day; a government press office, so labelled state media; St Kitts and Nevis's second outlet beside VON
  // Radio; home pin; no terms published (its footer's "Terms" links nowhere)
  {
    id:              'sknis-kn',
    name:            'SKNIS (St Kitts and Nevis Information Service)',
    feedUrl:         'https://www.sknis.gov.kn/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'KN',
    defaultLat:      17.30,
    defaultLng:      -62.72,
    defaultLocation: 'Basseterre, Saint Kitts and Nevis',
    extraTags:       ['saint-kitts-and-nevis', 'caribbean', 'state-media', 'government'],
    language:        'en',
  },
  // TASR, the News Agency of the Slovak Republic's English newswire (NewsNow): taken out on Oct 21 when the server
  // couldn't read it all day; it answers other networks (15 items, 2 a day), so it comes back parked: tried once a
  // day, read as usual from the first time it answers; home pin; no terms page
  {
    id:              'tasr-en',
    name:            'TASR (Slovakia, English)',
    feedUrl:         'https://newsnow.tasr.sk/rss/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'SK',
    defaultLat:      48.15,
    defaultLng:      17.11,
    defaultLocation: 'Bratislava, Slovakia',
    extraTags:       ['slovakia', 'europe', 'news-agency'],
    language:        'en',
    parked:          'the server could not read it all day on Oct 21, 2026; answers other networks (Nov 6)',
  },
  // Les Nouvelles Calédoniennes, Nouméa's daily, in French (the site's own Drupal feed, rss.xml; NOT the FeedBurner feed
  // its pages advertise, which carries spam): taken out on Oct 21 when every read from the server timed out; it answers
  // other networks (8 stories a day), so it comes back parked; mostly New Caledonia's own news, home pin; its legal
  // notice forbids reproducing or using its articles in any form (no clause on robots or data mining)
  {
    id:              'les-nouvelles-caledoniennes',
    name:            'Les Nouvelles Calédoniennes',
    feedUrl:         'https://www.lnc.nc/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'NC',
    defaultLat:      -22.27,
    defaultLng:      166.44,
    defaultLocation: 'Nouméa, New Caledonia',
    extraTags:       ['new-caledonia', 'pacific', 'oceania', 'french-language'],
    language:        'fr',
    parked:          'every read from the server timed out on Oct 21, 2026; answers other networks (Nov 6)',
  },
  // ── Added Nov 6, 2026, 11 AM (Devon, 10:19 AM, on the four outlets held back on their terms: "1 go in anyway"):
  // Cayman Compass and FBC News. The Royal Gazette and Sermitsiaq.AG wait for their feeds' addresses.
  // Cayman Compass, George Town's daily (about 10 stories a day): the Cayman Islands' second outlet beside Cayman News
  // Service; mostly the islands' own news, home pin. Its terms: "Your use of the Compass Media Site is for your own
  // personal and non-commercial use only", and its content is not to be shown on other websites (Devon's call, Nov 6)
  {
    id:              'cayman-compass-ky',
    name:            'Cayman Compass',
    feedUrl:         'https://www.caymancompass.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'KY',
    defaultLat:      19.29,
    defaultLng:      -81.38,
    defaultLocation: 'George Town, Cayman Islands',
    extraTags:       ['cayman-islands', 'caribbean'],
    language:        'en',
  },
  // FBC News, the Fiji Broadcasting Corporation's newsroom (Suva, about 10 stories a day): the government owns the
  // corporation, so it is labelled state media; mostly Fiji's own news, home pin. Its terms forbid linking to its pages
  // without its consent (Devon's call, Nov 6)
  {
    id:              'fbc-news-fj',
    name:            'FBC News (Fiji)',
    feedUrl:         'https://www.fbcnews.com.fj/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'FJ',
    defaultLat:      -18.14,
    defaultLng:      178.44,
    defaultLocation: 'Suva, Fiji',
    extraTags:       ['fiji', 'pacific', 'oceania', 'state-media', 'public-broadcaster'],
    language:        'en',
  },
  // ── Added Nov 6, 2026, 1 PM (Devon, 10:19 AM, on teaching the matching to read Arabic and Cyrillic, then adding those
  // outlets: "4 proceed with this"): Jordan's and Kyrgyzstan's second newsrooms, in their own languages; the matching
  // reads them since 648f9ae. Read with the poller's own reader at 11:30 AM.
  // Roya News, Amman's television newsroom, in Arabic (about 20 stories a day): Jordan's news and the region's, so no
  // home pin. Its copyright page sets out how Roya itself quotes others' material; no clause on reading its feed or on
  // automated access. Its robots.txt allows the feed and turns away AI crawlers by name (GPTBot, ClaudeBot)
  {
    id:              'roya-news-ar',
    name:            'Roya News (Arabic)',
    feedUrl:         'https://royanews.tv/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'JO',
    defaultLat:      31.95,
    defaultLng:      35.93,
    defaultLocation: 'Amman, Jordan',
    extraTags:       ['jordan', 'middle-east', 'arabic-language'],
    language:        'ar',
  },
  // JO24, Amman's news site, in Arabic (about 20 stories a day): Jordan's news, the region's and the world's, so no home
  // pin. No terms published; its robots.txt allows the feed and turns away AI crawlers by name
  {
    id:              'jo24-ar',
    name:            'JO24',
    feedUrl:         'https://jo24.net/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'JO',
    defaultLat:      31.95,
    defaultLng:      35.93,
    defaultLocation: 'Amman, Jordan',
    extraTags:       ['jordan', 'middle-east', 'arabic-language'],
    language:        'ar',
  },
  // 24.kg, Bishkek's news agency, in Russian (about 20 stories a day): mostly Kyrgyzstan's own news, home pin; its
  // English edition has no feed. No terms page found; its robots.txt allows the feed
  {
    id:              '24kg-ru',
    name:            '24.kg (Russian)',
    feedUrl:         'https://24.kg/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'KG',
    defaultLat:      42.87,
    defaultLng:      74.59,
    defaultLocation: 'Bishkek, Kyrgyzstan',
    extraTags:       ['kyrgyzstan', 'central-asia', 'news-agency', 'russian-language'],
    language:        'ru',
  },
  // Vesti.kg, Bishkek's news site, in Russian (about 20 stories a day): mostly Kyrgyzstan's own news, home pin. No terms
  // page found; its robots.txt has no rule for the feed
  {
    id:              'vesti-kg',
    name:            'Vesti.kg',
    feedUrl:         'https://vesti.kg/?format=feed&type=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.66,
    countryCode:     'KG',
    defaultLat:      42.87,
    defaultLng:      74.59,
    defaultLocation: 'Bishkek, Kyrgyzstan',
    extraTags:       ['kyrgyzstan', 'central-asia', 'russian-language'],
    language:        'ru',
  },
  // ── Added Nov 6, 2026, 2 PM (Devon, 1:17 PM, "Ok to all": The Royal Gazette's feed list page pasted in, and "Go in
  // anyway or skip: Syria (SANA, Syria TV, Al-Watan), Bahrain (Al Bilad), Mongolia (Ikon.mn)"). Read with the poller's
  // own reader at 1:25 PM; each robots.txt allows its feed. Their terms are noted beside each, as Devon's call.
  // The Royal Gazette, Bermuda's daily since 1828 (Hamilton; about 25 stories a day): mostly Bermuda's own news, home
  // pin; Bermuda's second outlet beside Bernews. Its feed list page is itself the all-stories feed. Its terms: personal,
  // non-commercial use; its content "may not be used to construct any kind of database"; links to any article allowed
  {
    id:              'royal-gazette-bm',
    name:            'The Royal Gazette (Bermuda)',
    feedUrl:         'https://www.royalgazette.com/feeds/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'BM',
    defaultLat:      32.29,
    defaultLng:      -64.78,
    defaultLocation: 'Hamilton, Bermuda',
    extraTags:       ['bermuda', 'caribbean', 'atlantic'],
    language:        'en',
  },
  // SANA, Syria's state news agency, in Arabic (Damascus; about 150 stories a day): the government's, so labelled state
  // media; mostly Syria's own news, home pin. From here it cuts about one read in two (the reader tries again next
  // cycle). Its terms page couldn't be read here (a server error)
  {
    id:              'sana-sy-ar',
    name:            'SANA (Syria, Arabic)',
    feedUrl:         'https://sana.sy/feed/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.50,
    countryCode:     'SY',
    defaultLat:      33.51,
    defaultLng:      36.28,
    defaultLocation: 'Damascus, Syria',
    extraTags:       ['syria', 'middle-east', 'news-agency', 'state-media', 'arabic-language'],
    language:        'ar',
  },
  // Syria TV, the television channel's newsroom, in Arabic (about 50 stories a day): Syria's news and the region's and
  // the world's (a third of its headlines name another country), so no home pin. Its terms page couldn't be read here.
  // It has turned the server away (HTTP 403) since it came in, so it is parked (Nov 7)
  {
    id:              'syria-tv-ar',
    name:            'Syria TV (Arabic)',
    feedUrl:         'https://www.syria.tv/rss2',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'SY',
    defaultLat:      33.51,
    defaultLng:      36.28,
    defaultLocation: 'Damascus, Syria',
    extraTags:       ['syria', 'middle-east', 'arabic-language'],
    language:        'ar',
    parked:          'turns the server away (HTTP 403), Nov 6 and 7, 2026',
  },
  // Al-Watan, Damascus's daily, in Arabic (about 20 stories a day): mostly Syria's own news, its sport and its economy,
  // home pin (its few stories on foreign football and film stars sit in Syria). Its terms page couldn't be read here
  {
    id:              'al-watan-sy-ar',
    name:            'Al-Watan (Syria, Arabic)',
    feedUrl:         'https://alwatan.sy/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.58,
    countryCode:     'SY',
    defaultLat:      33.51,
    defaultLng:      36.28,
    defaultLocation: 'Damascus, Syria',
    extraTags:       ['syria', 'middle-east', 'arabic-language'],
    language:        'ar',
  },
  // Al Bilad, Manama's daily, in Arabic (about 100 stories a day): Bahrain's news and the Arab world's and the world's
  // (two in five of its headlines name another country), so no home pin; Bahrain's second outlet beside News of Bahrain.
  // Its terms page couldn't be read here
  {
    id:              'al-bilad-bh-ar',
    name:            'Al Bilad (Bahrain, Arabic)',
    feedUrl:         'https://www.albiladpress.com/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.62,
    countryCode:     'BH',
    defaultLat:      26.23,
    defaultLng:      50.59,
    defaultLocation: 'Manama, Bahrain',
    extraTags:       ['bahrain', 'gulf', 'middle-east', 'arabic-language'],
    language:        'ar',
  },
  // Ikon.mn, Ulaanbaatar's news site, in Mongolian (about 80 stories a day): mostly Mongolia's own news, home pin;
  // Mongolia's second outlet beside News.mn's English edition. Its terms allow personal use only
  {
    id:              'ikon-mn',
    name:            'Ikon.mn',
    feedUrl:         'https://ikon.mn/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'MN',
    defaultLat:      47.89,
    defaultLng:      106.91,
    defaultLocation: 'Ulaanbaatar, Mongolia',
    extraTags:       ['mongolia', 'east-asia', 'asia', 'mongolian-language'],
    language:        'mn',
  },
  // ── Added Nov 9, 2026, 3 AM (R5, Devon's Nov 8 coverage rule: second newsrooms for places that read one) ──
  // The Local's Denmark and Sweden editions (R5, Nov 9, 2026): news and explainers in English for people living there, the second newsroom in English for each (Denmark had The Copenhagen Post, Sweden Radio Sweden); same publisher, feed host and terms as The Local Switzerland and Austria; home pin; each feed read Nov 9: Denmark's newest item that morning, Sweden's two days old (Nov 7)
  {
    id:              'thelocal-dk',
    name:            'The Local Denmark',
    feedUrl:         'https://feeds.thelocal.com/rss/dk',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'DK',
    defaultLat:      55.68,
    defaultLng:      12.57,
    defaultLocation: 'Copenhagen, Denmark',
    extraTags:       ['denmark', 'nordics', 'europe'],
    language:        'en',
  },
  {
    id:              'thelocal-se',
    name:            'The Local Sweden',
    feedUrl:         'https://feeds.thelocal.com/rss/se',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'SE',
    defaultLat:      59.33,
    defaultLng:      18.07,
    defaultLocation: 'Stockholm, Sweden',
    extraTags:       ['sweden', 'nordics', 'europe'],
    language:        'en',
  },
  // ── Added Nov 9, 2026, 10 PM (Devon, 10:12 PM: "Check these sources for Greenland", with the outlets Google lists) ──
  // Sermitsiaq.AG (Nuuk; Sermitsiaq, AG and Nuuk Ugeavis are its papers), in Danish: the last of the four outlets held
  // back on their terms on Nov 6 (Devon, 10:19 AM: "1 go in anyway"), which waited for its feed's address. The feed is
  // the front page's (the address feeder.co lists as "Sermitsiaq.AG Nyheder"): read Nov 9, 42 items, the newest that
  // evening, about 8 in 10 Greenland's own news (the coalition, the budget, Royal Greenland's quota), the rest world news
  // from the wires (the US midterms, Nvidia, US stocks) and paid posts, which aren't read (skipLinks). Its terms allow
  // private use only (Devon's call, Nov 6). Greenland's second outlet beside its government's press office. Not KNR
  // (its feed's last item is from 2017 and its site lists no other), ArcticToday (its robots.txt closes /feed/) or The
  // Local Denmark (read since Nov 9, counted for Denmark)
  {
    id:              'sermitsiaq-gl',
    name:            'Sermitsiaq.AG',
    feedUrl:         'https://www.sermitsiaq.ag/?lab_viewport=rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'GL',
    defaultLat:      64.18,
    defaultLng:      -51.72,
    defaultLocation: 'Nuuk, Greenland',
    extraTags:       ['greenland', 'arctic', 'nordics'],
    language:        'da',
    skipLinks:       /\/sponsoreret-indhold\//,
  },
  // ── Added Nov 10, 2026, 11:45 AM (Devon, 11:03 AM: "look for a second newsroom in the 8 quiet places, so their stories can get verified?" - "yes") ──
  // EmoNews, a Dominica news site (Roseau; © EmoNews), Dominica's third feed beside Dominica News Online and the prime
  // minister's press room, whose address wasn't found on Nov 10: the RSS feed its footer links, read Nov 10: 50 items
  // since Oct 8, about one a day, headlines only (no summaries). About 4 in 10 are Dominica's own (DOMLEC's tariffs,
  // the citizenship by investment programme, the cruise season), the rest the region's news and press releases
  // (Anguilla, Barbados, Martinique, Saint Lucia's prime minister, the ECCB, the CTO) and paid notices. So no home pin:
  // a headline that names no place gets none (with one, 11 of the 19 such headlines, the region's, would sit in
  // Roseau; the place-finder now knows the Caribbean's territories, geo.ts), and its death announcements and job
  // notices aren't read (skipLinks). Two outlets of a thinly covered place are matched by their headlines up to 48
  // hours apart (correlate.ts), so its Dominica stories can verify Dominica News Online's. Its terms allow sharing links and
  // quoting short extracts with credit and a link, and bar copying its content with automated tools without
  // permission, a clause aimed at scraping (the site offers this feed): we keep the headline and the link. Of the
  // other quiet places only Seychelles got a feed (SBC, below): not Burundi's other newsrooms (Isanganiro's last story
  // is from July; Iwacu's English feed stopped years ago), Comoros' Al-Watwan (its site answers with errors) or La
  // Gazette des Comores (no feed), Mongolia's Montsame and MNB (no feed), Liechtenstein's Vaterland, lie:zeit and
  // Landesspiegel (no feeds), Seychelles' Nation (no feed) and Seychelles News Agency (turns the reader away), Nauru's
  // and Tuvalu's (no newsroom with a feed; RNZ's Pacific feed is read)
  {
    id:              'emonews-dm',
    name:            'EmoNews',
    feedUrl:         'https://emonewsdm.com/feed.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.6,
    countryCode:     'DM',
    defaultLat:      15.30,
    defaultLng:      -61.39,
    defaultLocation: 'Roseau, Dominica',
    extraTags:       ['dominica', 'caribbean'],
    language:        'en',
    skipLinks:       /\/story\/(?:death-announcement|vacancy-notice|[a-z0-9-]*-vacancies(?:-\d+)?$)/,
  },
  // SBC, the Seychelles Broadcasting Corporation (Victoria), the public broadcaster: Seychelles' first newsroom here
  // beside the State House's press office. The site-wide feed its pages link (robots.txt allows all; the site's only
  // terms are its streaming service's, SBC+): read Nov 10, its newest 10 items from Nov 9, about 10 a day, in
  // Seychellois Creole (Kreol Seselwa), all Seychelles' own news (the National Assembly, a court charge, schools,
  // Praslin and La Digue), so a home pin; the reader learns the Creole name of the country (local-names.ts). Its
  // English pages from the Seychelles News Agency stopped in 2023. In Creole, its stories won't be matched with the
  // State House's English ones (or by the second-outlet search, English only), so it adds coverage, not verification
  {
    id:              'sbc-seychelles',
    name:            'Seychelles Broadcasting Corporation',
    feedUrl:         'https://www.sbc.sc/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.7,
    countryCode:     'SC',
    defaultLat:      -4.62,
    defaultLng:      55.45,
    defaultLocation: 'Victoria, Seychelles',
    extraTags:       ['seychelles', 'indian-ocean', 'africa'],
    language:        'crs',
  },
]

// ─── TYPE GUARDS ──────────────────────────────────────────────────────────────

/** Narrow a string to Category if it's valid, else fall back to 'other'. */
function toCategory(s: string): Category {
  const valid: Category[] = [
    'breaking', 'conflict', 'geopolitics', 'climate', 'health',
    'economy', 'technology', 'science', 'elections', 'culture',
    'disaster', 'security', 'sports', 'space', 'finance', 'other',
  ]
  return (valid as string[]).includes(s) ? (s as Category) : 'other'
}

// ─── SEVERITY DETECTION ───────────────────────────────────────────────────────

/**
 * Heuristically derive signal severity from article title + description.
 * Errs on the side of 'medium' to avoid alarm fatigue.
 */
export function detectNewsSeverity(title: string, description: string, category?: Category | null): SignalSeverity {
  // Counts the dead and injured and weighs the kind of event (pipeline/severity.ts, plan 0u)
  return rateSeverity(title, (description ?? '').replace(/<[^>]+>/g, ' '), category)
}

// ─── CATEGORY DETECTION ───────────────────────────────────────────────────────

/**
 * The article's category from its words (pipeline/categories.ts, shared with
 * classify.ts): the headline first, then the headline and description, else
 * the outlet's own category. Lets a geopolitics outlet (e.g. BBC) file a
 * disease outbreak as health.
 */
export function detectNewsCategory(
  title:           string,
  description:     string,
  sourceDefault:   Category,
): Category {
  return categorizeText(title, description) ?? sourceDefault
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

/**
 * A feed's text in the character set it declares: the Content-Type header's
 * charset, else the XML prolog's encoding="…", else UTF-8. Folha de S.Paulo's
 * feed is ISO-8859-1 (said only in its prolog); read as UTF-8, its accented
 * letters were lost ("ameaça" became "amea\uFFFDa" on the map, Oct 11, 2026).
 */
export function decodeFeed(buf: Buffer, contentType = ''): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1]
  const head = buf.subarray(0, 256).toString('latin1')
  // (a UTF-8 byte-order mark reads as "\u00EF\u00BB\u00BF" in latin1)
  const fromProlog = /^(?:\u00EF\u00BB\u00BF)?\s*<\?xml[^>]*?\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1]
  const label = (fromHeader ?? fromProlog ?? 'utf-8').toLowerCase()
  if (label === 'utf-8' || label === 'utf8') return buf.toString('utf8')
  try {
    return new TextDecoder(label).decode(buf)
  } catch {
    return buf.toString('utf8')   // a label Node doesn't know
  }
}

/**
 * Fetch a URL using node http/https, following up to 3 redirects.
 * Sets a 20-second timeout and identifies as WorldPulse. Decodes gzip, deflate
 * and brotli bodies: some servers compress whatever the client asks for, and
 * undecoded the feed reads as binary with no items (The Independent, Middle
 * East Eye).
 */
export function fetchUrl(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 3) {
      reject(new Error('Too many redirects'))
      return
    }

    const isHttps = url.startsWith('https')
    const client  = isHttps ? https : http

    const req = client.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent':      'WorldPulse/1.0 (open-source global intelligence; https://world-pulse.io)',
        'Accept':          'application/rss+xml, application/xml, application/atom+xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, (res) => {
      // Follow redirects; the new address may be relative ("/feed/")
      if (
        [301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
        res.headers.location
      ) {
        res.resume()
        let next: string
        try {
          next = new URL(res.headers.location, url).toString()
        } catch {
          reject(new Error(`Bad redirect from ${url}`))
          return
        }
        fetchUrl(next, redirectCount + 1).then(resolve, reject)
        return
      }

      if ((res.statusCode ?? 0) >= 400) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} from ${url}`))
        return
      }

      const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
      const body: NodeJS.ReadableStream =
        encoding.includes('br')      ? res.pipe(zlib.createBrotliDecompress()) :
        encoding.includes('gzip')    ? res.pipe(zlib.createGunzip()) :
        encoding.includes('deflate') ? res.pipe(zlib.createInflate()) :
        res

      const chunks: Buffer[] = []
      let size = 0
      body.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_FEED_BYTES) {
          req.destroy()
          reject(new Error(`Response over ${MAX_FEED_BYTES} bytes from ${url}`))
          return
        }
        chunks.push(chunk)
      })
      body.on('end',   () => resolve(decodeFeed(Buffer.concat(chunks), String(res.headers['content-type'] ?? ''))))
      body.on('error', reject)
    })

    req.on('error',   reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Timeout fetching ${url}`))
    })
  })
}

// ─── RSS / ATOM PARSING ───────────────────────────────────────────────────────

export interface FeedItem {
  title:       string
  link:        string
  pubDate:     string
  description: string
  /** The item's own point, when the feed gives one (GeoRSS or W3C geo tags; GDACS does) */
  point?:      { lat: number; lng: number } | null
  /** GDACS's alert level (Red, Orange, Green) */
  alertLevel?: string
}

/** An item's point from <georss:point>lat lng</georss:point> or <geo:lat>/<geo:long>, or null */
export function feedPoint(block: string): { lat: number; lng: number } | null {
  const georss = /<georss:point[^>]*>\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*<\/georss:point>/i.exec(block)
  const lat = Number(georss ? georss[1] : /<geo:lat[^>]*>\s*(-?[\d.]+)\s*<\/geo:lat>/i.exec(block)?.[1])
  const lng = Number(georss ? georss[2] : /<geo:long[^>]*>\s*(-?[\d.]+)\s*<\/geo:long>/i.exec(block)?.[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/**
 * An item's date from its own link, for a feed that dates nothing (Oct 31, 2026: the Greenland
 * government's feed gives a link and a title only, but .../Nyheder/2026/10/3010_styrelseschef is
 * Oct 30, 2026). An undated item counts as new, so its 2,584 releases would all have come in as
 * today's. The day only: noon UTC, never later than now; '' when the link carries no date.
 */
export function dateFromLink(link: string, now: number = Date.now()): string {
  const path = (link || '').replace(/^https?:\/\/[^/]+/i, '')
  // .../2026/10/3010_slug (the day, then the month again), or .../2026/10/30/slug
  const glued = /\/(20\d{2})\/(\d{2})\/(\d{2})(\d{2})_/.exec(path)
  const parts = glued && glued[4] === glued[2] ? glued : /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(path)
  if (!parts) return ''
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const t = Date.UTC(year, month - 1, day, 12)
  const d = new Date(t)
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  return new Date(Math.min(t, now)).toISOString()
}

/**
 * Minimal RSS 2.0 + Atom parser.
 * Handles: RSS <item>, Atom <entry>, CDATA sections, encoded HTML.
 */
export function parseFeedItems(xml: string): FeedItem[] {
  const items: FeedItem[] = []

  // Support both RSS <item> and Atom <entry>
  const blockPattern = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null

  while ((match = blockPattern.exec(xml)) !== null) {
    const block = match[1]

    const extract = (tags: string[]): string => {
      for (const tag of tags) {
        // Try CDATA first, then plain content, then attribute href. Whitespace
        // may wrap the CDATA section (OC Media's titles came out empty, Oct 14, 2026)
        const re = new RegExp(
          `<${tag}[^>]*(?:href="([^"]*)")?[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*|([^<]*))<\\/${tag}>|<${tag}[^>]*href="([^"]*)"[^>]*\\/?>`,
          'i',
        )
        const m = re.exec(block)
        if (m) {
          return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
        }
      }
      return ''
    }

    const link =
      extract(['link', 'id', 'guid']) ||
      // Atom <link href="..."/> self-closing
      (() => {
        const m = /<link[^>]+href="([^"]+)"/i.exec(block)
        return m?.[1] ?? ''
      })()

    items.push({
      title:       extract(['title']),
      link:        link.replace(/^https?:\/\/feedproxy\.google\.com\/~r\//i, 'https://'),
      // (the Council of the EU's feed dates its items in Atom's <a10:updated>; the Greenland
      // government's dates nothing but its links)
      pubDate:     extract(['pubDate', 'published', 'updated', 'dc:date', 'a10:updated']) || dateFromLink(link),
      description: extract(['description', 'summary', 'content', 'content:encoded']),
      point:       feedPoint(block),
      alertLevel:  extract(['gdacs:alertlevel']) || undefined,
    })
  }

  return newestFirst(items).slice(0, MAX_ITEMS)
}

/**
 * A feed's items newest first, before the reader takes MAX_ITEMS (Oct 31, 2026). Most feeds list their
 * newest first, but some list their oldest first (IranWire, found in sources round 8), and the first 20
 * in file order then gave the server only month-old items. A stable sort: a feed already newest first is
 * unchanged, and items without a date (each counts as new) come first in their own order.
 */
export function newestFirst<T extends { pubDate: string }>(items: T[]): T[] {
  return items
    .map((item, i) => {
      const t = Date.parse(item.pubDate)
      return { item, i, t: Number.isNaN(t) ? Number.POSITIVE_INFINITY : t }
    })
    .sort((a, b) => (b.t - a.t) || (a.i - b.i))
    .map((x) => x.item)
}

/** How far ahead of now an item's date may be before it counts as "just published" (clocks differ a little) */
export const FUTURE_SLACK_MS = 10 * 60_000

/**
 * When an item happened (Oct 31, 2026): its date, or now when it has none, can't be read, or lies ahead of
 * now. Jordan News dates its items about 3 hours ahead (Amman's time marked as UTC, found in sources round 8),
 * and an item from the future sat above the day's real news and looked like a scheduled event.
 */
export function eventTimeOf(pubDate: string | undefined, now: number = Date.now()): Date {
  const d = pubDate ? new Date(pubDate) : new Date(now)
  if (Number.isNaN(d.getTime()) || d.getTime() > now + FUTURE_SLACK_MS) return new Date(now)
  return d
}


// ─── DEDUP ────────────────────────────────────────────────────────────────────

export function newsRedisKey(sourceId: string, articleUrl: string): string {
  // Hash the URL into a short slug to keep key length bounded
  const slug = articleUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 80)
  return `osint:news-rss:${sourceId}:${slug}`
}

// ─── GEOGRAPHIC ENRICHMENT ───────────────────────────────────────────────────

interface GeoHint { lat: number; lng: number; name: string; code?: string }

/** Rough keyword → coordinates for common geographic entities in headlines. */
const GEO_HINTS: Array<{ keywords: string[]; geo: GeoHint }> = [
  { keywords: ['ukraine', 'kyiv', 'zaporizhzhia', 'zaporizhia', 'kharkiv', 'donetsk', 'kherson', 'odesa', 'dnipropetrovsk', 'chernihiv', 'sumy'],      geo: { lat: 50.45,  lng: 30.52,   name: 'Ukraine',          code: 'UA' } },
  { keywords: ['russia', 'moscow', 'kremlin', 'putin'],             geo: { lat: 55.75,  lng: 37.62,   name: 'Moscow, Russia',   code: 'RU' } },
  { keywords: ['israel', 'tel aviv', 'jerusalem', 'idf', 'netanyahu'], geo: { lat: 31.77, lng: 35.22, name: 'Israel',           code: 'IL' } },
  { keywords: ['gaza', 'palestin', 'hamas', 'west bank'],           geo: { lat: 31.50,  lng: 34.47,   name: 'Gaza',             code: 'PS' } },
  { keywords: ['china', 'beijing', 'shanghai', 'ccp', 'xi jinping'], geo: { lat: 39.91, lng: 116.39,  name: 'Beijing, China',   code: 'CN' } },
  { keywords: ['taiwan', 'taipei'],                                  geo: { lat: 25.03,  lng: 121.57,  name: 'Taipei, Taiwan',   code: 'TW' } },
  { keywords: ['north korea', 'pyongyang', 'dprk', 'kim jong'],     geo: { lat: 39.02,  lng: 125.75,  name: 'Pyongyang, North Korea', code: 'KP' } },
  { keywords: ['iran', 'tehran', 'irgc'],                            geo: { lat: 35.69,  lng: 51.39,   name: 'Tehran, Iran',     code: 'IR' } },
  { keywords: ['saudi arabia', 'riyadh', 'aramco'],                  geo: { lat: 24.69,  lng: 46.72,   name: 'Riyadh, Saudi Arabia', code: 'SA' } },
  { keywords: ['syria', 'damascus', 'aleppo'],                       geo: { lat: 33.51,  lng: 36.29,   name: 'Damascus, Syria',  code: 'SY' } },
  { keywords: ['india', 'new delhi', 'modi', 'bjp', 'mumbai'],      geo: { lat: 28.60,  lng: 77.21,   name: 'New Delhi, India', code: 'IN' } },
  { keywords: ['pakistan', 'islamabad', 'lahore', 'karachi'],        geo: { lat: 33.72,  lng: 73.06,   name: 'Islamabad, Pakistan', code: 'PK' } },
  { keywords: ['japan', 'tokyo', 'osaka', 'abe'],                    geo: { lat: 35.68,  lng: 139.69,  name: 'Tokyo, Japan',     code: 'JP' } },
  { keywords: ['germany', 'berlin', 'bundestag'],                    geo: { lat: 52.52,  lng: 13.41,   name: 'Berlin, Germany',  code: 'DE' } },
  { keywords: ['france', 'paris', 'macron', 'elysee'],               geo: { lat: 48.85,  lng: 2.35,    name: 'Paris, France',    code: 'FR' } },
  { keywords: ['united kingdom', 'london', 'britain', 'uk', 'westminster'], geo: { lat: 51.50, lng: -0.12, name: 'London, United Kingdom', code: 'GB' } },
  { keywords: ['united states', 'washington', 'white house', 'pentagon', 'congress', 'biden', 'trump'], geo: { lat: 38.90, lng: -77.04, name: 'Washington D.C., USA', code: 'US' } },
  { keywords: ['brazil', 'brasilia', 'sao paulo', 'lula'],           geo: { lat: -15.79, lng: -47.88,  name: 'Brasília, Brazil', code: 'BR' } },
  { keywords: ['africa', 'sahel', 'west africa', 'sub-saharan'],     geo: { lat:  0.00,  lng: 20.00,   name: 'Africa',           code: 'ZZ' } },
  { keywords: ['sudan', 'khartoum'],                                  geo: { lat: 15.55,  lng: 32.53,   name: 'Khartoum, Sudan',  code: 'SD' } },
  { keywords: ['ethiopia', 'addis ababa', 'tigray'],                  geo: { lat:  9.02,  lng: 38.75,   name: 'Addis Ababa, Ethiopia', code: 'ET' } },
  { keywords: ['somalia', 'mogadishu', 'al-shabaab'],                 geo: { lat:  2.05,  lng: 45.34,   name: 'Mogadishu, Somalia', code: 'SO' } },
  { keywords: ['myanmar', 'burma', 'rangoon', 'naypyidaw'],           geo: { lat: 16.80,  lng: 96.16,   name: 'Naypyidaw, Myanmar', code: 'MM' } },
  { keywords: ['turkey', 'ankara', 'istanbul', 'erdogan'],            geo: { lat: 39.93,  lng: 32.86,   name: 'Ankara, Turkey',   code: 'TR' } },
  { keywords: ['venezuela', 'caracas', 'maduro'],                     geo: { lat: 10.49,  lng: -66.88,  name: 'Caracas, Venezuela', code: 'VE' } },
  { keywords: ['mexico', 'mexico city', 'pemex'],                     geo: { lat: 19.43,  lng: -99.13,  name: 'Mexico City, Mexico', code: 'MX' } },
]

/**
 * A hint matches at the start of a word, so "iran" no longer pins "Tirana".
 * Short hints ("uk", "abe", "idf") must also end the word, or they pin "Dukes"
 * and "label"; longer ones may be prefixes ("palestin" for Palestinian).
 */
/**
 * Words that start like a place hint but aren't one. A hint matches the start
 * of a word ("Indian" is India, "Parisian" Paris), so "modifier" was Modi: on
 * Oct 14, 2026 a Le Monde reader survey asking who would modify their holiday
 * plans was pinned on New Delhi. "Parish" isn't Paris, "Indiana" isn't India,
 * German "Trumpf" (a trump card, a machine maker) isn't Trump; nor are Modivo (a Polish retailer: "MODIVO Platform
 * Q3 2026 slides" sat in New Delhi on Nov 7, 2026), Modigliani or Matthew Modine Modi.
 */
const NOT_A_HINT = /^(?:modif|modic|modish|modiv|modig|modin|indiana|parish|trumpet|trumpf|turkeys|chinatown)/

/**
 * "Congress" that isn't the US Congress (Oct 20, 2026): a party, as Sierra
 * Leone's All People's Congress, Nigeria's All Progressives Congress, South
 * Africa's African National Congress or India's Congress party, or another
 * country's congress, as China's National People's Congress. The "congress"
 * hint placed 3 of 10 Sierraloaded stories in Washington.
 */
const OTHER_CONGRESS = /\bnational\s+(?:[a-z']+\s+)?congress\b|\bpeople'?s\s+congress\b|\bprogressives?\s+congress\b|\bcongress\s+party\b|\bcongress-led\b|\b(?:bjp|lok sabha|rajya sabha|kharge)\b/

function hintMatches(text: string, keyword: string): boolean {
  if (keyword === 'congress' && OTHER_CONGRESS.test(text)) return false
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const end = keyword.length <= 3 ? '(?![a-z0-9])' : ''
  // (the whole word the hint starts, to rule out the words above)
  for (const m of text.matchAll(new RegExp(`(?<![a-z0-9])${escaped}${end}[a-z0-9]*`, 'g'))) {
    if (!NOT_A_HINT.test(m[0])) return true
  }
  return false
}

/** Government press offices whose stories are their own country's day (inferGeo; Nov 5, 2026) */
export const PRESS_OFFICES = new Set(['pmo-brunei', 'statehouse-seychelles', 'fsm-president-office', 'opm-pressroom-dm', 'sknis-kn',
  'naalakkersuisut-gl', 'regierung-li'])
/** A visit received at home: "receives", "hosts", "welcomes", "in audience", "courtesy call", "credentials" */
const HOSTING_WORDS = /\b(?:receives?|received|hosts?|hosted|welcomes?|welcomed|in audience|courtesy call|credentials|bids? farewell)\b/i

/** A place with this many of its own feeds or fewer is thinly covered (Nov 5, 2026) */
export const THIN_PLACE_FEEDS = 3

/**
 * The thinly covered places (upper-case codes): those with THIN_PLACE_FEEDS or fewer feeds of their own.
 * Two of their outlets' reports of one story may be a day or two apart (weeklies, a press office), so the
 * same-story second look reaches back two days for them (correlate.ts setThinPlaces).
 */
export function thinPlaces(sources: readonly NewsSource[] = NEWS_SOURCE_REGISTRY): string[] {
  const feeds = new Map<string, number>()
  for (const s of sources) if (s.countryCode) feeds.set(s.countryCode, (feeds.get(s.countryCode) ?? 0) + 1)
  return [...feeds].filter(([, n]) => n <= THIN_PLACE_FEEDS).map(([code]) => code).sort()
}

/**
 * National outlets whose stories are mostly about their own country: a story
 * that names no place is pinned at the outlet's home. Every other outlet's
 * story without a place gets no pin: until Oct 11, 2026 all of them fell back
 * to the outlet's office, so ABC Australia's US stories sat in Sydney,
 * Investing.com's stock trades in Limassol, CNA's Panama earthquake coverage
 * in Singapore and GDACS's alerts in Ispra, Italy (about 1 in 5 map points).
 */
export const HOME_PIN_SOURCES = new Set([
  'kyiv-independent', 'haaretz', 'times-of-india', 'the-hindu-national', 'japan-times', 'daily-maverick',
  'folha-sao-paulo', 'moscow-times', 'taipei-times', 'dawn-pakistan', 'premium-times-nigeria',
  'punch-nigeria', 'businessday-ng', 'mail-guardian-za',
  'vanguard-ng', 'daily-trust-ng', 'graphic-online-gh', 'nst-malaysia',
  'philippine-inquirer', 'vnexpress-intl', 'myanmar-now', 'irrawaddy', 'agencia-publica', 'ciper-chile',
  'la-silla-vacia', 'rnz-national', 'ecb-press', 'fed-press',
  // Oct 14, 2026
  'ansa-en', 'yonhap-en', 'antara-en', 'japan-today', 'thelocal-ch', 'hurriyet-dn', 'egypt-independent',
  'mada-masr', 'the-national-uae', 'standard-ke', 'capitalfm-ke', 'civil-ge', 'ukrainska-pravda',
  'khaosod-en', 'mexico-news-daily', 'ba-times',
  'gulf-news', 'saudi-gazette', 'fana-en', 'scroll-in', 'meduza-en', 'folha-en',
  // Oct 20, 2026
  'boe-news', 'ec-press-corner', 'studio-tamani', 'tico-times',
  'radio-dabanga', 'post-courier-pg', 'vanuatu-daily-post', 'economynext-lk', 'amu-tv', 'shafaq-iraq',
  'eu-council',
  // Oct 20, 2026 (Q5, batch A): national outlets; a story that names no place is pinned at home
  'notes-from-poland', 'daily-news-hungary', 'bnr-en', 'novinite-bg', 'err-news', 
  'lrt-en', 'sarajevo-times', 'newsinenglish-no', 'ruv-en', 'rte-news', 'radio-prague-en',
  'romania-insider', 'croatia-week', 'total-croatia-news', 'radio-sweden', 'yle-news',
  'helsinki-times', 'copenhagen-post', 'portugal-resident', 'the-shift-mt', 'tovima-en',
  'rtl-today-lu', 'slovak-spectator', 'independent-ug', 'nile-post-ug', 'nation-malawi',
  'the-namibian', 'kun-uz-en', 'daryo-uz-en', 'astana-times', 'asia-plus-tj', 'bianet-en',
  'taarifa-rw', 'arab-times-kw', 'times-of-oman', 'news-of-bahrain', 'somali-guardian',
  'ethiopia-insight', 'syria-direct', 'frontpage-africa',
  'mimi-mefo-info', 'myjoyonline-gh', 'naharnet', 'hong-kong-free-press', 'camboja-news',
  'businessworld-ph', 'kaniva-tonga', 'korea-herald', 'onlinekhabar-en', 'laotian-times',
  'prachatai-en', 'sibc-sb', 'solomon-times', 'talamua-ws', 'tatoli-en', 'tuoi-tre-news',
  'gma-news-nation', 'bbs-bhutan', 'news-mn-en', 'island-times-pw',
  'cook-islands-news', 'malay-mail', 'friday-times-pk', 'the-nation-pk', 'corporate-maldives',
  'caracas-chronicles', 'dominican-today', 'jamaica-observer', 'tribune-242', 'amandala-bz',
  'st-lucia-times', 'kaieteur-news', 'nation-news-bb', 'trinidad-express',
  // Oct 20, 2026 (Q5, round 2)
  'serbian-monitor', 'business-review-ro', 'wanted-in-rome', 'budapest-times', 
  'iceland-review', 'reykjavik-grapevine', 'newswire-lk', 'rthk-en', 'japan-forward',
  '1news-nz', 'now-grenada', 'iwitness-news-vc', 'bernews-bm', 'cayman-news-service',
  'cnc3-tt', 'zambia-monitor', 'cite-zw', '263chat-zw', 'sunday-standard-bw', 'botswana-gazette',
  'daily-news-tz', 'zitamar-mz', 'times-of-eswatini', 'togo-first',
  'cameroon-news-agency', 'yemen-monitor', 'pnn-english',
  // Oct 20, 2026 (Q5, round 3)
  'kerr-fatou-gm', 'sierraloaded-sl', 'libya-review', 'kt-press-rw', 'windhoek-observer',
  'hetq-am', 'evn-report', 'tdh-turkmenistan', 'monaco-life', 'newsbook-mt',
  'gulf-times-qatar', 'times-kuwait', 'iraq-business-news', 'antigua-news',
  '7news-belize', 'demerara-waves', 'jamaica-gleaner', 'vbtc-vu',
  // Oct 20/21, 2026 (Q5, round 4)
  'euronews-albania', 'diplomat-in-spain', 'zf-english-ro', 'ammon-news-en',
  'news-central-asia-tm', 'tengrinews-en', 'gazeta-uz-en', 'globes-en', 'sixth-tone',
  'focus-taiwan', 'new-bloom', 'cambodia-investment-review', 'khabarhub-en', 'malaysiakini-en',
  'vietnamplus-en', 'fiji-one-news', 'island-sun-sb', 'in-depth-solomons', 'opm-pressroom-dm',
  'newsroom-panama', 'city-paper-bogota', 'our-news-bs', 'le360-en', 'almarsad-en',
  'analyst-liberia', '3news-gh', 'egyptian-streets', 'newsday-ls', 'the-reporter-ls',
  'sunday-express-ls', 'zambian-business-times', 'capital-ethiopia', 'newshawks-zw',
  'sabc-news',
  // Oct 21, 2026 (Q5, round 5). bdnews24 left out Oct 29: its site-wide feed carries world business
  // news, so "Asian shares fall after Alphabet earnings miss" sat in Dhaka
  'luxtoday-lu', 'the-ditch-ie', 'tirana-times', 'cin-ba-en', 'kyiv-post',
  'interfax-ukraine-en', 'keep-talking-greece', 'the-arabian-stories', 'khaleej-times-uae',
  'kazakhstan-today-en', 'dhaka-tribune', 'lanka-business-online',
  'tpn-national-th', 'guam-daily-post', 'fritong-post', 'gambiana', 'smart-news-liberia',
  'malawi-voice', 'pml-daily-ug', 'weekend-post-bw', 'inews-guyana',
  // Oct 29, 2026 (H-0033)
  'tehran-times',
  // Oct 31, 2026 (Q9, sources round 6)
  'ami-mauritania-en', 'african-manager-en', 'echorouk-en', 'marshall-islands-journal', 'de-ware-tijd-sr',
  'starnieuws-sr', 'suriname-herald-sr', 'von-radio-kn', 'cuenca-high-life-ec', 'asuncion-times-py',
  'statehouse-seychelles', 'maka-angola-en', 'thelocal-at', 'thelocal-dk', 'thelocal-se',
  'rtv-slo-slovenija', 'moldovalive-md', 'zdg-md', 'tv8-md',
  'aktuelno-me', 'rtnk-me', 'prishtina-insight', 'lajmi-net-xk', 'el-periodic-andorra',
  'san-marino-rtv',
  // Oct 31, 2026 (Q9, sources round 7)
  'confidencial-en', 'islands-business-kiribati', 'islands-business-tuvalu', 'fresh-fruit-portal-chile',
  'fresh-fruit-portal-peru', 'fsm-president-office', 'sos-medias-burundi-en', 'mauritius-times',
  // Oct 31, 2026 (Q9, the last four places)
  'pmo-brunei', 'naalakkersuisut-gl', 'regierung-li', 'islands-business-nauru',
  // Oct 31, 2026 (round 8: depth)
  'altaveu-ad', 'abs-tv-radio-ag', 'antigua-observer-ag', 'balkanweb-al', 'rtsh-al', 'kleine-zeitung-at',
  'azertac-en', 'cbc-barbados-bb', 'tbs-bangladesh', 'sofia-globe-bg', 'zns-bahamas-bs', 'love-fm-bz',
  'san-pedro-sun-bz', 'corbeau-news-centrafrique', 'journal-de-brazza-cg', 'aip-cote-divoire', 'rti-info-ci',
  'business-in-cameroon', 'datacameroon', 'direct-infos-gabon', 'lunion-gabon', 'e-global-equatorial-guinea',
  'ang-guinea-bissau', 'e-global-guinea-bissau', 'bgen-croatia', 'shafaq-kurdistan', 'nationwide-news-jm',
  'kuwait-times-kw', 'the-voice-lc', 'lsm-english-lv', 'hello-monaco', 'borba-me',
  'portalb-mk', 'tv21-mk', 'maldives-voice-mv', 'mfr-maldives', 'namibian-sun-na',
  'new-era-na', 'actuniger-politique', 'le-sahel-niger', 'qatar-tribune', 'rwanda-dispatch-rw',
  'primorske-novice-si', 'calabash-newspaper-sl', 'corriere-romagna-sm', 'the-dawn-ss', 'rstp-sao-tome',
  'stp-press', 'eswatini-observer-sz', 'eswatini-positive-news-sz', 'atpe-tchad', '24heureinfo-tg',
  'khovar-en', 'diligente-tl', 'ttt-news-tt', 'crux-vatican', 'zenit-pope-va', 'samoa-global-news-ws',
  'saba-yemen-en', 'mwebantu-zm', 'news-diggers-zm',
  // Oct 31, 2026, 7:02 PM (round 8, Devon: "add them anyway"): national outlets, Macau's gaming trade paper and
  // Nice-Matin's Monaco edition
  'dominica-news-online-dm', 'doha-news-qa', 'shabait-er', 'breaking-belize-news-bz', 'starcom-barbados-bb', 'asgam-macau-mo',
  'libertas-sm', 'nice-matin-monaco-mc', 'oon-at', 'alsat-mk',
  // Nov 3, 2026: KBC News, Kenya's public broadcaster (in place of The East African)
  'kbc-ke',
  // Nov 5, 2026: national outlets for places left thin by parked and down feeds; at 8:18 PM (Devon: "Go in
  // anyway") four more. Not The Citizen (Tanzania), a third of whose feed is world news, nor Dan (Montenegro):
  // its site-wide feed carries world, celebrity and sport, and on its first read (9:45 PM) a London court
  // verdict, a Hollywood interview and a horoscope sat in Podgorica
  'haitilibre-ht', 'noticel-pr', 'barbados-today-bb', 'portal-analitika-me', 'le-nouvelliste-ht', 'observer-ug',
  // Nov 5, 2026, 11:45 PM: farmdoc daily (the US farm economy); not North Press (Syria, Iraq's Kurdistan and
  // Jordan alike), ECDC, NASA, AirlineGeeks or The Conversation's editions. And Top FM's politics section (plan Q10):
  // in French, it had no home pin when it came in (Oct 21, before the reader knew French place names), so its
  // stories named no place it knew ("Navin Ramgoolam", "Paul Bérenger") and none of its week's stories was
  // Mauritius's (Defimedia, Mauritius's busiest feed, went on Nov 3)
  'farmdoc-daily', 'top-fm-mu',
  // Nov 6, 2026, 12:10 AM: Honduras's, Djibouti's and Equatorial Guinea's second newsrooms, each mostly its own country's news
  'el-pulso-hn', 'la-nation-dj', 'ahora-eg-gq',
  // Nov 6, 2026, 8 AM: 15min (less its world section) and LRT's "In Lithuania" section, Estonian World and St Vincent
  // Times; not This is Beirut (mostly the region) or Spaceflight Now
  '15min-lt', 'lrt-lt', 'estonian-world-ee', 'st-vincent-times-vc',
  // Nov 6, 2026, 10 AM: SKNIS, and TASR and Les Nouvelles Calédoniennes (parked); not Islands Business (the region's)
  'sknis-kn', 'tasr-en', 'les-nouvelles-caledoniennes',
  // Nov 6, 2026, 11 AM: Cayman Compass and FBC News, each mostly its own place's news
  'cayman-compass-ky', 'fbc-news-fj',
  // Nov 6, 2026, 1 PM: 24.kg and Vesti.kg in Russian, mostly Kyrgyzstan's news; not Roya or JO24 (the region's too)
  '24kg-ru', 'vesti-kg',
  // Nov 6, 2026, 2 PM: The Royal Gazette, SANA, Al-Watan and Ikon.mn, each mostly its own country's news; not Syria TV
  // or Al Bilad (the region's and the world's too)
  'royal-gazette-bm', 'sana-sy-ar', 'al-watan-sy-ar', 'ikon-mn',
  // Nov 7, 2026: Paraguay's three national outlets, each almost only its own country's news (ABC Color's national
  // section; of 30 unplaced headlines sampled from each, all but one Paraguay's own); in two days 100 of their unplaced
  // headlines named President Peña during his impeachment, and dozens more the collapse of ueno bank, none of them on the map
  'abc-color-py', 'la-nacion-py', 'el-nacional-py',
  // Nov 9, 2026: Sermitsiaq.AG, about 8 in 10 of its stories Greenland's own; its wire stories name their place, in
  // Danish too (local-names.ts)
  'sermitsiaq-gl',
  // Nov 10, 2026: SBC, Seychelles' public broadcaster, all its own country's news (in Creole); not EmoNews (Dominica),
  // half of whose stories are the region's
  'sbc-seychelles',
])

export interface InferredGeo {
  lat: number | null
  lng: number | null
  locationName: string | null
  countryCode: string | null
}

/**
 * "Russian drones", "Russian troops" in a Ukrainian outlet's headline are the
 * war in Ukraine, not Moscow (Oct 29, 2026: Interfax-Ukraine's and Ukrainska
 * Pravda's air-defence and front-line stories sat in Moscow). Only the noun
 * or its capital pins them in Russia.
 */
const RUSSIA_NOUN = /\b(?:russia|moscow|kremlin)\b/

/**
 * Stories with no place of their own: league football and crypto-exchange news
 * (Oct 30, 2026: a Premier League story sat in Accra, a Binance hack in Dublin,
 * both home pins of national outlets), and horoscopes (Nov 5, 2026: Portal
 * Analitika's and Dan's daily one, "Horoskop za 6. novembar"). They get no pin
 * unless the text names a place.
 */
const NO_PLACE_TOPIC = /\b(?:premier league|champions league|europa league|la liga|serie a|bundesliga|man(?:chester)? (?:utd|united|city)|binance|coinbase|bitcoin|ethereum|crypto(?:currency)? (?:exchange|hack)|horoscopes?|horoskop[aeiu]?|hor[oó]scopos?|oroscopo)\b/i

/**
 * Countries whose own Congress the English-language press calls just "Congress": India's and Nepal's
 * parties, the Philippines' legislature and Latin America's congresses
 */
const OWN_CONGRESS = new Set(['IN', 'NP', 'PH', 'MX', 'GT', 'HN', 'DO', 'CO', 'PE', 'EC', 'BO', 'CL', 'AR', 'PY'])

/**
 * A fixture headline ("Villarreal vs. PSG", "Everton v Chelsea"): two clubs, so a city found only in
 * the summary is one team's, not where the story is (Nov 3, 2026: "Where to watch Villarreal vs. PSG"
 * sat in Paris because the summary said Paris Saint-Germain)
 */
const FIXTURE_HEADLINE = /\S\s(?:vs?\.?|contra|frente a|gegen|contre)\s+\p{Lu}/u

function fromHints(text: string, homeCountry?: string, national = false): InferredGeo | null {
  const lower = text.toLowerCase()
  for (const { keywords, geo } of GEO_HINTS) {
    if (geo.code === 'RU' && homeCountry === 'UA' && !RUSSIA_NOUN.test(lower)) continue
    // A bare "Congress" from a national outlet of a country with its own is that one (Oct 30, 2026: The Hindu's
    // "Cyclone Arnab: Congress says Centre must lead ... relief" sat in Washington)
    const words = national && geo.code === 'US' && OWN_CONGRESS.has(homeCountry ?? '') ? keywords.filter(kw => kw !== 'congress') : keywords
    if (words.some(kw => hintMatches(lower, kw))) {
      return { lat: geo.lat, lng: geo.lng, locationName: geo.name, countryCode: geo.code ?? null }
    }
  }
  return null
}

function fromPlace(text: string): InferredGeo | null {
  const place = placeFromText(text)
  return place.point && place.lat !== undefined && place.lng !== undefined
    ? { lat: place.lat, lng: place.lng, locationName: place.name ?? null, countryCode: place.countryCode ?? null }
    : null
}

/** The outlet's own country's town of the same name as the place found in the text (geo.ts homeTwinPlace) */
function fromTwin(text: string, source: NewsSource, named: InferredGeo | null): InferredGeo | null {
  if (!named || named.countryCode === source.countryCode) return null
  const found = findGazetteerPlace(text)
  // not when the text names the other place's country: a Dominican outlet's "cineasta chileno ... Santiago" is Chile's
  if (!found || mentionedCountries(text).includes(found.coords.country)) return null
  const place = homeTwinPlace(text, source.countryCode, found.place)
  return place?.point && place.lat !== undefined && place.lng !== undefined
    ? { lat: place.lat, lng: place.lng, locationName: place.name ?? null, countryCode: place.countryCode ?? null }
    : null
}

/** A home-only town of a country the text names by name (geo.ts namedCountryHomePlace): "Rosario, Argentina" */
function fromNamedCountry(text: string): InferredGeo | null {
  const place = namedCountryHomePlace(text)
  return place?.point && place.lat !== undefined && place.lng !== undefined
    ? { lat: place.lat, lng: place.lng, locationName: place.name ?? null, countryCode: place.countryCode ?? null }
    : null
}

/**
 * A match or stadium story whose headline names no place and whose summary says where it was played ("in Tromsø",
 * "at Anfield"): the venue, not the outlet's home (Nov 8, 2026: Vanguard's "Fan rushed to hospital after stadium
 * stand collapses during Bodo/Glimt match" sat in Lagos; its summary put it in Tromsø). Only a town found in the
 * summary after "in" or "at", so a player's home town or a club's name doesn't move a story.
 */
const SPORTS_VENUE_TOPIC = /\b(?:match|stadium|stands?|fixture|derby|pitch|kick-?off|fans?)\b/i
export function sportsVenue(title: string, body: string): InferredGeo | null {
  if (!SPORTS_VENUE_TOPIC.test(title)) return null
  const place = fromPlace(body)
  if (!place?.locationName) return null
  const name = place.locationName.split(',')[0]!.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b(?:in|at)\\s+(?:the\\s+)?${name}(?![\\p{L}])`, 'iu').test(body) ? place : null
}

/**
 * A place in a national outlet's own country that its summary names, when its headline names none (Nov 7, 2026: of 120
 * random stories pinned at a spot, 9 sat at the outlet's home though the summary named the town, among them the
 * Windhoek Observer's "The Swakopmund town hall meeting" and the Friday Times' "Upper Swat district of Khyber
 * Pakhtunkhwa"). Never another country's: a place abroad anywhere in the summary misplaced 1 in 8 placeless headlines
 * (Oct 30, 2026, M57).
 */
function ownPlace(text: string, source: NewsSource): InferredGeo | null {
  const place = placeInCountry(text, source.countryCode)
  // not the territory its home is written with ("Guam" for "Hagåtña, Guam")
  const around = (source.defaultLocation ?? '').toLowerCase().split(/,\s*/).slice(1)
  return place?.point && place.lat !== undefined && place.lng !== undefined && !around.includes((place.name ?? '').toLowerCase())
    ? { lat: place.lat, lng: place.lng, locationName: place.name ?? null, countryCode: place.countryCode ?? null }
    : fromHome(text, source)
}

/** A town only its own country's outlets are read for (geo.ts homePlaceFromText): "Mandeville" in a Jamaican outlet */
function fromHome(text: string, source: NewsSource): InferredGeo | null {
  const place = homePlaceFromText(text, source.countryCode)
  return place?.point && place.lat !== undefined && place.lng !== undefined
    ? { lat: place.lat, lng: place.lng, locationName: place.name ?? null, countryCode: place.countryCode ?? null }
    : null
}

/** One capitalised word of a dateline's place: "PARIS", "Kathmandu", "Bukit", "Abu", "D.C." */
const DATELINE_WORD = "\\p{Lu}[\\p{L}'’.-]*"
/**
 * A summary's dateline: one to four capitalised words, maybe ", Kenya", maybe
 * "(Reuters)", then a colon, a dash or ", October 30" (the month is checked in code).
 */
const DATELINE = new RegExp(
  `^\\s*(${DATELINE_WORD}(?:\\s+${DATELINE_WORD}){0,3}(?:,\\s*${DATELINE_WORD}(?:\\s+${DATELINE_WORD}){0,2})?)` +
  `\\s*(?:\\([^)]{1,40}\\)\\s*)?` +
  `(?::|\\s[—–-]{1,2}\\s|[—–]|,\\s*(\\p{L}+)\\.?\\s+\\d{1,2}\\b)`, 'u')
const MONTH = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i

/**
 * The place a summary's dateline names: "PARIS:", "Mumbai:", "NAIROBI, Kenya —",
 * "TOKYO (Kyodo) -", "Kathmandu, October 30". Only when every word before the
 * mark is a place name ("Opinion:", "Victoria Beckham —" are not).
 */
export function datelinePlace(text: string): InferredGeo | null {
  const m = DATELINE.exec(text)
  if (!m?.[1]) return null
  if (m[2] && !MONTH.test(m[2])) return null
  const { rest } = splitPlaces(m[1])
  if (rest.replace(/[\s,.'’-]+/g, '') !== '') return null
  return fromPlace(m[1])
}

/**
 * Where a news story is: the feed's own point for it (GDACS gives each
 * alert's coordinates), else a place its headline names (any city in the
 * gazetteer or any country, by its capital), else a leader or institution
 * it names ("Kremlin", "Modi"), else the same in its summary, else the
 * outlet's home for national outlets (HOME_PIN_SOURCES), else no pin.
 */
export function inferGeo(
  title:       string,
  description: string,
  source:      NewsSource,
  point?:      { lat: number; lng: number } | null,
): InferredGeo {
  // A Brazzaville outlet's "Congo", a Mauritian outlet's "Maurice" (geo.ts, withHomeNames; Oct 21, 2026), and
  // places named in the feed's own language: "Wien", "Rusiji", "Mali i Zi" (local-names.ts; Oct 31, 2026); not the
  // country an embassy or envoy is from ("Chinese Embassy Pledges More Support for Vulnerable Communities" is Uganda's;
  // geo.ts withoutEnvoyCountries, Nov 7, 2026); nor a title's place, or a place joined to who backs, runs or flags
  // something ("Duchess of Edinburgh due Monday", "Pakistan-based group", "Liberia-flagged tanker"; geo.ts
  // withoutNonPlaceNames, Nov 8, 2026)
  const [head, body] = withoutNonPlaceNames(
    withoutEnvoyCountries(withLocalNames(withHomeNames(title, source.countryCode), source.language)),
    withoutEnvoyCountries(withLocalNames(withHomeNames(description, source.countryCode), source.language)),
    source.countryCode,
  )
  if (point) {
    const named = fromPlace(head)
    return { lat: point.lat, lng: point.lng, locationName: named?.locationName ?? null, countryCode: named?.countryCode ?? null }
  }
  // A town its own country's outlets name that is also a word, a person or another country's place ("Mandeville",
  // "Kingston"; geo.ts homePlaceFromText, Nov 6, 2026), when the headline names no other place, or names only its own
  // country ("Liberia: Lofa County University President ..."); before a leader or an institution it names
  const named = fromPlace(head)
  const home = !named || (named.countryCode === source.countryCode && !findGazetteerPlace(head)) ? fromHome(head, source) : null
  // ...and any outlet's, when the headline names the town's country and no other place ("Floods in Rosario, Argentina")
  const ofNamed = !home && named && !findGazetteerPlace(head) ? fromNamedCountry(head) : null
  // ...and its own country's town of the same name before another country's ("Los Ángeles" in a Chilean outlet)
  const twin = fromTwin(head, source, named)
  const fromHead = twin ?? home ?? ofNamed ?? named ?? fromHints(head, source.countryCode, HOME_PIN_SOURCES.has(source.id))
  // AllAfrica files each story under its country, named first: "Malawi: 'Ngora Has No Power to Deregister HRDC'" is
  // Malawi's NGO regulator, not Uganda's Ngora district (Nov 6, 2026); another country's place there is a name
  const filedUnder = source.id === 'allafrica' ? /^([^:]{3,40}):\s/.exec(title)?.[1] : undefined
  if (filedUnder && fromHead && !findGazetteerPlace(filedUnder)) {
    const countries = mentionedCountries(filedUnder)
    if (countries.length === 1 && fromHead.countryCode !== countries[0]) return fromPlace(filedUnder) ?? fromHead
  }
  // A government's press office tells of its own country's day, also when a visitor's country is named: "His
  // Majesty receives in audience His Majesty The Sultan of Oman" and "Crown Prince Receives Outgoing High
  // Commissioner Islamic Republic Of Pakistan" (Brunei's PMO) sat in Muscat and Islamabad (Nov 5, 2026, plan Q10:
  // 5 of the office's 10 newest stories); a trip abroad ("President Simina Meets with JICA President in Tokyo")
  // goes where it names
  if (fromHead && fromHead.countryCode !== source.countryCode && PRESS_OFFICES.has(source.id)
    && (HOSTING_WORDS.test(head) || mentionedCountries(head).includes(source.countryCode))) {
    return { lat: source.defaultLat, lng: source.defaultLng, locationName: source.defaultLocation, countryCode: source.countryCode }
  }
  if (fromHead) return fromHead
  // A national outlet's story that names no place in its headline is about its own country unless its
  // dateline says otherwise (Oct 30, 2026, M57: a place found anywhere in the summary won before, so
  // Haaretz's column on Netanyahu sat in Washington, a Penang court case in Myanmar, Japan's new
  // prime minister in Beijing and a Khyber Pakhtunkhwa story in Tehran: about 1 in 8 placeless headlines)
  if (HOME_PIN_SOURCES.has(source.id) && !NO_PLACE_TOPIC.test(`${title} ${description}`)) {
    return datelinePlace(body) ?? ownPlace(body, source) ?? sportsVenue(title, body)
      ?? { lat: source.defaultLat, lng: source.defaultLng, locationName: source.defaultLocation, countryCode: source.countryCode }
  }
  if (FIXTURE_HEADLINE.test(title)) return { lat: null, lng: null, locationName: null, countryCode: null }
  // A space outlet's summary names the crew's agencies and countries, not where the story happens: Spaceflight
  // Now's spacewalks at the space station sat in Canada for "Canadian Space Agency astronaut Joshua Kutryk"
  // (Nov 6, 2026), so its stories are placed by their headline only
  if (source.category === 'space') return { lat: null, lng: null, locationName: null, countryCode: null }
  const bodyNamed = fromPlace(body)
  const fromBody = fromTwin(body, source, bodyNamed) ?? (bodyNamed && !findGazetteerPlace(body) ? fromNamedCountry(body) : null)
    ?? bodyNamed ?? fromHints(body, source.countryCode)
  if (fromBody) return fromBody
  return { lat: null, lng: null, locationName: null, countryCode: null }
}

// ─── SIGNAL CREATION ──────────────────────────────────────────────────────────

/**
 * A shopping page, not news: coupon and promo codes, gift guides, product
 * galleries (Oct 11, 2026: Wired's feed sent "eBay Coupons: 20% Off in
 * October 2026" and "Best Lego Gifts for Brick Builders").
 */
export function isShoppingItem(item: Pick<FeedItem, 'title' | 'link'>): boolean {
  const title = item.title ?? ''
  const link  = (item.link ?? '').replace(/^https?:\/\/[^/]+/i, '')
  return /\b(?:promo|coupon|discount)\s+codes?\b|\bgift\s+guides?\b|\bcoupons\b.*\b(?:off|codes?|deals?)\b/i.test(title)
    || /\/(?:gallery|coupons?|deals|shopping|gift-guides?)\//i.test(link)
    || /(?:promo-codes?|coupon-codes?|discount-codes?|gifts-for)/i.test(link)
}

/**
 * A press office's notice, not news: media advisories, accreditation,
 * schedules and agendas, press briefing announcements (Oct 20, 2026: the
 * Council of the EU's feed sends "Media advisory - Accreditation for the
 * Special European Council" and "Weekly schedule of President António Costa"
 * beside its decisions)
 */
export function isPressNotice(item: Pick<FeedItem, 'title'>): boolean {
  const title = item.title ?? ''
  return /^\s*(?:media advisory|press briefing|forward look|weekly schedule|agenda highlights|background brief|provisional agenda)\b/i.test(title)
    || /\baccreditation (?:is )?(?:now )?open\b|\baccreditation requirements\b|\b(?:one-year|annual) (?:press )?badge\b/i.test(title)
}

/** An obituary: from an obituaries section (or Legacy.com), or titled as one */
export function isObituary(item: Pick<FeedItem, 'title' | 'link'>): boolean {
  return /\/(?:obituaries|obituary|obits?)\//i.test(item.link ?? '')
    || /(?:^|\.)legacy\.com\//i.test((item.link ?? '').replace(/^https?:\/\//, ''))
    || /^\s*(?:obituary|obituaries|obit)\b/i.test(item.title ?? '')
}

async function processItem(
  db:       Knex,
  redis:    Redis,
  producer: Producer | null | undefined,
  source:   NewsSource,
  item:     FeedItem,
): Promise<'created' | 'stale' | 'none'> {
  if (!item.title && !item.link) return 'none'

  const key  = newsRedisKey(source.id, item.link || item.title)
  const seen = await redis.get(key)
  if (seen) return 'none'

  // An old story the feed still lists (or a backlog): remember it, don't post it
  if (isStaleItem(item.pubDate)) {
    await redis.setex(key, DEDUP_TTL_S, '1')
    return 'stale'
  }

  // Death notices from a local paper's obituaries section aren't world news
  // (Oct 11, 2026: "Frank J. Mauro", pinned in New York as health/high)
  if (isObituary(item)) {
    await redis.setex(key, DEDUP_TTL_S, '1')
    return 'none'
  }
  if (isShoppingItem(item) || isPressNotice(item)) {
    await redis.setex(key, DEDUP_TTL_S, '1')
    return 'none'
  }

  // The description as plain text: feeds send HTML, some of it encoded
  // ("&lt;p&gt;"), and its links and attributes aren't the story's words
  const text        = item.description ? feedText(item.description) : ''

  // GDACS alerts: severity from the alert level, a readable earthquake headline
  const alert       = source.id === 'gdacs' ? gdacsAlertLevel(item.title, item.alertLevel) : null
  const gdacs       = source.id === 'gdacs' ? tidyGdacsTitle(decodeEntities(item.title)) : null
  const title       = (gdacs?.title ?? decodeEntities(item.title)).slice(0, 500) || `${source.name} — news item`
  const category    = detectNewsCategory(item.title, text, source.category)
  const severity    = alert ? gdacsSeverity(alert) : detectNewsSeverity(decodeEntities(item.title), text, category)
  // (the story's own words: a WordPress footer's "appeared first on BENIN WEB TV" named Benin for the outlet's world news)
  const found       = inferGeo(item.title, cleanSummary(text), source, item.point)
  const geo         = gdacs?.place && !found.locationName ? { ...found, locationName: gdacs.place } : found

  const eventTime = eventTimeOf(item.pubDate)

  // The article's own words, or none when they only repeat the headline. The
  // outlet, its reliability and bias are on the signal (its source and the
  // state-media tag), not in the summary: until Oct 11, 2026 a note there
  // ("Source: X (reliability: 76%, bias: center).") read as the story's score.
  const description = text ? clipText(cleanSummary(text), 600) : ''
  const summary = repeatsTitle(description, title) ? null : description

  const tags = [
    'news', 'rss', source.id, source.countryCode.toLowerCase(),
    category, severity,
    ...(source.id === 'gdacs' ? gdacsTags(item.title) : source.extraTags),
    ...(source.biasLabel === 'state-media' ? ['state-media'] : []),
  ]

  try {
    const signal = await insertAndCorrelate({
      title,
      summary,
      category,
      severity,
      status:            'pending',
      reliability_score: source.reliability,
      source_count:      1,
      source_ids:        [],
      original_urls:     item.link ? [item.link] : [],
      location:          geo.lat !== null && geo.lng !== null ? db.raw('ST_MakePoint(?, ?)', [geo.lng, geo.lat]) : null,
      location_name:     geo.locationName,
      country_code:      geo.countryCode ?? null,
      region:            null,
      tags,
      language:          source.language,
      event_time:        eventTime,
    }, { lat: geo.lat, lng: geo.lng, sourceId: source.id, articleUrl: item.link || null })

    await redis.setex(key, DEDUP_TTL_S, '1')

    // (a skipped duplicate has no id: nothing to announce)
    if (signal?.id && producer) {
      await producer.send({
        topic:    'signals.verified',
        messages: [{
          key:   category,
          value: JSON.stringify({
            event:   'signal.new',
            payload: signal,
            filter:  { category, severity },
          }),
        }],
      }).catch(() => {})
    }

    return 'created'
  } catch (err) {
    // Expected for dedup constraint violations
    log.debug({ err, sourceId: source.id, title }, 'news-rss signal skipped (likely duplicate)')
    return 'none'
  }
}

// ─── REPAIR: PINS AT AN OUTLET'S OFFICE ──────────────────────────────────────

/**
 * Re-pins the past week's RSS signals that sit at their outlet's home
 * (Oct 11, 2026; see HOME_PIN_SOURCES): at the place the headline or summary
 * names, else at the home for national outlets, else no pin. GDACS alerts
 * also get their alert level's severity and a readable earthquake headline.
 * Bounded (5,000 rows) and idempotent: a row is changed only when the answer
 * differs, and a moved row no longer sits at a home.
 */
export async function repinNewsHomePins(db: Knex): Promise<{ moved: number; cleared: number; retitled: number }> {
  const homes = [...new Set(NEWS_SOURCE_REGISTRY.map(src => src.defaultLocation))]
  const found = await db.raw(
    `SELECT id, title, summary, tags, location_name, severity::text AS severity
       FROM signals
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND tags @> ARRAY['rss']::text[]
        AND location_name = ANY(?::text[])
      ORDER BY created_at DESC
      LIMIT 5000`,
    [homes],
  )
  const rows = ((found as { rows?: Array<{ id: string; title: string | null; summary: string | null; tags: unknown; location_name: string; severity: string }> })?.rows ?? [])
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(src => [src.id, src]))
  const totals = { moved: 0, cleared: 0, retitled: 0 }
  for (const row of rows) {
    const tags = Array.isArray(row.tags) ? row.tags.map(String) : []
    const source = tags.map(t => byId.get(t)).find((src): src is NewsSource => src !== undefined)
    if (!source || row.location_name !== source.defaultLocation || typeof row.title !== 'string') continue

    const summary = (row.summary ?? '').split(/\s+Source: /)[0] ?? ''
    const changes: Record<string, unknown> = {}
    if (source.id === 'gdacs') {
      const tidy = tidyGdacsTitle(decodeEntities(row.title))
      if (tidy.title !== row.title) changes.title = tidy.title
      const level = gdacsAlertLevel(row.title)
      if (level && gdacsSeverity(level) !== row.severity) changes.severity = gdacsSeverity(level)
    }
    const geo = inferGeo(row.title, summary, source)
    const atHome = geo.lat === source.defaultLat && geo.lng === source.defaultLng && geo.locationName === row.location_name
    if (!atHome) {
      changes.location      = geo.lat !== null && geo.lng !== null ? db.raw('ST_MakePoint(?, ?)', [geo.lng, geo.lat]) : null
      changes.location_name = geo.locationName
      changes.country_code  = geo.countryCode
    }
    if (Object.keys(changes).length === 0) continue
    await db('signals').where('id', row.id).update(changes)
    if (!atHome) { if (geo.lat === null) totals.cleared++; else totals.moved++ }
    if (changes.title) totals.retitled++
  }
  return totals
}

// ─── FEED FAILURES ───────────────────────────────────────────────────────────

const failKey  = (sourceId: string) => `news-rss:fail:${sourceId}`
const pauseKey = (sourceId: string) => `news-rss:pause:${sourceId}`
const whyKey   = (sourceId: string) => `news-rss:why:${sourceId}`

/**
 * Why a poll failed, as a fixed phrase for /ops-status.json and HQ (Oct 17,
 * 2026: the failing list said only "news feed", so nobody could tell a site
 * that turns our server away from a feed that moved). Never the raw error,
 * which carries the address.
 */
export function feedFailureWhy(reason: string): string {
  const r = reason.replace(/https?:\/\/\S+/g, '').toLowerCase()   // the address could match a word below
  const status = /\bhttp (\d{3})\b/.exec(r)?.[1]
  if (status === '401' || status === '403' || status === '429') return `turned away (${status})`
  if (status === '404' || status === '410') return `feed gone (${status})`
  if (status) return `answered ${status}`
  if (r.includes('timeout') || r.includes('timed out') || r.includes('etimedout')) return 'timed out'
  if (r.includes('enotfound') || r.includes('eai_again')) return 'address not found'
  if (r.includes('econnreset') || r.includes('socket hang up') || r.includes('epipe')) return 'connection cut'
  if (r.includes('econnrefused')) return 'connection refused'
  if (r.includes('cert') || r.includes('ssl') || r.includes('tls')) return 'certificate problem'
  if (r.includes('no items')) return 'not a feed (bot check or moved)'
  if (r.includes('empty response')) return 'empty answer'
  if (r.includes('redirect')) return 'redirect problem'
  if (r.includes('over ') && r.includes('bytes')) return 'too large'
  return 'other error'
}

export async function feedPaused(redis: Redis, sourceId: string): Promise<boolean> {
  try {
    return (await redis.exists(pauseKey(sourceId))) > 0
  } catch {
    return false
  }
}

/**
 * Count a failed poll. After FAILS_BEFORE_PAUSE in a row the feed is paused for
 * PAUSE_S, then tried once per pause until it works again. Every failure logs
 * the same message, so the pipeline stats can count them across feeds.
 */
export async function noteFeedFailure(
  redis:     Redis,
  source:    Pick<NewsSource, 'id' | 'feedUrl'>,
  sourceLog: Pick<typeof log, 'warn'>,
  reason:    string,
): Promise<void> {
  try {
    const fails = await redis.incr(failKey(source.id))
    await redis.expire(failKey(source.id), 7 * 86_400)
    await redis.set(whyKey(source.id), feedFailureWhy(reason), 'EX', 7 * 86_400)
    if (fails >= FAILS_BEFORE_PAUSE) {
      await redis.set(pauseKey(source.id), '1', 'EX', PAUSE_S)
      sourceLog.warn({ reason, fails, feedUrl: source.feedUrl }, 'News feed paused after repeated failures')
    } else {
      sourceLog.warn({ reason, fails, feedUrl: source.feedUrl }, 'News feed fetch failed')
    }
  } catch {
    sourceLog.warn({ reason, feedUrl: source.feedUrl }, 'News feed fetch failed')
  }
}

export async function clearFeedFailures(redis: Redis, sourceId: string): Promise<void> {
  try {
    await redis.del(failKey(sourceId), whyKey(sourceId))
  } catch {
    // best effort
  }
}

// ─── PARKED FEEDS ────────────────────────────────────────────────────────────
// Nov 5, 2026: six of the 19 failing feeds' sites answer every automated reader
// with a bot check, from any network. Each was read every 30 minutes, counted as
// failing, paused and tried again every 6 hours, for nothing, and kept the
// failing list long enough to hide a feed that had just broken. A parked feed
// (NewsSource.parked) is tried once a day instead, isn't counted as failing,
// and is read as usual for as long as it answers again.

const PARKED_TRY_S   = 86_400                // a parked feed that doesn't answer is tried once a day
const PARKED_WORKS_S = 7 * 86_400            // one that answers is read as usual, for a week from its last answer
const PARKED_SET     = 'news-rss:parked'     // the parked feeds, for /ops-status.json
const parkedTryKey   = (sourceId: string) => `news-rss:parked-try:${sourceId}`
const parkedWorksKey = (sourceId: string) => `news-rss:parked-works:${sourceId}`

/**
 * Whether a parked feed is read now: 'answering' while it answers again (read
 * as usual), 'daily-try' for its one try of the day, otherwise null.
 */
export async function parkedFeedDue(redis: Redis, sourceId: string): Promise<'answering' | 'daily-try' | null> {
  try {
    if ((await redis.exists(parkedWorksKey(sourceId))) > 0) return 'answering'
    return (await redis.set(parkedTryKey(sourceId), '1', 'EX', PARKED_TRY_S, 'NX')) === 'OK' ? 'daily-try' : null
  } catch {
    return null
  }
}

/** A parked feed answered (read it as usual) or didn't (back to once a day). */
export async function noteParkedResult(redis: Redis, sourceId: string, answered: boolean): Promise<void> {
  try {
    if (answered) await redis.set(parkedWorksKey(sourceId), '1', 'EX', PARKED_WORKS_S)
    else await redis.del(parkedWorksKey(sourceId))
  } catch {
    // best effort
  }
}

/**
 * When the poller starts: the parked feeds leave the failing list (their
 * failure counts, pauses and reasons are cleared) and are listed in
 * news-rss:parked for /ops-status.json. Returns how many feeds are parked.
 */
export async function noteParkedFeeds(
  redis:   Redis,
  sources: ReadonlyArray<Pick<NewsSource, 'id' | 'parked'>>,
): Promise<number> {
  const ids = sources.filter(s => s.parked).map(s => s.id)
  try {
    await redis.del(PARKED_SET)
    if (ids.length > 0) await redis.sadd(PARKED_SET, ...ids)
    for (const id of ids) await redis.del(failKey(id), pauseKey(id), whyKey(id))
  } catch {
    // best effort: the next start tries again
  }
  return ids.length
}

/**
 * Forget the failure counts and pauses of feeds that are no longer in the
 * registry. A removed feed is never polled again, so its count would sit in
 * ops-status.json's failing list for a week (Oct 14, 2026: 17 of the 21 feeds
 * listed there had been taken out). Runs when the poller starts, which is every
 * deploy. Returns how many feeds it forgot.
 */
export async function forgetRemovedFeeds(redis: Redis, keep: Iterable<string>): Promise<number> {
  const live = new Set(keep)
  const gone = new Set<string>()
  try {
    for (const prefix of ['news-rss:fail:', 'news-rss:pause:', 'news-rss:why:']) {
      let cursor = '0'
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
        cursor = next
        for (const key of keys) {
          const id = key.slice(prefix.length)
          if (live.has(id)) continue
          await redis.del(key)
          gone.add(id)
        }
      } while (cursor !== '0')
    }
  } catch {
    // best effort: a count also expires a week after its feed's last failure
  }
  return gone.size
}

// ─── POLL ONE SOURCE ─────────────────────────────────────────────────────────

async function pollSource(
  db:       Knex,
  redis:    Redis,
  producer: Producer | null | undefined,
  source:   NewsSource,
): Promise<void> {
  const sourceLog = log.child({ sourceId: source.id, feed: source.name })
  // A parked feed (behind a bot check) is read while it answers again, else once a day
  const parked = source.parked ? await parkedFeedDue(redis, source.id) : null
  if (source.parked && !parked) return
  if (!source.parked && await feedPaused(redis, source.id)) {
    sourceLog.debug(`${source.name}: paused after repeated failures`)
    return
  }
  sourceLog.debug(`Polling ${source.name}...`)

  // A parked feed's failed reads aren't counted: it goes back to one try a day
  const failed = async (reason: string): Promise<void> => {
    if (!source.parked) return noteFeedFailure(redis, source, sourceLog, reason)
    await noteParkedResult(redis, source.id, false)
    sourceLog.debug({ reason: feedFailureWhy(reason) }, `${source.name}: parked feed still not answering`)
  }

  let xml: string
  try {
    xml = await fetchUrl(source.feedUrl)
  } catch (err) {
    await failed(err instanceof Error ? err.message : String(err))
    return
  }

  if (!xml || xml.length < 50) {
    await failed('empty response')
    return
  }

  const items = parseFeedItems(xml)
  if (items.length === 0) {
    // A page that isn't a feed (moved feed, bot check) parses to nothing
    await failed('no items in the response')
    return
  }
  if (source.parked) {
    await noteParkedResult(redis, source.id, true)
    if (parked === 'daily-try') sourceLog.info(`${source.name}: parked feed answered; read as usual while it does`)
  } else {
    await clearFeedFailures(redis, source.id)
  }

  let created = 0
  let stale = 0
  for (const item of items) {
    if (skippedLink(source, item.link)) continue
    const result = await processItem(db, redis, producer, source, item)
    if (result === 'created') created++
    else if (result === 'stale') stale++
  }
  if (stale > 0) {
    // Logged once per item (they're remembered): a feed that only lists old stories shows up here
    sourceLog.info({ stale, total: items.length }, 'News feed items skipped as old')
  }

  if (created > 0) {
    sourceLog.info({ created, total: items.length }, `${source.name}: ${created} new signals`)
  } else {
    sourceLog.debug({ total: items.length }, `${source.name}: poll complete (no new items)`)
  }
}

/** An item from a section of its feed the reader skips (NewsSource.skipLinks) */
export function skippedLink(source: Pick<NewsSource, 'skipLinks'>, link: string | null | undefined): boolean {
  return Boolean(source.skipLinks && link && source.skipLinks.test(link))
}

// ─── MAIN POLLER ─────────────────────────────────────────────────────────────

/**
 * Start the global news RSS poller.
 *
 * Polls all registered news outlets every 30 minutes, READ_AT_ONCE at a
 * time, with a pause between rounds paced so a whole pass ends within
 * CYCLE_BUDGET (cyclePause). Returns a cleanup function.
 */
export function startNewsRssPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  const delay = sourceDelay(NEWS_SOURCE_REGISTRY.length)

  /**
   * Run a full poll cycle across all sources, READ_AT_ONCE at a time, paced to
   * end within CYCLE_BUDGET of the cycle's start (cyclePause).
   */
  async function pollAll(): Promise<void> {
    if (stopped) return
    const started = Date.now()

    // Carry on with a cycle a restart interrupted (cycleStart)
    let saved: CyclePlace | null = null
    try {
      const raw = await redis.get(CYCLE_KEY)
      saved = raw ? JSON.parse(raw) as CyclePlace : null
    } catch { saved = null }
    const { index: startAt, startedAt } = cycleStart(saved, NEWS_SOURCE_REGISTRY.map(s => s.id), Date.now())
    // A cycle carried on after a restart keeps its own start, so it still ends on time
    const budgetEnd = startedAt + CYCLE_BUDGET

    log.info(
      { sources: NEWS_SOURCE_REGISTRY.length, maxPauseMs: delay, budgetMin: CYCLE_BUDGET / 60_000, ...(startAt > 0 ? { resumeAt: startAt } : {}) },
      startAt > 0 ? '📰 News RSS: carrying on with the poll cycle a restart interrupted' : '📰 News RSS: starting poll cycle',
    )

    let roundMs = 0, read = 0
    const rounds = readRounds(NEWS_SOURCE_REGISTRY.length, startAt)
    for (let r = 0; r < rounds.length; r++) {
      if (stopped) break
      const [from, to] = rounds[r]!
      const batch = NEWS_SOURCE_REGISTRY.slice(from, to)
      // Where the cycle is, before the round: a restart during it reads these feeds again rather than skipping them
      await redis.set(CYCLE_KEY, JSON.stringify({ startedAt, nextId: batch[0]!.id }), 'EX', CYCLE_RESUME_MS / 1000).catch(() => {})
      const t0 = Date.now()
      await Promise.all(batch.map(source => pollSource(db, redis, producer, source).catch(err =>
        log.warn({ err, sourceId: source.id }, 'News feed poll error'),
      )))
      roundMs += Date.now() - t0; read += batch.length
      // A pause between rounds, shorter when the cycle runs behind (each feed is on its own host)
      if (!stopped) {
        const pause = Math.min(delay, cyclePause(rounds.length - r - 1, budgetEnd - Date.now(), roundMs / (r + 1)))
        await new Promise<void>(resolve => setTimeout(resolve, pause))
      }
    }

    if (!stopped) {
      await redis.del(CYCLE_KEY).catch(() => {})
      const done = Math.ceil(read / READ_AT_ONCE)
      log.info({ minutes: Math.round((Date.now() - started) / 6_000) / 10, feeds: read, atOnce: READ_AT_ONCE, avgRoundMs: done ? Math.round(roundMs / done) : null }, '📰 News RSS: poll cycle complete')
    }
  }

  const runCycle = oneCycleAtATime(pollAll, () =>
    log.warn('📰 News RSS: the last poll cycle is still running; this start is skipped'),
  )

  // Feeds taken out of the registry stop counting as failing
  void forgetRemovedFeeds(redis, NEWS_SOURCE_REGISTRY.map(s => s.id)).then(n => {
    if (n > 0) log.info({ feeds: n }, 'News RSS: forgot the failure counts of feeds no longer listed')
  })
  // Feeds parked behind a bot check leave the failing list; they're tried once a day
  void noteParkedFeeds(redis, NEWS_SOURCE_REGISTRY).then(n => {
    if (n > 0) log.info({ feeds: n }, 'News RSS: feeds parked behind a bot check are tried once a day')
  })
  // Places with few feeds of their own get the same-story second look across two days (correlate.ts)
  setThinPlaces(thinPlaces())
  // The Dev Room's coverage map: each place's feeds, for /ops-status.json (coverage.ts); again with every
  // cycle, so the numbers are back within one cycle if Redis loses them
  void noteCoverage(redis, NEWS_SOURCE_REGISTRY)

  // Kick off immediately
  void runCycle()

  // Then on a fixed interval
  timer = setInterval(() => {
    void runCycle()
    void noteCoverage(redis, NEWS_SOURCE_REGISTRY)
  }, POLL_INTERVAL)

  log.info(
    {
      sourceCount:     NEWS_SOURCE_REGISTRY.length,
      pollIntervalMin: POLL_INTERVAL / 60_000,
      staggerSec:      delay / 1000,
    },
    `📰 News RSS poller started — ${NEWS_SOURCE_REGISTRY.length} international outlets`,
  )

  return () => {
    stopped = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    log.info('News RSS poller stopped')
  }
}
