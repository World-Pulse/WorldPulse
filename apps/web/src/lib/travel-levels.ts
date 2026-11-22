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

/**
 * Whose advice shades the map (Nov 22, 2026; Devon: "ok to proceed"): the US State Department's, or Canada's as a
 * second opinion (Global Affairs Canada's open data, levels 1 to 4 from its four states). Canada's licence asks for
 * its line wherever its data is shown, so the legend gives it with Canada's advice.
 */
export type TravelFrom = 'us' | 'ca'
export const TRAVEL_FROM: Record<TravelFrom, { name: string; legend: string; labels: readonly string[]; url: string; link: string; licence?: { line: string; url: string } }> = {
  us: {
    name: 'US', legend: 'US State Department level', labels: TRAVEL_LEVELS.map(l => l.label),
    url: TRAVEL_SOURCE_URL, link: 'Each country’s advisory on travel.state.gov →',
  },
  ca: {
    name: 'Canada', legend: 'Government of Canada advice',
    labels: ['Normal precautions', 'High degree of caution', 'Avoid non-essential travel', 'Avoid all travel'],
    url: 'https://travel.gc.ca/travelling/advisories', link: 'Each country’s advice on travel.gc.ca →',
    licence: { line: 'Contains information licensed under the Open Government Licence – Canada', url: 'https://open.canada.ca/en/open-government-licence-canada' },
  },
}

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
