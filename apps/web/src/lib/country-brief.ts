/**
 * The numbers behind the World Map's country brief (plan M9): the signals on
 * the map that belong to a country, counted by severity and topic, newest
 * first. Worked out from what the map has already loaded (the same time
 * window and filters), so the brief opens at once.
 */

import { featureContains, type CountryFeature } from './country-shapes'

export interface BriefSignal {
  id: string
  severity: string
  category: string
  status: string
  country_code: string | null
  lat: number
  lng: number
  created_at: string
}

export const BRIEF_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type BriefSeverity = typeof BRIEF_SEVERITIES[number]

export interface CountryBriefData<T extends BriefSignal> {
  total: number
  verified: number
  bySeverity: Record<BriefSeverity, number>
  /** Topics, most signals first (at most 5) */
  categories: Array<{ category: string; count: number }>
  /** Newest first (at most `latestMax`) */
  latest: T[]
}

/**
 * A country's signals: those tagged with its code, plus untagged ones whose
 * pin lies inside its outline.
 */
export function signalsInCountry<T extends BriefSignal>(
  signals: T[],
  code: string | null,
  feature: CountryFeature | null,
): T[] {
  return signals.filter(s => {
    if (s.country_code) return code !== null && s.country_code.toUpperCase() === code
    return feature !== null && Number.isFinite(s.lng) && Number.isFinite(s.lat) && featureContains(feature, Number(s.lng), Number(s.lat))
  })
}

export function countryBrief<T extends BriefSignal>(signals: T[], latestMax = 8): CountryBriefData<T> {
  const bySeverity: Record<BriefSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  const byCategory = new Map<string, number>()
  let verified = 0
  for (const s of signals) {
    const sev = (BRIEF_SEVERITIES as readonly string[]).includes(s.severity) ? s.severity as BriefSeverity : 'low'
    bySeverity[sev]++
    if (s.status === 'verified') verified++
    const cat = s.category || 'other'
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
  }
  const categories = [...byCategory]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .slice(0, 5)
  const latest = [...signals]
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .slice(0, latestMax)
  return { total: signals.length, verified, bySeverity, categories, latest }
}
