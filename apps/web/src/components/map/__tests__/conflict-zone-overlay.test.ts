import { describe, it, expect, vi } from 'vitest'
import { ConflictZoneOverlay, CONFLICT_HEAT_ID, CONFLICT_CIRCLE_ID, CONFLICT_PULSE_ID, CONFLICT_POINTS_MINZOOM, HEAT_WEIGHT } from '../ConflictZoneOverlay'

const fakeMap = () => {
  const layers = new Map<string, { spec: Record<string, unknown>; before?: string }>()
  const sources = new Map<string, unknown>()
  return {
    layers,
    getLayer: (id: string) => layers.get(id) ?? (id === 'cluster-halo' ? {} : undefined),
    addLayer: vi.fn((spec: Record<string, unknown>, before?: string) => { layers.set(String(spec.id), { spec, before }) }),
    removeLayer: (id: string) => { layers.delete(id) },
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => { sources.set(id, s) },
    removeSource: (id: string) => { sources.delete(id) },
    setPaintProperty: vi.fn(),
  }
}

describe('ConflictZoneOverlay (Oct 19, 2026: zones as a glow)', () => {
  it('draws a glow under the news rings, and the stories as points only when zoomed in', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const map = fakeMap()
    const overlay = new ConflictZoneOverlay(map as never)
    overlay.show({ type: 'FeatureCollection', features: [] })
    const heat = map.layers.get(CONFLICT_HEAT_ID)
    expect(heat?.spec.type).toBe('heatmap')
    expect(heat?.before).toBe('cluster-halo')
    expect(heat?.spec.maxzoom).toBe(10)
    expect(map.layers.get(CONFLICT_CIRCLE_ID)?.spec.minzoom).toBe(CONFLICT_POINTS_MINZOOM)
    expect(map.layers.get(CONFLICT_PULSE_ID)?.spec.minzoom).toBe(CONFLICT_POINTS_MINZOOM)
    overlay.hide()
    expect(map.layers.size).toBe(0)
    vi.unstubAllGlobals()
  })

  it('the worst stories warm the glow most', () => {
    const weight = (sev: string) => { const i = HEAT_WEIGHT.indexOf(sev); return i > 0 ? HEAT_WEIGHT[i + 1] : HEAT_WEIGHT[HEAT_WEIGHT.length - 1] }
    expect(weight('critical')).toBeGreaterThan(weight('high'))
    expect(weight('high')).toBeGreaterThan(weight('medium'))
    expect(weight('medium')).toBeGreaterThan(weight('low'))
  })
})
