/**
 * CelesTrak Satellite Tracking Signal Source
 *
 * Polls CelesTrak's active satellite catalog (GP JSON) every 30 minutes.
 * Generates signals for recent launches (within 7 days) and recent re-entries
 * (within 3 days) plus one aggregate summary signal per poll cycle.
 *
 * API: https://celestrak.org/SATCAT/query.php?GROUP=active&FORMAT=json
 * Free, no auth required. CelesTrak is the authoritative public satellite catalog.
 *
 * Direct competitive response to Shadowbroker's CelesTrak integration (Mar 2026).
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'celestrak-source' })

const SATCAT_API =
  'https://celestrak.org/SATCAT/query.php?GROUP=active&FORMAT=json'

const MAX_SIGNALS_PER_POLL = 10

// ─── API TYPES ───────────────────────────────────────────────────────────────

interface SatcatEntry {
  INTLDES:    string   // International designator e.g. "1957-001A"
  NORAD_CAT_ID: number
  SATNAME:    string
  OBJECT_TYPE: 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN' | string
  COUNTRY:    string   // 3-letter country code e.g. "US", "CIS", "PRC"
  LAUNCH:     string   // ISO date "YYYY-MM-DD"
  DECAY:      string | null   // ISO date or null if still in orbit
  PERIOD:     number | null   // orbital period in minutes
  INCLINATION: number | null  // degrees
  APOGEE:     number | null   // km
  PERIGEE:    number | null   // km
  RCS_SIZE:   'SMALL' | 'MEDIUM' | 'LARGE' | null
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 30_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('CelesTrak request timeout')) })
  })
}

// ─── LAUNCH SITE COORDINATES ─────────────────────────────────────────────────
// Approximate coordinates for common launch site countries / agencies
const LAUNCH_COORDS: Record<string, [number, number]> = {
  'US':  [28.5, -80.7],   // Cape Canaveral
  'CIS': [45.9,  63.3],   // Baikonur
  'CN':  [28.2, 102.0],   // Xichang / Wenchang
  'PRC': [28.2, 102.0],
  'FR':  [5.2,  -52.8],   // Kourou (ESA/Arianespace)
  'ESA': [5.2,  -52.8],
  'IN':  [13.7,  80.2],   // Sriharikota
  'JP':  [30.4, 130.9],   // Tanegashima
  'IL':  [31.0,  34.7],   // Palmachim
  'KR':  [34.4, 127.5],   // Naro
  'NZ':  [-39.3, 177.9],  // Mahia (Rocket Lab)
}

function launchCoords(country: string): [number, number] {
  return LAUNCH_COORDS[country] ?? [0, 0]
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysSince(d: Date): number {
  return (Date.now() - d.getTime()) / 86_400_000
}

// ─── REDIS DEDUP ──────────────────────────────────────────────────────────────

function dedupKey(intldes: string, eventType: 'launch' | 'decay' | 'aggregate'): string {
  // Sanitize intldes — replace characters that could break Redis key
  const safe = intldes.replace(/[^a-zA-Z0-9-]/g, '_')
  return `osint:celestrak:${eventType}:${safe}`
}

// ─── MAIN POLLER ──────────────────────────────────────────────────────────────

export function startCelesTrakPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.CELESTRAK_POLL_INTERVAL_MS ?? 30 * 60_000)

  async function poll(): Promise<void> {
    try {
      log.debug('Polling CelesTrak satellite catalog...')
      const raw = await httpsGet(SATCAT_API)

      let entries: SatcatEntry[]
      try {
        entries = JSON.parse(raw) as SatcatEntry[]
      } catch {
        log.warn('CelesTrak: failed to parse JSON response')
        return
      }

      if (!Array.isArray(entries) || entries.length === 0) {
        log.debug('CelesTrak: empty catalog response')
        return
      }

      const now = new Date()
      const recentLaunches = entries.filter(e => {
        const d = parseDate(e.LAUNCH)
        return d != null && daysSince(d) <= 7
      })
      const recentDecays = entries.filter(e => {
        const d = parseDate(e.DECAY)
        return d != null && daysSince(d) <= 3
      })

      log.debug({
        total: entries.length,
        launches: recentLaunches.length,
        decays: recentDecays.length,
      }, 'CelesTrak catalog fetched')

      let created = 0

      // ── 1. Aggregate summary signal (once per poll cycle) ──────────────────

      const aggKey = `osint:celestrak:aggregate:${now.toISOString().slice(0, 13)}` // hourly bucket
      const aggSeen = await redis.get(aggKey)
      if (!aggSeen) {
        const aggTitle = `Orbital Status: ${entries.length.toLocaleString()} Active Satellites Tracked`
        const aggSummary = [
          `CelesTrak catalog: ${entries.length.toLocaleString()} active objects in orbit.`,
          recentLaunches.length > 0
            ? `${recentLaunches.length} new launch${recentLaunches.length === 1 ? '' : 'es'} in past 7 days.`
            : 'No new launches detected in past 7 days.',
          recentDecays.length > 0
            ? `${recentDecays.length} re-entr${recentDecays.length === 1 ? 'y' : 'ies'} in past 3 days.`
            : '',
          'Source: CelesTrak authoritative satellite catalog.',
        ].filter(Boolean).join(' ')

        try {
          const signal = await insertAndCorrelate({
            title:             aggTitle.slice(0, 500),
            summary:           aggSummary,
            category:          'technology',
            severity:          'info',
            status:            'pending',
            reliability_score: 0.97,
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://celestrak.org/SATCAT/'],
            location:          null,
            location_name:     'Global Orbital Space',
            country_code:      null,
            region:            null,
            tags:              ['osint', 'celestrak', 'satellite', 'space'],
            language:          'en',
            event_time:        now,
          }, { lat: null, lng: null, sourceId: 'celestrak' })

          await redis.setex(aggKey, 48 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'technology', severity: 'info' },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err }, 'CelesTrak aggregate signal skipped (likely duplicate)')
        }
      }

      // ── 2. Individual launch signals ───────────────────────────────────────

      for (const sat of recentLaunches.slice(0, Math.floor(MAX_SIGNALS_PER_POLL / 2))) {
        if (created >= MAX_SIGNALS_PER_POLL) break

        const key = dedupKey(sat.INTLDES, 'launch')
        const seen = await redis.get(key)
        if (seen) continue

        const launchDate = parseDate(sat.LAUNCH)
        const [lat, lng] = launchCoords(sat.COUNTRY)
        const orbitInfo  = sat.APOGEE != null && sat.PERIGEE != null
          ? ` Orbit: ${sat.PERIGEE}–${sat.APOGEE} km`
          : ''
        const inclInfo   = sat.INCLINATION != null ? `, ${sat.INCLINATION}° inclination` : ''

        const title   = `New Satellite Launch: ${sat.SATNAME.trim()} (${sat.COUNTRY})`
        const summary = [
          `${sat.OBJECT_TYPE === 'PAYLOAD' ? 'Payload' : sat.OBJECT_TYPE} launched by ${sat.COUNTRY}.`,
          `International designator: ${sat.INTLDES}.`,
          `NORAD catalog ID: ${sat.NORAD_CAT_ID}.`,
          orbitInfo ? orbitInfo.trim() + inclInfo + '.' : '',
          'Source: CelesTrak satellite catalog.',
        ].filter(Boolean).join(' ')

        try {
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary,
            category:          'technology',
            severity:          'medium',
            status:            'pending',
            reliability_score: 0.97,
            source_count:      1,
            source_ids:        [],
            original_urls:     [`https://celestrak.org/SATCAT/record.php?CATNR=${sat.NORAD_CAT_ID}`],
            location:          lat !== 0 || lng !== 0
              ? db.raw('ST_MakePoint(?, ?)', [lng, lat])
              : null,
            location_name:     sat.COUNTRY,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'celestrak', 'satellite', 'launch', 'space'],
            language:          'en',
            event_time:        launchDate ?? now,
          }, { lat: (lat !== 0 || lng !== 0) ? lat : null, lng: (lat !== 0 || lng !== 0) ? lng : null, sourceId: 'celestrak' })

          await redis.setex(key, 48 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'technology', severity: 'medium' },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err, intldes: sat.INTLDES }, 'CelesTrak launch signal skipped (likely duplicate)')
        }
      }

      // ── 3. Re-entry / decay signals ────────────────────────────────────────

      for (const sat of recentDecays.slice(0, Math.floor(MAX_SIGNALS_PER_POLL / 2))) {
        if (created >= MAX_SIGNALS_PER_POLL) break

        const key = dedupKey(sat.INTLDES, 'decay')
        const seen = await redis.get(key)
        if (seen) continue

        const decayDate = parseDate(sat.DECAY)

        const title   = `Satellite Re-entry: ${sat.SATNAME.trim()} Decayed from Orbit`
        const summary = [
          `${sat.OBJECT_TYPE === 'PAYLOAD' ? 'Payload' : sat.OBJECT_TYPE} (${sat.COUNTRY}) re-entered the atmosphere.`,
          `International designator: ${sat.INTLDES}. NORAD ID: ${sat.NORAD_CAT_ID}.`,
          decayDate ? `Re-entry date: ${decayDate.toISOString().slice(0, 10)}.` : '',
          'Source: CelesTrak satellite catalog.',
        ].filter(Boolean).join(' ')

        try {
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary,
            category:          'technology',
            severity:          'medium',
            status:            'pending',
            reliability_score: 0.97,
            source_count:      1,
            source_ids:        [],
            original_urls:     [`https://celestrak.org/SATCAT/record.php?CATNR=${sat.NORAD_CAT_ID}`],
            location:          null,
            location_name:     'Atmospheric Re-entry',
            country_code:      null,
            region:            null,
            tags:              ['osint', 'celestrak', 'satellite', 'reentry', 'space'],
            language:          'en',
            event_time:        decayDate ?? now,
          }, { lat: null, lng: null, sourceId: 'celestrak' })

          await redis.setex(key, 48 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'technology', severity: 'medium' },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err, intldes: sat.INTLDES }, 'CelesTrak decay signal skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, totalSats: entries.length }, 'CelesTrak: signals created')
      } else {
        log.debug({ totalSats: entries.length }, 'CelesTrak poll complete (no new events)')
      }
    } catch (err) {
      log.warn({ err }, 'CelesTrak poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'CelesTrak poller started')

  return () => {
    clearInterval(timer)
    log.info('CelesTrak poller stopped')
  }
}
