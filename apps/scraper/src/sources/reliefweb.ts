/**
 * UN ReliefWeb Humanitarian Crisis Signal Source
 *
 * Reads ReliefWeb's disasters feed (UN OCHA) for natural disasters, epidemics
 * and complex emergencies worldwide, one WorldPulse signal per disaster.
 *
 * The API v1 this used was switched off in 2026 (HTTP 410), and v2 only
 * answers apps whose appname ReliefWeb has approved (HTTP 403). So:
 *   - with RELIEFWEB_APPNAME set (request one at https://apidoc.reliefweb.int),
 *     it reads https://api.reliefweb.int/v2/disasters;
 *   - without it, it reads the RSS feed https://reliefweb.int/disasters/rss.xml.
 *     ReliefWeb's firewall (AWS WAF) answers some clients with an empty
 *     "challenge" (HTTP 202) instead of the feed; that counts as a failure
 *     with a clear message, not as an empty feed.
 * Both carry what a signal needs: the title, the disaster page, the date, the
 * affected countries and the GLIDE number, whose first two letters give the
 * disaster type and last three the country.
 *
 * Reliability: 0.94 (UN OCHA is the authoritative coordinator for
 *   global humanitarian response; ReliefWeb is the #1 humanitarian
 *   information portal serving 300K+ aid workers worldwide)
 * Category: disaster (epidemics: health)
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { iso3Centroid } from '../pipeline/country-centroids'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'reliefweb-source' })

const RELIEFWEB_RSS = 'https://reliefweb.int/disasters/rss.xml'
const RELIEFWEB_API = 'https://api.reliefweb.int/v2/disasters'
const USER_AGENT = 'WorldPulse/1.0 (OSINT intelligence network; https://world-pulse.io)'
const RELIABILITY = 0.94
const DEDUP_TTL_S = 180 * 86_400 // one signal per disaster
const MAX_AGE_DAYS = Number(process.env.RELIEFWEB_MAX_AGE_DAYS) || 60 // skip disasters that started long ago
const POLL_INTERVAL_MS = Number(process.env.RELIEFWEB_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** ReliefWeb disaster status to severity mapping */
const STATUS_SEVERITY: Record<string, SignalSeverity> = {
  alert: 'high',
  ongoing: 'medium',
  past: 'low',
}

/** Disaster type keywords that escalate severity */
const CRITICAL_TYPES = /earthquake|tsunami|cyclone|hurricane|typhoon|volcano|famine|genocide|armed conflict|complex emergency/i
const HIGH_TYPES = /flood|epidemic|drought|landslide|wildfire|storm|displacement|refugee/i

/**
 * Map ReliefWeb disaster entries to WorldPulse severity based on
 * disaster type, status, and affected country count.
 */
export function disasterSeverity(
  name: string,
  typeName: string,
  status: string,
  countryCount: number,
): SignalSeverity {
  const combined = `${name} ${typeName}`

  // Critical: mega-disasters, multi-country crises, or critical keywords
  if (countryCount >= 5 || CRITICAL_TYPES.test(combined)) return 'critical'

  // High: significant natural disasters or status=alert
  if (HIGH_TYPES.test(combined) || status === 'alert') return 'high'

  // Medium: ongoing disasters
  if (status === 'ongoing') return 'medium'

  return STATUS_SEVERITY[status] ?? 'low'
}

/**
 * Extract primary country coordinates from ReliefWeb disaster country list.
 * Uses the first country's lat/lon if available.
 */
export function extractDisasterLocation(
  countries: Array<{ iso3?: string; name?: string; location?: { lat?: number; lon?: number } }>,
): { lat: number; lon: number } | null {
  if (!countries || countries.length === 0) return null

  // ReliefWeb API sometimes includes location in country fields
  for (const c of countries) {
    if (c.location?.lat != null && c.location?.lon != null) {
      return { lat: c.location.lat, lon: c.location.lon }
    }
  }

  // Fallback: the centre of the first country
  return iso3Centroid(countries[0]?.iso3)
}

// ─── FEED PARSING ───────────────────────────────────────────────────────────

/** GLIDE event types: the first two letters of a GLIDE number (glidenumber.net) */
export const GLIDE_TYPES: Record<string, string> = {
  AC: 'Technological Disaster', AV: 'Snow Avalanche', CE: 'Complex Emergency', CW: 'Cold Wave',
  DR: 'Drought', EC: 'Extratropical Cyclone', EP: 'Epidemic', EQ: 'Earthquake',
  ET: 'Extreme Temperature', FA: 'Famine', FF: 'Flash Flood', FL: 'Flood', FR: 'Fire',
  HT: 'Heat Wave', IN: 'Insect Infestation', LS: 'Land Slide', MS: 'Mud Slide', OT: 'Other',
  SL: 'Slide', SS: 'Storm Surge', ST: 'Severe Local Storm', TC: 'Tropical Cyclone',
  TO: 'Tornado', TS: 'Tsunami', VO: 'Volcano', VW: 'Violent Wind', WF: 'Wild Fire', WV: 'Wave/Surge',
}

/** WorldPulse category for a GLIDE type: epidemics are health news, everything else a disaster */
export function reliefWebCategory(glideType: string | null): Category {
  return glideType === 'EP' ? 'health' : 'disaster'
}

export interface ReliefWebItem {
  /** Last part of the disaster page's address, e.g. "fl-2026-000181-ner" */
  slug: string
  /** ReliefWeb's name for it, e.g. "Niger: Floods - Sep 2026" */
  title: string
  url: string
  publishedAt: Date | null
  /** GLIDE number, e.g. "FL-2026-000181-NER" */
  glide: string | null
  /** Two-letter GLIDE type, e.g. "FL" */
  typeCode: string | null
  typeName: string
  /** Primary country's ISO alpha-3 code, from the GLIDE number */
  iso3: string | null
  countries: string[]
  summary: string
}

const GLIDE_RE = /\b([A-Z]{2})-(\d{4})-(\d{6})-([A-Z]{3})\b/

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}

/** Decode one layer of XML/HTML character references (&amp; last, so "&amp;lt;" stays "&lt;") */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => codePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`))
  return (m?.[1] ?? m?.[2] ?? '').trim()
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<div class="tag[^"]*">[\s\S]*?<\/div>/g, ' ') // the "Affected country" and "Glide" labels
      .replace(/<\/p>|<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:a|b|i|em|strong|span)\b[^>]*>/gi, '') // inline tags: no gap, "(OCHA, 8 Sep)"
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/** Disasters in ReliefWeb's RSS feed (https://reliefweb.int/disasters/rss.xml) */
export function parseReliefWebRss(xml: string): ReliefWebItem[] {
  const items: ReliefWebItem[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]
    const title = decodeEntities(tagText(block, 'title'))
    const url = decodeEntities(tagText(block, 'link'))
    if (!title || !/^https?:\/\//.test(url)) continue

    const slug = url.replace(/\/+$/, '').split('/').pop() ?? url
    // The description is HTML inside the XML, so it is encoded twice
    const descriptionHtml = decodeEntities(tagText(block, 'description'))
    const categories = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)]
      .map(c => decodeEntities(c[1].trim()))
      .filter(Boolean)
    const glideMatch = categories.map(c => c.match(GLIDE_RE)).find(Boolean) ?? descriptionHtml.match(GLIDE_RE)
    const typeCode = glideMatch?.[1] ?? null
    // ReliefWeb names a disaster "Country: Event - Mon YYYY"
    const named = title.match(/:\s*(.+?)\s+-\s+[A-Z][a-z]{2} \d{4}$/)
    const published = new Date(tagText(block, 'pubDate'))

    items.push({
      slug,
      title,
      url,
      publishedAt: isNaN(published.getTime()) ? null : published,
      glide: glideMatch?.[0] ?? null,
      typeCode,
      typeName: (typeCode && GLIDE_TYPES[typeCode]) || named?.[1] || 'Disaster',
      iso3: glideMatch?.[4] ?? null,
      countries: categories.filter(c => !GLIDE_RE.test(c)),
      summary: htmlToText(descriptionHtml),
    })
  }
  return items
}

/** A disaster as API v2 returns it */
export interface ReliefWebApiDisaster {
  id: number | string
  fields?: {
    name?: string
    description?: string
    glide?: string
    url?: string
    url_alias?: string
    date?: { created?: string; event?: string }
    type?: Array<{ name?: string; code?: string }>
    country?: Array<{ name?: string; iso3?: string }>
    primary_country?: { name?: string; iso3?: string }
  }
}

/** The same shape the RSS parser gives, from an API v2 disaster */
export function apiDisasterToItem(d: ReliefWebApiDisaster): ReliefWebItem | null {
  const f = d.fields
  if (!f?.name) return null
  const glideMatch = f.glide?.match(GLIDE_RE) ?? null
  const typeCode = glideMatch?.[1] ?? f.type?.[0]?.code?.toUpperCase() ?? null
  const url = f.url_alias || f.url || `https://reliefweb.int/disaster/${d.id}`
  const published = new Date(f.date?.event ?? f.date?.created ?? '')
  return {
    slug: url.replace(/\/+$/, '').split('/').pop() || String(d.id),
    title: f.name,
    url,
    publishedAt: isNaN(published.getTime()) ? null : published,
    glide: glideMatch?.[0] ?? null,
    typeCode,
    typeName: (typeCode && GLIDE_TYPES[typeCode]) || f.type?.[0]?.name || 'Disaster',
    iso3: f.primary_country?.iso3?.toUpperCase() ?? glideMatch?.[4] ?? f.country?.[0]?.iso3?.toUpperCase() ?? null,
    countries: (f.country ?? []).map(c => c.name ?? '').filter(Boolean),
    summary: htmlToText(f.description ?? ''),
  }
}

/** Error for a response that isn't the data: no retries, and the message says why */
function blocked(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 403 })
}

async function fetchFromApi(appname: string): Promise<ReliefWebItem[]> {
  const params = new URLSearchParams({ appname, preset: 'latest', limit: '30' })
  for (const field of ['name', 'description', 'glide', 'url', 'url_alias', 'date', 'type', 'country', 'primary_country']) {
    params.append('fields[include][]', field)
  }
  const url = `${RELIEFWEB_API}?${params}`
  const body = await fetchWithResilience('reliefweb', 'ReliefWeb', RELIEFWEB_API, async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 403) throw blocked('ReliefWeb API: the appname in RELIEFWEB_APPNAME is not approved (HTTP 403)')
    if (!res.ok) throw Object.assign(new Error(`ReliefWeb API: HTTP ${res.status}`), { statusCode: res.status })
    return res.json() as Promise<{ data?: ReliefWebApiDisaster[] }>
  })
  return (body.data ?? []).map(apiDisasterToItem).filter((d): d is ReliefWebItem => d !== null)
}

async function fetchFromRss(): Promise<ReliefWebItem[]> {
  const xml = await fetchWithResilience('reliefweb', 'ReliefWeb', RELIEFWEB_RSS, async () => {
    const res = await fetch(RELIEFWEB_RSS, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 202 || res.headers.get('x-amzn-waf-action')) {
      throw blocked('ReliefWeb RSS: its firewall answered with a browser check (HTTP 202) instead of the feed; set RELIEFWEB_APPNAME to use the API')
    }
    if (!res.ok) throw Object.assign(new Error(`ReliefWeb RSS: HTTP ${res.status}`), { statusCode: res.status })
    return res.text()
  })
  return parseReliefWebRss(xml)
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startReliefWebPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      const appname = process.env.RELIEFWEB_APPNAME?.trim()
      log.info({ via: appname ? 'api' : 'rss' }, 'Polling UN ReliefWeb disasters')

      let all: ReliefWebItem[]
      try {
        all = appname ? await fetchFromApi(appname) : await fetchFromRss()
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }

      const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000
      const disasters = all.filter(d => !d.publishedAt || d.publishedAt.getTime() >= cutoff)
      if (disasters.length === 0) {
        log.debug('No recent disasters in the ReliefWeb feed')
        return
      }

      let inserted = 0

      for (const disaster of disasters) {
        const dedupKey = `osint:reliefweb:${disaster.slug}`
        if (await redis.get(dedupKey)) continue

        const severity = disasterSeverity(disaster.title, disaster.typeName, 'ongoing', disaster.countries.length)
        const location = iso3Centroid(disaster.iso3)
        const where = disaster.countries.join(', ')
        const typeTag = disaster.typeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')

        const signalData = {
          title: `UN Crisis: ${disaster.title}`.slice(0, 500),
          summary: (disaster.summary || `${disaster.typeName} affecting ${where || 'several countries'}.`).slice(0, 2000),
          original_urls: [disaster.url],
          source_ids: [],
          category: reliefWebCategory(disaster.typeCode),
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
          location_name: where || 'Several countries',
          country_code: null,
          region: null,
          tags: ['osint', 'humanitarian', 'reliefweb', 'un', typeTag, ...(disaster.glide ? [disaster.glide.toLowerCase()] : [])],
          language: 'en',
          event_time: disaster.publishedAt ?? new Date(),
          source_count: 1,
        }

        try {
          await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'reliefweb' })
          await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        } catch (err) {
          log.warn({ err, disaster: disaster.slug }, 'Failed to ingest ReliefWeb disaster')
          continue
        }

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signalData) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish ReliefWeb signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New ReliefWeb disaster signals created')
      }
    } catch (err) {
      log.error({ err }, 'ReliefWeb poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('ReliefWeb humanitarian poller stopped')
  }
}
