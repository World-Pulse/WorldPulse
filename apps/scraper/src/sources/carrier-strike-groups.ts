/**
 * US Navy Carrier Strike Group (CSG) OSINT Tracker
 *
 * Tracks all 11 active US Navy Carrier Strike Groups via USNI News RSS feed.
 * Polls https://news.usni.org/feed every 30 minutes for carrier deployment
 * mentions, generates signals for movements, port arrivals/departures, and
 * strike group exercises.
 *
 * Reliability: 0.72 (OSINT-estimated, not confirmed official positions)
 * Category: military
 * Severity: high (new deployments), medium (movements/exercises)
 *
 * Direct competitive response to Shadowbroker's CSG tracker (Mar 2026).
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'csg-source' })

const USNI_RSS_URL = 'https://news.usni.org/feed'
const RELIABILITY  = 0.72
const DEDUP_TTL_S  = 6 * 3_600  // 6-hour dedup window

// ─── CARRIER REGISTRY ────────────────────────────────────────────────────────

export interface CarrierInfo {
  /** Full name e.g. "USS Gerald R. Ford" */
  name:        string
  /** Hull classification symbol e.g. "CVN-78" */
  hull:        string
  /** Common short names and aliases used in OSINT reporting */
  aliases:     string[]
  /** OSINT-estimated home port or last-known deployment position [lat, lng] */
  position:    [number, number]
  /** Human-readable position description */
  positionName: string
  /** Fleet assignment */
  fleet:       string
}

/**
 * All 11 active US Navy nuclear-powered carriers.
 * Positions are OSINT-estimated based on known homeports and deployment patterns.
 * Updated as USNI News mentions are detected.
 */
export const CARRIER_REGISTRY: CarrierInfo[] = [
  {
    name:         'USS Gerald R. Ford',
    hull:         'CVN-78',
    aliases:      ['Gerald Ford', 'Ford', 'CVN-78', 'CVN 78'],
    position:     [36.95, -76.33],
    positionName: 'Norfolk, Virginia (homeport)',
    fleet:        'Atlantic Fleet / 2nd Fleet',
  },
  {
    name:         'USS George Washington',
    hull:         'CVN-73',
    aliases:      ['George Washington', 'GW', 'CVN-73', 'CVN 73'],
    position:     [35.29, 139.67],
    positionName: 'Yokosuka, Japan (7th Fleet forward-deployed)',
    fleet:        '7th Fleet',
  },
  {
    name:         'USS Harry S. Truman',
    hull:         'CVN-75',
    aliases:      ['Harry Truman', 'Truman', 'HST', 'CVN-75', 'CVN 75'],
    position:     [36.95, -76.33],
    positionName: 'Norfolk, Virginia (homeport)',
    fleet:        'Atlantic Fleet / 2nd Fleet',
  },
  {
    name:         'USS Theodore Roosevelt',
    hull:         'CVN-71',
    aliases:      ['Theodore Roosevelt', 'TR', 'CVN-71', 'CVN 71'],
    position:     [32.70, -117.17],
    positionName: 'San Diego, California (homeport)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS Abraham Lincoln',
    hull:         'CVN-72',
    aliases:      ['Abraham Lincoln', 'Lincoln', 'CVN-72', 'CVN 72'],
    position:     [47.56, -122.63],
    positionName: 'Bremerton, Washington (homeport)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS Carl Vinson',
    hull:         'CVN-70',
    aliases:      ['Carl Vinson', 'Vinson', 'CVN-70', 'CVN 70'],
    position:     [32.70, -117.17],
    positionName: 'San Diego, California (homeport)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS Dwight D. Eisenhower',
    hull:         'CVN-69',
    aliases:      ['Dwight Eisenhower', 'Eisenhower', 'Ike', 'CVN-69', 'CVN 69'],
    position:     [36.95, -76.33],
    positionName: 'Norfolk, Virginia (homeport)',
    fleet:        'Atlantic Fleet / 2nd Fleet',
  },
  {
    name:         'USS Nimitz',
    hull:         'CVN-68',
    aliases:      ['Nimitz', 'CVN-68', 'CVN 68'],
    position:     [47.56, -122.63],
    positionName: 'Bremerton, Washington (homeport)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS John C. Stennis',
    hull:         'CVN-74',
    aliases:      ['John Stennis', 'Stennis', 'CVN-74', 'CVN 74'],
    position:     [32.70, -117.17],
    positionName: 'San Diego, California (homeport)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS Ronald Reagan',
    hull:         'CVN-76',
    aliases:      ['Ronald Reagan', 'Reagan', 'RR', 'CVN-76', 'CVN 76'],
    position:     [47.56, -122.63],
    positionName: 'Bremerton, Washington (in transit from Yokosuka)',
    fleet:        'Pacific Fleet / 3rd Fleet',
  },
  {
    name:         'USS George H.W. Bush',
    hull:         'CVN-77',
    aliases:      ['George Bush', 'H.W. Bush', 'GHWB', 'CVN-77', 'CVN 77'],
    position:     [36.95, -76.33],
    positionName: 'Norfolk, Virginia (homeport)',
    fleet:        'Atlantic Fleet / 2nd Fleet',
  },
]

// ─── EVENT TYPES ─────────────────────────────────────────────────────────────

export type CsgEventType = 'deployment' | 'arrival' | 'departure' | 'exercise' | 'mention'

const DEPARTURE_KEYWORDS = ['departed', 'departs', 'left port', 'underway', 'set sail', 'left for', 'deployed from']
const ARRIVAL_KEYWORDS   = ['arrived', 'arrives', 'returned', 'homecoming', 'pulled into', 'entered port', 'in port']
const EXERCISE_KEYWORDS  = ['exercise', 'drill', 'operation', 'wargame', 'joint', 'maneuver', 'transit']
const DEPLOYMENT_KEYWORDS = ['deployed', 'deployment', 'surge deployment', 'ordered to', 'diverted to', 'en route to']

export function detectEventType(text: string): CsgEventType {
  const lower = text.toLowerCase()
  if (DEPLOYMENT_KEYWORDS.some(kw => lower.includes(kw))) return 'deployment'
  if (DEPARTURE_KEYWORDS.some(kw => lower.includes(kw)))  return 'departure'
  if (ARRIVAL_KEYWORDS.some(kw => lower.includes(kw)))    return 'arrival'
  if (EXERCISE_KEYWORDS.some(kw => lower.includes(kw)))   return 'exercise'
  return 'mention'
}

export function eventSeverity(eventType: CsgEventType): 'high' | 'medium' {
  return eventType === 'deployment' ? 'high' : 'medium'
}

// ─── CARRIER DETECTION ───────────────────────────────────────────────────────

/**
 * Returns the first carrier found in the given text, or null if none matched.
 */
export function detectCarrier(text: string): CarrierInfo | null {
  const lower = text.toLowerCase()
  for (const carrier of CARRIER_REGISTRY) {
    if (lower.includes(carrier.name.toLowerCase())) return carrier
    for (const alias of carrier.aliases) {
      if (lower.includes(alias.toLowerCase())) return carrier
    }
  }
  return null
}

// ─── REDIS DEDUP ─────────────────────────────────────────────────────────────

export function dedupKey(hull: string, eventType: CsgEventType, articleUrl: string): string {
  // Sanitize hull designation for Redis key
  const safeHull = hull.replace(/[^a-zA-Z0-9-]/g, '_')
  // Use URL hash to avoid collisions when same carrier has multiple events
  const urlSlug = articleUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 60)
  return `osint:csg:${safeHull}:${eventType}:${urlSlug}`
}

// ─── POSITION ESTIMATION ─────────────────────────────────────────────────────

/**
 * Given an article text, tries to extract a geographic context for the carrier.
 * Falls back to the carrier's last-known static position.
 */
export function estimatePosition(
  carrier: CarrierInfo,
  text: string,
): { lat: number; lng: number; locationName: string } {
  const lower = text.toLowerCase()

  // Known deployment theaters — rough center coordinates
  const THEATER_COORDS: Array<{ keywords: string[]; lat: number; lng: number; name: string }> = [
    { keywords: ['mediterranean', 'med'],                      lat: 35.0,   lng: 18.0,   name: 'Mediterranean Sea' },
    { keywords: ['red sea'],                                   lat: 20.0,   lng: 38.0,   name: 'Red Sea' },
    { keywords: ['persian gulf', 'arabian gulf', 'fifth fleet'], lat: 26.5, lng: 53.5,   name: 'Persian Gulf / 5th Fleet' },
    { keywords: ['arabian sea'],                               lat: 15.0,   lng: 65.0,   name: 'Arabian Sea' },
    { keywords: ['pacific', 'western pacific', 'westpac'],    lat: 20.0,   lng: 145.0,  name: 'Western Pacific' },
    { keywords: ['south china sea'],                           lat: 15.0,   lng: 114.0,  name: 'South China Sea' },
    { keywords: ['philippine sea'],                            lat: 15.0,   lng: 130.0,  name: 'Philippine Sea' },
    { keywords: ['north atlantic', 'atlantic'],                lat: 45.0,   lng: -30.0,  name: 'North Atlantic' },
    { keywords: ['norfolk'],                                   lat: 36.95,  lng: -76.33, name: 'Norfolk, Virginia' },
    { keywords: ['san diego'],                                 lat: 32.70,  lng: -117.17, name: 'San Diego, California' },
    { keywords: ['bremerton'],                                 lat: 47.56,  lng: -122.63, name: 'Bremerton, Washington' },
    { keywords: ['yokosuka'],                                  lat: 35.29,  lng: 139.67, name: 'Yokosuka, Japan' },
    { keywords: ['guam'],                                      lat: 13.44,  lng: 144.79, name: 'Guam' },
    { keywords: ['hawaii', 'pearl harbor'],                    lat: 21.36,  lng: -157.97, name: 'Pearl Harbor, Hawaii' },
  ]

  for (const theater of THEATER_COORDS) {
    if (theater.keywords.some(kw => lower.includes(kw))) {
      return { lat: theater.lat, lng: theater.lng, locationName: theater.name }
    }
  }

  // Fall back to carrier's static estimated position
  return {
    lat:          carrier.position[0],
    lng:          carrier.position[1],
    locationName: carrier.positionName,
  }
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
        'Accept':     'application/rss+xml, application/xml, text/xml',
      },
    }, (res) => {
      // Follow one redirect
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
    req.on('timeout', () => { req.destroy(); reject(new Error('USNI RSS request timeout')) })
  })
}

// ─── RSS PARSING ─────────────────────────────────────────────────────────────

interface RssItem {
  title:   string
  link:    string
  pubDate: string
  description: string
}

/**
 * Minimal RSS 2.0 parser — extracts <item> blocks and their title/link/pubDate/description.
 * No external dependency; handles CDATA and HTML-encoded content.
 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []

  // Extract all <item>...</item> blocks
  const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi
  let itemMatch: RegExpExecArray | null

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const block = itemMatch[1]

    const extract = (tag: string): string => {
      // Match CDATA or plain text content
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`, 'i')
      const m  = re.exec(block)
      if (!m) return ''
      return (m[1] ?? m[2] ?? '').trim()
    }

    items.push({
      title:       extract('title'),
      link:        extract('link'),
      pubDate:     extract('pubDate'),
      description: extract('description'),
    })
  }

  return items
}

// ─── SIGNAL CREATION ─────────────────────────────────────────────────────────

async function createSignal(
  db:        Knex,
  redis:     Redis,
  producer:  Producer | null | undefined,
  carrier:   CarrierInfo,
  eventType: CsgEventType,
  item:      RssItem,
): Promise<boolean> {
  const key = dedupKey(carrier.hull, eventType, item.link || item.title)
  const seen = await redis.get(key)
  if (seen) return false

  const severity = eventSeverity(eventType)
  const fullText = `${item.title} ${item.description}`
  const pos      = estimatePosition(carrier, fullText)

  const eventLabel: Record<CsgEventType, string> = {
    deployment: 'Deployment',
    departure:  'Port Departure',
    arrival:    'Port Arrival',
    exercise:   'Exercise / Operation',
    mention:    'OSINT Update',
  }

  const title = `${carrier.name} (${carrier.hull}): ${eventLabel[eventType]}`
    .slice(0, 500)

  const summary = [
    item.title.trim() || `${carrier.name} ${eventType} reported by USNI News.`,
    `Fleet: ${carrier.fleet}.`,
    `OSINT-estimated position: ${pos.locationName}.`,
    'Source: USNI News (news.usni.org). Reliability: OSINT-estimated, not confirmed.',
  ].filter(Boolean).join(' ')

  const pubDate = item.pubDate ? new Date(item.pubDate) : new Date()
  const eventTime = isNaN(pubDate.getTime()) ? new Date() : pubDate

  try {
    const signal = await insertAndCorrelate({
      title,
      summary,
      category:          'conflict',
      severity,
      status:            'pending',
      reliability_score: RELIABILITY,
      source_count:      1,
      source_ids:        [],
      original_urls:     item.link ? [item.link] : ['https://news.usni.org/'],
      location:          db.raw('ST_MakePoint(?, ?)', [pos.lng, pos.lat]),
      location_name:     pos.locationName,
      country_code:      null,
      region:            null,
      tags:              [
        'osint', 'conflict', 'navy', 'carrier', 'csg',
        carrier.hull.toLowerCase().replace('-', ''),
        eventType,
      ],
      language:          'en',
      event_time:        eventTime,
    }, { lat: pos.lat, lng: pos.lng, sourceId: 'carrier-strike-groups' })

    await redis.setex(key, DEDUP_TTL_S, '1')

    if (signal && producer) {
      await producer.send({
        topic: 'signals.verified',
        messages: [{
          key:   'conflict',
          value: JSON.stringify({
            event:   'signal.new',
            payload: signal,
            filter:  { category: 'conflict', severity },
          }),
        }],
      }).catch(() => {})
    }

    return true
  } catch (err) {
    log.debug({ err, hull: carrier.hull, eventType }, 'CSG signal skipped (likely duplicate)')
    return false
  }
}

// ─── MAIN POLLER ─────────────────────────────────────────────────────────────

export function startCarrierStrikeGroupPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(
    process.env.CSG_POLL_INTERVAL_MS ?? 30 * 60_000,  // default 30 minutes
  )

  async function poll(): Promise<void> {
    try {
      log.debug('Polling USNI News RSS for carrier strike group mentions...')

      const xml = await httpsGet(USNI_RSS_URL)

      if (!xml || xml.length < 100) {
        log.warn('USNI RSS: empty or invalid response')
        return
      }

      const items = parseRssItems(xml)

      if (items.length === 0) {
        log.debug('USNI RSS: no items parsed')
        return
      }

      log.debug({ itemCount: items.length }, 'USNI RSS: parsed feed items')

      let created = 0

      for (const item of items) {
        const text = `${item.title} ${item.description}`

        const carrier = detectCarrier(text)
        if (!carrier) continue

        const eventType = detectEventType(text)

        const ok = await createSignal(db, redis, producer, carrier, eventType, item)
        if (ok) {
          created++
          log.debug({ hull: carrier.hull, eventType, title: item.title }, 'CSG signal created')
        }
      }

      if (created > 0) {
        log.info({ created, itemsScanned: items.length }, 'CSG: signals created from USNI News')
      } else {
        log.debug({ itemsScanned: items.length }, 'CSG poll complete (no new carrier events)')
      }
    } catch (err) {
      log.warn({ err }, 'CSG poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info(
    { intervalMs: INTERVAL_MS, carriers: CARRIER_REGISTRY.length },
    '⚓ CSG poller started — tracking all 11 US Navy carrier strike groups',
  )

  return () => {
    clearInterval(timer)
    log.info('CSG poller stopped')
  }
}
