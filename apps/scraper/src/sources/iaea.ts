/**
 * IAEA Nuclear Events & Radiation Incidents Signal Source
 *
 * Polls the IAEA (International Atomic Energy Agency) news and press release
 * RSS feed every 30 minutes, filtering for nuclear safety incidents,
 * radiation events, and emergency communications.
 *
 * Feed: https://www.iaea.org/feeds/news.rss
 * Free, no API key required, IAEA official source.
 *
 * Reliability: 0.97 (IAEA is the authoritative UN agency for nuclear safety)
 * Category: science (nuclear/radiation safety)
 *
 * Closes Crucix feed gap — Radiation Monitoring is one of Crucix's 27 feeds.
 * Crucix uses radmon.org; WorldPulse uses authoritative IAEA official source.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'

const log = rootLogger.child({ module: 'iaea-source' })

const IAEA_RSS_URL  = 'https://www.iaea.org/feeds/news.rss'
const RELIABILITY   = 0.97
const DEDUP_TTL_S   = 72 * 3_600  // 72-hour dedup

// ─── NUCLEAR/RADIATION KEYWORD FILTER ───────────────────────────────────────

/**
 * Keywords indicating a nuclear or radiation safety event.
 * IAEA covers many topics — we filter to safety-relevant items.
 */
const NUCLEAR_SAFETY_KEYWORDS = [
  'nuclear', 'radiation', 'radioactive', 'radiological',
  'reactor', 'ines', 'nuclear safety', 'nuclear incident',
  'nuclear accident', 'emergency preparedness', 'nuclear security',
  'uranium', 'plutonium', 'cesium', 'strontium', 'iodine-131',
  'fukushima', 'chernobyl', 'lost source', 'orphan source',
  'contamination', 'nuclear power plant', 'npp',
]

export function isNuclearSafetyItem(title: string, description: string = ''): boolean {
  const text = (title + ' ' + description).toLowerCase()
  return NUCLEAR_SAFETY_KEYWORDS.some(kw => text.includes(kw))
}

// ─── SEVERITY MAPPING ────────────────────────────────────────────────────────

/**
 * INES (International Nuclear Event Scale) severity mapping.
 * INES 1-3: Incident; INES 4-7: Accident; 7 = Chernobyl/Fukushima level.
 */
export function iaeaSeverity(title: string, description: string = ''): SignalSeverity {
  const text = (title + ' ' + description).toLowerCase()

  // Critical: INES 4-7 / major accident / emergency / large release
  if (
    /ines\s*level\s*[4-7]|nuclear\s+accident|major\s+accident|large\s+release|emergency\s+declared|radiation\s+emergency|nuclear\s+emergency|meltdown|core\s+damage/i.test(text)
  ) return 'critical'

  // High: INES 3 / serious incident / lost radioactive source / confirmed contamination
  if (
    /ines\s*level\s*3|serious\s+incident|lost\s+(?:radioactive\s+)?source|orphan\s+source|confirmed\s+contamination|significant\s+radiation|radiation\s+injury|radioactive\s+material\s+(?:lost|stolen|missing)/i.test(text)
  ) return 'high'

  // Medium: INES 1-2 / incident / precautionary measure / tritium / low-level event
  if (
    /ines\s*level\s*[12]|nuclear\s+incident|precautionary|tritium|radioactive\s+(?:leak|release|discharge)|abnormal\s+occurrence|reactor\s+shutdown|unplanned\s+shutdown/i.test(text)
  ) return 'medium'

  return 'low'
}

// ─── LOCATION INFERENCE ───────────────────────────────────────────────────────

const NUCLEAR_SITE_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  'fukushima':         { lat: 37.42, lng: 141.03, name: 'Fukushima, Japan' },
  'chernobyl':         { lat: 51.39, lng: 30.10,  name: 'Chernobyl, Ukraine' },
  'zaporizhzhia':      { lat: 47.51, lng: 34.59,  name: 'Zaporizhzhia NPP, Ukraine' },
  'ukraine':           { lat: 48.38, lng: 31.17,  name: 'Ukraine' },
  'iran':              { lat: 32.43, lng: 53.69,  name: 'Iran' },
  'natanz':            { lat: 33.72, lng: 51.73,  name: 'Natanz, Iran' },
  'north korea':       { lat: 40.34, lng: 127.51, name: 'North Korea' },
  'pakistan':          { lat: 30.37, lng: 69.35,  name: 'Pakistan' },
  'india':             { lat: 20.59, lng: 78.96,  name: 'India' },
  'china':             { lat: 35.86, lng: 104.20, name: 'China' },
  'russia':            { lat: 61.52, lng: 105.32, name: 'Russia' },
  'france':            { lat: 46.23, lng: 2.21,   name: 'France' },
  'united states':     { lat: 37.09, lng: -95.71, name: 'United States' },
  'united kingdom':    { lat: 55.38, lng: -3.44,  name: 'United Kingdom' },
  'germany':           { lat: 51.17, lng: 10.45,  name: 'Germany' },
  'brazil':            { lat: -14.24, lng: -51.93, name: 'Brazil' },
  'argentina':         { lat: -38.42, lng: -63.62, name: 'Argentina' },
  'armenia':           { lat: 40.07, lng: 45.04,  name: 'Armenia' },
  'kazakhstan':        { lat: 48.02, lng: 66.92,  name: 'Kazakhstan' },
  'belarus':           { lat: 53.71, lng: 27.95,  name: 'Belarus' },
  'hungary':           { lat: 47.16, lng: 19.50,  name: 'Hungary' },
  'slovakia':          { lat: 48.67, lng: 19.70,  name: 'Slovakia' },
  'finland':           { lat: 61.92, lng: 25.75,  name: 'Finland' },
  'sweden':            { lat: 60.13, lng: 18.64,  name: 'Sweden' },
  'south korea':       { lat: 35.91, lng: 127.77, name: 'South Korea' },
  'japan':             { lat: 36.20, lng: 138.25, name: 'Japan' },
}

export function inferIaeaLocation(title: string, description: string = ''): {
  lat: number; lng: number; locationName: string
} {
  const text = (title + ' ' + description).toLowerCase()

  for (const [keyword, coords] of Object.entries(NUCLEAR_SITE_COORDS)) {
    if (text.includes(keyword)) {
      return { lat: coords.lat, lng: coords.lng, locationName: coords.name }
    }
  }

  return { lat: 48.0, lng: 16.4, locationName: 'Vienna, Austria (IAEA HQ)' }
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
    req.on('timeout', () => { req.destroy(); reject(new Error('IAEA RSS request timeout')) })
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

export function startIaeaPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.IAEA_INTERVAL_MS ?? 30 * 60_000) // 30 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling IAEA news RSS feed...')
      const raw   = await httpsGet(IAEA_RSS_URL)
      const items = parseRssItems(raw)

      if (items.length === 0) {
        log.debug('IAEA: no items in RSS feed')
        return
      }

      let created = 0
      let filtered = 0

      for (const item of items) {
        if (!item.title || item.title.length < 5) continue

        // Only process nuclear/radiation safety items
        if (!isNuclearSafetyItem(item.title, item.description)) {
          filtered++
          continue
        }

        const dedupId  = item.guid || item.link || item.title
        const key      = `osint:iaea:${Buffer.from(dedupId).toString('base64').slice(0, 60)}`
        const seen     = await redis.get(key)
        if (seen) continue

        const severity = iaeaSeverity(item.title, item.description)
        const loc      = inferIaeaLocation(item.title, item.description)

        const title = `[IAEA] ${item.title}`.slice(0, 500)

        const cleanDesc = item.description
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 400)

        const summary = [
          cleanDesc || `IAEA Nuclear Safety Notice: ${item.title}`,
          'Source: International Atomic Energy Agency (IAEA).',
          `Location: ${loc.locationName}.`,
        ].filter(Boolean).join(' ')

        const pubDate   = item.pubDate ? new Date(item.pubDate) : new Date()
        const eventTime = isNaN(pubDate.getTime()) ? new Date() : pubDate

        try {
          const [signal] = await db('signals').insert({
            title,
            summary,
            category:          'science',
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      1,
            source_ids:        [],
            original_urls:     item.link ? [item.link] : ['https://www.iaea.org/newscenter/news'],
            location:          db.raw('ST_MakePoint(?, ?)', [loc.lng, loc.lat]),
            location_name:     loc.locationName,
            country_code:      null,
            region:            null,
            tags:              JSON.stringify([
              'osint', 'nuclear', 'radiation', 'iaea', 'safety', 'science',
            ]),
            language:          'en',
            event_time:        eventTime,
          }).returning('*')

          await redis.setex(key, DEDUP_TTL_S, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'science',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'science', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, title: item.title }, 'IAEA signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, filtered, total: items.length }, 'IAEA: signals created')
      } else {
        log.debug({ filtered, total: items.length }, 'IAEA poll complete (no new nuclear events)')
      }
    } catch (err) {
      log.warn({ err }, 'IAEA poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'IAEA nuclear events poller started')

  return () => {
    clearInterval(timer)
    log.info('IAEA nuclear events poller stopped')
  }
}
