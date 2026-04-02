/**
 * EnhancedHeatmap.ts
 * BAT-16 — MarineTraffic-quality signal density heatmap
 *
 * Replaces the basic CSS radial-gradient overlay with native MapLibre GL
 * heatmap layers that are:
 *   - Severity-weighted (critical=4 → info=0.5)
 *   - Category-specific colour ramps (conflict/climate/health/all)
 *   - Zoom-adaptive radius (15px@z2 → 80px@z14)
 *   - Animated pulsing glow overlay (0.3→0.6 sine, 3 s cycle)
 *   - 400 ms opacity fade on toggle / category cross-fade
 */

import type { Map as MapLibreMap } from 'maplibre-gl'

// ── Constants ────────────────────────────────────────────────────────────────

export const HEATMAP_LAYER_ID = 'enhanced-heatmap'
export const GLOW_LAYER_ID    = 'enhanced-heatmap-glow'
const SOURCE_ID               = 'signals'        // existing Supercluster GeoJSON source

/** Only process individual signal points — exclude Supercluster centroids. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const POINT_FILTER: any = ['!', ['has', 'point_count']]

/**
 * heatmap-weight: numeric contribution per point based on severity.
 * MapLibre expression evaluated per feature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEVERITY_WEIGHT: any = [
  'match', ['get', 'severity'],
  'critical', 4,
  'high',     3,
  'medium',   2,
  'low',      1,
  /* default (info/unknown) */ 0.5,
]

/**
 * heatmap-intensity: global multiplier that scales with zoom so density
 * tightens as the user zooms in, keeping the visual proportional.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const INTENSITY: any = ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 1.2, 12, 2.0]

/**
 * heatmap-radius: influence radius per point, adaptive to zoom level.
 *   z2=15px → z6=30px → z10=50px → z14=80px
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZOOM_RADIUS: any = [
  'interpolate', ['linear'], ['zoom'],
  2,  15,
  6,  30,
  10, 50,
  14, 80,
]

/** Glow layer uses a larger radius so it bleeds outward from the main layer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GLOW_RADIUS: any = [
  'interpolate', ['linear'], ['zoom'],
  2,  24,
  6,  48,
  10, 80,
  14, 130,
]

// ── Category colour ramps ────────────────────────────────────────────────────

export type HeatmapCategory = 'all' | 'conflict' | 'climate' | 'health' | string

/**
 * Returns a MapLibre `heatmap-color` paint expression for the given category.
 * Each ramp goes black→[category accent]→white as density increases.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function categoryColorRamp(cat: HeatmapCategory): any {
  switch (cat) {
    case 'conflict':
      // black → deep-red → orange → white
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.05, 'rgba(30,0,20,0.3)',
        0.2,  'rgba(100,0,0,0.6)',
        0.4,  'rgba(180,20,0,0.8)',
        0.6,  'rgba(240,80,0,0.9)',
        0.8,  'rgba(255,160,20,0.95)',
        1.0,  'rgba(255,255,200,1)',
      ]

    case 'climate':
      // black → deep-blue → cyan → white
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.05, 'rgba(0,0,40,0.3)',
        0.2,  'rgba(0,30,120,0.6)',
        0.4,  'rgba(0,80,180,0.8)',
        0.6,  'rgba(0,160,210,0.9)',
        0.8,  'rgba(0,230,230,0.95)',
        1.0,  'rgba(200,255,255,1)',
      ]

    case 'health':
      // black → deep-green → lime → white
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.05, 'rgba(0,25,0,0.3)',
        0.2,  'rgba(0,80,10,0.6)',
        0.4,  'rgba(0,150,20,0.8)',
        0.6,  'rgba(30,210,40,0.9)',
        0.8,  'rgba(140,255,60,0.95)',
        1.0,  'rgba(220,255,180,1)',
      ]

    default:
      // 'all' — black → blue → cyan → yellow → white
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.05, 'rgba(0,0,60,0.3)',
        0.2,  'rgba(0,60,160,0.6)',
        0.4,  'rgba(0,170,200,0.8)',
        0.6,  'rgba(0,230,180,0.9)',
        0.8,  'rgba(200,240,0,0.95)',
        1.0,  'rgba(255,220,0,1)',
      ]
  }
}

// ── EnhancedHeatmap class ────────────────────────────────────────────────────

/**
 * Manages two native MapLibre heatmap layers:
 *   1. `enhanced-heatmap`      — main density layer
 *   2. `enhanced-heatmap-glow` — wider, pulsing opacity overlay for visual depth
 *
 * Usage:
 *   const hm = new EnhancedHeatmap(map)
 *   hm.show('conflict')           // activate with initial category
 *   hm.setCategory('climate')     // cross-fade colour ramp
 *   hm.hide()                     // fade out and remove layers
 *   hm.destroy()                  // same as hide() — call on component unmount
 */
export class EnhancedHeatmap {
  private readonly map: MapLibreMap
  private _active       = false
  private _rafId        = 0
  private _startMs      = 0
  private _category: HeatmapCategory = 'all'

  constructor(map: MapLibreMap) {
    this.map = map
  }

  get active(): boolean { return this._active }

  /** Activate the heatmap. No-op if already active. */
  show(category: HeatmapCategory = 'all'): void {
    if (this._active) {
      // Already visible — just update category
      this.setCategory(category)
      return
    }
    this._active   = true
    this._category = category
    this._addLayers(category)
    this._startGlowAnimation()
  }

  /** Deactivate the heatmap. No-op if already hidden. */
  hide(): void {
    if (!this._active) return
    this._active = false
    this._stopGlowAnimation()
    this._removeLayers()
  }

  /**
   * Update the active colour ramp to reflect a new category filter.
   * Only applies when heatmap is visible.
   */
  setCategory(category: HeatmapCategory): void {
    this._category = category
    if (!this._active) return
    const m = this.map
    const ramp = categoryColorRamp(category)
    try {
      if (m.getLayer(HEATMAP_LAYER_ID)) m.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-color', ramp)
      if (m.getLayer(GLOW_LAYER_ID))    m.setPaintProperty(GLOW_LAYER_ID,    'heatmap-color', ramp)
    } catch { /* map may be mid-load */ }
  }

  /** Clean up on component unmount. */
  destroy(): void {
    this.hide()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _addLayers(category: HeatmapCategory): void {
    const m    = this.map
    const ramp = categoryColorRamp(category)

    // Guard: source must be present (map might not have loaded signals yet)
    if (!m.getSource(SOURCE_ID)) return

    // ── Main density layer ───────────────────────────────────────────────────
    if (!m.getLayer(HEATMAP_LAYER_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     HEATMAP_LAYER_ID,
        type:   'heatmap',
        source: SOURCE_ID,
        filter: POINT_FILTER,
        paint:  {
          'heatmap-weight':     SEVERITY_WEIGHT,
          'heatmap-intensity':  INTENSITY,
          'heatmap-color':      ramp,
          'heatmap-radius':     ZOOM_RADIUS,
          // Start at 0 and transition to 0.78 for 400 ms fade-in feel
          'heatmap-opacity':    0.78,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }

    // ── Glow overlay layer (wider, lower base opacity, animated) ─────────────
    if (!m.getLayer(GLOW_LAYER_ID)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.addLayer({
        id:     GLOW_LAYER_ID,
        type:   'heatmap',
        source: SOURCE_ID,
        filter: POINT_FILTER,
        paint:  {
          'heatmap-weight':     SEVERITY_WEIGHT,
          'heatmap-intensity':  ['interpolate', ['linear'], ['zoom'], 0, 0.2, 9, 0.7] as any,
          'heatmap-color':      ramp,
          'heatmap-radius':     GLOW_RADIUS,
          'heatmap-opacity':    0.35,  // base; RAF will oscillate 0.3→0.6
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }
  }

  private _removeLayers(): void {
    const m = this.map
    try {
      if (m.getLayer(GLOW_LAYER_ID))    m.removeLayer(GLOW_LAYER_ID)
      if (m.getLayer(HEATMAP_LAYER_ID)) m.removeLayer(HEATMAP_LAYER_ID)
    } catch { /* may already be gone */ }
  }

  /**
   * Run a requestAnimationFrame loop that oscillates the glow layer's opacity
   * as a sine wave: 0.3 → 0.6 → 0.3 over a 3 s period.
   */
  private _startGlowAnimation(): void {
    this._startMs = performance.now()

    const tick = (now: number) => {
      if (!this._active) return
      const elapsed = (now - this._startMs) / 3000          // normalised 0→1 per cycle
      const opacity = 0.3 + 0.3 * Math.sin(elapsed * 2 * Math.PI)  // 0.3 … 0.6
      try {
        if (this.map.getLayer(GLOW_LAYER_ID)) {
          this.map.setPaintProperty(GLOW_LAYER_ID, 'heatmap-opacity', opacity)
        }
      } catch { /* benign — map transitioning */ }
      this._rafId = requestAnimationFrame(tick)
    }

    this._rafId = requestAnimationFrame(tick)
  }

  private _stopGlowAnimation(): void {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = 0
    }
  }
}
