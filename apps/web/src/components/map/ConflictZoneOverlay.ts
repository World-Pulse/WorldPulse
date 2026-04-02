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
  'security', '#eab308',   // yellow-500
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

    // ── Main circle layer ───────────────────────────────────────────────────
    if (!m.getLayer(CONFLICT_CIRCLE_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     CONFLICT_CIRCLE_ID,
        type:   'circle',
        source: CONFLICT_SOURCE_ID,
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
    } catch { /* benign */ }
  }

  /**
   * Pulse animation: expands the ring radius from 14 px (base) to 30 px while
   * fading opacity from 0.3 → 0.0 over a 2-second cycle, then resets.
   */
  private _startPulseAnimation(): void {
    this._startMs = performance.now()

    const tick = (now: number): void => {
      if (!this._active) return
      const elapsed = ((now - this._startMs) % 2000) / 2000   // 0 → 1 per 2 s cycle
      const radius  = 14 + elapsed * 16                        // 14 → 30
      const opacity = 0.3 * (1 - elapsed)                      // 0.3 → 0.0
      try {
        if (this.map.getLayer(CONFLICT_PULSE_ID)) {
          this.map.setPaintProperty(CONFLICT_PULSE_ID, 'circle-radius',  radius)
          this.map.setPaintProperty(CONFLICT_PULSE_ID, 'circle-opacity', opacity)
        }
      } catch { /* map transitioning */ }
      this._rafId = requestAnimationFrame(tick)
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
