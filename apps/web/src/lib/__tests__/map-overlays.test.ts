/**
 * The World Map's newer layers (Oct 21, 2026): each API answer becomes points
 * and a safe popup, and OverlayLayers keeps MapLibre in step with the switches.
 * The answers are shaped like the live API's of Oct 21.
 */
import { describe, it, expect, vi } from 'vitest'
import { OVERLAYS, OVERLAY_KEYS, isOverlayKey, pointAt } from '../map-overlays'
import { OverlayLayers } from '@/components/map/OverlayLayers'

describe('pointAt', () => {
  it('takes real coordinates, as [lng, lat]', () => {
    expect(pointAt(9.07, 7.49)).toEqual([7.49, 9.07])
    expect(pointAt('41.33', '19.82')).toEqual([19.82, 41.33])
  })
  it('refuses 0,0, out-of-range and missing values', () => {
    expect(pointAt(0, 0)).toBeNull()
    expect(pointAt(91, 10)).toBeNull()
    expect(pointAt(10, 181)).toBeNull()
    expect(pointAt(null, 10)).toBeNull()
    expect(pointAt('', 10)).toBeNull()
  })
})

describe('the news layers (protests, outbreaks, displacement)', () => {
  const answer = {
    success: true, topic: 'outbreaks', hours: 72, type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [7.4951, 9.0579] },
        properties: { id: 'abc-1', title: 'Nigeria confirms first Ebola case as outbreak spreads', place: 'Abuja, Nigeria', severity: 'high', created_at: '2026-10-21T09:00:00.000Z' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'x', title: 'Null Island' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] }, properties: { id: 'y' } },
    ],
  }

  it('keeps reports with a title and a place', () => {
    const f = OVERLAYS.outbreaks.toFeatures(answer)
    expect(f).toHaveLength(1)
    expect(f[0].geometry.coordinates).toEqual([7.4951, 9.0579])
    expect(f[0].properties).toMatchObject({ id: 'abc-1', place: 'Abuja, Nigeria', severity: 'high' })
  })

  it('reads nothing from an answer of another shape', () => {
    expect(OVERLAYS.protests.toFeatures(null)).toEqual([])
    expect(OVERLAYS.protests.toFeatures({ features: 'no' })).toEqual([])
  })

  it('popup: the layer, the severity, the headline and a link to the story, escaped', () => {
    const html = OVERLAYS.protests.popup({ id: 'a b', title: '<img src=x onerror=alert(1)> Riots in Milan', place: 'Milan, Italy', severity: 'critical', at: new Date().toISOString() })
    expect(html).toContain('PROTESTS &amp; UNREST')
    expect(html).toContain('CRITICAL')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    expect(html).toContain('href="/signals/a%20b"')
    expect(html).toContain('Milan, Italy')
  })

  it('point at the topics route, each with its window', () => {
    expect(OVERLAYS.protests.path).toBe('/api/v1/map/topics/protests')
    expect(OVERLAYS.displacement.description).toContain('7 days')
  })
})

describe('internet outages', () => {
  const answer = { success: true, data: { count: 1, hours: 24, events: [{
    id: 'ce679d68', title: 'Internet outage in North Korea, detected by IODA',
    summary: 'IODA, Georgia Tech’s internet outage monitor, detected an internet outage in North Korea from 07:50 UTC on Oct 21.',
    severity: 'medium', location_name: 'North Korea', country_code: 'KP', lat: 39.0392, lng: 125.7625,
    published_at: '2026-10-21T07:50:00.000Z', source_url: 'https://ioda.inetintel.cc.gatech.edu/country/KP',
  }] } }

  it('one point per outage, where IODA puts the country', () => {
    const f = OVERLAYS.outages.toFeatures(answer)
    expect(f).toHaveLength(1)
    expect(f[0].geometry.coordinates).toEqual([125.7625, 39.0392])
  })

  it('popup links the story and IODA, and only http(s) links', () => {
    const p = OVERLAYS.outages.toFeatures(answer)[0].properties
    const html = OVERLAYS.outages.popup(p)
    expect(html).toContain('INTERNET OUTAGE')
    expect(html).toContain('href="/signals/ce679d68"')
    expect(html).toContain('href="https://ioda.inetintel.cc.gatech.edu/country/KP"')
    const bad = OVERLAYS.outages.popup({ ...p, source: 'javascript:alert(1)' })
    expect(bad).not.toContain('javascript:')
  })
})

describe('undersea cable landings', () => {
  const answer = { success: true, total_countries: 1, total_landing_points: 2, data: [{
    country: 'United States', country_code: 'US', points: [
      { name: 'Virginia Beach', lat: 36.85, lng: -75.98, cables: ['MAREA', 'Dunant', 'Jupiter'] },
      { name: 'Lynn', lat: 42.47, lng: -70.95, cables: ['Amitié'] },
    ],
  }] }

  it('one point per landing, with its cables', () => {
    const f = OVERLAYS['cable-landings'].toFeatures(answer)
    expect(f).toHaveLength(2)
    expect(f[0].properties).toMatchObject({ name: 'Virginia Beach', country: 'United States', cables: 'MAREA · Dunant · Jupiter', cableCount: 3 })
  })

  it('popup counts the cables', () => {
    const [many, one] = OVERLAYS['cable-landings'].toFeatures(answer)
    expect(OVERLAYS['cable-landings'].popup(many.properties)).toContain('3 cables: MAREA · Dunant · Jupiter')
    expect(OVERLAYS['cable-landings'].popup(one.properties)).toContain('Cable: Amitié')
  })
})

describe('AI data centers', () => {
  const answer = { success: true, total: 1, filtered: 1, data: [{
    id: 'ms-phoenix-az', name: 'Microsoft Phoenix Campus', operator: 'Microsoft', country: 'United States', country_code: 'US',
    city: 'Phoenix, AZ', lat: 33.4484, lng: -112.074, capacity_mw: 500, status: 'operational', gpu_type: 'NVIDIA H100',
  }] }

  it('a point per site, with what the popup shows', () => {
    const f = OVERLAYS['ai-dc'].toFeatures(answer)
    expect(f).toHaveLength(1)
    const html = OVERLAYS['ai-dc'].popup(f[0].properties)
    expect(html).toContain('Microsoft Phoenix Campus')
    expect(html).toContain('Phoenix, AZ, United States')
    expect(html).toContain('Microsoft · 500 MW · operational · NVIDIA H100')
  })
})

describe('the keys', () => {
  it('every layer has a definition and a colour of its own', () => {
    expect(OVERLAY_KEYS.every(k => OVERLAYS[k].key === k)).toBe(true)
    expect(new Set(OVERLAY_KEYS.map(k => OVERLAYS[k].color)).size).toBe(OVERLAY_KEYS.length)
    expect(isOverlayKey('outages')).toBe(true)
    expect(isOverlayKey('wind')).toBe(false)
  })
})

/** A stand-in for MapLibre: sources, layers and handlers */
function fakeMap() {
  const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>()
  const layers = new Map<string, unknown>()
  const handlers: Array<[string, string]> = []
  const map = {
    style: { _loaded: true },
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, def: { data: unknown }) => {
      const src = { data: def.data, setData(d: unknown) { src.data = d } }
      sources.set(id, src)
    },
    removeSource: (id: string) => { sources.delete(id) },
    getLayer: (id: string) => layers.get(id),
    addLayer: (def: { id: string }) => { layers.set(def.id, def) },
    removeLayer: (id: string) => { layers.delete(id) },
    on: (type: string, id: string) => { handlers.push([type, id]) },
    off: (type: string, id: string) => {
      const i = handlers.findIndex(([t, l]) => t === type && l === id)
      if (i >= 0) handlers.splice(i, 1)
    },
    getCanvas: () => ({ style: {} }),
  }
  return { map, sources, layers, handlers }
}

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
const outageAnswer = { data: { events: [{ id: 'o1', title: 'Internet outage in Iraq', lat: 33.3, lng: 44.4, published_at: '2026-10-21T10:00:00Z' }] } }

describe('OverlayLayers', () => {
  it('draws a layer when switched on, and takes it all away when switched off', async () => {
    const { map, sources, layers, handlers } = fakeMap()
    const counts: Array<[string, number | null]> = []
    const layer = new OverlayLayers(map, {
      apiUrl: 'https://api.test', popup: vi.fn(), loading: vi.fn(), count: (k, n) => counts.push([k, n]),
      fetchImpl: vi.fn(() => json(outageAnswer)) as unknown as typeof fetch,
    })
    layer.set('outages', true)
    await vi.waitFor(() => expect(layers.has('wp-overlay-outages-dots')).toBe(true))
    expect(counts.at(-1)).toEqual(['outages', 1])
    expect(handlers.filter(([, id]) => id === 'wp-overlay-outages-dots').map(([t]) => t).sort()).toEqual(['click', 'mouseenter', 'mouseleave'])
    layer.set('outages', false)
    expect(layers.size).toBe(0)
    expect(sources.size).toBe(0)
    expect(handlers).toHaveLength(0)
    expect(counts.at(-1)).toEqual(['outages', 0])
    layer.destroy()
  })

  it('drops an answer that arrives after the layer was switched off', async () => {
    const { map, layers } = fakeMap()
    let release: (v: Response) => void = () => {}
    const slow = new Promise<Response>(r => { release = r })
    const layer = new OverlayLayers(map, { apiUrl: '', popup: vi.fn(), loading: vi.fn(), count: vi.fn(), fetchImpl: (() => slow) as unknown as typeof fetch })
    layer.set('outages', true)
    layer.set('outages', false)
    release({ ok: true, json: () => Promise.resolve(outageAnswer) } as Response)
    await new Promise(r => setTimeout(r, 10))
    expect(layers.size).toBe(0)
    layer.destroy()
  })

  it('says when a layer could not load', async () => {
    const { map } = fakeMap()
    const count = vi.fn()
    const layer = new OverlayLayers(map, { apiUrl: '', popup: vi.fn(), loading: vi.fn(), count,
      fetchImpl: (() => Promise.resolve({ ok: false, status: 503 } as Response)) as unknown as typeof fetch })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    layer.set('protests', true)
    await vi.waitFor(() => expect(count).toHaveBeenCalledWith('protests', null))
    layer.destroy()
  })

  it('updates the points in place on a reload', async () => {
    vi.useFakeTimers()
    const { map, sources } = fakeMap()
    let n = 0
    const fetchImpl = vi.fn(() => json({ data: { events: Array.from({ length: ++n }, (_, i) => ({ id: `o${i}`, title: 'Outage', lat: 10 + i, lng: 10 })) } }))
    const layer = new OverlayLayers(map, { apiUrl: '', popup: vi.fn(), loading: vi.fn(), count: vi.fn(), fetchImpl: fetchImpl as unknown as typeof fetch })
    layer.set('outages', true)
    await vi.waitFor(() => expect(sources.has('wp-overlay-outages')).toBe(true))
    await vi.advanceTimersByTimeAsync(OVERLAYS.outages.refreshMs)
    await vi.waitFor(() => expect((sources.get('wp-overlay-outages')!.data as { features: unknown[] }).features).toHaveLength(2))
    layer.destroy()
    vi.useRealTimers()
  })
})
