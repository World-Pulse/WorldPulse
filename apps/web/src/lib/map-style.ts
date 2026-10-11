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

/** MapLibre expression: a signal's dot size by severity, growing with zoom */
export const SIGNAL_RADIUS_EXPR: Json = [
  'interpolate', ['linear'], ['zoom'],
  1,  ['match', ['get', 'severity'], 'critical', 5,  'high', 4.2, 'medium', 3.4, 2.8],
  5,  ['match', ['get', 'severity'], 'critical', 7.5, 'high', 6.5, 'medium', 5.5, 4.6],
  10, ['match', ['get', 'severity'], 'critical', 10, 'high', 9,   'medium', 8,   7],
]

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
