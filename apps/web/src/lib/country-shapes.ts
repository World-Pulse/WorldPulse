/**
 * Country outlines for the World Map (Natural Earth 1:110m, loaded once when
 * first needed): which country a click landed in, its outline for the
 * highlight, and its code and name. The country-risk layer uses the same file.
 *
 * Served from our own site (plan M23, Oct 14, 2026): it came from a third
 * party's CloudFront address, and if that went away, clicking a country would
 * stop working. public/geo/ne_110m_admin_0_countries.v1.geojson is Natural
 * Earth 3.3.0 (public domain) as that address served it, keeping only the
 * properties read here (iso_a2, adm0_a3, name, admin, name_long) and
 * coordinates to 5 decimals (about a metre): 245 KB instead of 600 KB, and the
 * same country for every point checked but a few within metres of a border.
 * A changed file gets a new name (v2), since browsers keep it for a week.
 */

export const COUNTRY_SHAPES_URL = '/geo/ne_110m_admin_0_countries.v1.geojson'

type Position = number[]
type Ring = Position[]
type PolygonCoords = Ring[]

export interface CountryGeometry {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: PolygonCoords | PolygonCoords[]
}

export interface CountryFeature {
  type: 'Feature'
  properties: Record<string, unknown> | null
  geometry: CountryGeometry | null
}

export interface CountryCollection {
  type: 'FeatureCollection'
  features: CountryFeature[]
}

export interface CountryHit {
  /** ISO 3166-1 alpha-2 (XK for Kosovo), or null when the shape has none */
  code: string | null
  name: string
  feature: CountryFeature
}

/** Whether (lng, lat) is inside a ring (ray casting; the ring may or may not repeat its first point) */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole */
export function pointInPolygon(lng: number, lat: number, polygon: PolygonCoords): boolean {
  if (polygon.length === 0 || !pointInRing(lng, lat, polygon[0])) return false
  for (let h = 1; h < polygon.length; h++) if (pointInRing(lng, lat, polygon[h])) return false
  return true
}

function polygonsOf(geometry: CountryGeometry | null): PolygonCoords[] {
  if (!geometry) return []
  return geometry.type === 'Polygon' ? [geometry.coordinates as PolygonCoords] : geometry.coordinates as PolygonCoords[]
}

const bboxes = new WeakMap<CountryFeature, [number, number, number, number]>()

/** [west, south, east, north] of a country's shape */
export function bboxOf(feature: CountryFeature): [number, number, number, number] {
  let box = bboxes.get(feature)
  if (!box) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const polygon of polygonsOf(feature.geometry)) {
      for (const [x, y] of polygon[0] ?? []) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
    }
    box = [w, s, e, n]
    bboxes.set(feature, box)
  }
  return box
}

/**
 * Where to zoom for a country: all its land, unless that spans more than 50°
 * of longitude (the US with Alaska across the date line, France with French
 * Guiana), then its biggest piece.
 */
export function focusBboxOf(feature: CountryFeature): [number, number, number, number] {
  const box = bboxOf(feature)
  if (box[2] - box[0] <= 50) return box
  let best: Ring = []
  for (const polygon of polygonsOf(feature.geometry)) if ((polygon[0]?.length ?? 0) > best.length) best = polygon[0]
  if (best.length === 0) return box
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of best) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return [w, s, e, n]
}

/** Whether a country's shape contains (lng, lat) */
export function featureContains(feature: CountryFeature, lng: number, lat: number): boolean {
  const [w, s, e, n] = bboxOf(feature)
  if (lng < w || lng > e || lat < s || lat > n) return false
  return polygonsOf(feature.geometry).some(polygon => pointInPolygon(lng, lat, polygon))
}

/** Shapes Natural Earth gives no ISO code (-99), by their adm0_a3 */
const NO_ISO_CODE: Record<string, string> = { KOS: 'XK', SOL: 'SO', CYN: 'CY' }

/** A shape's two-letter country code (null if it has none) */
export function countryCodeOf(props: Record<string, unknown> | null | undefined): string | null {
  const p = props ?? {}
  const iso = String(p.iso_a2 ?? p.ISO_A2 ?? '').toUpperCase()
  if (/^[A-Z]{2}$/.test(iso)) return iso
  const a3 = String(p.adm0_a3 ?? p.ADM0_A3 ?? '').toUpperCase()
  return NO_ISO_CODE[a3] ?? null
}

/** Current names Natural Earth 3.3 doesn't have yet */
const RENAMED: Record<string, string> = { SZ: 'Eswatini', MK: 'North Macedonia' }

/** Short names that are abbreviated or ambiguous ("Korea" is South Korea) */
const UNCLEAR_SHORT_NAMES = new Set(['Korea', 'Congo', 'Lao PDR'])

/**
 * A shape's display name: the short name ("Russia", "United States"), or the
 * full one where the short one is abbreviated or unclear ("Democratic
 * Republic of the Congo", not "Dem. Rep. Congo"; "South Korea", not "Korea").
 */
export function countryNameOf(props: Record<string, unknown> | null | undefined): string {
  const p = props ?? {}
  const code = countryCodeOf(p)
  if (code && RENAMED[code]) return RENAMED[code]
  const short = String(p.name ?? p.NAME ?? '')
  if (short && !short.includes('.') && !UNCLEAR_SHORT_NAMES.has(short)) return short
  return String(p.admin ?? p.ADMIN ?? p.name_long ?? p.NAME_LONG ?? short) || 'Unknown'
}

/** 🇺🇦 for UA ('' for anything that isn't two letters) */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** The country containing (lng, lat) among these shapes, if any */
export function findCountry(shapes: CountryCollection, lng: number, lat: number): CountryHit | null {
  for (const feature of shapes.features) {
    if (featureContains(feature, lng, lat)) {
      return { code: countryCodeOf(feature.properties), name: countryNameOf(feature.properties), feature }
    }
  }
  return null
}

let shapesPromise: Promise<CountryCollection> | null = null

/** The country shapes, downloaded once per page (a failed download is tried again next time) */
export function loadCountryShapes(): Promise<CountryCollection> {
  if (!shapesPromise) {
    shapesPromise = fetch(COUNTRY_SHAPES_URL)
      .then(res => {
        if (!res.ok) throw new Error(`country shapes: HTTP ${res.status}`)
        return res.json() as Promise<CountryCollection>
      })
      .catch(err => {
        shapesPromise = null
        throw err
      })
  }
  return shapesPromise
}

/** The country at (lng, lat), loading the shapes first if needed */
export async function countryAt(lng: number, lat: number): Promise<CountryHit | null> {
  return findCountry(await loadCountryShapes(), lng, lat)
}
