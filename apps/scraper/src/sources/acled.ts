/**
 * ACLED Conflict & Protest Events Signal Source
 *
 * Polls the ACLED (Armed Conflict Location & Event Data) public API
 * every 30 minutes for real-time armed conflict, protests, riots,
 * and political violence events worldwide.
 *
 * API: https://api.acleddata.com/acled/read (free public access for recent events)
 * Free tier: last 90 days, 500 records per request, no auth required.
 *
 * Reliability: 0.89 (ACLED is the academic gold standard for conflict data,
 *   used by UN, World Bank, and major news organizations)
 * Category: conflict
 *
 * Closes competitive gap vs Crucix — ACLED conflict data is a key intelligence feed.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'acled-source' })

const ACLED_API_URL = 'https://api.acleddata.com/acled/read'
const RELIABILITY   = 0.89
const DEDUP_TTL_S   = 48 * 3_600  // 48-hour dedup

// ─── EVENT TYPE → SEVERITY MAPPING ──────────────────────────────────────────

/**
 * Map ACLED event types and fatalities to WorldPulse severity.
 *
 * ACLED event types:
 *   Battles, Explosions/Remote violence, Violence against civilians,
 *   Protests, Riots, Strategic developments
 */
export function acledSeverity(
  eventType: string,
  fatalities: number,
  subEventType: string = '',
): SignalSeverity {
  // Fatality-based escalation takes priority
  if (fatalities >= 50) return 'critical'
  if (fatalities >= 10) return 'high'

  const type = eventType.toLowerCase()
  const sub  = subEventType.toLowerCase()

  // Critical: mass atrocity / large-scale battle / air/drone strike with casualties
  if (
    /sexual violence|chemical weapon|mass killing|ethnic cleansing/i.test(sub) ||
    (type.includes('explosion') && fatalities >= 5)
  ) return 'critical'

  // High: battles / explosions / violence against civilians
  if (
    type.includes('battle') ||
    type.includes('explosion') ||
    type.includes('remote violence') ||
    (type.includes('violence against civilians') && fatalities > 0)
  ) return 'high'

  // Medium: riots / violence against civilians (no fatalities) / armed clashes
  if (
    type.includes('riot') ||
    type.includes('violence against civilians') ||
    sub.includes('armed clash')
  ) return 'medium'

  // Low: protests / strategic developments
  return 'low'
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────

export function startAcledPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.ACLED_INTERVAL_MS ?? 30 * 60_000)
  const API_KEY     = process.env.ACLED_API_KEY ?? ''
  const API_EMAIL   = process.env.ACLED_API_EMAIL ?? ''

  async function poll(): Promise<void> {
    try {
      log.debug('Polling ACLED conflict events API...')

      // Fetch events from the last 3 days
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)

      const params = new URLSearchParams({
        event_date:       since,
        event_date_where: '>=',
        limit:            '100',
        fields:           'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|admin1|latitude|longitude|fatalities|notes|source|source_scale',
      })

      // Use API key if available (higher limits), otherwise use public access
      if (API_KEY && API_EMAIL) {
        params.set('key', API_KEY)
        params.set('email', API_EMAIL)
      }

      const url = `${ACLED_API_URL}?${params.toString()}`
      let data: { success: boolean; data: AcledEvent[]; count: number }
      try {
        data = await fetchWithResilience(
          'acled',
          'ACLED',
          url,
          async () => {
            const res = await fetch(url, {
              headers: {
                'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
                'Accept':     'application/json',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (!res.ok) throw Object.assign(new Error(`ACLED: HTTP ${res.status}`), { statusCode: res.status })
            return res.json() as Promise<{ success: boolean; data: AcledEvent[]; count: number }>
          },
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }

      if (!data.success || !data.data || data.data.length === 0) {
        log.debug('ACLED: no events returned')
        return
      }

      let created = 0

      for (const event of data.data) {
        if (!event.event_id_cnty) continue

        // Dedup by ACLED event ID
        const key  = `osint:acled:${event.event_id_cnty}`
        const seen = await redis.get(key)
        if (seen) continue

        const fatalities = Number(event.fatalities) || 0
        const severity   = acledSeverity(event.event_type, fatalities, event.sub_event_type)
        const lat        = Number(event.latitude)  || 0
        const lng        = Number(event.longitude) || 0

        const locationParts = [event.admin1, event.country].filter(Boolean)
        const locationName  = locationParts.join(', ') || 'Unknown'

        // Build title
        const actors = [event.actor1, event.actor2].filter(Boolean).join(' vs ')
        const title  = actors
          ? `${event.event_type}: ${actors} — ${locationName}`
          : `${event.event_type} in ${locationName}`

        // Build summary
        const summaryParts = [
          event.notes?.slice(0, 300) || `${event.event_type} event recorded by ACLED.`,
          fatalities > 0 ? `Fatalities reported: ${fatalities}.` : '',
          `Source: ${event.source || 'ACLED'} (${event.source_scale || 'national'} scale).`,
          `Location: ${locationName}.`,
        ].filter(Boolean)

        const eventDate = event.event_date ? new Date(event.event_date) : new Date()
        const eventTime = isNaN(eventDate.getTime()) ? new Date() : eventDate

        try {
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary:           summaryParts.join(' ').slice(0, 600),
            category:          'conflict',
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://acleddata.com'],
            location:          db.raw('ST_MakePoint(?, ?)', [lng, lat]),
            location_name:     locationName,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'conflict', 'acled', event.event_type.toLowerCase().replace(/\s+/g, '-'), fatalities > 0 ? 'fatalities' : ''].filter(Boolean),
            language:          'en',
            event_time:        eventTime,
          }, { lat: lat || null, lng: lng || null, sourceId: 'acled' })

          await redis.setex(key, DEDUP_TTL_S, '1')
          created++

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
        } catch (err) {
          log.debug({ err, eventId: event.event_id_cnty }, 'ACLED signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: data.data.length }, 'ACLED: conflict signals created')
      } else {
        log.debug({ total: data.data.length }, 'ACLED poll complete (no new events)')
      }
    } catch (err) {
      log.warn({ err }, 'ACLED poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'ACLED conflict/protest poller started')

  return () => {
    clearInterval(timer)
    log.info('ACLED conflict/protest poller stopped')
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface AcledEvent {
  event_id_cnty:  string
  event_date:     string
  event_type:     string
  sub_event_type: string
  actor1:         string
  actor2:         string
  country:        string
  admin1:         string
  latitude:       string
  longitude:      string
  fatalities:     string
  notes:          string
  source:         string
  source_scale:   string
}
