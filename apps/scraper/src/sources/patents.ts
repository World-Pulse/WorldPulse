/**
 * USPTO PatentsView Defense & Dual-Use Patent Intelligence Signal Source
 *
 * Polls the USPTO PatentsView REST API for newly granted patents and
 * published applications in defense, aerospace, military, cybersecurity,
 * nuclear, and dual-use technology categories. Creates WorldPulse signals
 * when strategically significant patent activity is detected.
 *
 * API: https://search.patentsview.org/api/v1/patent/
 * Docs: https://patentsview.org/apis/purpose-built-databases/api
 * Free public API — no authentication required for basic queries.
 *
 * Reliability: 0.93 (USPTO is the authoritative US patent authority;
 *   patent data is official government record, extremely high provenance)
 * Category: technology
 *
 * Severity rules:
 *   critical — nuclear, weapons of mass destruction, hypersonic,
 *              directed-energy weapons, offensive cyber/EW
 *   high     — missile systems, radar/sonar, unmanned systems,
 *              cryptography, classified technology transfer
 *   medium   — dual-use: satellite, communications, advanced materials,
 *              biotechnology with defense applications
 *   low      — general aerospace, defense logistics, base technologies
 *
 * Dedup: osint:patents:{patentId} @ 30-day TTL
 *
 * Poll interval: 60 minutes (USPTO_PATENTS_INTERVAL_MS env var, default 3600000)
 *
 * Competitive differentiation: directly counters WorldMonitor's
 * USPTO PatentsView defense patent seeder (PR opened March 22, 2026, unmerged).
 * WorldPulse ships patent intelligence FIRST.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'patents-source' })

const PATENTSVIEW_URL  = 'https://search.patentsview.org/api/v1/patent/'
const RELIABILITY      = 0.93
const DEDUP_TTL_S      = 30 * 86_400   // 30-day dedup
const MAX_RESULTS      = 25            // patents per poll cycle

// ─── DEFENSE & DUAL-USE CPC CLASSIFICATION CODES ───────────────────────────

/**
 * CPC (Cooperative Patent Classification) codes for defense and dual-use
 * technology areas. WorldPulse monitors patents in these domains.
 */
export const DEFENSE_CPC_CODES: Record<string, string> = {
  // Weapons & munitions
  'F41':    'Weapons',
  'F42':    'Ammunition and Explosives',
  // Military vehicles & platforms
  'B64C30': 'Military Aircraft',
  'B64G':   'Cosmonautics; Space Technology',
  // Naval
  'B63G':   'Offensive and Defensive Arrangements on Vessels',
  // Missiles & guidance
  'F42B15': 'Missiles and Projectiles',
  'G01S':   'Radio Direction-Finding; Radar; Sonar',
  // Nuclear
  'G21':    'Nuclear Physics; Nuclear Engineering',
  'G21J':   'Nuclear Explosives',
  // Cyber & electronic warfare
  'H04K':   'Secret Communication; Jamming of Communication',
  'H04L9':  'Arrangements for Secret or Secure Communications',
  // UAVs & unmanned systems
  'B64U':   'Unmanned Aerial Vehicles',
  // Directed energy
  'H01S':   'Devices Using Stimulated Emission (Lasers)',
  // Sensors & surveillance
  'G01V':   'Geophysics; Gravitational Measurements',
  'H04N7':  'Television Systems; Surveillance Cameras',
}

// ─── KEYWORD SEVERITY RULES ─────────────────────────────────────────────────

/** Patent titles/abstracts matching these patterns → critical severity */
const CRITICAL_KEYWORDS = /hypersonic|nuclear weapon|thermonuclear|fission warhead|fusion weapon|directed.energy weapon|electromagnetic pulse|EMP device|offensive cyber|zero.day exploit|biological weapon|chemical weapon/i

/** Patent titles/abstracts matching these patterns → high severity */
const HIGH_KEYWORDS = /missile guidance|anti.satellite|ASAT|cruise missile|ballistic missile|electronic warfare|radar jamming|sonar countermeasure|unmanned combat|stealth technology|classified technology|military satellite|spy satellite|drone swarm/i

/** Patent titles/abstracts matching these patterns → medium severity */
const MEDIUM_KEYWORDS = /dual.use|satellite communication|cyber.physical|advanced material|armor penetration|explosives detection|biometric surveillance|facial recognition.surveillance|military AI|autonomous weapon|lethal autonomous/i

// ─── SEVERITY MAPPING ────────────────────────────────────────────────────────

/**
 * Determine signal severity from CPC code, patent title, and abstract.
 *
 *   critical — WMD, nuclear, hypersonic, directed-energy, offensive cyber
 *   high     — missiles, ASAT, EW, unmanned combat, stealth, mil-satellite
 *   medium   — dual-use, surveillance, mil-AI, autonomous weapons
 *   low      — general defense/aerospace base technologies
 */
export function patentSeverity(
  cpcCode:   string,
  title:     string,
  abstract:  string,
): SignalSeverity {
  const text = `${title} ${abstract}`

  // Critical: WMD or explicitly offensive technologies
  if (CRITICAL_KEYWORDS.test(text)) return 'critical'
  if (cpcCode.startsWith('G21J') || cpcCode.startsWith('F42B15')) return 'critical'

  // High: significant military capabilities
  if (HIGH_KEYWORDS.test(text)) return 'high'
  if (
    cpcCode.startsWith('F41')  ||
    cpcCode.startsWith('F42')  ||
    cpcCode.startsWith('H04K') ||
    cpcCode.startsWith('B63G')
  ) return 'high'

  // Medium: dual-use and surveillance
  if (MEDIUM_KEYWORDS.test(text)) return 'medium'
  if (
    cpcCode.startsWith('G01S') ||
    cpcCode.startsWith('H04L9') ||
    cpcCode.startsWith('B64U')
  ) return 'medium'

  // Low: general defense base technology
  return 'low'
}

// ─── TITLE HELPERS ───────────────────────────────────────────────────────────

/**
 * Determine the primary defense category label from the CPC code.
 */
export function defenseCategory(cpcCode: string): string {
  for (const [prefix, label] of Object.entries(DEFENSE_CPC_CODES)) {
    if (cpcCode.startsWith(prefix)) return label
  }
  return 'Defense Technology'
}

/**
 * Build a human-readable signal title.
 * e.g. 'Patent: Hypersonic Glide Vehicle Guidance System (US123456789) — Lockheed Martin'
 */
export function buildPatentTitle(
  patentId:    string,
  patentTitle: string,
  assignee:    string | null,
): string {
  const truncated = patentTitle.length > 120
    ? `${patentTitle.slice(0, 117)}…`
    : patentTitle
  const org = assignee ? ` — ${assignee}` : ''
  return `Patent: ${truncated} (${patentId})${org}`
}

/**
 * Extract the primary assignee (organization) name from the patent data.
 * Returns null if no assignee is listed.
 */
export function extractPrimaryAssignee(
  assignees: Array<{ assignee_organization?: string | null }> | null | undefined,
): string | null {
  if (!assignees || assignees.length === 0) return null
  return assignees[0]?.assignee_organization ?? null
}

/**
 * Build the Redis dedup key for a patent signal.
 * Format: osint:patents:{patentId}
 */
export function patentDedupKey(patentId: string): string {
  return `osint:patents:${patentId}`
}

// ─── ASSIGNEE → COUNTRY MAPPING ──────────────────────────────────────────────

/**
 * Well-known defense contractors with their country centroids.
 * Used to geolocate patent signals to the filer's country.
 */
const ASSIGNEE_COUNTRY: Record<string, { countryCode: string; lat: number; lon: number }> = {
  'lockheed martin':    { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'boeing':             { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'raytheon':           { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'northrop grumman':   { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'general dynamics':   { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'l3harris':           { countryCode: 'US', lat: 38.90, lon: -77.04 },
  'bae systems':        { countryCode: 'GB', lat: 51.51, lon:  -0.13 },
  'airbus':             { countryCode: 'FR', lat: 43.60, lon:   1.44 },
  'thales':             { countryCode: 'FR', lat: 48.86, lon:   2.35 },
  'leonardo':           { countryCode: 'IT', lat: 41.90, lon:  12.50 },
  'rheinmetall':        { countryCode: 'DE', lat: 52.52, lon:  13.41 },
  'saab':               { countryCode: 'SE', lat: 59.33, lon:  18.07 },
  'israel aerospace':   { countryCode: 'IL', lat: 31.78, lon:  35.22 },
  'rafael':             { countryCode: 'IL', lat: 31.78, lon:  35.22 },
  'elbit':              { countryCode: 'IL', lat: 31.78, lon:  35.22 },
  'norinco':            { countryCode: 'CN', lat: 39.90, lon: 116.41 },
  'casic':              { countryCode: 'CN', lat: 39.90, lon: 116.41 },
  'avic':               { countryCode: 'CN', lat: 39.90, lon: 116.41 },
  'rosoboronexport':    { countryCode: 'RU', lat: 55.76, lon:  37.62 },
  'almaz-antey':        { countryCode: 'RU', lat: 55.76, lon:  37.62 },
  'united aircraft':    { countryCode: 'RU', lat: 55.76, lon:  37.62 },
}

/**
 * Resolve patent assignee organization to country/location.
 * Falls back to United States (USPTO patents default to US-origin).
 */
export function inferPatentLocation(
  assigneeOrg: string | null,
): { countryCode: string; lat: number; lon: number } {
  if (assigneeOrg) {
    const lower = assigneeOrg.toLowerCase()
    for (const [keyword, location] of Object.entries(ASSIGNEE_COUNTRY)) {
      if (lower.includes(keyword)) return location
    }
    // US government contractors / US military
    if (lower.includes('united states') || lower.includes('u.s. army') ||
        lower.includes('u.s. navy') || lower.includes('u.s. air force') ||
        lower.includes('darpa') || lower.includes('department of defense')) {
      return { countryCode: 'US', lat: 38.90, lon: -77.04 }
    }
  }
  // Default to United States (USPTO jurisdiction)
  return { countryCode: 'US', lat: 38.90, lon: -77.04 }
}

// ─── API RESPONSE TYPES ──────────────────────────────────────────────────────

interface PatentsViewPatent {
  patent_id:    string
  patent_title: string
  patent_date:  string
  patent_abstract?: string | null
  assignees?: Array<{
    assignee_organization?: string | null
    assignee_country?: string | null
  }> | null
  cpcs?: Array<{
    cpc_group?: string | null
    cpc_subgroup?: string | null
  }> | null
}

interface PatentsViewResponse {
  patents?: PatentsViewPatent[]
  total_patent_count?: number
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

export function startPatentsPoller(
  db:        Knex,
  redis:     Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.USPTO_PATENTS_INTERVAL_MS ?? 3_600_000)

  /** Get the ISO date string for 7 days ago — fresh patent grants window. */
  function getRecentDateFilter(): string {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]!  // YYYY-MM-DD
  }

  async function poll(): Promise<void> {
    try {
      log.info('Polling USPTO PatentsView for defense/dual-use patents')

      const dateFilter = getRecentDateFilter()

      // Build CPC filter — match any defense/dual-use CPC group prefix
      const cpcPrefixes = Object.keys(DEFENSE_CPC_CODES)
      const cpcFilter = cpcPrefixes.map(p => ({
        _begins: { 'cpcs.cpc_group': p }
      }))

      const requestBody = {
        q: {
          _or: [
            ...cpcFilter,
            { _gte: { patent_date: dateFilter } },
          ],
          _and: [
            { _gte: { patent_date: dateFilter } },
            { _or: cpcFilter },
          ]
        },
        f: [
          'patent_id',
          'patent_title',
          'patent_date',
          'patent_abstract',
          'assignees.assignee_organization',
          'assignees.assignee_country',
          'cpcs.cpc_group',
          'cpcs.cpc_subgroup',
        ],
        o: {
          page:    1,
          per_page: MAX_RESULTS,
          sort:    [{ patent_date: 'desc' }],
        },
      }

      const res = await fetch(PATENTSVIEW_URL, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':   'WorldPulse/1.0 (OSINT intelligence network; https://worldpulse.io)',
          'Accept':       'application/json',
        },
        body:   JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        log.warn({ status: res.status }, 'PatentsView API returned non-OK status')
        return
      }

      const body = await res.json() as PatentsViewResponse
      const patents = body.patents ?? []

      if (patents.length === 0) {
        log.debug('No defense patents returned from PatentsView')
        return
      }

      log.info({ count: patents.length }, 'Defense patents fetched from USPTO PatentsView')

      let inserted = 0

      for (const patent of patents) {
        const { patent_id, patent_title, patent_abstract, patent_date, assignees, cpcs } = patent

        if (!patent_id || !patent_title) continue

        // Dedup check
        const dedupKey = patentDedupKey(patent_id)
        const exists = await redis.get(dedupKey)
        if (exists) continue

        // Primary CPC code
        const primaryCpc = cpcs?.[0]?.cpc_group ?? 'F41A'

        // Skip if not actually in a defense CPC group
        const isDefense = Object.keys(DEFENSE_CPC_CODES).some(p => primaryCpc.startsWith(p))
        if (!isDefense) continue

        const abstract     = patent_abstract ?? ''
        const severity     = patentSeverity(primaryCpc, patent_title, abstract)
        const assigneeOrg  = extractPrimaryAssignee(assignees)
        const location     = inferPatentLocation(assigneeOrg)
        const category     = defenseCategory(primaryCpc)
        const title        = buildPatentTitle(patent_id, patent_title, assigneeOrg)

        const summary = abstract.length > 50
          ? abstract.slice(0, 2000)
          : `${category} patent granted by USPTO. CPC: ${primaryCpc}. ` +
            `Assignee: ${assigneeOrg ?? 'Undisclosed'}. Filed ${patent_date}.`

        const signalData = {
          title,
          summary,
          original_urls: [`https://patentsview.org/patent/${patent_id}`],
          source_ids:    [],
          category:      'technology' as const,
          severity,
          status:            'pending',
          reliability_score: RELIABILITY,
          location:          db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]),
          location_name:     `${assigneeOrg ?? 'USPTO'}, ${location.countryCode}`,
          country_code:      location.countryCode,
          region:            null,
          tags: [
            'osint', 'patent', 'defense', 'dual-use', 'technology',
            category.toLowerCase().replace(/\s+/g, '-'),
            primaryCpc.toLowerCase(),
          ].filter(Boolean),
          language:   'en',
          event_time: new Date(patent_date),
          source_count: 1,
        }

        await insertAndCorrelate(signalData, {
          lat:      location.lat,
          lng:      location.lon,
          sourceId: 'uspto-patents',
        })
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

        if (producer) {
          try {
            await producer.send({
              topic:    'worldpulse.signals.new',
              messages: [{ value: JSON.stringify({ patentId: patent_id, severity, category }) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish patent signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New defense/dual-use patent intelligence signals created')
      }

    } catch (err) {
      log.error({ err }, 'USPTO PatentsView poll error')
    }
  }

  // Initial poll then interval
  void poll()
  const timer = setInterval(poll, INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('USPTO PatentsView defense patent poller stopped')
  }
}
