/**
 * WorldPulse Global News RSS Adapter
 *
 * Ingests 50 mainstream international news RSS feeds and creates WorldPulse
 * signals from breaking/world news items. Provides editorial-sourced signal
 * coverage to complement the OSINT/sensor feeds already in the pipeline.
 *
 * Source registry: BBC World, Reuters, Al Jazeera, NPR, Deutsche Welle,
 * France24, AP News, The Guardian, SCMP, Haaretz, Euronews, NHK World,
 * VOA News, UN News, The Hindu, Kyiv Independent, Straits Times, Japan Times,
 * Middle East Eye, Times of India, Xinhua (EN), TASS (EN), DW Africa,
 * Sydney Morning Herald, The East African,
 * Le Monde, Der Spiegel International, El País (EN), The Wire India,
 * Daily Maverick, Nikkei Asia, Arab News, AllAfrica, Folha de S.Paulo,
 * The Conversation,
 * EURACTIV, Moscow Times (EN), Taipei Times, The Hindu National, Dawn Pakistan,
 * Premium Times Nigeria, Bangkok Post, The Jakarta Post, Al-Monitor,
 * EU Observer, Africanews, Radio Free Europe/RL, Caixin Global, Asia Times,
 * Channel NewsAsia
 *
 * Reliability scores reflect editorial independence, fact-check track records,
 * and MBFC/NewsGuard ratings. State-controlled outlets (Xinhua, TASS) are
 * tagged "state-media" and assigned lower reliability.
 *
 * Polling: staggered 30-min intervals (sources polled sequentially, 5 s apart)
 * Dedup: Redis key with 24-hour TTL per article URL
 *
 * Competitive rationale: Ground News indexes 50K+ sources; this registry adds
 * 50 high-signal international outlets (incl. French, German, Spanish,
 * Portuguese, Arabic, and regional African/Asian voices) to close the most
 * visible coverage gap while maintaining geographic and linguistic diversity.
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
  } catch (err) {
    sourceLog.warn({ err }, `${source.name}: fetch failed`)
    return
  }

  if (!xml || xml.length < 50) {
    sourceLog.warn(`${source.name}: empty response`)
    return
  }

  const items = parseFeedItems(xml)
  if (items.length === 0) {
    sourceLog.debug(`${source.name}: no items parsed`)
    return
  }

  let created = 0
  for (const item of items) {
    const ok = await processItem(db, redis, producer, source, item)
    if (ok) created++
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
 * Polls all 50 registered news outlets every 30 minutes in staggered sequence
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
      await pollSource(db, redis, producer, source)
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
