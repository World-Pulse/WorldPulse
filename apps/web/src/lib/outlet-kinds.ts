/**
 * What an outlet is, as the API says it (plan 15, Oct 22, 2026): each website
 * a report links to, with the outlet's name, kind, home country and whether a
 * government runs it (apps/api/src/lib/outlets.ts, from the outlet directory).
 */

export type OutletKind = 'agency' | 'international' | 'national' | 'local' | 'specialist' | 'aggregator' | 'official' | 'unknown'

export interface OutletInfo {
  site: string
  /** null: a website the directory doesn't know */
  name: string | null
  kind: OutletKind
  country: string | null
  stateMedia: boolean
}

/** How each kind reads on a page; unknown says nothing */
export const OUTLET_KIND_LABELS: Record<OutletKind, string | null> = {
  agency:        'News agency',
  international: 'International',
  national:      'National',
  local:         'Local',
  specialist:    'Specialist',
  aggregator:    'Aggregator',
  official:      'Official source',
  unknown:       null,
}

/** What the API says about a website (a host, "www." or not), when it says anything */
export function infoFor(info: readonly OutletInfo[] | null | undefined, site: string | null | undefined): OutletInfo | null {
  if (!info?.length || !site) return null
  const host = site.toLowerCase().replace(/^www\./, '')
  return info.find(i => i.site === host) ?? null
}

/** The host of a link, without "www."; null when it isn't one */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** "News agency · state media", "International", "" for unknown */
export function kindLine(i: Pick<OutletInfo, 'kind' | 'stateMedia'> | null): string {
  if (!i) return ''
  const label = OUTLET_KIND_LABELS[i.kind]
  return [label, i.stateMedia ? 'state media' : null].filter(Boolean).join(' · ')
}
