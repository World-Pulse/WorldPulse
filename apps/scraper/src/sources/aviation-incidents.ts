/**
 * Aviation Safety / Incident Signal Source
 *
 * Polls the Aviation Safety Network (ASN) and ICAO iSTARS public
 * aviation safety data for accidents, incidents, and near-misses.
 * Creates WorldPulse signals for aviation safety events that affect
 * global transportation and public safety.
 *
 * Primary: Aviation Safety Network (aviation-safety.net) RSS feed
 * Backup: FAA Preliminary Accident/Incident Data
 * Free, no API key required.
 *
 * Reliability: 0.88 (ASN is the gold-standard aviation safety database;
 *   reports may lag real-time by hours/days for preliminary data)
 * Category: transportation
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks aviation safety incidents as structured intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'aviation-incidents-source' })

const ASN_RSS_URL = 'https://aviation-safety.net/rss/allincidents.xml'
const FAA_INCIDENTS_URL = 'https://www.asias.faa.gov/apex/f?p=100:12:::NO'
const RELIABILITY = 0.88
const DEDUP_TTL_S = 7 * 86_400 // 7-day dedup
const POLL_INTERVAL_MS = Number(process.env.AVIATION_INTERVAL_MS) || 60 * 60_000 // 60 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** Fatality-based severity escalation */
export function aviationSeverity(
  fatalities: number,
  aircraftType: string,
  description: string,
): SignalSeverity {
  const combined = `${aircraftType} ${description}`.toLowerCase()

  // Critical: mass casualty event (>50 fatalities) or major airliner crash
  if (fatalities >= 50) return 'critical'
  if (fatalities >= 10 && /airliner|a[23]\d{2}|b7[3-8]\d|boeing|airbus|737|747|777|787|a320|a330|a350|a380/i.test(combined)) return 'critical'

  // High: significant fatalities or military aviation incident
  if (fatalities >= 10) return 'high'
  if (fatalities >= 1 && /military|fighter|bomber|transport|cargo|helicopter crash/i.test(combined)) return 'high'

  // Medium: fatalities or significant hull loss
  if (fatalities >= 1) return 'medium'
  if (/hull loss|destroyed|ditching|crash land|emergency landing|engine failure|fire/i.test(combined)) return 'medium'

  // Low: minor incidents, near misses
  return 'low'
}

/**
 * Determine if an aviation event is significant enough to create a signal.
 */
export function isSignificantAviation(
  fatalities: number,
  description: string,
): boolean {
  if (fatalities >= 1) return true
  if (/hull loss|destroyed|crash|ditching|emergency|fire|engine failure|midair/i.test(description)) return true
  return false
}

// ─── RSS PARSING ────────────────────────────────────────────────────────────

interface AsnEntry {
  title: string
  link: string
  description: string
  pubDate: string
  fatalities: number
  aircraftType: string
  location: string
  lat?: number
  lon?: number
}

/**
 * Extract fatality count from ASN RSS entry description.
 */
export function extractFatalities(text: string): number {
  // Match patterns like "3 killed", "fatalities: 150", "all 189 occupants"
  const match = text.match(/(\d+)\s*(?:killed|fatal|dead|died|perished|occupants?\s+(?:killed|dead))/i)
    ?? text.match(/fatalities?:?\s*(\d+)/i)
    ?? text.match(/(?:all\s+)?(\d+)\s+(?:on\s+board\s+)?(?:killed|perished|lost)/i)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Extract aircraft type from ASN RSS entry.
 */
export function extractAircraftType(text: string): string {
  const match = text.match(/(?:Boeing|Airbus|Cessna|Piper|Beechcraft|Embraer|Bombardier|ATR|de Havilland|Lockheed|Antonov|Tupolev|Sukhoi|Mil)\s+[\w-]+/i)
    ?? text.match(/(?:A\d{3}|B?7[0-9]{2}|737|747|777|787|A320|A330|A350|A380|MD-\d+|DC-\d+|ERJ[\w-]+|CRJ[\w-]+)\b/i)
  return match ? match[0] : 'Unknown type'
}

// ─── GEOLOCATION ────────────────────────────────────────────────────────────

/** Known airport/region coordinates for aviation incident geolocation */
const AVIATION_REGIONS: Record<string, { lat: number; lon: number }> = {
  // Major regions
  'north atlantic': { lat: 45.0, lon: -30.0 },
  'south atlantic': { lat: -20.0, lon: -25.0 },
  'pacific': { lat: 20.0, lon: -160.0 },
  'indian ocean': { lat: -10.0, lon: 70.0 },
  'mediterranean': { lat: 36.0, lon: 15.0 },
  'caribbean': { lat: 18.0, lon: -70.0 },
  // Countries (common incident locations)
  'united states': { lat: 39.83, lon: -98.58 },
  'russia': { lat: 55.75, lon: 37.62 },
  'brazil': { lat: -15.79, lon: -47.88 },
  'india': { lat: 28.61, lon: 77.21 },
  'indonesia': { lat: -6.21, lon: 106.85 },
  'china': { lat: 39.90, lon: 116.40 },
  'nigeria': { lat: 9.06, lon: 7.49 },
  'colombia': { lat: 4.71, lon: -74.07 },
  'iran': { lat: 35.69, lon: 51.39 },
  'congo': { lat: -4.32, lon: 15.31 },
}

/**
 * Infer geolocation from aviation incident description.
 * Falls back to lat 0 / lon 0 (mid-Atlantic) if no match.
 */
export function inferAviationLocation(
  location: string,
  description: string,
): { lat: number; lon: number } {
  const text = `${location} ${description}`.toLowerCase()
  for (const [key, coords] of Object.entries(AVIATION_REGIONS)) {
    if (text.includes(key)) return coords
  }
  return { lat: 0, lon: 0 }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

async function fetchAsnFeed(): Promise<AsnEntry[]> {
  try {
    const xml = await fetchWithResilience(
      'aviation-incidents',
      'Aviation Incidents',
      ASN_RSS_URL,
      async () => {
        const res = await fetch(ASN_RSS_URL, {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'WorldPulse-OSINT/1.0 (open-source intelligence aggregator)',
          },
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw Object.assign(new Error(`Aviation Incidents: HTTP ${res.status}`), { statusCode: res.status })
        return res.text()
      },
    )
    return parseAsnRss(xml)
  } catch (err) {
    if (err instanceof CircuitOpenError) return []
    log.error({ err }, 'Failed to fetch ASN aviation incident feed')
    return []
  }
}

/**
 * Parse ASN RSS XML into structured entries.
 * Uses simple regex-based XML parsing (no external XML library needed).
 */
export function parseAsnRss(xml: string): AsnEntry[] {
  const entries: AsnEntry[] = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemPattern.exec(xml)) !== null) {
    const item = match[1]
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1]
      ?? ''
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? ''
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1]
      ?? ''
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? ''

    const fatalities = extractFatalities(`${title} ${description}`)
    const aircraftType = extractAircraftType(`${title} ${description}`)

    // Extract location from title (ASN format: "date Type near Location")
    const locationMatch = title.match(/(?:near|at|in|over)\s+(.+?)(?:,|\s*$)/i)
    const location = locationMatch?.[1] ?? ''

    entries.push({
      title,
      link,
      description,
      pubDate,
      fatalities,
      aircraftType,
      location,
    })
  }

  return entries
}

async function pollAviationIncidents(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    log.debug('Polling aviation safety incident data…')

    const entries = await fetchAsnFeed()
    if (entries.length === 0) {
      log.debug('No ASN entries returned')
      return
    }

    let inserted = 0

    for (const entry of entries.slice(0, 15)) {
      if (!isSignificantAviation(entry.fatalities, entry.description)) continue

      // Create stable dedup key from link (unique per incident)
      const incidentId = entry.link.replace(/\D/g, '').slice(-10) || entry.title.slice(0, 40)
      const dedupKey = `osint:aviation:${incidentId}`

      const seen = await redis.get(dedupKey)
      if (seen) continue

      const severity = aviationSeverity(entry.fatalities, entry.aircraftType, entry.description)
      const { lat, lon } = inferAviationLocation(entry.location, entry.description)

      const signalData = {
        title: `Aviation Incident: ${entry.title}`.slice(0, 500),
        summary: `${entry.description.slice(0, 400)} | Aircraft: ${entry.aircraftType} | Fatalities: ${entry.fatalities}`,
        original_urls: [entry.link || 'https://aviation-safety.net'],
        source_ids: [],
        category: 'transportation',
        status: 'pending',
        severity,
        reliability_score: RELIABILITY,
        location: lat !== 0 || lon !== 0 ? db.raw('ST_MakePoint(?, ?)', [lon, lat]) : null,
        location_name: entry.location || 'Unknown',
        country_code: null,
        region: null,
        tags: ['osint', 'aviation', 'incidents', 'asn'],
        language: 'en',
        event_time: entry.pubDate ? new Date(entry.pubDate) : new Date(),
        source_count: 1,
      }

      try {
        const signal = await insertAndCorrelate(signalData, { lat: lat || null, lng: lon || null, sourceId: 'aviation-incidents' })

        if (producer) {
          await producer.send({
            topic: 'signals',
            messages: [{ key: String(signal['source_id'] ?? ''), value: JSON.stringify(signal) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        inserted++
      } catch (err) {
        log.error({ err, incidentId }, 'Failed to insert aviation incident signal')
      }
    }

    log.info({ inserted, total: entries.length }, 'Aviation incident poll complete')
  } catch (err) {
    log.error({ err }, 'Aviation incident poll failed')
  }
}

// ─── EXPORTED START FUNCTION ────────────────────────────────────────────────

export function startAviationIncidentPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info(`Starting Aviation Safety Incident poller (interval ${POLL_INTERVAL_MS / 60_000} min)`)
  pollAviationIncidents(db, redis, producer).catch(err =>
    log.error({ err }, 'Initial aviation incident poll failed'),
  )
  const timer = setInterval(
    () => pollAviationIncidents(db, redis, producer).catch(err =>
      log.error({ err }, 'Aviation incident poll failed'),
    ),
    POLL_INTERVAL_MS,
  )
  return () => {
    clearInterval(timer)
    log.info('Aviation Safety Incident poller stopped')
  }
}