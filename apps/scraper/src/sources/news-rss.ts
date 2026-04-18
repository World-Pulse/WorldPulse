/**
 * WorldPulse Global News RSS Adapter
 *
 * Ingests 108 international news RSS feeds and creates WorldPulse signals from
 * breaking/world news items. Provides editorial-sourced signal coverage to
 * complement the OSINT/sensor feeds already in the pipeline.
 *
 * Tier 1 — Wire services & flagship broadcasters:
 *   BBC World, Reuters, AP News, NHK World, NPR, Deutsche Welle, UN News
 * Tier 2 — Strong independent international outlets:
 *   Al Jazeera, The Guardian, France24, Euronews, Japan Times, Straits Times,
 *   The Hindu, SCMP, VOA, Kyiv Independent, Middle East Eye, Haaretz,
 *   Times of India, Sydney Morning Herald, DW Africa, The East African
 * Tier 2b — Regional & emerging-market outlets:
 *   Le Monde, Der Spiegel Intl, El País (EN), The Wire India, Daily Maverick,
 *   Nikkei Asia, Arab News, AllAfrica, Folha de S.Paulo, The Conversation,
 *   EURACTIV, Moscow Times, Taipei Times, Dawn Pakistan, Premium Times Nigeria,
 *   Bangkok Post, Jakarta Post, Al-Monitor, EUobserver, Africanews, RFE/RL,
 *   Caixin Global, Asia Times, Channel NewsAsia
 * Tier 3 — State-controlled media (lower reliability, flagged):
 *   Xinhua (EN), TASS (EN)
 * Tier 4 — Financial intelligence:
 *   Reuters Business, Bloomberg Markets, FT, MarketWatch, CoinDesk,
 *   The Block, ECB, Federal Reserve
 * Tier 4b — Premium finance (expanded):
 *   Barron's, CNBC Markets, CNN Business, TheStreet, Investing.com,
 *   WSJ Markets, Forbes Money, Bloomberg Businessweek, Reuters Markets Wire
 * Tier 5 — Expanded regional & specialist coverage (50 new feeds, cycle 10):
 *   Africa: Nation Africa (KE), The Punch (NG), BusinessDay (NG),
 *     The Africa Report, Ahram Online (EG), Mail & Guardian (ZA),
 *     Vanguard (NG), Daily Trust (NG), The Reporter Ethiopia,
 *     Graphic Online (GH)
 *   SE Asia business: NST Malaysia, Philippine Daily Inquirer, VnExpress Intl,
 *     Myanmar Now, Vietnam News
 *   LatAm investigative: Animal Político (MX), Agência Pública (BR),
 *     El Faro (SV), CIPER Chile, La Silla Vacía (CO)
 *   Pacific: RNZ Pacific, Islands Business (FJ), ABC Pacific, RNZ National
 *   Climate/energy: Carbon Brief, Climate Home News, Renewable Energy World,
 *     OilPrice.com, Solar Power World, pv magazine, IEA News
 *   Science: Nature News, New Scientist, Phys.org, ScienceDaily,
 *     MIT Technology Review
 *   Defense/security: War on the Rocks, Bellingcat, Lawfare, Breaking Defense,
 *     Just Security
 *   Other: Balkan Insight, OCCRP, The Irrawaddy, The Diplomat, Eurasia Review,
 *     The News Lens Intl, WION, The Arab Weekly, Georgia Today
 *
 * Reliability scores reflect editorial independence, fact-check track records,
 * and MBFC/NewsGuard ratings. State-controlled outlets (Xinhua, TASS,
 * Vietnam News) are tagged "state-media" and assigned lower reliability.
 *
 * Polling: staggered 30-min intervals (sources polled sequentially, 5 s apart)
 * Dedup: Redis key with 24-hour TTL per article URL
 */

import https from 'node:https'
import http  from 'node:http'
import type { Knex }     from 'knex'
import type Redis        from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'news-rss-source' })

const DEDUP_TTL_S   = 24 * 3_600          // 24 hours
const POLL_INTERVAL = 30 * 60_000         // 30 minutes between full cycles
const SOURCE_DELAY  = 5_000               // 5 s stagger between sources
const MAX_ITEMS     = 20                  // max signals per source per poll

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
    id:              'reuters-world',
    name:            'Reuters World News',
    feedUrl:         'https://feeds.reuters.com/reuters/worldNews',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['reuters', 'wire-service'],
    language:        'en',
  },
  {
    id:              'ap-news',
    name:            'AP News — Top Headlines',
    feedUrl:         'https://feeds.apnews.com/rss/apf-topnews',
    category:        'breaking',
    biasLabel:       'center',
    reliability:     0.94,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['ap', 'wire-service'],
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
    name:            'UN News — Top Stories',
    feedUrl:         'https://news.un.org/feed/subscribe/en/news/topic/top-stories/feed/rss.xml',
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
    feedUrl:         'https://www.straitstimes.com/global/rss.xml',
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
    feedUrl:         'https://www.thehindu.com/news/international/rssfeed/?id=526517',
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
    feedUrl:         'https://kyivindependent.com/rss',
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
    feedUrl:         'https://www.haaretz.com/srv/haaretz-en.xml',
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
    feedUrl:         'https://www.theeastafrican.co.ke/tea/rss',
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
    id:              'the-wire-india',
    name:            'The Wire — India',
    feedUrl:         'https://thewire.in/rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.80,
    countryCode:     'IN',
    defaultLat:      28.61,
    defaultLng:      77.21,
    defaultLocation: 'New Delhi, India',
    extraTags:       ['the-wire', 'india', 'south-asia'],
    language:        'en',
  },
  {
    id:              'daily-maverick',
    name:            'Daily Maverick',
    feedUrl:         'https://www.dailymaverick.co.za/rss/world/',
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
    feedUrl:         'https://allafrica.com/tools/headlines/rdf/latest/2000.rdf',
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
    id:              'jakarta-post',
    name:            'The Jakarta Post',
    feedUrl:         'https://www.thejakartapost.com/news.rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.77,
    countryCode:     'ID',
    defaultLat:      -6.21,
    defaultLng:      106.85,
    defaultLocation: 'Jakarta, Indonesia',
    extraTags:       ['jakarta-post', 'indonesia', 'southeast-asia'],
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
    feedUrl:         'https://euobserver.com/feed.rss',
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
    feedUrl:         'https://www.africanews.com/rss/',
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
    feedUrl:         'https://www.rferl.org/api/zrqosovruqos/rss',
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
    id:              'caixin-global',
    name:            'Caixin Global',
    feedUrl:         'https://www.caixinglobal.com/rss/index.xml',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.79,
    countryCode:     'CN',
    defaultLat:      39.91,
    defaultLng:      116.39,
    defaultLocation: 'Beijing, China',
    extraTags:       ['caixin', 'china', 'economy', 'business', 'east-asia'],
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
    id:              'reuters-markets',
    name:            'Reuters Business',
    feedUrl:         'https://feeds.reuters.com/reuters/businessNews',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['reuters', 'markets', 'finance', 'business'],
    language:        'en',
  },
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
    name:            'Forbes Money',
    feedUrl:         'https://www.forbes.com/money/feed/',
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
  {
    id:              'bloomberg-businessweek',
    name:            'Bloomberg Businessweek',
    feedUrl:         'https://feeds.bloomberg.com/businessweek/news.rss',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'US',
    defaultLat:      40.71,
    defaultLng:      -74.01,
    defaultLocation: 'New York, United States',
    extraTags:       ['bloomberg', 'businessweek', 'finance', 'business', 'economy'],
    language:        'en',
  },
  {
    id:              'reuters-markets-wire',
    name:            'Reuters Markets Wire',
    feedUrl:         'https://feeds.reuters.com/reuters/companyNews',
    category:        'finance',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['reuters', 'markets', 'corporate', 'earnings', 'finance'],
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
    feedUrl:         'https://mg.co.za/feed/',
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
    feedUrl:         'https://www.thereporterethiopia.com/rss',
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
    feedUrl:         'https://www.graphic.com.gh/rss',
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
    feedUrl:         'https://www.nst.com.my/rss/news',
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
  {
    id:              'vietnam-news-vna',
    name:            'Vietnam News (VNA)',
    feedUrl:         'https://vietnamnews.vn/rss/',
    category:        'geopolitics',
    biasLabel:       'state-media',
    reliability:     0.55,
    countryCode:     'VN',
    defaultLat:      21.03,
    defaultLng:      105.85,
    defaultLocation: 'Hanoi, Vietnam',
    extraTags:       ['vietnam-news', 'vietnam', 'southeast-asia', 'state-media'],
    language:        'en',
  },
  // ── Tier 5 — Latin American Investigative Journalism ─────────────────────
  {
    id:              'animal-politico',
    name:            'Animal Político (Mexico)',
    feedUrl:         'https://www.animalpolitico.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.82,
    countryCode:     'MX',
    defaultLat:      19.43,
    defaultLng:      -99.13,
    defaultLocation: 'Mexico City, Mexico',
    extraTags:       ['animal-politico', 'mexico', 'latin-america', 'investigative'],
    language:        'es',
  },
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
    id:              'el-faro',
    name:            'El Faro (El Salvador)',
    feedUrl:         'https://elfaro.net/es/rss',
    category:        'geopolitics',
    biasLabel:       'center-left',
    reliability:     0.83,
    countryCode:     'SV',
    defaultLat:      13.69,
    defaultLng:      -89.22,
    defaultLocation: 'San Salvador, El Salvador',
    extraTags:       ['el-faro', 'el-salvador', 'central-america', 'latin-america', 'investigative'],
    language:        'es',
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
    feedUrl:         'https://www.occrp.org/en/feed.rss',
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
    id:              'the-news-lens-intl',
    name:            'The News Lens International',
    feedUrl:         'https://international.thenewslens.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.77,
    countryCode:     'TW',
    defaultLat:      25.03,
    defaultLng:      121.57,
    defaultLocation: 'Taipei, Taiwan',
    extraTags:       ['news-lens', 'taiwan', 'east-asia', 'asia-pacific'],
    language:        'en',
  },
  {
    id:              'wion-news',
    name:            'WION News (India)',
    feedUrl:         'https://www.wionews.com/feeds/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.71,
    countryCode:     'IN',
    defaultLat:      28.61,
    defaultLng:      77.21,
    defaultLocation: 'New Delhi, India',
    extraTags:       ['wion', 'india', 'south-asia', 'international'],
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

  // ── Batch Apr 15 — Geographic gap fills + high-frequency sources ──────────
  // Target: push signal count from 300 → 500 by adding 40 sources
  // Focus: Francophone Africa, Central Asia, Caribbean, Scandinavia,
  //        health/pandemic, cybersecurity, disaster/humanitarian

  // --- Francophone Africa (MAJOR GAP) ---
  {
    id:              'rfi-afrique',
    name:            'RFI Afrique',
    feedUrl:         'https://www.rfi.fr/en/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'FR',
    defaultLat:      5.32,
    defaultLng:      -4.01,
    defaultLocation: 'Abidjan, Côte d\'Ivoire',
    extraTags:       ['rfi', 'francophone-africa', 'west-africa', 'sahel'],
    language:        'en',
  },
  {
    id:              'jeune-afrique',
    name:            'Jeune Afrique',
    feedUrl:         'https://www.jeuneafrique.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'FR',
    defaultLat:      12.64,
    defaultLng:      -8.00,
    defaultLocation: 'Bamako, Mali',
    extraTags:       ['jeune-afrique', 'francophone-africa', 'sahel'],
    language:        'fr',
  },
  {
    id:              'the-continent',
    name:            'The Continent',
    feedUrl:         'https://www.thecontinent.org/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'ZA',
    defaultLat:      -1.29,
    defaultLng:      36.82,
    defaultLocation: 'Nairobi, Kenya',
    extraTags:       ['the-continent', 'pan-african'],
    language:        'en',
  },
  {
    id:              'icc-cpi',
    name:            'ICC — International Criminal Court',
    feedUrl:         'https://www.icc-cpi.int/rss',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.94,
    countryCode:     'NL',
    defaultLat:      52.07,
    defaultLng:      4.30,
    defaultLocation: 'The Hague, Netherlands',
    extraTags:       ['icc', 'international-law', 'justice', 'war-crimes'],
    language:        'en',
  },

  // --- Central Asia (ZERO COVERAGE) ---
  {
    id:              'eurasianet',
    name:            'Eurasianet',
    feedUrl:         'https://eurasianet.org/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.78,
    countryCode:     'US',
    defaultLat:      41.30,
    defaultLng:      69.28,
    defaultLocation: 'Tashkent, Uzbekistan',
    extraTags:       ['eurasianet', 'central-asia', 'caucasus', 'post-soviet'],
    language:        'en',
  },
  {
    id:              'the-astana-times',
    name:            'The Astana Times',
    feedUrl:         'https://astanatimes.com/feed/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.65,
    countryCode:     'KZ',
    defaultLat:      51.17,
    defaultLng:      71.43,
    defaultLocation: 'Astana, Kazakhstan',
    extraTags:       ['astana-times', 'kazakhstan', 'central-asia'],
    language:        'en',
  },

  // --- Caribbean (ZERO COVERAGE) ---
  {
    id:              'jamaica-gleaner',
    name:            'Jamaica Gleaner',
    feedUrl:         'https://jamaica-gleaner.com/feed',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.70,
    countryCode:     'JM',
    defaultLat:      18.01,
    defaultLng:      -76.79,
    defaultLocation: 'Kingston, Jamaica',
    extraTags:       ['jamaica-gleaner', 'caribbean'],
    language:        'en',
  },
  {
    id:              'loop-caribbean',
    name:            'Loop Caribbean News',
    feedUrl:         'https://caribbean.loopnews.com/rss.xml',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.68,
    countryCode:     'TT',
    defaultLat:      10.65,
    defaultLng:      -61.50,
    defaultLocation: 'Port of Spain, Trinidad',
    extraTags:       ['loop-news', 'caribbean', 'trinidad'],
    language:        'en',
  },

  // --- Scandinavia / Nordics (ZERO COVERAGE) ---
  {
    id:              'the-local-sweden',
    name:            'The Local — Sweden',
    feedUrl:         'https://feeds.thelocal.com/rss/se',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.75,
    countryCode:     'SE',
    defaultLat:      59.33,
    defaultLng:      18.07,
    defaultLocation: 'Stockholm, Sweden',
    extraTags:       ['the-local', 'sweden', 'nordics', 'scandinavia'],
    language:        'en',
  },
  {
    id:              'yle-finland',
    name:            'YLE News — Finland',
    feedUrl:         'https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_NEWS',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'FI',
    defaultLat:      60.17,
    defaultLng:      24.94,
    defaultLocation: 'Helsinki, Finland',
    extraTags:       ['yle', 'finland', 'nordics', 'nato'],
    language:        'en',
  },
  {
    id:              'iceland-monitor',
    name:            'Iceland Monitor',
    feedUrl:         'https://icelandmonitor.mbl.is/rss/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.72,
    countryCode:     'IS',
    defaultLat:      64.15,
    defaultLng:      -21.94,
    defaultLocation: 'Reykjavik, Iceland',
    extraTags:       ['iceland-monitor', 'iceland', 'nordics', 'arctic'],
    language:        'en',
  },

  // --- Health / Pandemic (HIGH-VALUE GAP) ---
  {
    id:              'who-news',
    name:            'WHO — Disease Outbreak News',
    feedUrl:         'https://www.who.int/feeds/entity/don/en/rss.xml',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.96,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.15,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['who', 'pandemic', 'disease', 'global-health'],
    language:        'en',
  },
  {
    id:              'cidrap',
    name:            'CIDRAP — Infectious Disease',
    feedUrl:         'https://www.cidrap.umn.edu/rss.xml',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'US',
    defaultLat:      44.97,
    defaultLng:      -93.24,
    defaultLocation: 'Minneapolis, USA',
    extraTags:       ['cidrap', 'infectious-disease', 'pandemic', 'avian-flu'],
    language:        'en',
  },
  {
    id:              'stat-news',
    name:            'STAT News — Health & Medicine',
    feedUrl:         'https://www.statnews.com/feed/',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.85,
    countryCode:     'US',
    defaultLat:      42.36,
    defaultLng:      -71.06,
    defaultLocation: 'Boston, USA',
    extraTags:       ['stat-news', 'health', 'pharma', 'biotech'],
    language:        'en',
  },
  {
    id:              'lancet-rss',
    name:            'The Lancet',
    feedUrl:         'https://www.thelancet.com/rssfeed/lancet_current.xml',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.95,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['lancet', 'medical-journal', 'research', 'global-health'],
    language:        'en',
  },

  // --- Cybersecurity (HIGH-VALUE FOR CORRELATION) ---
  {
    id:              'bleepingcomputer',
    name:            'BleepingComputer',
    feedUrl:         'https://www.bleepingcomputer.com/feed/',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['bleepingcomputer', 'cybersecurity', 'infosec', 'malware'],
    language:        'en',
  },
  {
    id:              'the-record',
    name:            'The Record by Recorded Future',
    feedUrl:         'https://therecord.media/feed',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.84,
    countryCode:     'US',
    defaultLat:      42.36,
    defaultLng:      -71.06,
    defaultLocation: 'Boston, USA',
    extraTags:       ['the-record', 'cybersecurity', 'nation-state', 'ransomware'],
    language:        'en',
  },
  {
    id:              'dark-reading',
    name:            'Dark Reading',
    feedUrl:         'https://www.darkreading.com/rss.xml',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['dark-reading', 'cybersecurity', 'vulnerability', 'threat-intel'],
    language:        'en',
  },
  {
    id:              'krebs-on-security',
    name:            'Krebs on Security',
    feedUrl:         'https://krebsonsecurity.com/feed/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.88,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['krebs', 'cybersecurity', 'cybercrime', 'investigative'],
    language:        'en',
  },

  // --- Disaster / Humanitarian (CORRELATION FUEL) ---
  {
    id:              'reliefweb-rss',
    name:            'ReliefWeb — Latest Reports',
    feedUrl:         'https://reliefweb.int/updates/rss.xml',
    category:        'disaster',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, USA',
    extraTags:       ['reliefweb', 'humanitarian', 'disaster', 'un'],
    language:        'en',
  },
  {
    id:              'gdacs-rss',
    name:            'GDACS — Global Disaster Alert',
    feedUrl:         'https://www.gdacs.org/xml/rss.xml',
    category:        'disaster',
    biasLabel:       'center',
    reliability:     0.94,
    countryCode:     'IT',
    defaultLat:      45.80,
    defaultLng:      8.63,
    defaultLocation: 'Ispra, Italy',
    extraTags:       ['gdacs', 'disaster', 'earthquake', 'flood', 'cyclone'],
    language:        'en',
  },
  {
    id:              'icrc-news',
    name:            'ICRC — Red Cross News',
    feedUrl:         'https://www.icrc.org/en/rss',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.15,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['icrc', 'red-cross', 'humanitarian', 'conflict', 'ihl'],
    language:        'en',
  },
  {
    id:              'msf-press',
    name:            'Médecins Sans Frontières',
    feedUrl:         'https://www.msf.org/rss/all',
    category:        'health',
    biasLabel:       'center',
    reliability:     0.91,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.15,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['msf', 'doctors-without-borders', 'humanitarian', 'health'],
    language:        'en',
  },

  // --- Latin America expansion ---
  {
    id:              'clarin-english',
    name:            'Clarín — Argentina',
    feedUrl:         'https://www.clarin.com/rss/lo-ultimo/',
    category:        'geopolitics',
    biasLabel:       'center-right',
    reliability:     0.72,
    countryCode:     'AR',
    defaultLat:      -34.60,
    defaultLng:      -58.38,
    defaultLocation: 'Buenos Aires, Argentina',
    extraTags:       ['clarin', 'argentina', 'south-america'],
    language:        'es',
  },
  {
    id:              'mercopress',
    name:            'MercoPress — South Atlantic News',
    feedUrl:         'https://en.mercopress.com/rss',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.73,
    countryCode:     'UY',
    defaultLat:      -34.88,
    defaultLng:      -56.19,
    defaultLocation: 'Montevideo, Uruguay',
    extraTags:       ['mercopress', 'south-america', 'mercosur', 'falklands'],
    language:        'en',
  },
  {
    id:              'bnamericas',
    name:            'BNamericas',
    feedUrl:         'https://www.bnamericas.com/en/rss',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'CL',
    defaultLat:      -33.45,
    defaultLng:      -70.67,
    defaultLocation: 'Santiago, Chile',
    extraTags:       ['bnamericas', 'latin-america', 'business', 'infrastructure'],
    language:        'en',
  },

  // --- East/Central Europe ---
  {
    id:              'kyiv-post',
    name:            'Kyiv Post',
    feedUrl:         'https://www.kyivpost.com/feed',
    category:        'conflict',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'UA',
    defaultLat:      50.45,
    defaultLng:      30.52,
    defaultLocation: 'Kyiv, Ukraine',
    extraTags:       ['kyiv-post', 'ukraine', 'russia-war', 'eastern-europe'],
    language:        'en',
  },
  {
    id:              'new-eastern-europe',
    name:            'New Eastern Europe',
    feedUrl:         'https://neweasterneurope.eu/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.74,
    countryCode:     'PL',
    defaultLat:      50.06,
    defaultLng:      19.94,
    defaultLocation: 'Kraków, Poland',
    extraTags:       ['new-eastern-europe', 'post-soviet', 'europe', 'poland'],
    language:        'en',
  },

  // --- Arctic / High-Latitude (UNIQUE NICHE) ---
  {
    id:              'arctic-today',
    name:            'Arctic Today',
    feedUrl:         'https://www.arctictoday.com/feed/',
    category:        'climate',
    biasLabel:       'center',
    reliability:     0.76,
    countryCode:     'US',
    defaultLat:      64.84,
    defaultLng:      -147.72,
    defaultLocation: 'Fairbanks, Alaska',
    extraTags:       ['arctic', 'climate', 'northern-sea-route', 'polar'],
    language:        'en',
  },

  // --- Defense / Military Intelligence ---
  {
    id:              'janes-news',
    name:            'Janes Defence News',
    feedUrl:         'https://www.janes.com/feeds/news',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.90,
    countryCode:     'GB',
    defaultLat:      51.50,
    defaultLng:      -0.12,
    defaultLocation: 'London, United Kingdom',
    extraTags:       ['janes', 'defense', 'military', 'intelligence', 'arms'],
    language:        'en',
  },
  {
    id:              'defense-one',
    name:            'Defense One',
    feedUrl:         'https://www.defenseone.com/rss/',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['defense-one', 'pentagon', 'military', 'nato'],
    language:        'en',
  },

  // --- Space (COMPLEMENTS OSINT POLLERS) ---
  {
    id:              'spacenews',
    name:            'SpaceNews',
    feedUrl:         'https://spacenews.com/feed/',
    category:        'space',
    biasLabel:       'center',
    reliability:     0.83,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['spacenews', 'space', 'satellites', 'launch'],
    language:        'en',
  },
  {
    id:              'nasaspaceflight',
    name:            'NASASpaceFlight',
    feedUrl:         'https://www.nasaspaceflight.com/feed/',
    category:        'space',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      28.57,
    defaultLng:      -80.65,
    defaultLocation: 'Cape Canaveral, USA',
    extraTags:       ['nasaspaceflight', 'space', 'rockets', 'iss'],
    language:        'en',
  },

  // --- Nuclear / Arms Control (NICHE BUT CRITICAL) ---
  {
    id:              'arms-control-today',
    name:            'Arms Control Association',
    feedUrl:         'https://www.armscontrol.org/rss.xml',
    category:        'security',
    biasLabel:       'center',
    reliability:     0.87,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['arms-control', 'nuclear', 'nonproliferation', 'treaties'],
    language:        'en',
  },

  // --- Migration / Refugee (HUMANITARIAN CORRELATION) ---
  {
    id:              'mixed-migration',
    name:            'Mixed Migration Centre',
    feedUrl:         'https://mixedmigration.org/feed/',
    category:        'geopolitics',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'CH',
    defaultLat:      46.23,
    defaultLng:      6.15,
    defaultLocation: 'Geneva, Switzerland',
    extraTags:       ['mixed-migration', 'refugees', 'displacement', 'humanitarian'],
    language:        'en',
  },

  // --- AI / Emerging Tech (FAST-GROWING SIGNAL DOMAIN) ---
  {
    id:              'the-verge-tech',
    name:            'The Verge — Tech',
    feedUrl:         'https://www.theverge.com/rss/index.xml',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, USA',
    extraTags:       ['the-verge', 'tech', 'ai', 'silicon-valley'],
    language:        'en',
  },
  {
    id:              'ars-technica',
    name:            'Ars Technica',
    feedUrl:         'https://feeds.arstechnica.com/arstechnica/index',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.82,
    countryCode:     'US',
    defaultLat:      40.75,
    defaultLng:      -73.97,
    defaultLocation: 'New York, USA',
    extraTags:       ['ars-technica', 'tech', 'science', 'ai', 'policy'],
    language:        'en',
  },
  {
    id:              'wired',
    name:            'WIRED',
    feedUrl:         'https://www.wired.com/feed/rss',
    category:        'technology',
    biasLabel:       'center',
    reliability:     0.80,
    countryCode:     'US',
    defaultLat:      37.78,
    defaultLng:      -122.41,
    defaultLocation: 'San Francisco, USA',
    extraTags:       ['wired', 'tech', 'security', 'ai', 'culture'],
    language:        'en',
  },

  // --- Economics / Trade (CORRELATION WITH SANCTIONS) ---
  {
    id:              'world-bank-news',
    name:            'World Bank News',
    feedUrl:         'https://www.worldbank.org/en/news/rss.xml',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['world-bank', 'development', 'economics', 'poverty'],
    language:        'en',
  },
  {
    id:              'imf-news',
    name:            'IMF News',
    feedUrl:         'https://www.imf.org/en/News/rss',
    category:        'economy',
    biasLabel:       'center',
    reliability:     0.93,
    countryCode:     'US',
    defaultLat:      38.90,
    defaultLng:      -77.04,
    defaultLocation: 'Washington D.C., USA',
    extraTags:       ['imf', 'global-finance', 'economics', 'debt'],
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
export function detectNewsSeverity(title: string, description: string): SignalSeverity {
  const text = `${title} ${description}`.toLowerCase()

  // Critical: mass-casualty, nuclear, genocide, war declaration, pandemic
  if (
    /\b(mass\s+casualt|nuclear\s+(?:strike|attack|war|explosion)|genocide|war\s+declared|pandemic\s+declared|catastrophic|world\s+war|chemical\s+weapon|biological\s+weapon|dirty\s+bomb)\b/i.test(text)
  ) return 'critical'

  // High: confirmed deaths, large explosions, major crisis
  if (
    /\b(killed|dead|deaths|bombing|missile\s+strike|air\s+strike|earthquake|tsunami|hurricane|invasion|coup|emergency\s+declared|terror\s+attack|assassination|refugee\s+crisis|famine|outbreak)\b/i.test(text)
  ) return 'high'

  // Medium: conflict/tension, significant events
  if (
    /\b(arrested|sanction|protest|crisis|clash|conflict|fighting|forces|offensive|troops|ceasefire|election|summit|verdict|breaking)\b/i.test(text)
  ) return 'medium'

  return 'low'
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

  if (/\b(pandemic|outbreak|virus|disease|epidemic|vaccine|who|health\s+emergency|pathogen|mpox|ebola|flu|covid)\b/.test(text))
    return toCategory('health')
  if (/\b(earthquake|tsunami|hurricane|typhoon|cyclone|wildfire|flood|eruption|volcano|tornado|blizzard|drought|disaster)\b/.test(text))
    return toCategory('disaster')
  if (/\b(election|vote|voting|ballot|democracy|referendum|poll|candidate|campaign|inauguration)\b/.test(text))
    return toCategory('elections')
  if (/\b(stock\s+market|recession|inflation|gdp|central\s+bank|interest\s+rate|economy|trade\s+war|tariff|sanction|oil\s+price|crypto)\b/.test(text))
    return toCategory('economy')
  if (/\b(ai\s+|artificial\s+intelligence|cybersecurity|hack|data\s+breach|tech\s+giant|silicon\s+valley|openai|spacex|nasa)\b/.test(text))
    return toCategory('technology')
  if (/\b(climate\s+change|global\s+warming|carbon|emissions|cop[0-9]+|fossil\s+fuel|renewable\s+energy|deforestation)\b/.test(text))
    return toCategory('climate')
  if (/\b(war|invasion|airstrike|missile|troops|military|casualties|conflict|nato|ceasefire|bombing|killed|shelling)\b/.test(text))
    return toCategory('conflict')
  if (/\b(space\s+launch|rocket|satellite|iss|moon|mars|nasa|esa|spacex|boeing\s+starliner|astronaut)\b/.test(text))
    return toCategory('space')
  if (/\b(cyber\s+attack|ransomware|malware|espionage|spy|intelligence|terror)\b/.test(text))
    return toCategory('security')

  return sourceDefault
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

/**
 * Fetch a URL using node http/https, following one redirect.
 * Sets a 20-second timeout and identifies as WorldPulse.
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
        'User-Agent': 'WorldPulse/1.0 (open-source global intelligence; https://worldpulse.io)',
        'Accept':     'application/rss+xml, application/xml, application/atom+xml, text/xml, */*',
      },
    }, (res) => {
      // Follow redirects (301/302/307/308)
      if (
        [301, 302, 307, 308].includes(res.statusCode ?? 0) &&
        res.headers.location
      ) {
        res.resume()
        fetchUrl(res.headers.location, redirectCount + 1).then(resolve, reject)
        return
      }

      if ((res.statusCode ?? 0) >= 400) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} from ${url}`))
        return
      }

      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end',  () => resolve(body))
      res.on('error', reject)
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

export function inferGeo(
  title:       string,
  description: string,
  source:      NewsSource,
): { lat: number; lng: number; locationName: string; countryCode: string | null } {
  const text = `${title} ${description}`.toLowerCase()

  for (const { keywords, geo } of GEO_HINTS) {
    if (keywords.some(kw => text.includes(kw))) {
      return {
        lat:          geo.lat,
        lng:          geo.lng,
        locationName: geo.name,
        countryCode:  geo.code ?? null,
      }
    }
  }

  // Fall back to outlet's editorial home
  return {
    lat:          source.defaultLat,
    lng:          source.defaultLng,
    locationName: source.defaultLocation,
    countryCode:  source.countryCode,
  }
}

// ─── SIGNAL CREATION ──────────────────────────────────────────────────────────

async function processItem(
  db:       Knex,
  redis:    Redis,
  producer: Producer | null | undefined,
  source:   NewsSource,
  item:     FeedItem,
): Promise<boolean> {
  if (!item.title && !item.link) return false

  const key  = newsRedisKey(source.id, item.link || item.title)
  const seen = await redis.get(key)
  if (seen) return false

  const title       = item.title.slice(0, 500) || `${source.name} — news item`
  const fullText    = `${item.title} ${item.description}`
  const severity    = detectNewsSeverity(item.title, item.description)
  const category    = detectNewsCategory(item.title, item.description, source.category)
  const geo         = inferGeo(item.title, item.description, source)

  const pubDate  = item.pubDate ? new Date(item.pubDate) : new Date()
  const eventTime = isNaN(pubDate.getTime()) ? new Date() : pubDate

  const summary = [
    item.description
      ? item.description.replace(/<[^>]+>/g, '').trim().slice(0, 600)
      : `${title}.`,
    `Source: ${source.name} (reliability: ${(source.reliability * 100).toFixed(0)}%, bias: ${source.biasLabel}).`,
    source.biasLabel === 'state-media'
      ? `⚠️ This outlet is state-controlled and may reflect official government positions.`
      : '',
  ].filter(Boolean).join(' ')

  const tags = [
    'news', 'rss', source.id, source.countryCode.toLowerCase(),
    category, severity,
    ...source.extraTags,
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
      location:          db.raw('ST_MakePoint(?, ?)', [geo.lng, geo.lat]),
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

    return true
  } catch (err) {
    // Expected for dedup constraint violations
    log.debug({ err, sourceId: source.id, title }, 'news-rss signal skipped (likely duplicate)')
    return false
  }
}

// ─── POLL ONE SOURCE ─────────────────────────────────────────────────────────

async function pollSource(
  db:       Knex,
  redis:    Redis,
  producer: Producer | null | undefined,
  source:   NewsSource,
): Promise<void> {
  const sourceLog = log.child({ sourceId: source.id })
  sourceLog.debug(`Polling ${source.name}...`)

  let xml: string
  try {
    xml = await fetchUrl(source.feedUrl)
  } catc