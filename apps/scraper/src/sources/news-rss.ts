/**
 * WorldPulse Global News RSS Adapter
 *
 * Ingests 130+ international news RSS feeds and creates WorldPulse signals from
 * breaking/world news items. Provides editorial-sourced signal coverage to
 * complement the OSINT/sensor feeds already in the pipeline.
 *
 * Tier 1 — Wire services & flagship broadcasters:
 *   BBC World, NHK World, NPR, Deutsche Welle, UN News
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
 *   Xinhua (EN), TASS (EN)
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
// Feed items published more than 3 days ago aren't news
import { MAX_ITEM_AGE_MS, isStaleItem } from '../pipeline/freshness'
// Feeds send "&#x27;" and "&amp;" in titles and summaries
import { decodeEntities, cleanSummary } from '../pipeline/text'
import { placeFromText } from '../pipeline/geo'
import { rateSeverity } from '../pipeline/severity'
import { gdacsAlertLevel, gdacsSeverity, gdacsTags, tidyGdacsTitle } from './gdacs'
export { MAX_ITEM_AGE_MS, isStaleItem, decodeEntities }

const log = rootLogger.child({ module: 'news-rss-source' })

// Longer than MAX_ITEM_AGE_MS, so an item is never processed twice while it's
// young enough to be news. With 24 hours, an item still in its feed a day later
// could come back as a new signal (the title check in insert-signal.ts only
// looks back 6 hours).
const DEDUP_TTL_S   = 4 * 24 * 3_600      // 4 days
const POLL_INTERVAL = 30 * 60_000         // 30 minutes between full cycles
const SOURCE_DELAY  = 5_000               // 5 s stagger between sources
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
    id:              'nhk-world',
    name:            'NHK World News',
    feedUrl:         'https://www3.nhk.or.jp/rss/news/cat0.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.89,
    countryCode:     'JP',
    defaultLat:      35.68,
    defaultLng:      139.69,
    defaultLocation: 'Tokyo, Japan',
    extraTags:       ['nhk', 'japan', 'asia-pacific'],
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
    id:              'middle-east-eye',
    name:            'Middle East Eye',
    feedUrl:         'https://www.middleeasteye.net/rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.74,
    countryCode:     'GB',
    defaultLat:      25.20,
    defaultLng:      45.08,
    defaultLocation: 'Middle East / North Africa',
    extraTags:       ['mee', 'middle-east', 'mena'],
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
  {
    id:              'east-african',
    name:            'The East African',
    feedUrl:         'https://www.theeastafrican.co.ke/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'KE',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['east-african', 'east-africa', 'africa'],
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
    id:              'arab-news',
    name:            'Arab News',
    feedUrl:         'https://www.arabnews.com/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.74,
    countryCode:     'SA',
    defaultLat:      24.69,
    defaultLng:      46.72,
    defaultLocation: 'Riyadh, Saudi Arabia',
    extraTags:       ['arab-news', 'saudi-arabia', 'middle-east'],
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
    id:              'euractiv',
    name:            'EURACTIV',
    feedUrl:         'https://www.euractiv.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'BE',
    defaultLat:      50.85,
    defaultLng:      4.35,
    defaultLocation: 'Brussels, Belgium',
    extraTags:       ['euractiv', 'europe', 'eu-policy', 'brussels'],
    language:        'en',
  },
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
    id:              'bangkok-post',
    name:            'Bangkok Post',
    feedUrl:         'https://www.bangkokpost.com/rss/data/topstories.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'TH',
    defaultLat:      13.75,
    defaultLng:      100.52,
    defaultLocation: 'Bangkok, Thailand',
    extraTags:       ['bangkok-post', 'thailand', 'southeast-asia'],
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
    id:              'xinhua-en',
    name:            'Xinhua News (English)',
    feedUrl:         'http://www.xinhuanet.com/english/rss/worldrss.xml',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.48,
    countryCode:     'CN',
    defaultLat:      39.91,
    defaultLng:      116.39,
    defaultLocation: 'Beijing, China',
    extraTags:       ['xinhua', 'china', 'state-media', 'ccp-affiliated'],
    language:        'en',
  },
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
    id:              'barrons-markets',
    name:            "Barron's Markets",
    feedUrl:         'https://www.barrons.com/feed',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['barrons', 'markets', 'finance', 'investing', 'wall-street'],
    language:        'en',
  },
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
    id:              'cnn-markets',
    name:            'CNN Business',
    feedUrl:         'http://rss.cnn.com/rss/money_latest.rss',
    category:        'finance',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      33.75,
    defaultLng:      -84.39,
    defaultLocation: 'Atlanta, United States',
    extraTags:       ['cnn', 'markets', 'finance', 'business', 'economy'],
    language:        'en',
  },
  {
    id:              'thestreet-markets',
    name:            'TheStreet Markets',
    feedUrl:         'https://www.thestreet.com/feeds/rss/markets',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['thestreet', 'markets', 'finance', 'stocks', 'investing'],
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
    feedUrl:         'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
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
    id:              'nation-africa-ke',
    name:            'Nation Africa (Kenya)',
    feedUrl:         'https://nation.africa/kenya/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'KE',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['nation-africa', 'kenya', 'east-africa', 'africa'],
    language:        'en',
  },
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
    id:              'africa-report',
    name:            'The Africa Report',
    feedUrl:         'https://www.theafricareport.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'SN',
    defaultLat:      14.69,
    defaultLng:      -17.45,
    defaultLocation: 'Dakar, Senegal',
    extraTags:       ['africa-report', 'africa', 'pan-african', 'business'],
    language:        'en',
  },
  {
    id:              'ahram-online',
    name:            'Ahram Online (Egypt)',
    feedUrl:         'https://english.ahram.org.eg/rss.aspx',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'EG',
    defaultLat:      30.06,
    defaultLng:      31.25,
    defaultLocation: 'Cairo, Egypt',
    extraTags:       ['ahram', 'egypt', 'north-africa', 'mena'],
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
    id:              'ethiopia-reporter',
    name:            'The Reporter Ethiopia',
    feedUrl:         'https://www.thereporterethiopia.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'ET',
    defaultLat:      9.02,
    defaultLng:      38.75,
    defaultLocation: 'Addis Ababa, Ethiopia',
    extraTags:       ['reporter-ethiopia', 'ethiopia', 'horn-of-africa', 'africa'],
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
    id:              'islands-business',
    name:            'Islands Business (Pacific)',
    feedUrl:         'https://www.islandsbusiness.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'FJ',
    defaultLat:      -18.14,
    defaultLng:      178.44,
    defaultLocation: 'Suva, Fiji',
    extraTags:       ['islands-business', 'fiji', 'pacific', 'pacific-islands'],
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
    id:              'renewableenergyworld',
    name:            'Renewable Energy World',
    feedUrl:         'https://www.renewableenergyworld.com/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['renewable-energy', 'clean-energy', 'climate', 'solar', 'wind'],
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
  {
    id:              'iea-news',
    name:            'IEA News',
    feedUrl:         'https://www.iea.org/news/rss',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'FR',
    defaultLat:      48.85,
    defaultLng:      2.35,
    defaultLocation: 'Paris, France',
    extraTags:       ['iea', 'energy-agency', 'climate', 'energy-policy', 'international'],
    language:        'en',
  },
  // ── Tier 5 — Scientific Journals & Research ───────────────────────────────
  {
    id:              'nature-news',
    name:            'Nature News & Comment',
    feedUrl:         'https://www.nature.com/nature.rss',
    category:        'science',
    biasLabel:       'center',
    reliability:     0.97,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['nature', 'science', 'research', 'peer-reviewed', 'academic'],
    language:        'en',
  },
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
    id:              'lawfare-blog',
    name:            'Lawfare',
    feedUrl:         'https://www.lawfaremedia.org/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.86,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., United States',
    extraTags:       ['lawfare', 'national-security', 'law', 'policy', 'intelligence'],
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
  {
    id:              'arab-weekly',
    name:            'The Arab Weekly',
    feedUrl:         'https://thearabweekly.com/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'GB',
    defaultLat:      23.42,
    defaultLng:      41.00,
    defaultLocation: 'Middle East / North Africa',
    extraTags:       ['arab-weekly', 'arab-world', 'middle-east', 'mena'],
    language:        'en',
  },
  {
    id:              'georgia-today',
    name:            'Georgia Today',
    feedUrl:         'https://georgiatoday.ge/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.71,
    countryCode:     'GE',
    defaultLat:      41.69,
    defaultLng:      44.83,
    defaultLocation: 'Tbilisi, Georgia',
    extraTags:       ['georgia-today', 'georgia', 'caucasus', 'eastern-europe'],
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
    id:              'hellenic-shipping-news',
    name:            'Hellenic Shipping News',
    feedUrl:         'https://www.hellenicshippingnews.com/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'GR',
    defaultLat:      37.98,
    defaultLng:      23.73,
    defaultLocation: 'Athens, Greece',
    extraTags:       ['maritime', 'shipping', 'tanker', 'dry-bulk', 'freight-rates', 'trade'],
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
  {
    id:              'maritime-global-security',
    name:            'Maritime Global Security',
    feedUrl:         'https://maritimeglobalsecurity.org/feed/',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.11,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['maritime', 'piracy', 'security', 'naval', 'chokepoints', 'red-sea', 'houthi'],
    language:        'en',
  },
  // ── Maritime: Naval & Defense ──────────────────────────────────────────────
  {
    id:              'naval-news',
    name:            'Naval News',
    feedUrl:         'https://www.navalnews.com/feed/',
    category:        'military',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'FR',
    defaultLat:      48.86,
    defaultLng:      2.35,
    defaultLocation: 'Paris, France',
    extraTags:       ['maritime', 'naval', 'defense', 'submarines', 'warships', 'military'],
    language:        'en',
  },
  {
    id:              'usni-news',
    name:            'USNI News',
    feedUrl:         'https://news.usni.org/feed',
    category:        'military',
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
    id:              'port-technology',
    name:            'Port Technology International',
    feedUrl:         'https://www.porttechnology.org/feed/',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'GB',
    defaultLat:      51.51,
    defaultLng:      -0.11,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['maritime', 'ports', 'logistics', 'automation', 'supply-chain', 'chokepoints'],
    language:        'en',
  },
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
    id:              'who-news',
    name:            'WHO News',
    feedUrl:         'https://www.who.int/rss-feeds/news-english.xml',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.92,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.15,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['who', 'health', 'pandemic', 'global-health', 'institutional'],
    language:        'en',
  },
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
    id:              'iiss-blog',
    name:            'IISS Analysis',
    feedUrl:         'https://www.iiss.org/rss/',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.14,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['iiss', 'conflict', 'defense', 'military', 'analysis'],
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
    id:              'reliefweb-updates',
    name:            'ReliefWeb Updates',
    feedUrl:         'https://reliefweb.int/updates/rss.xml',
    category:        'disaster',
    biasLabel:       'center',
    reliability:     0.91,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, United States',
    extraTags:       ['reliefweb', 'humanitarian', 'disaster', 'un', 'crisis'],
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
    id:              'cnn-world',
    name:            'CNN World',
    feedUrl:         'http://rss.cnn.com/rss/edition_world.rss',
    category:        'breaking',
    biasLabel:       'center-left',
    reliability:     0.83,
    countryCode:     'US',
    defaultLat:      33.76,
    defaultLng:      -84.39,
    defaultLocation: 'Atlanta, United States',
    extraTags:       ['cnn', 'wire-syndication', 'ap-reuters', 'breaking'],
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
 * Override the source's default category based on article keywords.
 * Allows a geopolitics outlet (e.g. BBC) to generate a 'health' signal
 * if the article is about a disease outbreak.
 */
export function detectNewsCategory(
  title:           string,
  description:     string,
  sourceDefault:   Category,
): Category {
  const text = `${title} ${description}`.toLowerCase()

  if (/\b(pandemic|outbreak|virus|disease|epidemic|vaccine|world\s+health\s+organi[sz]ation|health\s+emergency|pathogen|mpox|ebola|flu|covid)\b/.test(text))
    return toCategory('health')
  if (/\b(earthquake|tsunami|hurricane|typhoon|cyclone|wildfire|flood|eruption|volcano|tornado|blizzard|drought|disaster)\b/.test(text))
    return toCategory('disaster')
  if (/\b(elections?|votes?|voting|ballots?|democracy|referendum|polls?|candidates?|campaigns?|inauguration)\b/.test(text))
    return toCategory('elections')
  if (/\b(stock\s+market|recession|inflation|gdp|central\s+bank|interest\s+rate|economy|trade\s+war|tariff|sanction|oil\s+price|crypto)\b/.test(text))
    return toCategory('economy')
  // Space before technology, which also names SpaceX and NASA. No bare "moon"
  // ("Moon Jae-in", "Ban Ki-moon") or "mars" (the chocolate company)
  if (/\b(space\s+launch|rockets?|satellites?|iss|international\s+space\s+station|lunar|moon\s+(?:landing|mission|base)|(?:to|on)\s+mars|mars\s+(?:rover|mission|landing)|nasa|esa|spacex|boeing\s+starliner|astronauts?)\b/.test(text))
    return toCategory('space')
  if (/\b(ai\s+|artificial\s+intelligence|cybersecurity|hack|data\s+breach|tech\s+giant|silicon\s+valley|openai)\b/.test(text))
    return toCategory('technology')
  if (/\b(climate\s+change|global\s+warming|carbon|emissions|cop[0-9]+|fossil\s+fuel|renewable\s+energy|deforestation)\b/.test(text))
    return toCategory('climate')
  if (/\b(war|invasion|airstrike|missile|troops|military|casualties|conflict|nato|ceasefire|bombing|killed|shelling)\b/.test(text))
    return toCategory('conflict')
  if (/\b(cyber\s+attack|ransomware|malware|espionage|spy|intelligence|terror)\b/.test(text))
    return toCategory('security')

  return sourceDefault
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

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
        'User-Agent':      'WorldPulse/1.0 (open-source global intelligence; https://worldpulse.io)',
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
      body.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')))
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
        // Try CDATA first, then plain content, then attribute href
        const re = new RegExp(
          `<${tag}[^>]*(?:href="([^"]*)")?[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>|<${tag}[^>]*href="([^"]*)"[^>]*\\/?>`,
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
      pubDate:     extract(['pubDate', 'published', 'updated', 'dc:date']),
      description: extract(['description', 'summary', 'content', 'content:encoded']),
      point:       feedPoint(block),
      alertLevel:  extract(['gdacs:alertlevel']) || undefined,
    })
  }

  return items.slice(0, MAX_ITEMS)
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
  { keywords: ['ukraine', 'kyiv', 'zaporizhzhia', 'kharkiv'],      geo: { lat: 50.45,  lng: 30.52,   name: 'Ukraine',          code: 'UA' } },
  { keywords: ['russia', 'moscow', 'kremlin'],                      geo: { lat: 55.75,  lng: 37.62,   name: 'Moscow, Russia',   code: 'RU' } },
  { keywords: ['israel', 'tel aviv', 'jerusalem', 'idf'],           geo: { lat: 31.77,  lng: 35.22,   name: 'Israel',           code: 'IL' } },
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
function hintMatches(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const end = keyword.length <= 3 ? '(?![a-z0-9])' : ''
  return new RegExp(`(?<![a-z0-9])${escaped}${end}`).test(text)
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
  'arab-news', 'folha-sao-paulo', 'moscow-times', 'taipei-times', 'dawn-pakistan', 'premium-times-nigeria',
  'bangkok-post', 'nation-africa-ke', 'punch-nigeria', 'businessday-ng', 'ahram-online', 'mail-guardian-za',
  'vanguard-ng', 'daily-trust-ng', 'ethiopia-reporter', 'graphic-online-gh', 'nst-malaysia',
  'philippine-inquirer', 'vnexpress-intl', 'myanmar-now', 'irrawaddy', 'agencia-publica', 'ciper-chile',
  'la-silla-vacia', 'rnz-national', 'georgia-today', 'ecb-press', 'fed-press',
])

export interface InferredGeo {
  lat: number | null
  lng: number | null
  locationName: string | null
  countryCode: string | null
}

function fromHints(text: string): InferredGeo | null {
  const lower = text.toLowerCase()
  for (const { keywords, geo } of GEO_HINTS) {
    if (keywords.some(kw => hintMatches(lower, kw))) {
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
  if (point) {
    const named = fromPlace(title)
    return { lat: point.lat, lng: point.lng, locationName: named?.locationName ?? null, countryCode: named?.countryCode ?? null }
  }
  const found = fromPlace(title) ?? fromHints(title) ?? fromPlace(description) ?? fromHints(description)
  if (found) return found
  if (HOME_PIN_SOURCES.has(source.id)) {
    return { lat: source.defaultLat, lng: source.defaultLng, locationName: source.defaultLocation, countryCode: source.countryCode }
  }
  return { lat: null, lng: null, locationName: null, countryCode: null }
}

// ─── SIGNAL CREATION ──────────────────────────────────────────────────────────

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

  // GDACS alerts: severity from the alert level, a readable earthquake headline
  const alert       = source.id === 'gdacs' ? gdacsAlertLevel(item.title, item.alertLevel) : null
  const gdacs       = source.id === 'gdacs' ? tidyGdacsTitle(decodeEntities(item.title)) : null
  const title       = (gdacs?.title ?? decodeEntities(item.title)).slice(0, 500) || `${source.name} — news item`
  const category    = detectNewsCategory(item.title, item.description, source.category)
  const severity    = alert ? gdacsSeverity(alert) : detectNewsSeverity(decodeEntities(item.title), item.description, category)
  const found       = inferGeo(item.title, item.description, source, item.point)
  const geo         = gdacs?.place && !found.locationName ? { ...found, locationName: gdacs.place } : found

  const pubDate  = item.pubDate ? new Date(item.pubDate) : new Date()
  const eventTime = isNaN(pubDate.getTime()) ? new Date() : pubDate

  const summary = [
    item.description
      ? cleanSummary(decodeEntities(item.description.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ')).slice(0, 600) || `${title}.`
      : `${title}.`,
    `Source: ${source.name} (reliability: ${(source.reliability * 100).toFixed(0)}%, bias: ${source.biasLabel}).`,
    source.biasLabel === 'state-media'
      ? `⚠️ This outlet is state-controlled and may reflect official government positions.`
      : '',
  ].filter(Boolean).join(' ')

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
    }, { lat: geo.lat, lng: geo.lng, sourceId: source.id })

    await redis.setex(key, DEDUP_TTL_S, '1')

    if (signal && producer) {
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
    await redis.del(failKey(sourceId))
  } catch {
    // best effort
  }
}

// ─── POLL ONE SOURCE ─────────────────────────────────────────────────────────

async function pollSource(
  db:       Knex,
  redis:    Redis,
  producer: Producer | null | undefined,
  source:   NewsSource,
): Promise<void> {
  const sourceLog = log.child({ sourceId: source.id, feed: source.name })
  if (await feedPaused(redis, source.id)) {
    sourceLog.debug(`${source.name}: paused after repeated failures`)
    return
  }
  sourceLog.debug(`Polling ${source.name}...`)

  let xml: string
  try {
    xml = await fetchUrl(source.feedUrl)
  } catch (err) {
    await noteFeedFailure(redis, source, sourceLog, err instanceof Error ? err.message : String(err))
    return
  }

  if (!xml || xml.length < 50) {
    await noteFeedFailure(redis, source, sourceLog, 'empty response')
    return
  }

  const items = parseFeedItems(xml)
  if (items.length === 0) {
    // A page that isn't a feed (moved feed, bot check) parses to nothing
    await noteFeedFailure(redis, source, sourceLog, 'no items in the response')
    return
  }
  await clearFeedFailures(redis, source.id)

  let created = 0
  let stale = 0
  for (const item of items) {
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

// ─── MAIN POLLER ─────────────────────────────────────────────────────────────

/**
 * Start the global news RSS poller.
 *
 * Polls all registered news outlets every 30 minutes in staggered sequence
 * (5 s between sources) to distribute load. Returns a cleanup function.
 */
export function startNewsRssPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  /**
   * Run a full poll cycle across all sources.
   * Each source is polled sequentially with SOURCE_DELAY ms between them.
   */
  async function runCycle(): Promise<void> {
    if (stopped) return

    log.info(
      { sources: NEWS_SOURCE_REGISTRY.length },
      '📰 News RSS: starting poll cycle',
    )

    for (const source of NEWS_SOURCE_REGISTRY) {
      if (stopped) break
      await pollSource(db, redis, producer, source).catch(err =>
        log.warn({ err, sourceId: source.id }, 'News feed poll error'),
      )
      // Stagger requests to be a good citizen with upstream RSS servers
      if (!stopped) {
        await new Promise<void>(resolve => setTimeout(resolve, SOURCE_DELAY))
      }
    }

    if (!stopped) {
      log.debug('📰 News RSS: poll cycle complete')
    }
  }

  // Kick off immediately
  void runCycle()

  // Then on a fixed interval
  timer = setInterval(() => void runCycle(), POLL_INTERVAL)

  log.info(
    {
      sourceCount:     NEWS_SOURCE_REGISTRY.length,
      pollIntervalMin: POLL_INTERVAL / 60_000,
      staggerSec:      SOURCE_DELAY / 1000,
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
