/**
 * ConflictZoneOverlay.ts
 * BAT-17 — Conflict Zone Overlay
 *
 * Manages a conflict zone visualization layer on a MapLibre GL map:
 *   - Circle layer per conflict signal, colour-coded by category
 *   - Pulsing animation layer for critical-severity signals
 */

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'

// ── Layer / Source IDs ────────────────────────────────────────────────────────

export const CONFLICT_SOURCE_ID  = 'conflict-zone-source'
export const CONFLICT_CIRCLE_ID  = 'conflict-zone-circles'
export const CONFLICT_PULSE_ID   = 'conflict-zone-pulse'
/** Oct 19, 2026 (Map Lab review): the zones as a glow, strongest where the fighting is worst */
export const CONFLICT_HEAT_ID    = 'conflict-zone-heat'
/** Below this zoom only the glow shows; from it, the stories as points to click */
export const CONFLICT_POINTS_MINZOOM = 4.5

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConflictFeatureProperties {
  id:                string
  title:             string
  severity:          'critical' | 'high' | 'medium' | 'low' | string
  category:          'conflict' | 'military' | 'security' | string
  reliability_score: number
  source_name:       string | null
  published_at:      string | null
}

export interface ConflictGeoJSON {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: ConflictFeatureProperties
  }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Circle colour by category. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CATEGORY_COLOR: any = [
  'match', ['get', 'category'],
  'conflict', '#ef4444',   // red-500
  'military', '#f97316',   // orange-500
  /* default */ '#ef4444',
]

/** Circle radius by severity. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEVERITY_RADIUS: any = [
  'match', ['get', 'severity'],
  'critical', 14,
  'high',     10,
  'medium',    7,
  'low',       5,
  /* default */ 5,
]

/** How much each story warms the glow, by severity */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HEAT_WEIGHT: any = [
  'match', ['get', 'severity'],
  'critical', 1,
  'high',     0.7,
  'medium',   0.35,
  /* low */   0.15,
]

/** Dark red where there is a little, through red and orange, to yellow at the worst */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HEAT_COLOR: any = [
  'interpolate', ['linear'], ['heatmap-density'],
  0,    'rgba(127,29,29,0)',
  0.15, 'rgba(153,27,27,0.45)',
  0.35, 'rgba(220,38,38,0.7)',
  0.6,  'rgba(249,115,22,0.85)',
  0.85, 'rgba(251,191,36,0.92)',
  1,    'rgba(254,240,138,0.95)',
]

/** Filter that selects only critical signals for the pulse layer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CRITICAL_FILTER: any = ['==', ['get', 'severity'], 'critical']

// ── ConflictZoneOverlay ───────────────────────────────────────────────────────

/**
 * Manages two MapLibre GL layers on top of a dedicated GeoJSON source:
 *   1. `conflict-zone-circles` — filled circles colour-coded by category
 *   2. `conflict-zone-pulse`   — expanding ring animation on critical signals
 *
 * Usage:
 *   const overlay = new ConflictZoneOverlay(map)
 *   overlay.show(geojson)   // add source + layers
 *   overlay.hide()          // remove layers + source
 *   overlay.destroy()       // alias for hide() — call on unmount
 */
export class ConflictZoneOverlay {
  private readonly map: MapLibreMap
  private _active  = false
  private _rafId   = 0
  private _startMs = 0

  constructor(map: MapLibreMap) {
    this.map = map
  }

  get active(): boolean { return this._active }

  /**
   * Add the source and layers with the provided GeoJSON data.
   * If already active, updates the source data in-place.
   */
  show(data: ConflictGeoJSON): void {
    if (this._active) {
      this._updateSource(data)
      return
    }
    this._active = true
    this._addSource(data)
    this._addLayers()
    this._startPulseAnimation()
  }

  /** Remove layers and source. */
  hide(): void {
    if (!this._active) return
    this._active = false
    this._stopPulseAnimation()
    this._removeLayers()
    this._removeSource()
  }

  /** Alias for hide() — call on component unmount. */
  destroy(): void {
    this.hide()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _addSource(data: ConflictGeoJSON): void {
    const m = this.map
    if (!m.getSource(CONFLICT_SOURCE_ID)) {
      m.addSource(CONFLICT_SOURCE_ID, {
        type: 'geojson',
        data,
      })
    }
  }

  private _updateSource(data: ConflictGeoJSON): void {
    const src = this.map.getSource(CONFLICT_SOURCE_ID) as GeoJSONSource | undefined
    if (src) src.setData(data)
  }

  private _removeSource(): void {
    const m = this.map
    try {
      if (m.getSource(CONFLICT_SOURCE_ID)) m.removeSource(CONFLICT_SOURCE_ID)
    } catch { /* already gone */ }
  }

  private _addLayers(): void {
    const m = this.map

    // ── The glow (Oct 19, 2026) ─────────────────────────────────────────────
    // 300 circles that looked like the news rings read as noise, not zones
    if (!m.getLayer(CONFLICT_HEAT_ID)) {
      const below = m.getLayer('cluster-halo') ? 'cluster-halo' : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     CONFLICT_HEAT_ID,
        type:   'heatmap',
        source: CONFLICT_SOURCE_ID,
        maxzoom: 10,
        paint:  {
          'heatmap-weight':    HEAT_WEIGHT,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.9, 4, 1.4, 8, 2.2],
          'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 1, 16, 3, 26, 5, 40, 8, 60],
          'heatmap-color':     HEAT_COLOR,
          'heatmap-opacity':   ['interpolate', ['linear'], ['zoom'], 1, 0.85, 7, 0.75, 10, 0.35],
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, below)
    }

    // ── Main circle layer (zoomed in: the stories to click) ───────────────
    if (!m.getLayer(CONFLICT_CIRCLE_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     CONFLICT_CIRCLE_ID,
        type:   'circle',
        source: CONFLICT_SOURCE_ID,
        minzoom: CONFLICT_POINTS_MINZOOM,
        paint:  {
          'circle-color':        CATEGORY_COLOR,
          'circle-radius':       SEVERITY_RADIUS,
          'circle-opacity':      0.75,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }

    // ── Pulse ring layer (critical signals only) ────────────────────────────
    if (!m.getLayer(CONFLICT_PULSE_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     CONFLICT_PULSE_ID,
        type:   'circle',
        source: CONFLICT_SOURCE_ID,
        minzoom: CONFLICT_POINTS_MINZOOM,
        filter: CRITICAL_FILTER,
        paint:  {
          'circle-color':   CATEGORY_COLOR,
          'circle-radius':  20,   // larger than main — RAF will animate
          'circle-opacity': 0.3,  // RAF will animate 0.3 → 0.0
          'circle-stroke-width': 0,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }
  }

  private _removeLayers(): void {
    const m = this.map
    try {
      if (m.getLayer(CONFLICT_PULSE_ID))  m.removeLayer(CONFLICT_PULSE_ID)
      if (m.getLayer(CONFLICT_CIRCLE_ID)) m.removeLayer(CONFLICT_CIRCLE_ID)
      if (m.getLayer(CONFLICT_HEAT_ID))   m.removeLayer(CONFLICT_HEAT_ID)
    } catch { /* benign */ }
  }

  /**
   * Pulse animation: expands the ring radius from 14 px (base) to 30 px while
   * fading opacity from 0.3 → 0.0 over a 2-second cycle, then resets.
   */
  private _startPulseAnimation(): void {
    this._startMs = performance.now()

    let last = 0
    const tick = (now: number): void => {
      if (!this._active) return
      this._rafId = requestAnimationFrame(tick)
      if (now - last < 66) return   // ~15 redraws a second is plenty for a slow pulse
      last = now
      const elapsed = ((now - this._startMs) % 2000) / 2000   // 0 → 1 per 2 s cycle
      const radius  = 14 + elapsed * 16                        // 14 → 30
      const opacity = 0.3 * (1 - elapsed)                      // 0.3 → 0.0
      try {
        if (this.map.getLayer(CONFLICT_PULSE_ID)) {
          this.map.setPaintProperty(CONFLICT_PULSE_ID, 'circle-radius',  radius)
          this.map.setPaintProperty(CONFLICT_PULSE_ID, 'circle-opacity', opacity)
        }
      } catch { /* map transitioning */ }
    }

    this._rafId = requestAnimationFrame(tick)
  }

  private _stopPulseAnimation(): void {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = 0
    }
  }
}
