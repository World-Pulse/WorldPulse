/**
 * The map's travel advisories layer (Nov 22, 2026; Devon: "add more map layers where it makes sense and is free and
 * automated"): every country shaded by the US State Department's travel advisory level, 1 (exercise normal
 * precautions) to 4 (do not travel). The scraper reads the State Department's feed every hour (a work of the US
 * government, public domain) and the API's /api/v1/public/travel-advice gives each country's level.
 */

export interface TravelLevelRow { country: string; level: number; since: string | null }

/** Each level's colour and name, 1 to 4 (the legend's order) */
export const TRAVEL_LEVELS = [
  { level: 1, color: '#86efac', label: 'Normal precautions' },
  { level: 2, color: '#fde047', label: 'Increased caution' },
  { level: 3, color: '#fb923c', label: 'Reconsider travel' },
  { level: 4, color: '#ef4444', label: 'Do not travel' },
] as const

export const TRAVEL_SOURCE_URL = 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html'

/** The countries to shade: a real level and a two-letter code each, one row per country */
export function travelShading(rows: unknown): Array<{ iso: string; color: string; level: number }> {
  if (!Array.isArray(rows)) return []
  const seen = new Set<string>()
  const out: Array<{ iso: string; color: string; level: number }> = []
  for (const r of rows as Array<Partial<TravelLevelRow> | null>) {
    const iso = typeof r?.country === 'string' ? r.country : ''
    const def = TRAVEL_LEVELS.find(l => l.level === r?.level)
    if (!/^[A-Z]{2}$/.test(iso) || !def || seen.has(iso)) continue
    seen.add(iso)
    out.push({ iso, color: def.color, level: def.level })
  }
  return out
}

/** How many countries are at each level, 1 to 4 */
export function travelCounts(rows: Array<{ level: number }>): [number, number, number, number] {
  const n: [number, number, number, number] = [0, 0, 0, 0]
  for (const r of rows) if (r.level >= 1 && r.level <= 4) n[r.level - 1] = (n[r.level - 1] ?? 0) + 1
  return n
}
