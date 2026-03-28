/**
 * WHO Disease Outbreak News Signal Source
 *
 * Polls the WHO Disease Outbreak News RSS feed every 30 minutes for
 * official disease outbreak notifications. Creates WorldPulse signals
 * for public health emergencies and disease events.
 *
 * Feed: https://www.who.int/rss-feeds/disease-outbreak-news-en.xml
 * Free, no API key required, updated by WHO when outbreaks are notified.
 *
 * Reliability: 0.96 (WHO is the authoritative global public health source)
 * Category: health
 *
 * Closes Crucix feed gap — WHO Disease Outbreaks is one of Crucix's health feeds.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'who-source' })

const WHO_RSS_URL = 'https://www.who.int/rss-feeds/disease-outbreak-news-en.xml'
const RELIABILITY  = 0.96
const DEDUP_TTL_S  = 72 * 3_600  // 72-hour dedup (outbreaks persist for days)

// ─── SEVERITY MAPPING ────────────────────────────────────────────────────────

/**
 * Derive signal severity from WHO outbreak title and description.
 * Based on WHO Emergency Response Framework grading (Grade 1-3)
 * and pathogen/event type keywords.
 */
export function whoSeverity(title: string, description: string = ''): SignalSeverity {
  const text = (title + ' ' + description).toLowerCase()

  // Critical: grade 3 / PHEIC-level / Ebola / hemorrhagic / pandemic declaration
  if (
    /grade\s*3|pheic|public health emergency of international concern|ebola|marburg|hemorrhagic fever|plague|smallpox|pandemic declared/i.test(text)
  ) return 'critical'

  // High: novel pathogen / grade 2 / high risk / significant outbreak
  if (
    /grade\s*2|novel\s+(?:virus|strain|pathogen)|high\s+risk|large(?:\s|\-)scale|significant outbreak|multi-country|multi-country|spreading|cholera.*deaths|outbreak.*killed|mpox.*grade/i.test(text)
  ) return 'high'

  // Medium: confirmed outbreak / grade 1 / update on ongoing event
  if (
    /grade\s*1|confirmed\s+(?:cases|outbreak)|outbreak update|cases\s+reported|cluster|avian\s+influenza|meningitis|yellow fever|dengue|lassa/i.test(text)
  ) return 'medium'

  return 'low'
}

// ─── LOCATION INFERENCE ───────────────────────────────────────────────────────

/**
 * Known country/region → [lat, lng] lookup for common WHO outbreak locations.
 * Falls back to global centroid [0, 20] if no match.
 */
const COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  'democratic republic of the congo': { lat: -4.0, lng: 21.8 },
  'congo':    { lat: -4.0, lng: 21.8 },
  'drc':      { lat: -4.0, lng: 21.8 },
  'nigeria':  { lat: 9.1, lng: 8.7 },
  'ghana':    { lat: 7.9, lng: -1.0 },
  'ethiopia': { lat: 9.1, lng: 40.5 },
  'kenya':    { lat: -0.0, lng: 37.9 },
  'tanzania': { lat: -6.4, lng: 34.9 },
  'uganda':   { lat: 1.4, lng: 32.3 },
  'somalia':  { lat: 5.2, lng: 46.2 },
  'sudan':    { lat: 15.6, lng: 32.5 },
  'south sudan': { lat: 6.9, lng: 31.3 },
  'chad':     { lat: 15.5, lng: 18.7 },
  'niger':    { lat: 17.6, lng: 8.1 },
  'mali':     { lat: 17.6, lng: -4.0 },
  'guinea':   { lat: 11.0, lng: -10.9 },
  'liberia':  { lat: 6.4, lng: -9.4 },
  'sierra leone': { lat: 8.5, lng: -11.8 },
  'cameroon': { lat: 3.9, lng: 11.5 },
  'mozambique': { lat: -18.7, lng: 35.5 },
  'zimbabwe': { lat: -20.0, lng: 30.0 },
  'zambia':   { lat: -13.1, lng: 27.9 },
  'malawi':   { lat: -13.3, lng: 34.3 },
  'india':    { lat: 20.6, lng: 78.9 },
  'pakistan': { lat: 30.4, lng: 69.3 },
  'bangladesh': { lat: 23.7, lng: 90.4 },
  'myanmar':  { lat: 17.1, lng: 96.9 },
  'indonesia': { lat: -0.8, lng: 113.9 },
  'philippines': { lat: 12.9, lng: 121.8 },
  'vietnam':  { lat: 14.1, lng: 108.3 },
  'china':    { lat: 35.9, lng: 104.2 },
  'cambodia': { lat: 12.6, lng: 104.9 },
  'thailand': { lat: 15.9, lng: 100.9 },
  'brazil':   { lat: -14.2, lng: -51.9 },
  'colombia': { lat: 4.6, lng: -74.1 },
  'venezuela': { lat: 6.4, lng: -66.6 },
  'peru':     { lat: -9.2, lng: -75.0 },
  'haiti':    { lat: 18.9, lng: -72.3 },
  'iraq':     { lat: 33.2, lng: 43.7 },
  'afghanistan': { lat: 33.9, lng: 67.7 },
  'syria':    { lat: 34.8, lng: 38.9 },
  'yemen':    { lat: 15.6, lng: 48.5 },
  'ukraine':  { lat: 48.4, lng: 31.2 },
  'global':   { lat: 0.0, lng: 20.0 },
}

export function inferLocation(title: string, description: string = ''): {
  lat: number; lng: number; locationName: string
} {
  const text = (title + ' ' + description).toLowerCase()

  for (const [country, coords] of Object.entries(COUNTRY_COORDS)) {
    if (text.includes(country)) {
      const displayName = country
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      return { lat: coords.lat, lng: coords.lng, locationName: displayName }
    }
  }

  return { lat: 0.0, lng: 20.0, locationName: 'Global' }
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpsGet(res.headers.location).then(resolve, reject)
        res.resume()
        return
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('WHO RSS request timeout')) })
  })
}

// ─── RSS PARSING ──────────────────────────────────────────────────────────────

export interface RssItem {
  title:       string
  link:        string
  pubDate:     string
  description: string
  guid:        string
}

/**
 * Minimal RSS 2.0 parser — extracts <item> blocks.
 * Handles CDATA sections and plain text content.
 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi
  let itemMatch: RegExpExecArray | null

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const block = itemMatch[1]

    const extract = (tag: string): string => {
      const re = new RegExp(
        `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`,
        'i',
      )
      const m = re.exec(block)
      if (!m) return ''
      return (m[1] ?? m[2] ?? '').trim()
    }

    // guid may be inside a <guid> tag or fall back to link
    const link = extract('link') || extract('guid')

    items.push({
      title:       extract('title'),
      link,
      pubDate:     extract('pubDate'),
      description: extract('description'),
      guid:        extract('guid') || link,
    })
  }

  return items
}

// ─── MAIN POLLER ──────────────────────────────────────────────────────────────

export function startWhoPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.WHO_INTERVAL_MS ?? 30 * 60_000) // 30 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling WHO Disease Outbreak News RSS feed...')
      let raw: string
      try {
        raw = await fetchWithResilience(
          'who',
          'WHO',
          WHO_RSS_URL,
          () => httpsGet(WHO_RSS_URL),
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const items = parseRssItems(raw)

      if (items.length === 0) {
        log.debug('WHO: no items in RSS feed')
        return
      }

      let created = 0

      for (const item of items) {
        if (!item.title || item.title.length < 5) continue

        // Dedup key based on guid or link
        const dedupId  = item.guid || item.link || item.title
        const key      = `osint:who:${Buffer.from(dedupId).toString('base64').slice(0, 60)}`
        const seen     = await redis.get(key)
        if (seen) continue

        const severity = whoSeverity(item.title, item.description)
        const loc      = inferLocation(item.title, item.description)

        const title = item.title.slice(0, 500)

        // Clean HTML tags from description for summary
        const cleanDesc = item.description
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 400)

        const summary = [
          cleanDesc || `WHO Disease Outbreak Notice: ${title}`,
          'Source: World Health Organization (WHO) Disease Outbreak News.',
          `Location: ${loc.locationName}.`,
        ].filter(Boolean).join(' ')

        const pubDate   = item.pubDate ? new Date(item.pubDate) : new Date()
        const eventTime = isNaN(pubDate.getTime()) ? new Date() : pubDate

        try {
          const signal = await insertAndCorrelate({
            title,
            summary,
            category:          'health',
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      1,
            source_ids:        [],
            original_urls:     item.link ? [item.link] : ['https://www.who.int/emergencies/disease-outbreak-news'],
            location:          db.raw('ST_MakePoint(?, ?)', [loc.lng, loc.lat]),
            location_name:     loc.locationName,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'health', 'who', 'disease-outbreak', 'public-health'],
            language:          'en',
            event_time:        eventTime,
          }, { lat: loc.lat, lng: loc.lng, sourceId: 'who' })

          await redis.setex(key, DEDUP_TTL_S, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'health',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'health', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, title: item.title }, 'WHO signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: items.length }, 'WHO: signals created')
      } else {
        log.debug({ total: items.length }, 'WHO poll complete (no new outbreaks)')
      }
    } catch (err) {
      log.warn({ err }, 'WHO poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'WHO Disease Outbreak poller started')

  return () => {
    clearInterval(timer)
    log.info('WHO Disease Outbreak poller stopped')
  }
}
