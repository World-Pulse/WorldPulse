/**
 * Draws the World Map's newer layers (lib/map-overlays.ts) on the map: one
 * GeoJSON source and one circle layer each, a popup on click, a reload while
 * on. The map page says which are on; this keeps MapLibre in step.
 */

import { OVERLAYS, type OverlayKey } from '@/lib/map-overlays'
import { onLayer, offLayer, whenStyleUsable } from '@/lib/map-utils'

export interface OverlayHooks {
  /** The API's base address */
  apiUrl: string
  /** Show a popup at a place (the page keeps one popup at a time) */
  popup: (lngLat: unknown, html: string) => void
  /** How many points a layer shows (null: it couldn't load) */
  count: (key: OverlayKey, n: number | null) => void
  loading: (key: OverlayKey, on: boolean) => void
  fetchImpl?: typeof fetch
}

const sourceId = (key: OverlayKey) => `wp-overlay-${key}`
const layerId  = (key: OverlayKey) => `wp-overlay-${key}-dots`

export class OverlayLayers {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private map: any
  private hooks: OverlayHooks
  private on = new Set<OverlayKey>()
  private timers = new Map<OverlayKey, ReturnType<typeof setInterval>>()
  /** Bumped on every switch, so an answer that arrives after the layer was switched off is dropped */
  private turn = new Map<OverlayKey, number>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(map: any, hooks: OverlayHooks) {
    this.map = map
    this.hooks = hooks
  }

  set(key: OverlayKey, on: boolean): void {
    if (on === this.on.has(key)) return
    this.turn.set(key, (this.turn.get(key) ?? 0) + 1)
    if (on) {
      this.on.add(key)
      void this.load(key)
      this.timers.set(key, setInterval(() => { void this.load(key) }, OVERLAYS[key].refreshMs))
    } else {
      this.on.delete(key)
      const t = this.timers.get(key)
      if (t) clearInterval(t)
      this.timers.delete(key)
      this.remove(key)
      this.hooks.count(key, 0)
      this.hooks.loading(key, false)
    }
  }

  destroy(): void {
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
    for (const key of this.on) this.remove(key)
    this.on.clear()
  }

  private async load(key: OverlayKey): Promise<void> {
    const def = OVERLAYS[key]
    const turn = this.turn.get(key)
    this.hooks.loading(key, true)
    try {
      const res = await (this.hooks.fetchImpl ?? fetch)(`${this.hooks.apiUrl}${def.path}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const features = def.toFeatures(await res.json())
      if (this.turn.get(key) !== turn || !this.on.has(key)) return
      whenStyleUsable(this.map, () => {
        if (this.turn.get(key) !== turn || !this.on.has(key)) return
        this.draw(key, features)
      })
      this.hooks.count(key, features.length)
    } catch (err) {
      console.warn(`[map][${key}]`, err)
      if (this.turn.get(key) === turn) this.hooks.count(key, null)
    } finally {
      if (this.turn.get(key) === turn) this.hooks.loading(key, false)
    }
  }

  private draw(key: OverlayKey, features: unknown[]): void {
    const map = this.map
    const def = OVERLAYS[key]
    const data = { type: 'FeatureCollection', features }
    const source = map.getSource(sourceId(key))
    if (source) { source.setData(data); return }
    map.addSource(sourceId(key), { type: 'geojson', data })
    map.addLayer({
      id: layerId(key),
      type: 'circle',
      source: sourceId(key),
      paint: {
        'circle-color': def.color,
        'circle-opacity': 0.85,
        'circle-radius': def.bySeverity
          ? ['match', ['get', 'severity'], 'critical', 8, 'high', 6.5, 'medium', 5.5, 4.5]
          : ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 6.5],
        'circle-stroke-color': 'rgba(8,12,20,0.9)',
        'circle-stroke-width': 1.5,
      },
    })
    onLayer(map, 'mouseenter', layerId(key), () => { map.getCanvas().style.cursor = 'pointer' })
    onLayer(map, 'mouseleave', layerId(key), () => { map.getCanvas().style.cursor = '' })
    onLayer(map, 'click', layerId(key), (e: { features?: Array<{ properties?: Record<string, unknown> }>; lngLat: unknown }) => {
      const props = e.features?.[0]?.properties
      if (props) this.hooks.popup(e.lngLat, def.popup(props))
    })
  }

  private remove(key: OverlayKey): void {
    const map = this.map
    try {
      offLayer(map, layerId(key))
      if (map.getLayer(layerId(key))) map.removeLayer(layerId(key))
      if (map.getSource(sourceId(key))) map.removeSource(sourceId(key))
    } catch { /* the map may be gone */ }
  }
}
