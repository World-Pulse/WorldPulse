/**
 * AlienVault OTX (Open Threat Exchange) Cyber Threat Intelligence Source
 *
 * Polls the AlienVault OTX API for recently published threat pulses
 * from the world's largest open threat intelligence community.
 * Creates WorldPulse signals for new malware campaigns, APT activity,
 * vulnerability exploits, phishing campaigns, and cyber-attacks.
 *
 * API: https://otx.alienvault.com/api/v1/pulses/subscribed (with key)
 * Fallback: https://otx.alienvault.com/api/v1/pulses/activity (public)
 * Free tier: 10,000 requests/day with API key, public feed available.
 *
 * Reliability: 0.82 (community-contributed threat intel; top-rated pulses
 *   are from verified security researchers, but quality varies)
 * Category: security
 *
 * Complements CISA KEV (government vulnerability catalog) with real-time
 * community threat intelligence. No competitor tracks OTX pulses.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'otx-threats-source' })

const OTX_ACTIVITY_URL = 'https://otx.alienvault.com/api/v1/pulses/activity'
const RELIABILITY = 0.82
const DEDUP_TTL_S = 7 * 86_400 // 7-day dedup
const POLL_INTERVAL_MS = Number(process.env.OTX_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** APT and nation-state threat groups that escalate to critical */
const CRITICAL_ACTORS = /apt\d+|lazarus|cozy bear|fancy bear|sandworm|equation group|turla|apt28|apt29|apt41|hafnium|nobelium|lapsus|scattered spider|lockbit|blackcat|alphv|cl0p|rhysida/i

/** Attack types that indicate high severity */
const HIGH_ATTACK_TYPES = /ransomware|zero-day|0-day|supply.chain|critical vulnerability|remote code execution|rce|wiper|backdoor|rootkit|botnet|c2|command.and.control/i

/** Moderate attack indicators */
const MEDIUM_ATTACK_TYPES = /phishing|credential.?theft|spear.?phish|malware|trojan|exploit|brute.?force|ddos|data.?breach|exfiltration/i

/**
 * Map OTX threat pulse to WorldPulse severity based on
 * adversary type, attack technique, and indicator count.
 */
export function otxSeverity(
  name: string,
  description: string,
  tags: string[],
  indicatorCount: number,
): SignalSeverity {
  const combined = `${name} ${description} ${tags.join(' ')}`

  // Critical: APT/nation-state actors or major threat groups
  if (CRITICAL_ACTORS.test(combined)) return 'critical'

  // High: ransomware, zero-days, supply chain attacks
  if (HIGH_ATTACK_TYPES.test(combined)) return 'high'

  // High: large indicator sets suggest significant campaigns
  if (indicatorCount >= 100) return 'high'

  // Medium: standard malware, phishing, exploits
  if (MEDIUM_ATTACK_TYPES.test(combined)) return 'medium'

  // Medium: moderate indicator count
  if (indicatorCount >= 20) return 'medium'

  // Low: small or informational pulses
  return 'low'
}

/**
 * Infer a representative location from threat targeting info
 */
export function inferThreatRegion(
  name: string,
  description: string,
  tags: string[],
): { lat: number; lon: number } | null {
  const combined = `${name} ${description} ${tags.join(' ')}`.toLowerCase()

  const regionMap: Record<string, { lat: number; lon: number }> = {
    'united states': { lat: 39.83, lon: -98.58 },
    'usa':           { lat: 39.83, lon: -98.58 },
    'ukraine':       { lat: 48.38, lon: 31.17 },
    'russia':        { lat: 55.75, lon: 37.62 },
    'china':         { lat: 39.90, lon: 116.40 },
    'iran':          { lat: 35.69, lon: 51.39 },
    'north korea':   { lat: 39.02, lon: 125.75 },
    'europe':        { lat: 50.85, lon: 4.35 },
    'israel':        { lat: 31.77, lon: 35.22 },
    'india':         { lat: 20.59, lon: 78.96 },
    'japan':         { lat: 36.20, lon: 138.25 },
    'south korea':   { lat: 35.91, lon: 127.77 },
    'taiwan':        { lat: 23.70, lon: 120.96 },
    'uk':            { lat: 51.51, lon: -0.13 },
    'germany':       { lat: 51.17, lon: 10.45 },
    'france':        { lat: 46.23, lon: 2.21 },
  }

  for (const [region, coords] of Object.entries(regionMap)) {
    if (combined.includes(region)) return coords
  }

  return null // Global/unknown targeting
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

interface OtxPulse {
  id: string
  name: string
  description: string
  tags: string[]
  created: string
  modified: string
  indicators: { count?: number } | number
  author: { username: string }
  references: string[]
  adversary: string
  targeted_countries: string[]
}

async function pollOtxPulses(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'WorldPulse/1.0',
    }

    // Use API key if available for higher rate limits
    const apiKey = process.env.OTX_API_KEY
    if (apiKey) {
      headers['X-OTX-API-KEY'] = apiKey
    }

    const res = await fetch(OTX_ACTIVITY_URL, { headers })

    if (!res.ok) {
      log.warn({ status: res.status }, 'OTX API non-200 response')
      return
    }

    const data = (await res.json()) as { results?: OtxPulse[] }
    const pulses = data.results ?? []

    if (!pulses.length) {
      log.debug('No new OTX threat pulses')
      return
    }

    // Process latest 10 pulses per poll
    let ingested = 0

    for (const pulse of pulses.slice(0, 10)) {
      const dedupKey = `osint:otx:${pulse.id}`
      const seen = await redis.get(dedupKey)
      if (seen) continue

      const indicatorCount = typeof pulse.indicators === 'number'
        ? pulse.indicators
        : pulse.indicators?.count ?? 0

      const severity = otxSeverity(
        pulse.name,
        pulse.description ?? '',
        pulse.tags ?? [],
        indicatorCount,
      )

      const location = inferThreatRegion(
        pulse.name,
        pulse.description ?? '',
        pulse.tags ?? [],
      )

      const adversaryLabel = pulse.adversary ? ` [${pulse.adversary}]` : ''

      const signalData = {
        title: `Cyber Threat${adversaryLabel}: ${pulse.name.slice(0, 140)}`.slice(0, 500),
        summary: `${(pulse.description ?? '').slice(0, 500)}\n\nTags: ${(pulse.tags ?? []).slice(0, 10).join(', ')}\nIndicators: ${indicatorCount}\nAuthor: ${pulse.author?.username ?? 'unknown'}`,
        original_urls: [`https://otx.alienvault.com/pulse/${pulse.id}`],
        source_ids: [],
        category: 'security',
        severity,
        status: 'pending',
        reliability_score: RELIABILITY,
        location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
        location_name: location?.name || 'Unknown',
        country_code: null,
        region: null,
        tags: ['osint', 'cybersecurity', 'otx', 'threat', 'alienvault'],
        language: 'en',
        event_time: pulse.created ? new Date(pulse.created) : new Date(),
        source_count: 1,
      }

      try {
        await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'otx-threats' })

        if (producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{ value: JSON.stringify(signal) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        ingested++
      } catch (err) {
        log.warn({ err, pulseId: pulse.id }, 'Failed to ingest OTX pulse')
      }
    }

    if (ingested > 0) {
      log.info({ ingested, total: pulses.length }, 'OTX threat pulses ingested')
    }
  } catch (err) {
    log.error({ err }, 'OTX threat pulse poll failed')
  }
}

export function startOtxPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info('Starting AlienVault OTX threat pulse poller (30-min interval)')
  pollOtxPulses(db, redis, producer)

  const timer = setInterval(() => pollOtxPulses(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
