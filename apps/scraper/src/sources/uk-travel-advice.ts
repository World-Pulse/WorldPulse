/**
 * UK travel advice updates (Nov 5, 2026; Q15's next batch of signals).
 *
 * The Foreign Office keeps a page of travel advice for every country and
 * lists the latest changes in one Atom feed (https://www.gov.uk/foreign-travel-advice.atom,
 * no key, the 20 newest updates, each with a one-line summary of what changed:
 * "Possible demonstrations and protests", "Ebola screening requirements",
 * "FCDO advice against all travel within 10km of the Kenya border"). The
 * content is published under the Open Government Licence v3.0, which allows
 * reuse with attribution; every signal names the Foreign, Commonwealth &
 * Development Office and links the page.
 *
 * Most updates are paperwork (visa rules, entry forms, accuracy reviews), so
 * only those that say something about safety are signals: advice against
 * travel, unrest, strikes, attacks, kidnapping, disasters, weather, outbreaks
 * and health screening. Each country's last update is kept
 * (osint:travel-uk:<slug>, a year) so an update is a signal once. The first
 * read signals only updates of the last 3 days.
 *
 * Reliability: 0.95 (the UK government's own advice). Category: security,
 * health for outbreaks and screening, weather for weather and disasters.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import type { SignalSeverity } from '@worldpulse/types'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { advisoryPlace } from './travel-advisories'

const log = rootLogger.child({ module: 'uk-travel-advice-source' })

export const UK_ADVICE_URL = 'https://www.gov.uk/foreign-travel-advice.atom'
const SOURCE_ID = 'uk-travel-advice'
const RELIABILITY = 0.95
const KEEP_S = 400 * 86_400
const MAX_AGE_MS = 3 * 86_400_000
const MAX_PER_POLL = 10
const MAX_BYTES = 2_000_000
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io)'
const POLL_INTERVAL_MS = Number(process.env.UK_TRAVEL_ADVICE_INTERVAL_MS) || 60 * 60_000 // hourly
const seenKey = (slug: string) => `osint:travel-uk:${slug}`

export interface AdviceUpdate {
  /** The page's address name ("south-africa") */
  slug:    string
  country: string
  link:    string
  /** ISO timestamp of the update */
  updated: string
  /** What changed, as the feed says it, plain text */
  text:    string
}

export type AdviceCategory = 'security' | 'health' | 'weather'

/** The Foreign Office's names that the place-finder reads wrongly, or not at all → the State Department's code */
const CODES: Record<string, string> = {
  jordan: 'jor', georgia: 'geo', chad: 'tcd', congo: 'cog', 'republic of congo': 'cog',
  'democratic republic of the congo': 'cod', 'dr congo': 'cod', usa: 'usa', 'the gambia': 'gmb', gambia: 'gmb',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, '’').replace(/&ldquo;|&rdquo;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/gi, '&')
}

/** The summary as plain text; the feed carries it as escaped or plain XHTML */
export function adviceText(raw: string): string {
  let s = String(raw || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  if (/&lt;\s*\/?[a-z]/i.test(s)) s = decodeEntities(s)
  return decodeEntities(s.replace(/<\/?(?:p|li|ul|ol|div|br)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim().slice(0, 600)
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? m[1]!.trim() : ''
}

/** Every update in the feed, one per country (the newest) */
export function parseAdvice(xml: string): AdviceUpdate[] {
  const out = new Map<string, AdviceUpdate>()
  for (const block of String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []) {
    const country = decodeEntities(tag(block, 'title').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    const href = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block)
      ?? /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i.exec(block)
    const link = decodeEntities(href?.[1] ?? '').trim()
    const slug = /^https:\/\/www\.gov\.uk\/foreign-travel-advice\/([a-z0-9-]+)\/?$/i.exec(link)?.[1]?.toLowerCase()
    const updated = tag(block, 'updated')
    if (!country || !slug || !Number.isFinite(Date.parse(updated))) continue
    const u: AdviceUpdate = { slug, country, link, updated: new Date(updated).toISOString(), text: adviceText(tag(block, 'summary') || tag(block, 'content')) }
    const had = out.get(slug)
    if (!had || u.updated > had.updated) out.set(slug, u)
  }
  return [...out.values()]
}

/** Paperwork, not news: accuracy reviews and the removal of old notices */
const ROUTINE = /\b(?:accuracy review|reviewed? for accuracy|removal of|removed information|updated (?:contact|embassy|consular)|visa|passport validity|entry requirements?\b(?!.*(?:screening|ebola)))/i
const AGAINST = /\badvi[cs]e[sd]?\s+against\b|\bagainst (?:all|all but essential) travel\b/i
const HEALTH  = /\b(?:ebola|cholera|outbreak|epidemic|pandemic|virus|measles|mpox|marburg|dengue|health screening|screening)\b/i
const WEATHER = /\b(?:flood\w*|storm\w*|hurricane\w*|typhoon\w*|cyclone\w*|earthquake\w*|volcan\w*|wildfire\w*|landslide\w*|tsunami\w*|heavy rain|weather)\b/i
const UNREST  = /\b(?:protests?|demonstrations?|unrest|strikes?|riots?|clashes|violence|terroris[tm]|attacks?|kidnap\w*|curfew|state of emergency|military|fighting|conflict|shooting|explosion|airspace|airport closure|border closure|evacuat\w*|security situation|political situation|election\w*|coup)\b/i

/** The signal's category when an update is about safety, else null (a visa or paperwork update) */
export function adviceCategory(u: Pick<AdviceUpdate, 'text'>): AdviceCategory | null {
  const t = u.text
  if (AGAINST.test(t)) return 'security'
  if (HEALTH.test(t)) return ROUTINE.test(t) && !/screening|ebola|outbreak/i.test(t) ? null : 'health'
  if (ROUTINE.test(t)) return null
  if (WEATHER.test(t) && !UNREST.test(t)) return 'weather'
  return UNREST.test(t) ? 'security' : WEATHER.test(t) ? 'weather' : null
}

/** Advice against travel is medium; the rest low */
export function adviceSeverity(u: Pick<AdviceUpdate, 'text'>): SignalSeverity {
  return AGAINST.test(u.text) ? 'medium' : 'low'
}

/** Whether an update is news, given what was kept (the last update's timestamp) for its country */
export function adviceIsNew(u: AdviceUpdate, seen: string | null | undefined, now = Date.now()): boolean {
  if (seen) return Number.isFinite(Date.parse(seen)) ? u.updated > new Date(seen).toISOString() : false
  return now - Date.parse(u.updated) <= MAX_AGE_MS
}

export function adviceSignalText(u: AdviceUpdate): { title: string; summary: string } {
  const what = u.text.replace(/[.\s]+$/, '')
  const title = `UK travel advice for ${u.country} updated: ${what}`.slice(0, 500)
  const day = u.updated.slice(0, 10)
  const summary = [`${what}.`, `Source: UK Foreign, Commonwealth & Development Office, travel advice for ${u.country} of ${day} (Open Government Licence v3.0).`].join('\n').slice(0, 2000)
  return { title, summary }
}

export function advicePlace(u: Pick<AdviceUpdate, 'country'>) {
  const code = CODES[u.country.toLowerCase()] ?? ''
  return advisoryPlace({ code, country: u.country })
}

async function fetchFeed(): Promise<string> {
  return fetchWithResilience(SOURCE_ID, 'UK travel advice', UK_ADVICE_URL, async () => {
    const res = await fetch(UK_ADVICE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      throw Object.assign(new Error(`UK travel advice: HTTP ${res.status}`), { statusCode: res.status })
    }
    const body = await res.text()
    if (body.length > MAX_BYTES) throw new Error(`UK travel advice: over ${MAX_BYTES} bytes`)
    return body
  })
}

async function pollAdvice(db: Knex, redis: Redis, producer?: Producer | null): Promise<void> {
  try {
    let xml: string
    try {
      xml = await fetchFeed()
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      throw err
    }
    const list = parseAdvice(xml)
    if (list.length === 0) {
      log.warn('UK travel advice: no updates in the feed')
      return
    }

    const kept = await redis.mget(...list.map(u => seenKey(u.slug)))
    let ingested = 0
    const keep = redis.multi()
    let keepCount = 0
    for (let i = 0; i < list.length; i++) {
      const u = list[i]!
      const seen = kept[i]
      if (!adviceIsNew(u, seen)) {
        // the first read keeps old updates so they are not signals later
        if (!seen) { keep.set(seenKey(u.slug), u.updated, 'EX', KEEP_S); keepCount++ }
        continue
      }
      const category = adviceCategory(u)
      if (category && ingested < MAX_PER_POLL) {
        const { title, summary } = adviceSignalText(u)
        const place = advicePlace(u)
        try {
          const signal = await insertAndCorrelate({
            title,
            summary,
            original_urls: [u.link],
            source_ids: [],
            category,
            severity: adviceSeverity(u),
            status: 'pending',
            reliability_score: RELIABILITY,
            location: place.lat != null && place.lng != null ? db.raw('ST_MakePoint(?, ?)', [place.lng, place.lat]) : null,
            location_name: place.name,
            country_code: place.countryCode,
            region: null,
            tags: ['osint', 'travel-advice', 'uk-fcdo'],
            language: 'en',
            event_time: new Date(Math.min(Date.parse(u.updated), Date.now())),
            source_count: 1,
          }, { lat: place.lat, lng: place.lng, sourceId: SOURCE_ID })
          if (producer) {
            await producer.send({ topic: 'signals.verified', messages: [{ value: JSON.stringify(signal) }] })
          }
          ingested++
        } catch (err) {
          log.warn({ err, slug: u.slug }, 'Failed to ingest a UK travel advice update')
          continue   // not kept, so it is tried again next poll
        }
      } else if (category) {
        continue     // over this poll's limit: tried again next poll
      }
      keep.set(seenKey(u.slug), u.updated, 'EX', KEEP_S)
      keepCount++
    }
    if (keepCount > 0) await keep.exec()
    if (ingested > 0) log.info({ ingested }, 'UK travel advice ingested')
  } catch (err) {
    log.error({ err }, 'UK travel advice poll failed')
  }
}

export function startUkTravelAdvicePoller(db: Knex, redis: Redis, producer?: Producer | null): () => void {
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'UK travel advice poller started')
  void pollAdvice(db, redis, producer)
  const timer = setInterval(() => void pollAdvice(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
