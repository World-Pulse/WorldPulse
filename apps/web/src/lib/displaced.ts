/**
 * UNHCR's figures for each country (plan R4; Devon, Oct 21, 2026: "Add -
 * added refugee and displacement data"), kept on our own server as
 * public/geo/unhcr-displacement.v1.geojson (scripts/map-data/
 * unhcr-displacement.py, run when UNHCR publishes new figures, twice a year).
 * UNHCR's population statistics are licensed CC BY 4.0: whatever shows them
 * credits UNHCR and links its Refugee Data Finder.
 *
 * Read by the World Map's "Displaced people (UNHCR)" layer and by each
 * country's page.
 */

export const DISPLACED_FILE = '/geo/unhcr-displacement.v1.geojson'
export const UNHCR_DATA_URL = 'https://www.unhcr.org/refugee-statistics/'

export interface DisplacedFigures {
  name: string
  /** ISO 3166-1 alpha-2, upper case; null when the file had none */
  iso2: string | null
  /** The year UNHCR's figures are for */
  year: number | null
  /** Displaced inside the country */
  inside: number
  /** Its people abroad: refugees, asylum-seekers and others in need of international protection */
  abroad: number
  /** The same three groups from elsewhere, living in the country */
  hosted: number
  stateless: number
  /** Refugees and displaced people who went home that year */
  returned: number
  /** The circle's size on the map, 0 to 1: the square root of its share of the largest */
  size: number
  lng: number
  lat: number
  /** What UNHCR's figures leave out, where it matters */
  note: string | null
}

const PALESTINE_NOTE = 'UNHCR\'s figures don\'t include the Palestine refugees UNRWA serves, or people displaced inside Gaza and the West Bank.'

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const count = (v: unknown): number => Math.max(0, Math.round(num(v) ?? 0))

/** The file's countries, each checked: a name and a real place, counts as whole numbers */
export function displacedFigures(json: unknown): DisplacedFigures[] {
  const list = (json as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  const year = num((json as { year?: unknown }).year)
  const out: DisplacedFigures[] = []
  for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
    const lng = num(c[0]), lat = num(c[1])
    const p = f?.properties ?? {}
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name || lng == null || lat == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue
    const iso2 = /^[A-Z]{2}$/.test(String(p.iso2 ?? '')) ? String(p.iso2) : null
    out.push({
      name, iso2, year,
      inside: count(p.inside), abroad: count(p.abroad), hosted: count(p.hosted),
      stateless: count(p.stateless), returned: count(p.returned),
      size: Math.min(1, Math.max(0, num(p.size) ?? 0)),
      lng, lat,
      note: iso2 === 'PS' ? PALESTINE_NOTE : null,
    })
  }
  return out
}

/** 9139309 → "9.1 million", 270007 → "270,007" */
export function people(n: number): string {
  if (n >= 1e6) return `${(Math.round(n / 1e5) / 10).toLocaleString('en-US')} million`
  return n.toLocaleString('en-US')
}

/** Each group in plain words, the biggest story first; groups under 1 left out */
export function displacedLines(f: Pick<DisplacedFigures, 'inside' | 'abroad' | 'hosted' | 'stateless' | 'returned' | 'year'>): string[] {
  const lines: string[] = []
  if (f.inside) lines.push(`${people(f.inside)} displaced inside the country`)
  if (f.abroad) lines.push(`${people(f.abroad)} refugees and asylum-seekers abroad`)
  if (f.hosted) lines.push(`Hosts ${people(f.hosted)} from elsewhere`)
  if (f.stateless) lines.push(`${people(f.stateless)} stateless people`)
  if (f.returned) lines.push(`${people(f.returned)} went home${f.year ? ` in ${f.year}` : ''}`)
  return lines
}

/** The World Map, centred on the country, with this layer on */
export function displacedMapLink(f: Pick<DisplacedFigures, 'lat' | 'lng'>): string {
  return `/map#@${f.lat.toFixed(2)},${f.lng.toFixed(2)},3.50|l=displaced`
}
