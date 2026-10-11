/**
 * Convergence hotspots as the World Map uses them. Before Oct 11, 2026 the
 * API sent a cell's categories as one string ("{conflict,health}"), and
 * opening the "N CONVERGENCES" list crashed the whole map page; this keeps
 * the map safe from that shape whatever the API sends.
 */

export interface Hotspot {
  centerLat:      number
  centerLng:      number
  /** The place most of the cell's signals are pinned to ("Kyiv, Ukraine") */
  place?:         string | null
  signalCount:    number
  categoryCount:  number
  categories:     string[]
  maxSeverity:    string
  avgReliability: number
  latestSignalAt: string | null
  sampleTitles:   string[]
  sampleIds:      string[]
}

/** A list of strings from an array, or from a Postgres array written as text ("{a,b}") */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  const inner = value.trim().replace(/^\{|\}$/g, '')
  return inner ? inner.split(',').map(v => v.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean) : []
}

/** One hotspot from the API, with every field in the shape the map expects (null if it has no position) */
export function toHotspot(raw: unknown): Hotspot | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.centerLat == null || r.centerLng == null) return null
  const lat = Number(r.centerLat)
  const lng = Number(r.centerLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    centerLat:      lat,
    centerLng:      lng,
    place:          typeof r.place === 'string' && r.place.trim() ? r.place.trim() : null,
    signalCount:    Number(r.signalCount) || 0,
    categoryCount:  Number(r.categoryCount) || 0,
    categories:     toStringList(r.categories),
    maxSeverity:    typeof r.maxSeverity === 'string' ? r.maxSeverity : 'low',
    avgReliability: Number(r.avgReliability) || 0,
    latestSignalAt: typeof r.latestSignalAt === 'string' ? r.latestSignalAt : null,
    sampleTitles:   toStringList(r.sampleTitles),
    sampleIds:      toStringList(r.sampleIds),
  }
}

/** Where a hotspot is, in words when we know it */
export function hotspotPlace(hs: Pick<Hotspot, 'place' | 'centerLat' | 'centerLng'>): string {
  return hs.place || `${hs.centerLat.toFixed(1)}°, ${hs.centerLng.toFixed(1)}°`
}
