/**
 * Internet Outage Monitoring Signal Source
 *
 * Polls the Georgia Tech IODA (Internet Outage Detection and Analysis) API
 * every 10 minutes for significant internet connectivity outages globally.
 *
 * API: https://api.ioda.caida.org/v2/alerts/?from=<unix>&until=<unix>
 * Free, no API key required. Returns country/region/ASN-level outage alerts.
 *
 * Severity mapping:
 *   score >= 500 → critical (major national outage)
 *   score >= 100 → high    (severe regional outage)
 *   score >= 30  → medium  (notable connectivity degradation)
 *   else         → low
 *
 * Reliability: 0.87 (IODA uses BGP + active probing + telescope signals)
 *
 * Counters Shadowbroker's Internet Outage Monitoring (IODA) advantage.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'ioda-source' })

const IODA_API_BASE = 'https://api.ioda.caida.org/v2'

// ─── API TYPES ──────────────────────────────────────────────────────────────
interface IodaEntityGeo {
  country_code?: string
  country?:      string
}

interface IodaEntity {
  type:    'country' | 'region' | 'asn'
  code:    string
  name:    string
  attrs?:  IodaEntityGeo
}

interface IodaAlert {
  id?:         number
  entityType:  string
  entity:      IodaEntity
  time:        number   // Unix timestamp (seconds)
  level:       string   // 'normal' | 'warning' | 'critical'
  score:       number   // anomaly score (higher = worse)
  datasource:  string
}

interface IodaAlertsResponse {
  data?: IodaAlert[]
}

// ─── HTTP HELPER ────────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('IODA request timeout')) })
  })
}

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────
export function iodaSeverity(score: number): SignalSeverity {
  if (score >= 500) return 'critical'
  if (score >= 100) return 'high'
  if (score >= 30)  return 'medium'
  return 'low'
}

/** Country code → approximate centroid [lng, lat] for major countries. */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AF: [67.71, 33.93],  US: [-95.71, 37.09], RU: [105.32, 61.52],
  CN: [104.20, 35.86], BR: [-51.93, -14.24], AU: [133.78, -25.27],
  IN: [78.96, 20.59],  FR: [2.21, 46.23],   DE: [10.45, 51.17],
  GB: [-3.44, 55.38],  UA: [31.17, 48.38],  IR: [53.69, 32.43],
  SY: [38.30, 34.80],  IQ: [43.68, 33.22],  TR: [35.24, 38.96],
  EG: [30.80, 26.82],  PK: [69.35, 30.38],  NG: [8.68, 9.08],
  KP: [127.51, 40.34], BY: [27.95, 53.71],  AZ: [47.58, 40.14],
  MM: [95.96, 16.87],  ET: [40.49, 9.14],   KZ: [66.92, 48.02],
  VE: [-66.59, 6.42],  CU: [-79.52, 21.52], SD: [30.22, 12.86],
}

function entityCentroid(entity: IodaEntity): [number, number] | null {
  const cc = entity.attrs?.country_code ?? entity.code
  return COUNTRY_CENTROIDS[cc.toUpperCase()] ?? null
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────
export function startIodaPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS  = Number(process.env.IODA_INTERVAL_MS ?? 10 * 60_000) // 10 min default
  const MIN_SCORE    = Number(process.env.IODA_MIN_SCORE ?? 30)             // anomaly threshold
  const LOOKBACK_S   = Number(process.env.IODA_LOOKBACK_S ?? 600)           // 10-min lookback window

  async function poll(): Promise<void> {
    try {
      const now   = Math.floor(Date.now() / 1_000)
      const from  = now - LOOKBACK_S
      const url   = `${IODA_API_BASE}/alerts/?from=${from}&until=${now}&entityType=country&minScore=${MIN_SCORE}&limit=20`

      log.debug({ url }, 'Polling IODA internet outage alerts...')
      const raw  = await httpsGet(url)
      const body = JSON.parse(raw) as IodaAlertsResponse

      const alerts = (body.data ?? [])
        .filter(a => a.score >= MIN_SCORE && a.level !== 'normal')
        // Sort by severity score descending
        .sort((a, b) => b.score - a.score)

      if (alerts.length === 0) {
        log.debug('IODA: no outage alerts above threshold')
        return
      }

      let created = 0

      for (const alert of alerts) {
        const { entity, score, datasource, time } = alert
        const severity = iodaSeverity(score)

        // Dedup key: entity code + truncated 10-min bucket to avoid re-inserting within window
        const bucket = Math.floor(time / 600) * 600
        const key    = `ioda:dedup:${entity.type}:${entity.code}:${bucket}`
        const seen   = await redis.get(key)
        if (seen) continue

        const centroid = entityCentroid(entity)
        const entityLabel = entity.name ?? entity.code

        const signalTitle = `Internet Outage Detected — ${entityLabel} (IODA score: ${Math.round(score)})`
        const dsLabel = datasource ? ` via ${datasource}` : ''
        const summary = [
          `Georgia Tech IODA detected significant internet connectivity disruption in ${entityLabel}${dsLabel}.`,
          `Anomaly score: ${Math.round(score)} (${severity} severity).`,
          `Detection methods: BGP routing anomalies, active probing, network telescope data.`,
          'Source: IODA — Internet Outage Detection and Analysis (Georgia Tech / CAIDA).',
        ].join(' ')

        try {
          const insertData: Record<string, unknown> = {
            title:             signalTitle.slice(0, 500),
            summary,
            category:          'technology',
            severity,
            status:            'pending',
            reliability_score: 0.87,
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://ioda.caida.org/'],
            location_name:     entityLabel,
            country_code:      entity.attrs?.country_code ?? null,
            region:            null,
            tags:              ['osint', 'internet', 'outage', 'ioda', 'connectivity', entity.type],
            language:          'en',
            event_time:        new Date(time * 1_000),
          }

          if (centroid) {
            insertData.location = db.raw('ST_MakePoint(?, ?)', [centroid[0], centroid[1]])
          }

          const signal = await insertAndCorrelate(insertData, { lat: centroid?.[1] ?? null, lng: centroid?.[0] ?? null, sourceId: 'ioda' })

          // Dedup for 30 min — IODA refreshes every ~10 min but we deduplicate per window
          await redis.setex(key, 30 * 60, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'technology', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, key }, 'IODA signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: alerts.length }, 'IODA: outage signals created')
      } else {
        log.debug({ total: alerts.length }, 'IODA poll complete (no new outages)')
      }
    } catch (err) {
      log.warn({ err }, 'IODA poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS, minScore: MIN_SCORE }, 'IODA internet outage poller started (Georgia Tech / CAIDA)')

  return () => {
    clearInterval(timer)
    log.info('IODA poller stopped')
  }
}
