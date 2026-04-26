/**
 * UN Comtrade Strategic Commodity Flows Signal Source
 *
 * Polls the UN Comtrade v3 public preview API for strategic commodity trade
 * flows between countries. Covers crude oil, semiconductors, nuclear materials,
 * critical minerals, and other HS-coded commodities with geopolitical relevance.
 *
 * API: https://comtradeapi.un.org/public/v1/preview/C/A/HS
 * No authentication required for the public preview endpoint.
 * Annual (A) trade data — expect ~2-year reporting lag from UN statistical offices.
 *
 * Reliability: 0.91 (UN official national statistics; quarterly lag applies)
 * Category: economy
 *
 * Severity rules:
 *   critical — nuclear/radioactive (HS 2844) OR trade value >$10B
 *   high     — semiconductors (HS 8542) OR crude oil (HS 2709) OR value >$1B
 *   medium   — other strategic commodities >$100M
 *   low      — smaller flows of strategic interest
 *
 * Dedup: osint:comtrade:{reporterCode}:{partnerCode}:{cmdCode}:{period} @ 7-day TTL
 *
 * Poll interval: 60 minutes (COMTRADE_INTERVAL_MS env var, default 3600000)
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'comtrade-source' })

const COMTRADE_BASE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS'
const RELIABILITY       = 0.91
const DEDUP_TTL_S       = 7 * 86_400    // 7-day dedup
const MIN_VALUE_USD     = 10_000_000    // $10M minimum — suppress noise

// ─── STRATEGIC COMMODITY CODES (HS) ─────────────────────────────────────────

/**
 * HS codes tracked as strategically significant commodity flows.
 * Covers energy security, critical minerals, semiconductors, and nuclear materials.
 */
export const STRATEGIC_COMMODITIES: Record<string, string> = {
  '2709': 'Crude Oil',
  '2710': 'Petroleum Products',
  '2601': 'Iron Ore',
  '2701': 'Coal',
  '2844': 'Radioactive Materials',
  '2612': 'Uranium Ore',
  '8542': 'Semiconductors',
  '1001': 'Wheat',
  '9301': 'Military Weapons',
  '9303': 'Firearms',
  '2602': 'Manganese Ore',
  '2615': 'Niobium/Tantalum Ore',
}

const ALL_CMD_CODES = Object.keys(STRATEGIC_COMMODITIES).join(',')

// ─── STRATEGIC REPORTER COUNTRIES (UN M49 codes) ─────────────────────────────

/** Major trading nations polled each cycle (UN M49 numeric codes) */
const STRATEGIC_REPORTERS: number[] = [
  156,  // China
  840,  // United States
  643,  // Russia
  276,  // Germany
  356,  // India
  392,  // Japan
  410,  // South Korea
  682,  // Saudi Arabia
  528,  // Netherlands
   36,  // Australia
  124,  // Canada
   76,  // Brazil
  784,  // UAE
  566,  // Nigeria
  250,  // France
  380,  // Italy
  826,  // United Kingdom
  702,  // Singapore
  458,  // Malaysia
  764,  // Thailand
]

// ─── COUNTRY CENTROIDS (30+ major trading nations) ──────────────────────────

/**
 * Capital city centroids for major trading nations, keyed by UN M49 numeric code.
 * Signals are geolocated to the EXPORTER (reporter) country.
 */
export const COUNTRY_CENTROIDS: Record<number, { name: string; lat: number; lon: number }> = {
  156: { name: 'China',          lat:  39.90, lon: 116.41 },
  840: { name: 'United States',  lat:  38.90, lon: -77.04 },
  643: { name: 'Russia',         lat:  55.76, lon:  37.62 },
  276: { name: 'Germany',        lat:  52.52, lon:  13.41 },
  356: { name: 'India',          lat:  28.61, lon:  77.21 },
  392: { name: 'Japan',          lat:  35.68, lon: 139.69 },
  410: { name: 'South Korea',    lat:  37.57, lon: 126.98 },
  682: { name: 'Saudi Arabia',   lat:  24.71, lon:  46.68 },
  528: { name: 'Netherlands',    lat:  52.37, lon:   4.90 },
   36: { name: 'Australia',      lat: -33.87, lon: 151.21 },
  124: { name: 'Canada',         lat:  45.42, lon: -75.69 },
   76: { name: 'Brazil',         lat: -15.79, lon: -47.88 },
  784: { name: 'UAE',            lat:  24.45, lon:  54.38 },
  566: { name: 'Nigeria',        lat:   9.07, lon:   7.40 },
  250: { name: 'France',         lat:  48.86, lon:   2.35 },
  380: { name: 'Italy',          lat:  41.90, lon:  12.50 },
  724: { name: 'Spain',          lat:  40.42, lon:  -3.70 },
  826: { name: 'United Kingdom', lat:  51.51, lon:  -0.13 },
  792: { name: 'Turkey',         lat:  39.93, lon:  32.86 },
  818: { name: 'Egypt',          lat:  30.04, lon:  31.24 },
  710: { name: 'South Africa',   lat: -25.75, lon:  28.19 },
  586: { name: 'Pakistan',       lat:  33.69, lon:  73.04 },
  360: { name: 'Indonesia',      lat:  -6.21, lon: 106.85 },
  458: { name: 'Malaysia',       lat:   3.15, lon: 101.71 },
  764: { name: 'Thailand',       lat:  13.76, lon: 100.50 },
  704: { name: 'Vietnam',        lat:  21.03, lon: 105.84 },
  484: { name: 'Mexico',         lat:  19.43, lon: -99.13 },
  604: { name: 'Peru',           lat: -12.05, lon: -77.05 },
  152: { name: 'Chile',          lat: -33.46, lon: -70.65 },
   32: { name: 'Argentina',      lat: -34.60, lon: -58.38 },
  616: { name: 'Poland',         lat:  52.23, lon:  21.01 },
  702: { name: 'Singapore',      lat:   1.29, lon: 103.85 },
}

// ─── SEVERITY MAPPING ────────────────────────────────────────────────────────

/**
 * Determine signal severity from HS commodity code and USD trade value.
 *
 *   critical — nuclear/radioactive (HS 2844) OR value >$10B
 *   high     — semiconductors (HS 8542) OR crude oil (HS 2709) OR value >$1B
 *   medium   — other strategic commodities >$100M
 *   low      — smaller flows of strategic interest
 */
export function commoditySeverity(cmdCode: string, tradeValueUsd: number): SignalSeverity {
  if (cmdCode === '2844' || tradeValueUsd > 10_000_000_000) return 'critical'
  if (cmdCode === '8542' || cmdCode === '2709' || tradeValueUsd > 1_000_000_000) return 'high'
  if (tradeValueUsd > 100_000_000) return 'medium'
  return 'low'
}

// ─── TITLE / VALUE HELPERS ───────────────────────────────────────────────────

function formatTradeValue(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`
  if (usd >= 1_000_000)     return `$${(usd / 1_000_000).toFixed(0)}M`
  return `$${(usd / 1_000).toFixed(0)}K`
}

/**
 * Build a human-readable signal title for a bilateral trade flow.
 * e.g. 'China → India Semiconductors Exports: $2.3B 2024'
 */
export function buildSignalTitle(
  exporterName:  string,
  importerName:  string,
  cmdCode:       string,
  tradeValueUsd: number,
  period:        string,
): string {
  const commodity = STRATEGIC_COMMODITIES[cmdCode] ?? `HS ${cmdCode}`
  const valueStr  = formatTradeValue(tradeValueUsd)
  return `${exporterName} → ${importerName} ${commodity} Exports: ${valueStr} ${period}`
}

/**
 * Resolve a UN M49 reporter code to its capital city centroid.
 * Returns EXPORTER country coordinates (reporter = exporting country).
 */
export function inferComtradeLocation(
  reporterCode: number,
): { name: string; lat: number; lon: number } | null {
  return COUNTRY_CENTROIDS[reporterCode] ?? null
}

/**
 * Build the Redis dedup key for a Comtrade trade flow record.
 * Format: osint:comtrade:{reporterCode}:{partnerCode}:{cmdCode}:{period}
 */
export function comtradeDedupKey(
  reporterCode: number,
  partnerCode:  number,
  cmdCode:      string,
  period:       string,
): string {
  return `osint:comtrade:${reporterCode}:${partnerCode}:${cmdCode}:${period}`
}

// ─── API RESPONSE TYPES ──────────────────────────────────────────────────────

interface ComtradeDataItem {
  reporterCode: number
  reporterDesc: string
  partnerCode:  number
  partnerDesc:  string
  cmdCode:      string
  cmdDesc:      string
  flowCode:     string    // 'X' = export, 'M' = import
  primaryValue: number
  refYear:      number
  period:       string | number
}

interface ComtradeResponse {
  data?: ComtradeDataItem[]
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

export function startComtradePoller(
  db:        Knex,
  redis:     Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.COMTRADE_INTERVAL_MS ?? 3_600_000)

  /** Most recent year with reliable Comtrade coverage (2-year reporting lag). */
  function getRecentPeriod(): string {
    return String(new Date().getFullYear() - 2)
  }

  async function pollReporter(reporterCode: number, period: string): Promise<number> {
    const url = new URL(COMTRADE_BASE_URL)
    url.searchParams.set('cmdCode',      ALL_CMD_CODES)
    url.searchParams.set('reporterCode', String(reporterCode))
    url.searchParams.set('period',       period)
    url.searchParams.set('flowCode',     'X')    // exports only
    url.searchParams.set('maxRecords',   '500')

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network; https://worldpulse.io)',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      log.warn({ status: res.status, reporterCode }, 'Comtrade API non-OK')
      return 0
    }

    const body = await res.json() as ComtradeResponse
    const rows = body.data ?? []
    if (rows.length === 0) return 0

    let created = 0

    for (const row of rows) {
      if (!row.cmdCode || row.primaryValue < MIN_VALUE_USD) continue

      const rowPeriod  = String(row.period ?? row.refYear ?? period)
      const dedupKey   = comtradeDedupKey(row.reporterCode, row.partnerCode, row.cmdCode, rowPeriod)
      const seen       = await redis.get(dedupKey)
      if (seen) continue

      const severity     = commoditySeverity(row.cmdCode, row.primaryValue)
      const location     = inferComtradeLocation(row.reporterCode)
      const exporterName = location?.name ?? row.reporterDesc ?? `Country ${row.reporterCode}`
      const importerName = COUNTRY_CENTROIDS[row.partnerCode]?.name ?? row.partnerDesc ?? `Country ${row.partnerCode}`
      const periodLabel  = String(row.refYear ?? row.period ?? period)
      const cmdLabel     = STRATEGIC_COMMODITIES[row.cmdCode] ?? row.cmdDesc ?? `HS ${row.cmdCode}`

      const title   = buildSignalTitle(exporterName, importerName, row.cmdCode, row.primaryValue, periodLabel)
      const summary = [
        `${exporterName} exported ${formatTradeValue(row.primaryValue)} in ${cmdLabel} to ${importerName} in ${periodLabel}.`,
        `Commodity: ${cmdLabel} (HS ${row.cmdCode}).`,
        `Trade flow value: ${formatTradeValue(row.primaryValue)} USD.`,
        `Source: UN Comtrade official national trade statistics (${periodLabel} annual data).`,
      ].join(' ')

      try {
        const signal = await insertAndCorrelate({
          title:             title.slice(0, 500),
          summary:           summary.slice(0, 600),
          category:          'economy' as const,
          severity,
          status:            'pending',
          reliability_score: RELIABILITY,
          source_count:      1,
          source_ids:        [],
          original_urls:     ['https://comtradeapi.un.org'],
          location:          location
            ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat])
            : null,
          location_name:     exporterName,
          country_code:      null,
          region:            null,
          tags:              [
            'osint', 'economy', 'trade', 'comtrade',
            row.cmdCode,
            cmdLabel.toLowerCase().replace(/[\s/]+/g, '-'),
          ],
          language:          'en',
          event_time:        new Date(`${periodLabel}-01-01`),
        }, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'comtrade' })

        await redis.setex(dedupKey, DEDUP_TTL_S, '1')
        created++

        if (signal && producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{
              key:   'economy',
              value: JSON.stringify({
                event:   'signal.new',
                payload: signal,
                filter:  { category: 'economy', severity },
              }),
            }],
          }).catch(() => {})
        }
      } catch (err) {
        log.debug({ err, dedupKey }, 'Comtrade signal insert skipped (likely duplicate)')
      }
    }

    return created
  }

  async function poll(): Promise<void> {
    try {
      log.debug('Polling UN Comtrade strategic commodity flows...')
      const period = getRecentPeriod()
      let totalCreated = 0

      for (const reporterCode of STRATEGIC_REPORTERS) {
        try {
          const n = await pollReporter(reporterCode, period)
          totalCreated += n
          // Brief pause between reporter requests — polite to the public endpoint
          await new Promise<void>(resolve => setTimeout(resolve, 500))
        } catch (err) {
          log.warn({ err, reporterCode }, 'Comtrade reporter poll error (skipping)')
        }
      }

      if (totalCreated > 0) {
        log.info({ totalCreated, period }, 'Comtrade: trade flow signals created')
      } else {
        log.debug({ period }, 'Comtrade poll complete (no new flows)')
      }
    } catch (err) {
      log.warn({ err }, 'Comtrade poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'UN Comtrade commodity flows poller started')

  return () => {
    clearInterval(timer)
    log.info('UN Comtrade poller stopped')
  }
}
