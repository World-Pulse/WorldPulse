/**
 * The Satellites layer (plan M53, Oct 21, 2026): real element sets of Oct 21
 * (CelesTrak), placed with satellite.js. The ISS flies about 400-420 km up
 * at about 7.66 km/s, never further from the equator than its inclination
 * (51.6°); a GPS satellite about 20,200 km up.
 */
import { describe, it, expect, vi } from 'vitest'
import * as satellite from 'satellite.js'
import { prepareWith, prepareSatellites, satellitePositions, parseTleText, celestrakGroup, CELESTRAK_KEEP_MS, type KeptStore } from '../map-satellites'
import { OVERLAYS } from '../map-overlays'
import { OverlayLayers } from '@/components/map/OverlayLayers'

const ISS = {
  name: 'ISS (ZARYA)', norad: 25544, group: 'stations',
  tle1: '1 25544U 98067A   26294.04791053  .00009575  00000+0  18188-3 0  9996',
  tle2: '2 25544  51.6327  37.2623 0006759 289.5321  70.4938 15.48967427591263',
}
const GPS = {
  name: 'GPS BIIR-5  (PRN 22)', norad: 26407, group: 'gnss',
  tle1: '1 26407U 00040A   26294.05710803 -.00000015  00000+0  00000+0 0  9995',
  tle2: '2 26407  54.8302 210.1681 0116263 304.6186 141.5204  2.00558710192477',
}
const answer = { success: true, satellites: [ISS, GPS, { name: 'Broken', norad: 1, group: 'stations', tle1: 'x', tle2: 'y' }, { ...ISS, group: 'unknown' }] }

describe('satellitePositions', () => {
  const prepared = prepareWith(satellite, answer)
  const at = new Date('2026-10-21T12:00:00Z')

  it('keeps the element sets satellite.js can read, in known groups', () => {
    expect(prepared.sats.map(s => s.name)).toEqual(['ISS (ZARYA)', 'GPS BIIR-5  (PRN 22)'])
  })

  it('places the ISS where it can be', () => {
    const [iss] = satellitePositions(prepared, at)
    const [lng, lat] = iss.geometry.coordinates
    expect(Math.abs(lat)).toBeLessThanOrEqual(51.7)
    expect(Math.abs(lng)).toBeLessThanOrEqual(180)
    expect(iss.properties.km).toBeGreaterThan(380)
    expect(iss.properties.km).toBeLessThan(440)
    expect(iss.properties.kms).toBeGreaterThan(7.5)
    expect(iss.properties.kms).toBeLessThan(7.8)
    expect(iss.properties).toMatchObject({ group: 'stations', kind: 'Space station', norad: 25544 })
  })

  it('places a GPS satellite in its own orbit, 20,000 km up', () => {
    const gps = satellitePositions(prepared, at)[1]
    expect(gps.properties.km).toBeGreaterThan(19_000)
    expect(gps.properties.km).toBeLessThan(21_500)
  })

  it('moves the ISS on: about 460 km a minute', () => {
    const a = satellitePositions(prepared, at)[0].geometry.coordinates
    const b = satellitePositions(prepared, new Date(at.getTime() + 60_000))[0].geometry.coordinates
    expect(a).not.toEqual(b)
  })

  it('popup: what, how high, how fast, safely', () => {
    const [iss] = satellitePositions(prepared, at)
    const html = OVERLAYS.satellites.popup({ ...iss.properties, name: '<b>ISS</b>' })
    expect(html).toContain('SATELLITE · SPACE STATION')
    expect(html).toContain('&lt;b&gt;ISS&lt;/b&gt;')
    expect(html).toMatch(/\d{3} km up · 7\.\d+ km\/s · NORAD 25544/)
    expect(html).toContain('href="https://celestrak.org/satcat/table-satcat.php?CATNR=25544&MAX=1"')
  })

  it('reads nothing from another shape', () => {
    expect(prepareWith(satellite, null).sats).toEqual([])
    expect(prepareWith(satellite, { satellites: 'no' }).sats).toEqual([])
  })
})

describe('OverlayLayers with moving points', () => {
  it('places them again on the layer\'s timer, and stops when switched off', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    const sources = new Map<string, { data: { features: Array<{ geometry: { coordinates: number[] } }> }; setData: (d: never) => void }>()
    const layers = new Set<string>()
    const map = {
      style: { _loaded: true },
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, def: { data: never }) => { const src = { data: def.data, setData(d: never) { src.data = d } }; sources.set(id, src) },
      removeSource: (id: string) => { sources.delete(id) },
      getLayer: (id: string) => layers.has(id) || undefined,
      addLayer: (def: { id: string }) => { layers.add(def.id) },
      removeLayer: (id: string) => { layers.delete(id) },
      on: () => {}, off: () => {},
      getCanvas: () => ({ style: {} }),
    }
    // the API has one satellite; CelesTrak, asked from the browser, doesn't answer
    const fetchImpl = vi.fn(async (url: string) => (url.startsWith('https://celestrak.org/')
      ? { ok: false, status: 503, text: async () => '' }
      : { ok: true, json: async () => ({ satellites: [ISS] }) }) as unknown as Response)
    const count = vi.fn()
    const layer = new OverlayLayers(map, { apiUrl: 'https://api.test', popup: vi.fn(), loading: vi.fn(), count, fetchImpl: fetchImpl as unknown as typeof fetch })
    layer.set('satellites', true)
    await vi.waitFor(() => expect(sources.has('wp-overlay-satellites')).toBe(true))
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/api/v1/map/satellites')
    expect(count).toHaveBeenCalledWith('satellites', 1)
    const first = sources.get('wp-overlay-satellites')!.data.features[0].geometry.coordinates
    await vi.advanceTimersByTimeAsync(OVERLAYS.satellites.live!.everyMs)
    const second = sources.get('wp-overlay-satellites')!.data.features[0].geometry.coordinates
    expect(second).not.toEqual(first)
    layer.set('satellites', false)
    expect(sources.size).toBe(0)
    await vi.advanceTimersByTimeAsync(3 * OVERLAYS.satellites.live!.everyMs)
    expect(sources.size).toBe(0)
    layer.destroy()
    vi.useRealTimers()
  })
})

describe('when the API has too few: CelesTrak, from the browser', () => {
  const text = [ISS.name, ISS.tle1, ISS.tle2, GPS.name, GPS.tle1, GPS.tle2].join('\r\n') + '\r\n'
  const memory = (): KeptStore & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
  }
  const celestrak = (body = text) => vi.fn(async (_url: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response)

  it('reads CelesTrak\'s three-line text', () => {
    expect(parseTleText(text, 'gnss').map(s => [s.norad, s.name, s.group])).toEqual([[25544, 'ISS (ZARYA)', 'gnss'], [26407, 'GPS BIIR-5  (PRN 22)', 'gnss']])
    expect(parseTleText('No GP data found', 'gnss')).toEqual([])
  })

  it('keeps each group two hours in this browser, as CelesTrak asks', async () => {
    const store = memory()
    const f = celestrak()
    const t0 = Date.parse('2026-10-21T12:00:00Z')
    expect(await celestrakGroup('stations', f as unknown as typeof fetch, store, t0)).toHaveLength(2)
    expect(String(f.mock.calls[0][0])).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle')
    await celestrakGroup('stations', f as unknown as typeof fetch, store, t0 + CELESTRAK_KEEP_MS - 1000)
    expect(f).toHaveBeenCalledTimes(1)
    await celestrakGroup('stations', f as unknown as typeof fetch, store, t0 + CELESTRAK_KEEP_MS + 1000)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('keeps no empty answer', async () => {
    const store = memory()
    expect(await celestrakGroup('weather', celestrak('No GP data found') as unknown as typeof fetch, store)).toEqual([])
    expect(store.data.size).toBe(0)
  })

  it('asks CelesTrak only when the API has fewer than 50, each satellite once', async () => {
    const f = celestrak()
    const few = await prepareSatellites({ satellites: [ISS] }, f as unknown as typeof fetch, memory())
    expect(f).toHaveBeenCalledTimes(5)
    expect(few.sats.map(s => s.norad)).toEqual([25544, 26407])
    expect(few.sats[0].group).toBe('stations')
    const g = celestrak()
    const many = await prepareSatellites({ satellites: Array.from({ length: 50 }, () => ISS) }, g as unknown as typeof fetch, memory())
    expect(g).not.toHaveBeenCalled()
    expect(many.sats).toHaveLength(50)
  })

  it('keeps the API\'s few when CelesTrak doesn\'t answer either', async () => {
    const down = vi.fn(async () => { throw new Error('offline') })
    expect((await prepareSatellites({ satellites: [ISS] }, down as unknown as typeof fetch, null)).sats).toHaveLength(1)
  })
})
