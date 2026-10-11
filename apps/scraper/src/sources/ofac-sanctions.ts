/**
 * OFAC Sanctions Signal Source
 *
 * Reads the US Treasury OFAC "Recent Actions" list for new sanctions
 * designations, removals and general licenses, and creates WorldPulse signals
 * for these geopolitical events that affect global trade, finance and security.
 *
 * Page: https://ofac.treasury.gov/recent-actions (public, no key)
 * OFAC retired its RSS feed on January 31, 2025 (it now answers 404), so this
 * reads the first page of the list: each action links to
 * /recent-actions/YYYYMMDD (plus _N when there are several that day), with
 * its date and category underneath.
 *
 * Reliability: 0.97 (US Treasury is the authoritative source for sanctions;
 *   SDN list entries are legally binding designations)
 * Category: security
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'ofac-sanctions-source' })

const OFAC_ORIGIN = 'https://ofac.treasury.gov'
const OFAC_RECENT_ACTIONS_URL = `${OFAC_ORIGIN}/recent-actions`
const RELIABILITY = 0.97
const DEDUP_TTL_S = 14 * 86_400 // 14-day dedup (sanctions are persistent)
const MAX_AGE_DAYS = 7
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

  // Low: purely administrative actions (general licenses, FAQs, settlements)
  // even when they name a big programme ("Issuance of Russia-related General License")
  if (!/designation|addition/i.test(title) &&
      /general licen[cs]e|frequently asked|\bfaqs?\b|settlement|guidance|advisory|interpretive|regulation/i.test(title)) {
    return 'low'
  }

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

// ─── PAGE PARSING ───────────────────────────────────────────────────────────

export interface OfacAction {
  /** e.g. "/recent-actions/20261009_33" */
  path: string
  url: string
  title: string
  /** The day OFAC lists the action under (noon UTC, since the page gives no time) */
  date: Date | null
  /** e.g. "Sanctions List Updates", "General Licenses" */
  category: string
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}

function htmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => codePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

/** The actions listed on an OFAC Recent Actions page, newest first, one per link */
export function parseOfacRecentActions(html: string): OfacAction[] {
  const links = [...html.matchAll(
    /<a\s[^>]*href="((?:https:\/\/ofac\.treasury\.gov)?\/recent-actions\/(\d{4})(\d{2})(\d{2})(?:_\d+)?)"[^>]*>([\s\S]*?)<\/a>/g,
  )]
  const actions: OfacAction[] = []
  const seen = new Set<string>()

  links.forEach((m, i) => {
    const path = m[1].replace(OFAC_ORIGIN, '')
    const title = htmlText(m[5])
    if (!title || seen.has(path)) return
    seen.add(path)

    // The date and category sit between this link and the next action's link
    const after = html.slice((m.index ?? 0) + m[0].length, links[i + 1]?.index ?? html.length).slice(0, 2_000)
    const shown = after.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/)
    const month = shown ? MONTHS[shown[1].toLowerCase()] : undefined
    const date = shown && month !== undefined
      ? new Date(Date.UTC(Number(shown[3]), month, Number(shown[2]), 12))
      : new Date(Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]), 12))
    const category = after.match(/<a\s[^>]*href="\/recent-actions\/[a-z][a-z0-9-]*"[^>]*>([\s\S]*?)<\/a>/)

    actions.push({
      path,
      url: `${OFAC_ORIGIN}${path}`,
      title,
      date: isNaN(date.getTime()) ? null : date,
      category: category ? htmlText(category[1]) : '',
    })
  })

  return actions
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

      let html: string
      try {
        html = await fetchWithResilience(
          'ofac-sanctions',
          'OFAC Sanctions',
          OFAC_RECENT_ACTIONS_URL,
          async () => {
            const res = await fetch(OFAC_RECENT_ACTIONS_URL, {
              headers: {
                'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network; https://world-pulse.io)',
                'Accept': 'text/html,application/xhtml+xml',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (!res.ok) throw Object.assign(new Error(`OFAC Sanctions: HTTP ${res.status}`), { statusCode: res.status })
            return res.text()
          },
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }

      const actions = parseOfacRecentActions(html)
      if (actions.length === 0) {
        // The page loaded but nothing parsed: OFAC changed its layout
        log.warn('No actions found on the OFAC Recent Actions page')
        return
      }

      const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000
      const recent = actions.filter(a => a.date && a.date.getTime() > cutoff)

      log.info({ total: actions.length, recent: recent.length }, 'OFAC items fetched')

      let inserted = 0

      for (const action of recent) {
        const dedupKey = `osint:ofac:${action.path.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 100)}`
        if (await redis.get(dedupKey)) continue

        const severity = sanctionsSeverity(action.title, '', action.category)
        const location = inferSanctionsRegion(action.title)
        const day = action.date!.toISOString().slice(0, 10)

        const signalData = {
          title: `OFAC Sanctions: ${action.title.slice(0, 200)}`,
          summary: `${action.title}. ${action.category ? `${action.category}. ` : ''}Published by the US Treasury's Office of Foreign Assets Control on ${day}.`.slice(0, 2000),
          original_urls: [action.url],
          source_ids: [],
          category: 'security' as const,
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
          location_name: 'Unknown',
          country_code: null,
          region: null,
          tags: ['osint', 'sanctions', 'ofac', 'security'],
          language: 'en',
          event_time: action.date!,
          source_count: 1,
        }

        try {
          await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'ofac-sanctions' })
          await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        } catch (err) {
          log.warn({ err, action: action.path }, 'Failed to ingest OFAC action')
          continue
        }

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signalData) }],
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
