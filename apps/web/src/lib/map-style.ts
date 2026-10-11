/**
 * The World Map's look: the basemap, its colours and the severity palette, in
 * one place so the map, its legend, pop-ups and panels agree (map redesign,
 * .hq/departments/product/map-redesign-plan.md).
 *
 * Basemaps (all free, no key needed):
 *  - dark: OpenFreeMap's vector "dark" style (OpenStreetMap data), recoloured
 *    to WorldPulse's navy palette, with English place names;
 *  - night: NASA Black Marble city lights under the same borders and labels;
 *  - satellite: NASA Blue Marble (or MapTiler satellite when a key is set).
 * Switching between them only shows and hides layers inside one style, so the
 * signal and overlay layers added on top are never lost.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapLike = any

export type BasemapMode = 'dark' | 'night' | 'satellite'

export const BASEMAP_MODES: BasemapMode[] = ['dark', 'night', 'satellite']

export const BASEMAP_LABEL: Record<BasemapMode, string> = {
  dark:      'Dark',
  night:     'Night lights',
  satellite: 'Satellite',
}

/** Old share links used 'terrain' (bright street tiles): show the dark map instead */
export function toBasemapMode(value: unknown): BasemapMode | null {
  if (value === 'dark' || value === 'night' || value === 'satellite') return value
  if (value === 'terrain') return 'dark'
  return null
}

// ─── Severity palette ────────────────────────────────────────────────────────

/** Severity colours: four distinct hues that read well on the dark map */
export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#ff8a3d',
  medium:   '#f2c94c',
  low:      '#7f95b5',
  info:     '#5b6b82',
}

/** The same colours as translucent backgrounds (badges, panels) */
export const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.15)',
  high:     'rgba(255,138,61,0.15)',
  medium:   'rgba(242,201,76,0.15)',
  low:      'rgba(127,149,181,0.15)',
  info:     'rgba(91,107,130,0.15)',
}

export const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

/** Rank (0–4) → colour, for clusters coloured by their most severe signal */
export const RANK_COLOR = [
  SEVERITY_COLOR.info, SEVERITY_COLOR.low, SEVERITY_COLOR.medium, SEVERITY_COLOR.high, SEVERITY_COLOR.critical,
]

export function severityColor(severity: string | null | undefined): string {
  return SEVERITY_COLOR[severity ?? ''] ?? SEVERITY_COLOR.low
}

/** MapLibre expression: a cluster's colour from its highest severity rank ('sev') */
export const CLUSTER_COLOR_EXPR: Json = [
  'match', ['get', 'sev'],
  4, SEVERITY_COLOR.critical,
  3, SEVERITY_COLOR.high,
  2, SEVERITY_COLOR.medium,
  1, SEVERITY_COLOR.low,
  SEVERITY_COLOR.info,
]

// ─── Sizes ───────────────────────────────────────────────────────────────────
// The map draws dots and cluster rings from these tables, and the de-cluttering
// (lib/map-declutter.ts) reads the same ones to know how much room each takes.

type Stops = Array<[number, number]>

/** MapLibre's linear 'interpolate' through [x, y] stops, held flat past the ends */
export function interpolateStops(stops: Stops, x: number): number {
  if (stops.length === 0) return 0
  if (!(x > stops[0]![0])) return stops[0]![1]
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i]!
    if (x <= x1) {
      const [x0, y0] = stops[i - 1]!
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return stops[stops.length - 1]![1]
}

/** A signal's dot radius (px) by severity, at zoom stops */
const DOT_RADIUS: Array<[zoom: number, radius: Record<'critical' | 'high' | 'medium' | 'other', number>]> = [
  [1,  { critical: 5,   high: 4.2, medium: 3.4, other: 2.8 }],
  [5,  { critical: 7.5, high: 6.5, medium: 5.5, other: 4.6 }],
  [10, { critical: 10,  high: 9,   medium: 8,   other: 7 }],
]

const dotKey = (severity: unknown): 'critical' | 'high' | 'medium' | 'other' =>
  severity === 'critical' || severity === 'high' || severity === 'medium' ? severity : 'other'

/** MapLibre expression: a signal's dot size by severity, growing with zoom */
export const SIGNAL_RADIUS_EXPR: Json = [
  'interpolate', ['linear'], ['zoom'],
  ...DOT_RADIUS.flatMap(([zoom, r]) => [zoom, ['match', ['get', 'severity'], 'critical', r.critical, 'high', r.high, 'medium', r.medium, r.other]]),
]

/** From this zoom a single signal is drawn as an icon of its kind (lib/map-signal-icons.ts) */
export const SIGNAL_ICON_ZOOM = 4.5
/** The icon's scale (26 px drawn at 0.85) and so its radius on screen, px */
export const SIGNAL_ICON_SCALE = 0.85
export const SIGNAL_ICON_RADIUS = 11

/** A signal's dot radius in px, as SIGNAL_RADIUS_EXPR draws it */
export function dotRadius(severity: unknown, zoom: number): number {
  const key = dotKey(severity)
  return interpolateStops(DOT_RADIUS.map(([z, r]) => [z, r[key]] as [number, number]), zoom)
}

/**
 * Cluster sizes by member count: the ring, its soft halo and the number. They
 * are smaller on the zoomed-out globe (a phone's whole world is ~300 px wide,
 * and full-size rings covered most of it) and full size from zoom 3.5.
 */
const CLUSTER_SIZE: Array<[zoom: number, sizes: { ring: Stops; halo: Stops; text: Stops }]> = [
  [1,   { ring: [[2, 8], [10, 10], [50, 13.5], [200, 17]], halo: [[2, 12], [10, 16], [50, 22], [200, 28]], text: [[2, 9.5], [200, 11.5]] }],
  [3.5, { ring: [[2, 11], [10, 14], [50, 19], [200, 25]],  halo: [[2, 17], [10, 23], [50, 31], [200, 40]], text: [[2, 10.5], [200, 13]] }],
]

function clusterExpr(part: 'ring' | 'halo' | 'text'): Json {
  return [
    'interpolate', ['linear'], ['zoom'],
    ...CLUSTER_SIZE.flatMap(([zoom, sizes]) => [zoom, ['interpolate', ['linear'], ['get', 'point_count'], ...sizes[part].flat()]]),
  ]
}

/** MapLibre expressions for a cluster's ring radius, halo radius and number size */
export const CLUSTER_RING_EXPR: Json = clusterExpr('ring')
export const CLUSTER_HALO_EXPR: Json = clusterExpr('halo')
export const CLUSTER_TEXT_EXPR: Json = clusterExpr('text')

/** A cluster ring's radius in px for `count` signals, as CLUSTER_RING_EXPR draws it */
export function ringRadius(count: number, zoom: number): number {
  return interpolateStops(CLUSTER_SIZE.map(([z, sizes]) => [z, interpolateStops(sizes.ring, count)] as [number, number]), zoom)
}

// ─── Basemap ─────────────────────────────────────────────────────────────────

export const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'
export const OPENFREEMAP_GLYPHS     = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/** Fonts the glyph server has (OpenFreeMap): use these for every text layer */
export const FONT_REGULAR = ['Noto Sans Regular']
export const FONT_BOLD    = ['Noto Sans Bold']

const BLACK_MARBLE_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'
const BLUE_MARBLE_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'

/** WorldPulse's map colours */
export const MAP_PALETTE = {
  space:           '#04060b',
  land:            '#0e141e',
  water:           '#070b12',
  landcover:       '#111a26',
  building:        '#0b1119',
  roadMinor:       '#111824',
  roadMajor:       '#141c29',
  motorway:        '#19233a',
  rail:            '#131b28',
  boundaryCountry: '#3d4d66',
  boundaryState:   '#202b3c',
  labelCountry:    '#6f8099',
  labelPlace:      '#7c8ba3',
  labelMinor:      '#5d6b80',
  labelWater:      '#33465f',
  halo:            '#04060b',
} as const

const P = MAP_PALETTE

/** English name where the map has one, else the local name */
const NAME_EN: Json = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']]

/**
 * Recolour OpenFreeMap's dark style to the WorldPulse palette, in place:
 * navy land and water, quiet roads, readable borders, English labels.
 * Unknown layers keep their own colours.
 */
export function recolorDarkStyle(style: Json): Json {
  const set = (layer: Json, key: string, value: unknown) => {
    layer.paint = { ...(layer.paint ?? {}), [key]: value }
  }
  for (const layer of style.layers ?? []) {
    const id: string = layer.id ?? ''
    if (layer.type === 'background') set(layer, 'background-color', P.land)
    else if (id === 'water') set(layer, 'fill-color', P.water)
    else if (id === 'waterway') set(layer, 'line-color', P.water)
    else if (id.startsWith('landcover') || id.startsWith('landuse')) set(layer, 'fill-color', P.landcover)
    else if (id === 'building') { set(layer, 'fill-color', P.building); set(layer, 'fill-outline-color', P.roadMinor) }
    else if (id.startsWith('aeroway')) set(layer, layer.type === 'fill' ? 'fill-color' : 'line-color', P.roadMinor)
    else if (id.startsWith('road_area') || id === 'road_pier') set(layer, layer.type === 'fill' ? 'fill-color' : 'line-color', P.land)
    else if (id === 'highway_path' || id === 'highway_minor') set(layer, 'line-color', P.roadMinor)
    else if (id.startsWith('highway_major')) set(layer, 'line-color', id.endsWith('inner') ? P.roadMinor : P.roadMajor)
    else if (id.startsWith('highway_motorway')) set(layer, 'line-color', id.endsWith('inner') ? P.roadMajor : P.motorway)
    else if (id.startsWith('railway')) set(layer, 'line-color', id.endsWith('dashline') ? P.land : P.rail)
    else if (id === 'boundary_state') { set(layer, 'line-color', P.boundaryState) }
    else if (id.startsWith('boundary_country')) { set(layer, 'line-color', P.boundaryCountry); set(layer, 'line-opacity', 0.9) }
    else if (layer.type === 'symbol') {
      const isCountry = id.startsWith('place_country')
      const isWater   = id === 'water_name'
      const isRoad    = id.startsWith('highway_name') || id.startsWith('road_')
      set(layer, 'text-color', isCountry ? P.labelCountry : isWater ? P.labelWater : isRoad ? P.labelMinor : P.labelPlace)
      set(layer, 'text-halo-color', P.halo)
      set(layer, 'text-halo-width', 1.2)
      set(layer, 'text-halo-blur', 0.5)
      if (id.startsWith('place_') || isWater) {
        layer.layout = { ...(layer.layout ?? {}), 'text-field': NAME_EN }
      }
      // Zoomed out, only countries are named: regions and cities come in as you zoom
      if (id === 'place_state') layer.minzoom = Math.max(Number(layer.minzoom ?? 0), 5)
      if (id === 'place_country_other') layer.minzoom = Math.max(Number(layer.minzoom ?? 0), 4.5)
      if (id === 'place_city') layer.minzoom = Math.max(Number(layer.minzoom ?? 0), 5)
      if (id === 'place_city_large') {
        layer.minzoom = Math.max(Number(layer.minzoom ?? 0), 3.2)
        layer.layout = { ...(layer.layout ?? {}), 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 13, 10, 15] }
      }
      if (isCountry) {
        // Quiet, small capitals: the signals should read first
        layer.layout = {
          ...(layer.layout ?? {}),
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.14,
          'text-size': ['interpolate', ['linear'], ['zoom'], 0, 8, 3, 10, 5, 12, 7, 13],
        }
      }
    }
  }
  return style
}

/** A plain style used when the vector map can't be loaded: the night imagery still works */
export function fallbackStyle(): Json {
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': P.land } }],
  }
}

/**
 * The dark vector style, recoloured. Resolves to the fallback style (and
 * `vector: false`) when OpenFreeMap doesn't answer within `timeoutMs`.
 */
export async function loadBaseStyle(timeoutMs = 6000): Promise<{ style: Json; vector: boolean }> {
  try {
    const res = await fetch(OPENFREEMAP_DARK_STYLE, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const style = await res.json()
    if (!Array.isArray(style?.layers)) throw new Error('not a style')
    return { style: recolorDarkStyle(style), vector: true }
  } catch {
    return { style: fallbackStyle(), vector: false }
  }
}

/** The ids of the basemap's own layers (before WorldPulse adds anything) */
export function baseLayerIds(style: Json): string[] {
  return (style?.layers ?? []).map((l: Json) => String(l.id))
}

const IMAGERY_LAYERS = { night: 'wp-imagery-night', satellite: 'wp-imagery-satellite' } as const

/**
 * Add the night-lights and satellite imagery (hidden), just above the
 * background, so borders and labels stay on top of them.
 */
export function addImageryLayers(map: MapLike, maptilerKey: string): void {
  const firstAfterBackground = (map.getStyle()?.layers ?? []).find((l: Json) => l.type !== 'background')?.id
  const hasMaptiler = maptilerKey !== '' && maptilerKey !== 'demo'
  if (!map.getSource(IMAGERY_LAYERS.night)) {
    map.addSource(IMAGERY_LAYERS.night, {
      type: 'raster', tiles: [BLACK_MARBLE_TILES], tileSize: 256, maxzoom: 8,
      attribution: 'Night lights: NASA Black Marble (GIBS)',
    })
  }
  if (!map.getSource(IMAGERY_LAYERS.satellite)) {
    map.addSource(IMAGERY_LAYERS.satellite, hasMaptiler
      ? {
          type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${maptilerKey}`],
          tileSize: 512, maxzoom: 20, attribution: '© MapTiler',
        }
      : {
          type: 'raster', tiles: [BLUE_MARBLE_TILES], tileSize: 256, maxzoom: 8,
          attribution: 'Imagery: NASA Blue Marble (GIBS)',
        })
  }
  if (!map.getLayer(IMAGERY_LAYERS.night)) {
    map.addLayer({
      id: IMAGERY_LAYERS.night, type: 'raster', source: IMAGERY_LAYERS.night,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1, 'raster-saturation': -0.15, 'raster-contrast': 0.1 },
    }, firstAfterBackground)
  }
  if (!map.getLayer(IMAGERY_LAYERS.satellite)) {
    map.addLayer({
      id: IMAGERY_LAYERS.satellite, type: 'raster', source: IMAGERY_LAYERS.satellite,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1, 'raster-brightness-max': 0.85, 'raster-saturation': -0.1 },
    }, firstAfterBackground)
  }
}

/**
 * Show one basemap. Imagery modes hide the vector map's fills, roads and road
 * names, keeping country borders and place names on top of the imagery.
 */
export function applyBasemap(map: MapLike, mode: BasemapMode, baseIds: string[]): void {
  const imagery = mode !== 'dark'
  const vis = (id: string, show: boolean) => {
    try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none') } catch { /* layer gone */ }
  }
  for (const id of baseIds) {
    const layer = map.getLayer(id)
    if (!layer) continue
    const type = layer.type as string
    const keep = type === 'background'
      || id.startsWith('boundary')
      || (type === 'symbol' && (id.startsWith('place_') || id === 'water_name'))
    vis(id, imagery ? keep : true)
  }
  vis(IMAGERY_LAYERS.night, mode === 'night')
  vis(IMAGERY_LAYERS.satellite, mode === 'satellite')
}

/** The glow around the globe and the dark space behind it (MapLibre v5 sky) */
export const ATMOSPHERE: Json = {
  'sky-color':         '#04060b',
  'sky-horizon-blend': 0.6,
  'horizon-color':     '#173a6b',
  'horizon-fog-blend': 0.7,
  'fog-color':         '#0b1830',
  'fog-ground-blend':  0.6,
  'atmosphere-blend':  ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
}
