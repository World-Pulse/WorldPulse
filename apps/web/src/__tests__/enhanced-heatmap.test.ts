/**
 * Unit tests for EnhancedHeatmap — BAT-16
 *
 * Tests the MapLibre GL heatmap layer lifecycle:
 *   - show / hide / destroy lifecycle
 *   - category colour-ramp cross-fade
 *   - idempotent no-op guards (show when active, hide when inactive)
 *   - glow RAF animation start/stop
 *   - _addLayers guard when source is missing
 *   - HEATMAP_LAYER_ID / GLOW_LAYER_ID exports
 *
 * MapLibre GL is mocked via a minimal stub — no DOM / WebGL required.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  EnhancedHeatmap,
  HEATMAP_LAYER_ID,
  GLOW_LAYER_ID,
  type HeatmapCategory,
} from '@/components/map/EnhancedHeatmap'

// ── MapLibre minimal stub ────────────────────────────────────────────────────

type PaintProp = Record<string, unknown>

function makeMapStub(hasSource = true) {
  const layers = new Map<string, PaintProp>()
  const paintProps = new Map<string, Map<string, unknown>>()

  return {
    _layers: layers,
    getSource: vi.fn((_id: string) => (hasSource ? {} : undefined)),
    getLayer:  vi.fn((id: string) => layers.get(id) ?? undefined),
    addLayer:  vi.fn((spec: { id: string }) => { layers.set(spec.id, spec as PaintProp) }),
    removeLayer: vi.fn((id: string) => { layers.delete(id); paintProps.delete(id) }),
    setPaintProperty: vi.fn((id: string, prop: string, val: unknown) => {
      if (!paintProps.has(id)) paintProps.set(id, new Map())
      paintProps.get(id)!.set(prop, val)
    }),
    getPaintProperty: (id: string, prop: string) => paintProps.get(id)?.get(prop),
  }
}

// ── RAF stub (jsdom doesn't have rAF wired to a timer by default) ───────────

let rafCallbacks: Array<(t: number) => void> = []

beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
    // mark as cancelled — noop for tests
  })
  vi.stubGlobal('performance', { now: () => 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function flushRaf(time = 0): void {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) cb(time)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EnhancedHeatmap — constants', () => {
  it('exports HEATMAP_LAYER_ID as a non-empty string', () => {
    expect(typeof HEATMAP_LAYER_ID).toBe('string')
    expect(HEATMAP_LAYER_ID.length).toBeGreaterThan(0)
  })

  it('exports GLOW_LAYER_ID as a non-empty string', () => {
    expect(typeof GLOW_LAYER_ID).toBe('string')
    expect(GLOW_LAYER_ID.length).toBeGreaterThan(0)
  })

  it('HEATMAP_LAYER_ID and GLOW_LAYER_ID are distinct', () => {
    expect(HEATMAP_LAYER_ID).not.toBe(GLOW_LAYER_ID)
  })
})

describe('EnhancedHeatmap — construction', () => {
  it('starts inactive', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    expect(hm.active).toBe(false)
  })

  it('does not add any layers on construction', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new EnhancedHeatmap(map as any)
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})

describe('EnhancedHeatmap — show()', () => {
  it('sets active=true after show()', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(hm.active).toBe(true)
  })

  it('adds both heatmap and glow layers', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show('all')
    const addedIds = map.addLayer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id)
    expect(addedIds).toContain(HEATMAP_LAYER_ID)
    expect(addedIds).toContain(GLOW_LAYER_ID)
  })

  it('starts glow RAF loop', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(rafCallbacks.length).toBeGreaterThan(0)
  })

  it('is idempotent — second show() does not add layers again', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    const countAfterFirst = map.addLayer.mock.calls.length
    hm.show()
    // second show() calls setCategory() internally, no new addLayer calls
    expect(map.addLayer.mock.calls.length).toBe(countAfterFirst)
  })

  it('defaults category to "all"', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(hm.active).toBe(true)
    // The colour ramp for "all" should have been set — no error thrown
  })

  it('does not add layers when source is absent', () => {
    const map = makeMapStub(false) // no source
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})

describe('EnhancedHeatmap — hide()', () => {
  it('sets active=false after hide()', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    hm.hide()
    expect(hm.active).toBe(false)
  })

  it('removes both layers on hide()', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    // Simulate getLayer returning truthy for both during remove
    map.getLayer.mockImplementation((id: string) => map._layers.get(id))
    hm.hide()
    expect(map.removeLayer).toHaveBeenCalledWith(HEATMAP_LAYER_ID)
    expect(map.removeLayer).toHaveBeenCalledWith(GLOW_LAYER_ID)
  })

  it('is idempotent — hide() when already hidden is a no-op', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    expect(() => hm.hide()).not.toThrow()
    expect(map.removeLayer).not.toHaveBeenCalled()
  })

  it('stops the RAF loop on hide()', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    const rafBefore = rafCallbacks.length
    hm.hide()
    // After hide, flushing remaining RAF callbacks should NOT re-queue new ones
    // because _active is false
    flushRaf()
    expect(rafCallbacks.length).toBe(0)
    expect(rafBefore).toBeGreaterThan(0) // was running before
  })
})

describe('EnhancedHeatmap — setCategory()', () => {
  const categories: HeatmapCategory[] = ['all', 'conflict', 'climate', 'health', 'other']

  for (const cat of categories) {
    it(`updates colour ramp for category "${cat}" when active`, () => {
      const map = makeMapStub()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hm = new EnhancedHeatmap(map as any)
      hm.show('all')
      // Ensure getLayer returns truthy for both layers
      map.getLayer.mockImplementation((id: string) => map._layers.get(id))
      hm.setCategory(cat)
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        HEATMAP_LAYER_ID,
        'heatmap-color',
        expect.anything(),
      )
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        GLOW_LAYER_ID,
        'heatmap-color',
        expect.anything(),
      )
    })
  }

  it('is a no-op when heatmap is not active', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.setCategory('conflict')
    // Should not call setPaintProperty — heatmap not shown yet
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })

  it('handles a graceful error if map throws during setPaintProperty', () => {
    const map = makeMapStub()
    map.getLayer.mockReturnValue({})
    map.setPaintProperty.mockImplementation(() => { throw new Error('map busy') })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(() => hm.setCategory('climate')).not.toThrow()
  })
})

describe('EnhancedHeatmap — destroy()', () => {
  it('destroy() is equivalent to hide()', () => {
    const map = makeMapStub()
    map.getLayer.mockImplementation((id: string) => map._layers.get(id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    hm.destroy()
    expect(hm.active).toBe(false)
  })

  it('destroy() when already inactive does not throw', () => {
    const map = makeMapStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    expect(() => hm.destroy()).not.toThrow()
  })
})

describe('EnhancedHeatmap — show() → second call updates category via setCategory', () => {
  it('second show("conflict") when already active calls setPaintProperty', () => {
    const map = makeMapStub()
    map.getLayer.mockImplementation((id: string) => map._layers.get(id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show('all')
    map.setPaintProperty.mockClear()
    hm.show('conflict')
    // setCategory is called internally — should update paint properties
    expect(map.setPaintProperty).toHaveBeenCalled()
  })
})

describe('EnhancedHeatmap — glow RAF animation', () => {
  it('RAF callback updates glow layer opacity', () => {
    const map = makeMapStub()
    map.getLayer.mockImplementation((id: string) => map._layers.get(id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    map.setPaintProperty.mockClear()
    // Flush the first RAF tick at t=1500 ms (half period → sin=0 → opacity=0.3)
    flushRaf(1500)
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      GLOW_LAYER_ID,
      'heatmap-opacity',
      expect.any(Number),
    )
    // opacity should be between 0.3 and 0.6
    const opacityCall = map.setPaintProperty.mock.calls.find(
      (c: unknown[]) => c[1] === 'heatmap-opacity'
    )
    if (opacityCall) {
      const opacity = opacityCall[2] as number
      expect(opacity).toBeGreaterThanOrEqual(0.3)
      expect(opacity).toBeLessThanOrEqual(0.6)
    }
  })

  it('RAF callback stops gracefully if map throws', () => {
    const map = makeMapStub()
    map.getLayer.mockReturnValue({})
    map.setPaintProperty.mockImplementation(() => { throw new Error('benign') })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)
    hm.show()
    expect(() => flushRaf(500)).not.toThrow()
  })
})

describe('EnhancedHeatmap — full lifecycle round-trip', () => {
  it('show → hide → show works correctly', () => {
    const map = makeMapStub()
    map.getLayer.mockImplementation((id: string) => map._layers.get(id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hm = new EnhancedHeatmap(map as any)

    hm.show('all')
    expect(hm.active).toBe(true)
    const addCount1 = map.addLayer.mock.calls.length

    hm.hide()
    expect(hm.active).toBe(false)

    // Second show — layers removed from stub in hide(), so addLayer is called again
    map._layers.clear()
    hm.show('climate')
    expect(hm.active).toBe(true)
    // New addLayer calls should have happened
    expect(map.addLayer.mock.calls.length).toBeGreaterThan(addCount1)
  })
})
