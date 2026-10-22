import { cachedFetch } from '@/lib/server-fetch'
import { SITE_URL } from '@/lib/page-metadata'
import { weekSpan } from '@/lib/week'
import { clip } from '@/lib/story-card'
import type { EntityCardText } from '@/lib/entity-card'

/**
 * Under-reported crises (the coverage gap, Oct 21, 2026): the countries UNHCR
 * counts at least a million people displaced from, ranked by how few news
 * outlets WorldPulse placed in them (GET /api/v1/coverage-gap,
 * apps/api/src/lib/coverage-gap.ts). Read by /under-reported, its finished
 * weeks (/under-reported/2026-W42) and their share pictures.
 */

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
export const API_ORIGIN = 'https://api.world-pulse.io'
export const UNHCR_DATA_URL = 'https://www.unhcr.org/refugee-statistics/'

export interface GapCrisis {
  rank: number
  code: string
  name: string
  displaced: number
  inside: number
  abroad: number
  outlets: number
  articles: number
  peoplePerOutlet: number
  sites: Array<{ site: string; articles: number }>
  stories: Array<{ id: string; title: string; outlets: number; verified: boolean }>
}

export interface CoverageGapData {
  window: 'last7days' | 'week'
  week: string | null
  start: string
  end: string
  minDisplaced: number
  unhcrYear: number
  crises: GapCrisis[]
  mostCovered: Array<{ code: string; name: string; outlets: number; articles: number }>
  totals: { articles: number; outlets: number; countries: number; crisisArticles: number; crisisShare: number; crisisDisplaced: number }
  generatedAt: string
}

/**
 * The figures (no week: the last 7 days); 'missing' for a week that isn't
 * one, isn't over or hasn't begun, 'unavailable' when the API didn't answer
 * (or is still putting a week together). Kept 2 minutes in this process.
 */
export async function fetchCoverageGap(week?: string): Promise<CoverageGapData | 'missing' | 'unavailable'> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/coverage-gap${week ? `?week=${encodeURIComponent(week)}` : ''}`, 120_000)
    if (res.status === 400 || res.status === 404) return 'missing'
    if (!res.ok) return 'unavailable'
    const json = await res.json() as { success?: boolean; data?: CoverageGapData }
    return json.success && json.data && Array.isArray(json.data.crises) ? json.data : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** "12.9 million", "980,000" */
export function people(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`
  return Math.round(n).toLocaleString('en-US')
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Oct 14–21, 2026" for the last 7 days, the week's own span for a finished week */
export function gapSpan(d: Pick<CoverageGapData, 'window' | 'start' | 'end'>): string {
  if (d.window === 'week') return weekSpan(new Date(d.start))
  const start = new Date(d.start), end = new Date(d.end)
  const month = (x: Date) => x.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const sameMonth = month(start) === month(end)
  return `${month(start)} ${start.getUTCDate()}–${sameMonth ? '' : `${month(end)} `}${end.getUTCDate()}, ${end.getUTCFullYear()}`
}

export const gapPath = (d: Pick<CoverageGapData, 'week'>) => (d.week ? `/under-reported/${d.week}` : '/under-reported')

/** The page title (" — WorldPulse" is added) */
export function gapTitle(d: Pick<CoverageGapData, 'window' | 'start' | 'end'>): string {
  return d.window === 'week' ? `Under-reported crises: ${gapSpan(d)}` : 'Under-reported crises this week'
}

export function gapDescription(d: CoverageGapData): string {
  const top = d.crises.slice(0, 3).map(c => c.name)
  const lead = d.crises.length
    ? `${d.crises.length} countries where at least a million people are displaced, ranked by how few news outlets reported on them`
    : 'The countries where at least a million people are displaced, ranked by how few news outlets reported on them'
  return `${lead}${d.window === 'week' ? ` in the week of ${gapSpan(d)}` : ' in the last 7 days'}${top.length ? `: ${top.join(', ')} first` : ''}. UNHCR's figures against the outlets WorldPulse reads.`
}

/** What the share picture says: the least covered crisis, and one bar per crisis (its outlets) */
export function gapCardText(d: CoverageGapData): EntityCardText {
  const first = d.crises[0]
  const span = gapSpan(d).replace(/, \d{4}$/, '')
  const name = first ? clip(first.name, 40) : 'Under-reported crises'
  const then = d.crises.slice(1, 4).map(c => c.name)
  return {
    name,
    nameSize: name.length <= 14 ? 112 : name.length <= 24 ? 92 : name.length <= 36 ? 72 : 58,
    kind: `MOST UNDER-REPORTED CRISIS · ${span.toUpperCase()}`,
    counts: first
      ? `${people(first.displaced)} displaced · ${plural(first.outlets, 'outlet')} ${d.window === 'week' ? 'that week' : 'in 7 days'}`
      : 'No figures yet',
    bars: d.crises.map(c => c.outlets),
    story: then.length ? clip(`Then ${then.join(', ')}`, 90) : null,
    proof: 'UNHCR figures · the outlets WorldPulse reads',
    verified: false,
  }
}

/** Structured data for search engines and dataset search: what the list is, where its data comes from */
export function gapJsonLd(d: CoverageGapData): Record<string, unknown> {
  const url = `${SITE_URL}${gapPath(d)}`
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: gapTitle(d),
    description: gapDescription(d),
    url,
    creator: { '@type': 'Organization', name: 'WorldPulse', url: SITE_URL },
    isBasedOn: { '@type': 'Dataset', name: `UNHCR Refugee Data Finder (${d.unhcrYear})`, url: UNHCR_DATA_URL, license: 'https://creativecommons.org/licenses/by/4.0/' },
    temporalCoverage: `${d.start.slice(0, 10)}/${d.end.slice(0, 10)}`,
    spatialCoverage: 'World',
    variableMeasured: ['People displaced (UNHCR)', 'News outlets reporting', 'People displaced per outlet'],
    distribution: {
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: `${API_ORIGIN}/api/v1/coverage-gap${d.week ? `?week=${d.week}` : ''}`,
    },
  }
}
