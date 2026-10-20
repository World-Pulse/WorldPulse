/**
 * OpenSanctions Entity Search
 *
 * Queries the public OpenSanctions API (https://api.opensanctions.org) to search
 * sanctioned persons, companies, vessels, and other entities across 100+ global
 * sanctions lists (OFAC SDN, EU FSF, UN SC, UK HMT, Interpol, World Bank, etc.).
 *
 * OpenSanctions asks for an API key (without one it answers 401 Unauthorized,
 * checked Oct 20, 2026): set OPENSANCTIONS_API_KEY on the server and every call
 * sends it as "Authorization: ApiKey <key>" (opensanctions.org/docs/api/authentication).
 * After a 401 or 403 no call goes out for 10 minutes: the callers get the same
 * error at once, and the pages say searching is offline (plan P16).
 * Set OPENSANCTIONS_URL env var to point at a self-hosted Yente instance if needed.
 *
 * Unique WorldPulse feature: combines live OSINT signal feeds (OFAC + EU sanctions
 * pollers) with on-demand entity lookup — no competitor has both in one platform.
 */

import { redis } from '../db/redis'

const OPENSANCTIONS_BASE = (
  process.env['OPENSANCTIONS_URL'] ?? 'https://api.opensanctions.org'
).replace(/\/$/, '')

const CACHE_TTL_S = 300 // 5 minutes — sanctions lists update daily, not real-time

/** After OpenSanctions refuses us (401/403: no key, or a key it doesn't accept), wait this long before asking again */
export const REFUSED_PAUSE_MS = 10 * 60 * 1000
let refused: { until: number; message: string } | null = null

/** The key, read at call time so a restart with a new key needs nothing else */
function apiKey(): string {
  return (process.env['OPENSANCTIONS_API_KEY'] || '').trim()
}

/** True while OpenSanctions has refused us in the last 10 minutes: searching is offline */
export function sanctionsSearchRefused(now = Date.now()): boolean {
  return refused !== null && now < refused.until
}

/** For tests: forget a refusal */
export function resetSanctionsRefusal(): void {
  refused = null
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OSEntity {
  id:       string
  caption:  string
  schema:   string
  datasets: string[]
  score:    number
  properties: {
    name?:        string[]
    alias?:       string[]
    birthDate?:   string[]
    deathDate?:   string[]
    nationality?: string[]
    country?:     string[]
    position?:    string[]
    notes?:       string[]
    topics?:      string[]
    address?:     string[]
    website?:     string[]
    email?:       string[]
    phone?:       string[]
    passportNumber?: string[]
    idNumber?:    string[]
    registrationNumber?: string[]
    incorporationDate?:  string[]
    modifiedAt?:  string[]
  }
}

interface OSSearchResponse {
  results: OSEntity[]
  total:   { value: number; relation: string } | number
  limit:   number
  offset:  number
}

// ─── Main search function ──────────────────────────────────────────────────────

/**
 * Search sanctioned entities by name/keyword.
 *
 * @param q      - Search query (name, alias, passport number, etc.)
 * @param limit  - Max results (1–20)
 * @param schema - Optional entity type filter: Person | Company | Organization | Vessel | Aircraft
 */
export async function searchEntities(
  q:       string,
  limit  = 10,
  schema?: string,
): Promise<{ entities: OSEntity[]; total: number }> {
  const cacheKey = `os:search:${q.toLowerCase().replace(/\s+/g, '_').slice(0, 80)}:${schema ?? 'all'}:${limit}`

  // ── Cache hit ────────────────────────────────────────────
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as { entities: OSEntity[]; total: number }
    }
  } catch { /* Redis miss — proceed */ }

  // ── Refused a moment ago: don't ask again yet ────────────
  if (refused && Date.now() < refused.until) throw new Error(refused.message)

  // ── Fetch from OpenSanctions ─────────────────────────────
  const params = new URLSearchParams({
    q,
    limit:   String(Math.min(limit, 20)),
    dataset: 'default',
  })
  if (schema) params.set('schema', schema)

  const headers: Record<string, string> = {
    'User-Agent': 'WorldPulse/1.0 (+https://world-pulse.io; open-source OSINT platform)',
    Accept:       'application/json',
  }
  const key = apiKey()
  if (key) headers['Authorization'] = `ApiKey ${key}`

  const res = await fetch(`${OPENSANCTIONS_BASE}/search/default?${params}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  })

  if (!res.ok) {
    const message = `OpenSanctions API error: ${res.status} ${res.statusText}`
    if (res.status === 401 || res.status === 403) refused = { until: Date.now() + REFUSED_PAUSE_MS, message }
    throw new Error(message)
  }
  refused = null

  const data = await res.json() as OSSearchResponse

  // API returns total as `{ value, relation }` or plain number depending on version
  const totalCount =
    typeof data.total === 'object' && data.total !== null
      ? (data.total as { value: number }).value
      : (data.total as number) ?? data.results.length

  const result = { entities: data.results, total: totalCount }

  // ── Cache result ─────────────────────────────────────────
  redis.setex(cacheKey, CACHE_TTL_S, JSON.stringify(result)).catch(() => {})

  return result
}

// ─── Display helpers ───────────────────────────────────────────────────────────

/** Human-readable label for an OpenSanctions dataset identifier */
export function datasetLabel(id: string): string {
  const KNOWN: Record<string, string> = {
    us_ofac_sdn:                'OFAC SDN',
    us_ofac_cons:               'OFAC Consolidated',
    eu_fsf:                     'EU Financial Sanctions',
    un_sc_sanctions:            'UN Security Council',
    gb_hmt_sanctions:           'UK HM Treasury',
    ch_seco_sanctions:          'Switzerland SECO',
    ca_dfatd_sema_sanctions:    'Canada SEMA',
    au_dfat_sanctions:          'Australia DFAT',
    jp_mof_sanctions:           'Japan MoF',
    nz_russia_sanctions:        'New Zealand (Russia)',
    us_bis_entity:              'US BIS Entity List',
    us_state_debarment:         'US State Debarment',
    us_dod_contractors:         'US DoD Contractors',
    interpol_red_notices:       'Interpol Red Notices',
    worldbank_debarment:        'World Bank Debarment',
    icij_offshoreleaks:         'ICIJ Offshore Leaks',
    us_fbi_most_wanted:         'FBI Most Wanted',
    us_dea_fugitives:           'DEA Fugitives',
    us_ice_most_wanted:         'ICE Most Wanted',
    ru_rupep:                   'Russia RuPEP',
    kg_fiu_sanctions:           'Kyrgyzstan FIU',
    ua_nabc_sanctions:          'Ukraine NABC',
    kz_afmrk_sanctions:         'Kazakhstan AFMRK',
    gb_fcdo_russia:             'UK FCDO Russia',
    eu_travel_bans:             'EU Travel Bans',
    default:                    'OpenSanctions (all lists)',
  }
  return KNOWN[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Short schema display name */
export function schemaLabel(schema: string): string {
  const MAP: Record<string, string> = {
    Person:       'Person',
    Company:      'Company',
    Organization: 'Organization',
    LegalEntity:  'Legal Entity',
    Vessel:       'Vessel',
    Aircraft:     'Aircraft',
    PublicBody:   'Public Body',
    Thing:        'Entity',
  }
  return MAP[schema] ?? schema
}

/** Severity of an entity based on which lists it appears on */
export function entityThreatLevel(datasets: string[]): 'critical' | 'high' | 'medium' | 'low' {
  const CRITICAL_LISTS = new Set([
    'us_ofac_sdn', 'un_sc_sanctions', 'eu_fsf', 'interpol_red_notices', 'us_fbi_most_wanted',
  ])
  const HIGH_LISTS = new Set([
    'gb_hmt_sanctions', 'us_bis_entity', 'us_ofac_cons', 'worldbank_debarment',
    'ch_seco_sanctions', 'au_dfat_sanctions', 'ca_dfatd_sema_sanctions',
  ])

  if (datasets.some(d => CRITICAL_LISTS.has(d))) return 'critical'
  if (datasets.some(d => HIGH_LISTS.has(d)))     return 'high'
  if (datasets.length >= 2)                       return 'medium'
  return 'low'
}
