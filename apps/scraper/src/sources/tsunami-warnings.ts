/**
 * NOAA Tsunami Warning Signal Source
 *
 * Polls the NOAA/NWS National Tsunami Warning Center (NTWC) and Pacific
 * Tsunami Warning Center (PTWC) Atom/RSS feeds for active tsunami warnings,
 * watches, and advisories worldwide.
 *
 * Feed: https://www.tsunami.gov/events/xml/PAAQAtom.xml (PTWC)
 * Feed: https://www.tsunami.gov/events/xml/PHEBAtom.xml (NTWC Alaska)
 * Docs: https://www.tsunami.gov/
 * Free, no API key required, US government public safety data.
 *
 * Reliability: 0.97 (NOAA NTWC/PTWC are the authoritative global tsunami
 *   warning centers; bulletins carry life-safety priority)
 * Category: weather
 *
 * Unique to WorldPulse — no competitor tracks dedicated tsunami warnings
 * as separate intelligence signals (NWS alerts include some but miss PTWC
 * international bulletins).
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'tsunami-warning-source' })

const TSUNAMI_FEEDS = [
  'https://www.tsunami.gov/events/xml/PAAQAtom.xml',  // PTWC — Pacific
  'https://www.tsunami.gov/events/xml/PHEBAtom.xml',  // NTWC — Alaska/US
]
const RELIABILITY = 0.97
const DEDUP_TTL_S = 3 * 86_400 // 3-day dedup
const POLL_INTERVAL_MS = Number(process.env.TSUNAMI_INTERVAL_MS) || 10 * 60_000 // 10 min (life-safety)

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** Tsunami alert level keywords → severity */
const WARNING_RE = /warning/i
const WATCH_RE = /watch/i
const ADVISORY_RE = /advisory/i
const INFORMATION_RE = /information|statement|bulletin/i

/**
 * Map tsunami bulletin type and content to WorldPulse severity.
 * Tsunami warnings are always at least high severity due to life-safety implications.
 */
export function tsunamiSeverity(
  title: string,
  summary: string,
): SignalSeverity {
  const combined = `${title} ${summary}`

  // Critical: active warning with measured wave heights or major earthquake trigger
  if (WARNING_RE.test(combined) && /measured|observed|wave height|inundation|M[89]\.|M7\.[5-9]/i.test(combined)) {
    return 'critical'
  }

  // Critical: any warning for major population centers
  if (WARNING_RE.test(combined)) return 'critical'

  // High: watch issued (potential tsunami, monitoring in progress)
  if (WATCH_RE.test(combined)) return 'high'

  // Medium: advisory (minor waves expected, beach hazard)
  if (ADVISORY_RE.test(combined)) return 'medium'

  // Low: information/statement bulletins
  if (INFORMATION_RE.test(combined)) return 'low'

  return 'medium' // default for unclassified tsunami bulletins
}

/**
 * Extract geographic coordinates from tsunami bulletin text.
 * Bulletins typically contain earthquake epicenter or affected region info.
 */
export function extractTsunamiLocation(
  title: string,
  summary: string,
): { lat: number; lon: number } | null {
  const combined = `${title} ${summary}`

  // Try to extract earthquake epicenter coordinates (common in bulletins)
  // Pattern: "XX.X North XX.X West" or similar
  const coordMatch = combined.match(
    /(\d+\.?\d*)\s*(North|South|N|S)[,\s]+(\d+\.?\d*)\s*(East|West|E|W)/i,
  )
  if (coordMatch) {
    let lat = parseFloat(coordMatch[1])
    let lon = parseFloat(coordMatch[3])
    if (/South|S/i.test(coordMatch[2])) lat = -lat
    if (/West|W/i.test(coordMatch[4])) lon = -lon
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon }
    }
  }

  // Fallback: infer from region keywords
  return inferTsunamiRegion(combined)
}

/** Region inference from tsunami bulletin text */
function inferTsunamiRegion(text: string): { lat: number; lon: number } | null {
  const REGIONS: Array<[RegExp, { lat: number; lon: number }]> = [
    [/pacific|hawaii/i, { lat: 19.90, lon: -155.58 }],
    [/alaska|aleutian/i, { lat: 56.00, lon: -160.00 }],
    [/japan/i, { lat: 36.20, lon: 138.25 }],
    [/chile/i, { lat: -35.68, lon: -71.54 }],
    [/indonesia|sumatra|java/i, { lat: -0.79, lon: 113.92 }],
    [/philippines/i, { lat: 12.88, lon: 121.77 }],
    [/new zealand|tonga|samoa/i, { lat: -18.0, lon: -175.0 }],
    [/caribbean/i, { lat: 15.00, lon: -68.00 }],
    [/mediterranean/i, { lat: 35.00, lon: 18.00 }],
    [/indian ocean/i, { lat: -5.00, lon: 75.00 }],
    [/atlantic/i, { lat: 25.00, lon: -45.00 }],
    [/west coast|california|oregon|washington/i, { lat: 37.77, lon: -122.42 }],
    [/mexico/i, { lat: 23.63, lon: -102.55 }],
    [/peru/i, { lat: -9.19, lon: -75.02 }],
    [/papua|solomon/i, { lat: -6.31, lon: 147.00 }],
  ]

  for (const [re, coords] of REGIONS) {
    if (re.test(text)) return coords
  }
  return null
}

// ─── ATOM FEED PARSING ──────────────────────────────────────────────────────

interface AtomEntry {
  id: string
  title: string
  summary: string
  link: string
  updated: string
}

/**
 * Minimal Atom XML parser for tsunami feeds.
 * Extracts entry id, title, summary, link, and updated fields.
 */
export function parseAtomEntries(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = []
  const entryBlocks = xml.split(/<entry>/i).slice(1)

  for (const block of entryBlocks) {
    const id = block.match(/<id>([^<]+)<\/id>/i)?.[1]?.trim() ?? ''
    const title = block.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? ''
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]?.trim() ?? ''
    const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1]?.trim() ?? ''
    const updated = block.match(/<updated>([^<]+)<\/updated>/i)?.[1]?.trim() ?? ''

    if (id && title) {
      entries.push({ id, title, summary, link, updated })
    }
  }

  return entries
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startTsunamiWarningPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      log.info('Polling NOAA tsunami warning feeds')

      let totalInserted = 0

      for (const feedUrl of TSUNAMI_FEEDS) {
        try {
          const res = await fetch(feedUrl, {
            headers: {
              'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network)',
              'Accept': 'application/atom+xml, application/xml, text/xml',
            },
            signal: AbortSignal.timeout(30_000),
          })

          if (!res.ok) {
            log.warn({ status: res.status, feed: feedUrl }, 'Tsunami feed returned non-OK status')
            continue
          }

          const xml = await res.text()
          const entries = parseAtomEntries(xml)

          if (entries.length === 0) {
            log.debug({ feed: feedUrl }, 'No tsunami entries in feed')
            continue
          }

          log.info({ count: entries.length, feed: feedUrl }, 'Tsunami entries fetched')

          for (const entry of entries.slice(0, 10)) {
            // Hash the entry ID for dedup
            const dedupKey = `osint:tsunami:${Buffer.from(entry.id).toString('base64').slice(0, 64)}`
            const exists = await redis.get(dedupKey)
            if (exists) continue

            const severity = tsunamiSeverity(entry.title, entry.summary)
            const location = extractTsunamiLocation(entry.title, entry.summary)

            // Strip HTML from summary
            const cleanSummary = entry.summary
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\s+/g, ' ')
              .trim()

            const signalData = {
              title: `Tsunami Alert: ${entry.title.slice(0, 200)}`,
              summary: (cleanSummary || `NOAA tsunami bulletin: ${entry.title}`).slice(0, 2000),
              original_urls: [entry.link || feedUrl],
              source_ids: [],
              category: 'weather' as const,
              severity,
              status: 'pending',
              reliability_score: RELIABILITY,
              location: location ? db.raw('ST_MakePoint(?, ?)', [location.lng, location.lat]) : null,
              location_name: location?.name || 'Tsunami Region',
              country_code: null,
              region: null,
              tags: ['osint', 'tsunami', 'warning', 'noaa', 'weather'],
              language: 'en',
              event_time: entry.updated ? new Date(entry.updated) : new Date(),
              source_count: 1,
            }

            await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lng ?? null, sourceId: 'tsunami-warnings' })
            await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

            if (producer) {
              try {
                await producer.send({
                  topic: 'worldpulse.signals.new',
                  messages: [{ value: JSON.stringify(signal) }],
                })
              } catch (kafkaErr) {
                log.warn({ kafkaErr }, 'Failed to publish tsunami signal to Kafka')
              }
            }

            totalInserted++
          }
        } catch (feedErr) {
          log.warn({ err: feedErr, feed: feedUrl }, 'Error polling individual tsunami feed')
        }
      }

      if (totalInserted > 0) {
        log.info({ inserted: totalInserted }, 'New tsunami warning signals created')
      }
    } catch (err) {
      log.error({ err }, 'Tsunami warning poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('Tsunami warning poller stopped')
  }
}
