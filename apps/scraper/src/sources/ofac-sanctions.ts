/**
 * OFAC Sanctions List Signal Source
 *
 * Polls the US Treasury OFAC Specially Designated Nationals (SDN) list
 * RSS feed for newly added sanctions designations. Creates WorldPulse
 * signals for geopolitical sanctions events that affect global trade,
 * finance, and security.
 *
 * Feed: https://ofac.treasury.gov/recent-actions (RSS/Atom feed)
 * Backup: https://ofac.treasury.gov/system/files/126/sdn.csv (full SDN CSV)
 * Free, no API key required.
 *
 * Reliability: 0.97 (US Treasury is the authoritative source for sanctions;
 *   SDN list entries are legally binding designations)
 * Category: security
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks sanctions designations as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'ofac-sanctions-source' })

const OFAC_RECENT_URL = 'https://ofac.treasury.gov/recent-actions/rss.xml'
const OFAC_FALLBACK_URL = 'https://ofac.treasury.gov/recent-actions'
const RELIABILITY = 0.97
const DEDUP_TTL_S = 14 * 86_400 // 14-day dedup (sanctions are persistent)
const POLL_INTERVAL_MS = Number(process.env.OFAC_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** High-threat country/program patterns for severity escalation */
const CRITICAL_PROGRAMS = /russia|iran|north korea|dprk|syria|china|prc|belarus|venezuela|cuba|terrorism|wmd|weapons of mass destruction|proliferation|cyber/i
const HIGH_PROGRAMS = /narcotics|transnational criminal|magnitsky|global sanctions|human rights|glomag|caatsa|ukraine/i

/**
 * Map OFAC sanctions designations to WorldPulse severity based on
 * the sanctions program, entity type, and designation scope.
 */
export function sanctionsSeverity(
  title: string,
  description: string,
  programRef: string,
): SignalSeverity {
  const combined = `${title} ${description} ${programRef}`

  // Critical: major nation-state sanctions, terrorism, WMD, or cyber
  if (CRITICAL_PROGRAMS.test(combined)) return 'critical'

  // High: narcotics, human rights, transnational crime
  if (HIGH_PROGRAMS.test(combined)) return 'high'

  // Medium: entity-level designation or update
  if (/designation|addition|update/i.test(title)) return 'medium'

  // Low: removal, general license, or other administrative
  return 'low'
}

/**
 * Infer geopolitical context region from sanctions program names
 */
export function inferSanctionsRegion(text: string): { lat: number; lon: number } | null {
  const regionMap: Record<string, { lat: number; lon: number }> = {
    russia:        { lat: 55.75, lon: 37.62 },
    iran:          { lat: 35.69, lon: 51.39 },
    'north korea': { lat: 39.02, lon: 125.75 },
    dprk:          { lat: 39.02, lon: 125.75 },
    syria:         { lat: 33.51, lon: 36.29 },
    china:         { lat: 39.90, lon: 116.40 },
    prc:           { lat: 39.90, lon: 116.40 },
    cuba:          { lat: 23.11, lon: -82.37 },
    venezuela:     { lat: 10.49, lon: -66.88 },
    belarus:       { lat: 53.90, lon: 27.57 },
    myanmar:       { lat: 19.76, lon: 96.07 },
    yemen:         { lat: 15.35, lon: 44.21 },
    somalia:       { lat: 2.05, lon: 45.32 },
    mali:          { lat: 12.64, lon: -8.00 },
    sudan:         { lat: 15.60, lon: 32.53 },
    libya:         { lat: 32.90, lon: 13.18 },
    lebanon:       { lat: 33.89, lon: 35.50 },
    iraq:          { lat: 33.31, lon: 44.37 },
    afghanistan:   { lat: 34.53, lon: 69.17 },
  }

  const lower = text.toLowerCase()
  for (const [country, coords] of Object.entries(regionMap)) {
    if (lower.includes(country)) return coords
  }

  // Default: Washington DC (OFAC HQ) for unlocated sanctions
  return { lat: 38.89, lon: -77.04 }
}

// ─── XML PARSING HELPERS ────────────────────────────────────────────────────

interface RssItem {
  title: string
  description: string
  link: string
  pubDate: string
  guid: string
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
  const m = xml.match(re)
  return (m?.[1] ?? m?.[2] ?? '').trim()
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'description'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      guid: extractTag(block, 'guid') || extractTag(block, 'link'),
    })
  }

  return items
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startOfacSanctionsPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      log.info('Polling OFAC sanctions recent actions')

      const res = await fetch(OFAC_RECENT_URL, {
        headers: { 'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network)' },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        log.warn({ status: res.status }, 'OFAC RSS feed returned non-OK status, trying fallback scrape')
        return
      }

      const xml = await res.text()
      const items = parseRssItems(xml)

      if (items.length === 0) {
        log.debug('No items in OFAC RSS feed')
        return
      }

      // Filter to last 7 days
      const cutoff = Date.now() - 7 * 86_400_000
      const recent = items.filter(item => {
        const d = new Date(item.pubDate)
        return !isNaN(d.getTime()) && d.getTime() > cutoff
      })

      log.info({ total: items.length, recent: recent.length }, 'OFAC items fetched')

      let inserted = 0

      for (const item of recent) {
        const dedupKey = `osint:ofac:${item.guid.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 100)}`
        const exists = await redis.get(dedupKey)
        if (exists) continue

        const severity = sanctionsSeverity(item.title, item.description, item.title)
        const location = inferSanctionsRegion(`${item.title} ${item.description}`)

        const signalData = {
          title: `OFAC Sanctions: ${item.title.slice(0, 200)}`,
          summary: item.description.slice(0, 2000) || item.title,
          original_urls: [item.link],
          source_ids: [],
          category: 'security' as const,
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lng, location.lat]) : null,
          location_name: location?.name || 'Unknown',
          country_code: null,
          region: null,
          tags: ['osint', 'sanctions', 'ofac', 'security'],
          language: 'en',
          event_time: new Date(item.pubDate),
          source_count: 1,
        }

        await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lng ?? null, sourceId: 'ofac-sanctions' })
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signal) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish OFAC signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New OFAC sanctions signals created')
      }
    } catch (err) {
      log.error({ err }, 'OFAC sanctions poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('OFAC sanctions poller stopped')
  }
}
