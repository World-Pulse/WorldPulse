/**
 * GDELT Project Signal Source
 *
 * Polls the GDELT Full-Text Search API every 15 minutes for recent
 * conflict/war/attack events and creates WorldPulse signals from them.
 *
 * GDELT API: https://blog.gdeltproject.org/gdelt-full-text-search-api/
 * Data is free, no API key required, updated every 15 minutes.
 *
 * Counters Shadowbroker's GDELT feed advantage.
 */

import https from 'node:https'
import { createHash } from 'node:crypto'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'gdelt-source' })

// GDELT Full-Text Doc API — returns articles in last timespan matching query
// sorted by most negative (conflictual) tone first
const GDELT_DOC_API =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=armed+conflict+attack+airstrike+explosion+troops+invasion+offensive' +
  '&mode=artlist&maxrecords=25&format=json&timespan=15m&sort=tonedesc'

// Country name → approximate [lat, lng] centroid for rough geo mapping
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'Ukraine':        [48.38, 31.17],
  'Russia':         [61.52, 105.32],
  'Israel':         [31.05, 34.85],
  'Gaza':           [31.35, 34.31],
  'Syria':          [34.80, 38.99],
  'Iraq':           [33.22, 43.68],
  'Iran':           [32.43, 53.69],
  'Sudan':          [12.86, 30.22],
  'Ethiopia':       [9.15, 40.49],
  'Somalia':        [5.15, 46.20],
  'Pakistan':       [30.38, 69.35],
  'Afghanistan':    [33.94, 67.71],
  'Yemen':          [15.55, 48.52],
  'Myanmar':        [19.16, 96.68],
  'Congo':          [-4.04, 21.76],
  'Mali':           [17.57, -3.99],
  'Libya':          [26.34, 17.23],
  'Nigeria':        [9.08, 8.68],
  'Mozambique':     [-18.67, 35.53],
  'Haiti':          [18.97, -72.29],
}

// GDELT article response shape
interface GdeltArticle {
  url: string
  title: string
  seendate: string     // "20260322T142000Z"
  domain: string
  language: string
  sourcecountry: string
}

interface GdeltResponse {
  articles?: GdeltArticle[]
}

// ─── HTTP HELPER ───────────────────────────────────────────────────────────
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
    req.on('timeout', () => { req.destroy(); reject(new Error('GDELT request timeout')) })
  })
}

// ─── SEVERITY DERIVATION ───────────────────────────────────────────────────
const SEVERITY_CRITICAL = /nuclear|mass casualty|genocide|chemical weapon|biological weapon|WMD/i
const SEVERITY_HIGH     = /airstrike|air strike|bombing|killed|casualties|invasion|coup/i
const SEVERITY_MEDIUM   = /attack|offensive|clash|fighting|shelling|missile/i
const SEVERITY_LOW      = /tension|protest|demonstration|dispute|standoff/i

function deriveSeverity(title: string): SignalSeverity {
  if (SEVERITY_CRITICAL.test(title)) return 'critical'
  if (SEVERITY_HIGH.test(title))     return 'high'
  if (SEVERITY_MEDIUM.test(title))   return 'medium'
  if (SEVERITY_LOW.test(title))      return 'low'
  return 'medium'
}

// ─── GEO EXTRACTION ────────────────────────────────────────────────────────
function extractGeoFromTitle(title: string): { lat?: number; lng?: number; name?: string } {
  for (const [country, [lat, lng]] of Object.entries(COUNTRY_CENTROIDS)) {
    if (title.includes(country)) return { lat, lng, name: country }
  }
  return {}
}

// ─── REDIS DEDUP KEY ────────────────────────────────────────────────────────
function dedupKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  return `osint:gdelt:${hash}`
}

// ─── MAIN POLLER ───────────────────────────────────────────────────────────
export function startGdeltPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.GDELT_INTERVAL_MS ?? 15 * 60_000) // 15 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling GDELT...')
      const raw = await httpsGet(GDELT_DOC_API)
      const data: GdeltResponse = JSON.parse(raw)

      const articles = data.articles ?? []
      if (articles.length === 0) {
        log.debug('GDELT: no articles returned')
        return
      }

      let created = 0

      for (const article of articles) {
        const key = dedupKey(article.url)

        // Dedup check — 24h TTL
        const seen = await redis.get(key)
        if (seen) continue

        const severity = deriveSeverity(article.title)
        const geo      = extractGeoFromTitle(article.title)

        // Insert signal into DB
        try {
          const signal = await insertAndCorrelate({
            title:             article.title.slice(0, 500),
            summary:           `GDELT signal from ${article.domain} (${article.sourcecountry})`,
            category:          'conflict' as Category,
            severity,
            status:            'pending',
            reliability_score: 0.55,
            source_count:      1,
            source_ids:        [],
            original_urls:     [article.url],
            location:          geo.lat != null && geo.lng != null
              ? db.raw('ST_MakePoint(?, ?)', [geo.lng, geo.lat])
              : null,
            location_name:     geo.name ?? null,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'gdelt', 'conflict'],
            language:          article.language === 'English' ? 'en' : (article.language?.slice(0, 2)?.toLowerCase() ?? 'xx'),
            event_time:        parseGdeltDate(article.seendate),
          }, { lat: geo.lat ?? null, lng: geo.lng ?? null, sourceId: 'gdelt' })

          // Mark deduped for 24h
          await redis.setex(key, 86400, '1')
          created++

          // Publish to Kafka if available
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
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          // Ignore duplicate URL constraint errors
          log.debug({ err, url: article.url }, 'GDELT signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: articles.length }, 'GDELT: signals created')
      }
    } catch (err) {
      log.warn({ err }, 'GDELT poll error (non-fatal)')
    }
  }

  // Run immediately, then on interval
  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'GDELT poller started')

  return () => {
    clearInterval(timer)
    log.info('GDELT poller stopped')
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function parseGdeltDate(seendate: string): Date | null {
  // Format: "20260322T142000Z"
  try {
    const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
    if (!m) return null
    return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  } catch {
    return null
  }
}
