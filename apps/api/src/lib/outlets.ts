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

/** "Reuters (news agency, GB)", "TASS (news agency, RU, state media)", "example.com" */
export function describeSite(site: string): string {
  const e = outletOf(site)
  if (!e) return site
  return `${e.name} (${OUTLET_KIND_LABELS[e.kind].toLowerCase()}, ${e.country}${e.state ? ', state media' : ''})`
}
