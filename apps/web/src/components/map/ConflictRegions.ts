/**
 * ConflictRegions.ts
 * BAT-17 — Conflict Zone Overlay
 *
 * Defines 20+ active conflict zones as GeoJSON bounding-box polygons and
 * provides a MapLibre GL layer class that renders them as filled regions with
 * hover popups.
 */

import type { Map as MapLibreMap, MapMouseEvent, Popup as MapLibrePopup } from 'maplibre-gl'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConflictSeverity = 'active' | 'frozen' | 'escalating'

export interface ConflictRegion {
  id:          string
  name:        string
  country:     string
  severity:    ConflictSeverity
  signalCount: number
  /** [west, south, east, north] */
  bbox:        [number, number, number, number]
}

// ── Layer / Source IDs ────────────────────────────────────────────────────────

export const REGIONS_SOURCE_ID  = 'conflict-regions-source'
export const REGIONS_FILL_ID    = 'conflict-regions-fill'
export const REGIONS_OUTLINE_ID = 'conflict-regions-outline'

// ── Region Registry ───────────────────────────────────────────────────────────

const CONFLICT_REGIONS: ConflictRegion[] = [
  { id: 'ukraine-russia',     name: 'Ukraine–Russia Front Line', country: 'Ukraine / Russia',       severity: 'escalating', signalCount: 0, bbox: [28,  47,  40,  52]  },
  { id: 'gaza-israel',        name: 'Gaza / Israel',             country: 'Palestine / Israel',      severity: 'active',     signalCount: 0, bbox: [33.8, 30.7, 35.8, 32.6] },
  { id: 'sudan',              name: 'Sudan',                     country: 'Sudan',                   severity: 'active',     signalCount: 0, bbox: [22,  10,  38,  22]  },
  { id: 'myanmar',            name: 'Myanmar',                   country: 'Myanmar',                 severity: 'active',     signalCount: 0, bbox: [92,  16,  102, 28]  },
  { id: 'sahel',              name: 'Sahel (Mali/Burkina/Niger)', country: 'Mali / Burkina Faso / Niger', severity: 'active', signalCount: 0, bbox: [-10, 10,  20,  20]  },
  { id: 'somalia',            name: 'Somalia',                   country: 'Somalia',                 severity: 'active',     signalCount: 0, bbox: [40,  1,   52,  12]  },
  { id: 'drc-eastern',        name: 'Eastern DRC',               country: 'DR Congo',                severity: 'active',     signalCount: 0, bbox: [26,  -5,  32,  2]   },
  { id: 'ethiopia-tigray',    name: 'Ethiopia (Tigray)',          country: 'Ethiopia',                severity: 'frozen',     signalCount: 0, bbox: [36,  12,  42,  15]  },
  { id: 'yemen',              name: 'Yemen',                     country: 'Yemen',                   severity: 'active',     signalCount: 0, bbox: [42,  12,  56,  18]  },
  { id: 'syria',              name: 'Syria',                     country: 'Syria',                   severity: 'active',     signalCount: 0, bbox: [35,  32,  43,  38]  },
  { id: 'iraq-kurdish',       name: 'Iraq / Kurdish Region',     country: 'Iraq',                    severity: 'active',     signalCount: 0, bbox: [38,  34,  48,  38]  },
  { id: 'afghanistan',        name: 'Afghanistan',               country: 'Afghanistan',             severity: 'active',     signalCount: 0, bbox: [60,  29,  75,  38]  },
  { id: 'pakistan-fata',      name: 'Pakistan (FATA)',           country: 'Pakistan',                severity: 'active',     signalCount: 0, bbox: [69,  32,  74,  36]  },
  { id: 'haiti',              name: 'Haiti',                     country: 'Haiti',                   severity: 'escalating', signalCount: 0, bbox: [-74, 18,  -72, 20]  },
  { id: 'libya',              name: 'Libya',                     country: 'Libya',                   severity: 'active',     signalCount: 0, bbox: [9,   22,  25,  33]  },
  { id: 'nagorno-karabakh',   name: 'Nagorno-Karabakh Area',     country: 'Azerbaijan / Armenia',    severity: 'frozen',     signalCount: 0, bbox: [45,  39,  50,  41]  },
  { id: 'lebanon-southern',   name: 'Southern Lebanon',          country: 'Lebanon',                 severity: 'active',     signalCount: 0, bbox: [35,  33,  36.5, 33.9] },
  { id: 'sahara-mena',        name: 'Sahara / MENA (general)',   country: 'North Africa',            severity: 'active',     signalCount: 0, bbox: [-6,  14,  12,  25]  },
  { id: 'west-bank',          name: 'West Bank',                 country: 'Palestine',               severity: 'escalating', signalCount: 0, bbox: [34.8, 31.3, 35.6, 32.6] },
  { id: 'mozambique-cabo',    name: 'Mozambique (Cabo Delgado)', country: 'Mozambique',              severity: 'active',     signalCount: 0, bbox: [38,  -13, 41,  -10] },
]

/**
 * Returns the full array of conflict region definitions.
 */
export function getConflictRegions(): ConflictRegion[] {
  return CONFLICT_REGIONS
}

// ── GeoJSON helpers ───────────────────────────────────────────────────────────

function bboxToPolygon(bbox: [number, number, number, number]): [number, number][] {
  const [w, s, e, n] = bbox
  return [[w, s], [e, s], [e, n], [w, n], [w, s]]
}

function buildRegionsGeoJSON(regions: ConflictRegion[]): object {
  return {
    type: 'FeatureCollection',
    features: regions.map(r => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [bboxToPolygon(r.bbox)],
      },
      properties: {
        id:          r.id,
        name:        r.name,
        country:     r.country,
        severity:    r.severity,
        signalCount: r.signalCount,
      },
    })),
  }
}

// ── Fill / outline paint by severity ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILL_COLOR: any = [
  'match', ['get', 'severity'],
  'active',     'rgba(239,68,68,0.12)',    // red-500 @ 12%
  'escalating', 'rgba(249,115,22,0.12)',   // orange-500 @ 12%
  'frozen',     'rgba(113,113,122,0.08)',  // zinc-500 @ 8%
  /* default */ 'rgba(239,68,68,0.12)',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OUTLINE_COLOR: any = [
  'match', ['get', 'severity'],
  'active',     '#f87171',   // red-400
  'escalating', '#fb923c',   // orange-400
  'frozen',     '#a1a1aa',   // zinc-400
  /* default */ '#f87171',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OUTLINE_WIDTH: any = [
  'match', ['get', 'severity'],
  'frozen', 1,
  /* default */ 1.5,
]

// ── ConflictRegionLayer ───────────────────────────────────────────────────────

/**
 * Adds filled polygon regions + outline layers to a MapLibre map.
 * Hover shows a popup with region name, country, and severity badge.
 *
 * Usage:
 *   const layer = new ConflictRegionLayer(map)
 *   layer.addToMap()
 *   layer.removeFromMap()
 */
export class ConflictRegionLayer {
  private readonly map: MapLibreMap
  private _added  = false
  private _popup: MapLibrePopup | null = null

  constructor(map: MapLibreMap) {
    this.map = map
  }

  get added(): boolean { return this._added }

  addToMap(): void {
    if (this._added) return
    this._added = true
    const m = this.map

    // Source
    if (!m.getSource(REGIONS_SOURCE_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addSource(REGIONS_SOURCE_ID, {
        type: 'geojson',
        data: buildRegionsGeoJSON(CONFLICT_REGIONS) as any,
      })
    }

    // Fill layer
    if (!m.getLayer(REGIONS_FILL_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     REGIONS_FILL_ID,
        type:   'fill',
        source: REGIONS_SOURCE_ID,
        paint:  { 'fill-color': FILL_COLOR },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }

    // Outline layer
    if (!m.getLayer(REGIONS_OUTLINE_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     REGIONS_OUTLINE_ID,
        type:   'line',
        source: REGIONS_SOURCE_ID,
        paint:  {
          'line-color': OUTLINE_COLOR,
          'line-width': OUTLINE_WIDTH,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }

    this._attachHoverListeners()
  }

  removeFromMap(): void {
    if (!this._added) return
    this._added = false
    this._detachHoverListeners()
    this._popup?.remove()
    this._popup = null
    const m = this.map
    try {
      if (m.getLayer(REGIONS_OUTLINE_ID)) m.removeLayer(REGIONS_OUTLINE_ID)
      if (m.getLayer(REGIONS_FILL_ID))    m.removeLayer(REGIONS_FILL_ID)
      if (m.getSource(REGIONS_SOURCE_ID)) m.removeSource(REGIONS_SOURCE_ID)
    } catch { /* benign */ }
  }

  // ── Hover popup ──────────────────────────────────────────────────────────

  private _onMouseEnter = (e: MapMouseEvent): void => {
    this.map.getCanvas().style.cursor = 'pointer'
    const feat = e.features?.[0]
    if (!feat) return
    const p = feat.properties as {
      name:        string
      country:     string
      severity:    string
      signalCount: number
    }

    const severityColor: Record<string, string> = {
      active:     '#f87171',
      escalating: '#fb923c',
      frozen:     '#a1a1aa',
    }
    const color = severityColor[p.severity] ?? '#f87171'

    const html = `
      <div style="font:600 12px/1.4 system-ui;color:${color};margin-bottom:4px">${p.name}</div>
      <div style="font:11px system-ui;color:#9ca3af;margin-bottom:3px">📍 ${p.country}</div>
      <div style="font:11px monospace;color:#d1d5db">
        <span style="color:${color};text-transform:uppercase;font-weight:600">${p.severity}</span>
        ${p.signalCount > 0 ? ` · ${p.signalCount} signals` : ''}
      </div>
    `

    // Dynamic import to avoid SSR issues
    import('maplibre-gl').then(({ Popup }) => {
      this._popup?.remove()
      this._popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map)
    }).catch(() => { /* non-fatal */ })
  }

  private _onMouseLeave = (): void => {
    this.map.getCanvas().style.cursor = ''
    this._popup?.remove()
    this._popup = null
  }

  private _attachHoverListeners(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.map.on('mouseenter', REGIONS_FILL_ID, this._onMouseEnter as any)
    this.map.on('mouseleave', REGIONS_FILL_ID, this._onMouseLeave)
  }

  private _detachHoverListeners(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.map.off('mouseenter', REGIONS_FILL_ID, this._onMouseEnter as any)
    this.map.off('mouseleave', REGIONS_FILL_ID, this._onMouseLeave)
  }
}
