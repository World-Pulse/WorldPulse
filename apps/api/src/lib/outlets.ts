/**
 * What an outlet is (plan 15, Oct 22, 2026): a website looked up in the outlet
 * directory (lib/outlet-directory.ts, written by
 * scripts/outlets/build-outlet-directory.py), for its name, home country, kind
 * (news agency, international, national, local, specialist, aggregator,
 * official) and whether a government runs it. A subdomain stands for its
 * website (edition.cnn.com is cnn.com); a website the directory doesn't know
 * (many of the articles GDELT points to) is "unknown".
 */

import { OUTLET_DIRECTORY, type OutletEntry, type OutletKind } from './outlet-directory'

export type { OutletKind }

/** How each kind reads on a page */
export const OUTLET_KIND_LABELS: Record<OutletKind, string> = {
  agency:        'News agency',
  international: 'International',
  national:      'National',
  local:         'Local',
  specialist:    'Specialist',
  aggregator:    'Aggregator',
  official:      'Official source',
}

/** The directory's entry for a website (a host, "www." or not), its own or its nearest parent's; null when unknown */
export function outletOf(site: string): (OutletEntry & { site: string }) | null {
  let host = String(site ?? '').trim().toLowerCase().replace(/^www\./, '')
  while (host.includes('.')) {
    const entry = OUTLET_DIRECTORY[host]
    if (entry) return { ...entry, site: host }
    host = host.slice(host.indexOf('.') + 1)
  }
  return null
}

/** The websites of a list of links, each once, without "www." (`max` at most), in the links' order */
export function sitesOfLinks(urls: unknown, max = 10): string[] {
  const out: string[] = []
  for (const u of Array.isArray(urls) ? urls : []) {
    try {
      const url = new URL(String(u))
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      if (host && !out.includes(host)) out.push(host)
    } catch { /* not a link */ }
    if (out.length >= max) break
  }
  return out
}

export interface SiteInfo {
  site: string
  /** The outlet's name; null when the directory doesn't know the website */
  name: string | null
  kind: OutletKind | 'unknown'
  /** Its home country (ISO 3166-1 alpha-2); null when unknown */
  country: string | null
  /** A government runs it */
  stateMedia: boolean
}

/** For each website: its outlet's name, kind, home country and whether a government runs it */
export function siteInfo(sites: readonly string[]): SiteInfo[] {
  return sites.map(site => {
    const e = outletOf(site)
    return { site, name: e?.name ?? null, kind: e?.kind ?? 'unknown', country: e?.country ?? null, stateMedia: Boolean(e?.state) }
  })
}

/**
 * How far a story reached (Nov 8, 2026; Devon: "find a way to retain the edge" once WorldMonitor counted outlets too):
 * how many countries its outlets are from, and how many are newsrooms of the story's own country (`country`, the
 * place most of its reports are pinned to), with up to three of their names. Websites the directory doesn't know
 * count for neither.
 */
export interface OutletReach {
  countries: number
  local: number
  localNames: string[]
}

export function outletReach(sites: readonly string[], country: string | null | undefined): OutletReach {
  const seen = new Set<string>()
  const localNames: string[] = []
  let local = 0
  const home = country ? country.toUpperCase() : null
  for (const site of sites) {
    const e = outletOf(site)
    if (!e?.country) continue
    seen.add(e.country)
    if (home && e.country === home) {
      local++
      if (localNames.length < 3 && !localNames.includes(e.name)) localNames.push(e.name)
    }
  }
  return { countries: seen.size, local, localNames }
}

/**
 * The languages a story is reported in (Nov 10, 2026; Devon: "Add 'reported in N languages' to your X posts"): its
 * outlets' feed languages as the directory knows them (an outlet WorldPulse sees only in GDELT's articles has none),
 * and its reports' own (`reportLanguages`; a second outlet the search finds is in its report's language), A to Z
 */
export function outletLanguages(sites: readonly string[], reportLanguages: readonly unknown[] = []): string[] {
  const out = new Set<string>()
  for (const site of sites) {
    const lang = outletOf(site)?.lang
    if (lang && /^[a-z]{2}$/.test(lang)) out.add(lang)
  }
  for (const lang of reportLanguages) if (typeof lang === 'string' && /^[a-z]{2}$/.test(lang)) out.add(lang)
  return [...out].sort()
}

/** Names that read better than Unicode's ("Congo - Kinshasa", "Myanmar (Burma)"), or as the site writes them */
const COUNTRY_LABELS: Record<string, string> = {
  CD: 'DR Congo', CG: 'Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macau', PS: 'Palestine', TR: 'Turkey',
  CZ: 'Czech Republic', BA: 'Bosnia and Herzegovina', TT: 'Trinidad and Tobago', AG: 'Antigua and Barbuda',
  KN: 'St Kitts and Nevis', LC: 'St Lucia', VC: 'St Vincent and the Grenadines', ST: 'São Tomé and Príncipe',
  VA: 'Vatican City', FM: 'Micronesia',
}
/** Countries said with "the": "2 from the United States" */
const WITH_THE = new Set(['US', 'GB', 'NL', 'PH', 'AE', 'CF', 'DO', 'BS', 'GM', 'MV', 'KM', 'SB', 'MH', 'KY', 'FO', 'FK', 'TC', 'VG', 'VI', 'MP', 'CK'])
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/** "Poland", "the United States" (`the` false: "United States"); the code itself when it is not one */
export function countryLabel(code: string, the = true): string {
  const c = code.toUpperCase()
  let name = COUNTRY_LABELS[c]
  if (!name) {
    try { name = REGION_NAMES.of(c) ?? c } catch { name = c }
  }
  return the && WITH_THE.has(c) ? `the ${name}` : name
}

/** "Reuters (news agency, GB)", "TASS (news agency, RU, state media)", "example.com" */
export function describeSite(site: string): string {
  const e = outletOf(site)
  if (!e) return site
  return `${e.name} (${OUTLET_KIND_LABELS[e.kind].toLowerCase()}, ${e.country}${e.state ? ', state media' : ''})`
}
