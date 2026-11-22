/**
 * Two map layers from free public feeds that update themselves (Nov 22, 2026): NASA EONET's storms, floods and other
 * open events, and NOAA's aurora forecast. Neither reads the database: the source's answer, made into points.
 * The answers below are shaped like the live ones of Nov 21, 2026 (Tropical Cyclone Akvan's track, from JTWC).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: (_k: string, _o: unknown, make: () => Promise<unknown>) => make() }))

import Fastify from 'fastify'
import { eonetFeatures, auroraFeatures, cemsFeatures, registerEarthFeedRoutes, registerSatelliteMapRoute, EONET_URL, AURORA_URL, CEMS_URL, TRACK_POINTS } from '../routes/map/earth-feeds'

const AKVAN = {
  id: 'EONET_26494', title: 'Tropical Cyclone Akvan', description: null, link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_26494', closed: null,
  categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
  sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/io0526.tcw' }],
  geometry: [
    { magnitudeValue: 35.0, magnitudeUnit: 'kts', date: '2026-11-16T18:00:00Z', type: 'Point', coordinates: [86.8, 11.4] },
    { magnitudeValue: 45.0, magnitudeUnit: 'kts', date: '2026-11-17T18:00:00Z', type: 'Point', coordinates: [87.3, 13.1] },
    { magnitudeValue: 30.0, magnitudeUnit: 'kts', date: '2026-11-19T18:00:00Z', type: 'Point', coordinates: [84.7, 17.2] },
  ],
}
const FLOOD = {
  id: 'EONET_9', title: 'Floods in Somalia', categories: [{ id: 'floods' }], sources: [{ id: 'GDACS', url: 'https://www.gdacs.org/report.aspx?eventid=1' }],
  geometry: [{ date: '2026-11-20T00:00:00Z', type: 'Polygon', coordinates: [[[44, 2], [46, 2], [46, 4], [44, 4], [44, 2]]] }],
}
const QUAKE = { id: 'EONET_7', title: 'M 6.1 Japan', categories: [{ id: 'earthquakes' }], sources: [], geometry: [{ date: '2026-11-20T00:00:00Z', type: 'Point', coordinates: [140, 36] }] }

describe('eonetFeatures', () => {
  it("a storm at its newest position, with its earlier positions as its track", () => {
    const f = eonetFeatures({ events: [AKVAN] })
    expect(f.map(x => x.properties.now)).toEqual([false, false, true])
    expect(f[2]).toMatchObject({ geometry: { coordinates: [84.7, 17.2] }, properties: { title: 'Tropical Cyclone Akvan', category: 'severeStorms', wind_kts: 30, positions: 3, since: '2026-11-16T18:00:00Z', source: 'JTWC', link: 'https://www.metoc.navy.mil/jtwc/products/io0526.tcw' } })
    expect(f[0]!.properties).toMatchObject({ at: '2026-11-16T18:00:00Z', wind_kts: 35, now: false })
  })

  it('an area at its middle; earthquakes, volcanoes and wildfires left to the Natural hazards layer', () => {
    const f = eonetFeatures({ events: [FLOOD, QUAKE, { id: 'x' }, null] })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ geometry: { coordinates: [44.8, 2.8] }, properties: { category: 'floods', now: true, source: 'GDACS' } })
  })

  it(`keeps a long track to its last ${TRACK_POINTS} positions, and drops places that aren't real`, () => {
    const long = { ...AKVAN, geometry: Array.from({ length: 60 }, (_, i) => ({ magnitudeValue: 50, magnitudeUnit: 'kts', date: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), type: 'Point', coordinates: [80 + i / 10, 10] })) }
    expect(eonetFeatures({ events: [long] })).toHaveLength(TRACK_POINTS + 1)
    const bad = { ...AKVAN, geometry: [{ date: '2026-11-19T18:00:00Z', type: 'Point', coordinates: [200, 95] }] }
    expect(eonetFeatures({ events: [bad] })).toEqual([])
    expect(eonetFeatures(null)).toEqual([])
  })
})

describe('auroraFeatures', () => {
  const grid = {
    'Observation Time': '2026-11-22T04:10:00Z', 'Forecast Time': '2026-11-22T05:20:00Z', 'Data Format': '[Longitude, Latitude, Aurora]',
    coordinates: [[0, -90, 2], [10, 65, 12], [11, 65, 40], [10, 64, 30], [350, 66, 55], [200, 70, 9], [300, 60, 101]],
  }

  it('keeps 10% or more, the highest of each 2-degree cell, at its middle, longitudes from -180 to 180', () => {
    const { forecast, observed, features } = auroraFeatures(grid)
    expect(forecast).toBe('2026-11-22T05:20:00Z')
    expect(observed).toBe('2026-11-22T04:10:00Z')
    expect(features.map(f => [f.geometry.coordinates, f.properties.chance])).toEqual([
      [[11, 65], 40],
      [[-9, 67], 55],
    ])
  })

  it('an answer that is not a grid gives no points', () => {
    expect(auroraFeatures({}).features).toEqual([])
    expect(auroraFeatures(null).features).toEqual([])
  })
})

describe('the routes', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('ask the sources and answer GeoJSON, and 503 when a source fails', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url === EONET_URL ? { events: [AKVAN] } : { 'Forecast Time': 'T', coordinates: [[10, 65, 50]] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const app = Fastify()
    await app.register(registerEarthFeedRoutes, { prefix: '/api/v1/map' })
    const storms = await app.inject({ method: 'GET', url: '/api/v1/map/storms' })
    expect(storms.statusCode).toBe(200)
    expect(JSON.parse(storms.body)).toMatchObject({ success: true, type: 'FeatureCollection', source: 'NASA EONET (eonet.gsfc.nasa.gov)' })
    expect(JSON.parse(storms.body).features).toHaveLength(3)
    const aurora = await app.inject({ method: 'GET', url: '/api/v1/map/aurora' })
    expect(JSON.parse(aurora.body)).toMatchObject({ success: true, forecast: 'T', features: [{ properties: { chance: 50 } }] })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([EONET_URL, AURORA_URL])
    expect(EONET_URL).toContain('category=severeStorms,floods,landslides,dustHaze,drought,tempExtremes,snow,manmade')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    const down = await app.inject({ method: 'GET', url: '/api/v1/map/storms' })
    expect(down.statusCode).toBe(503)
    await app.close()
  })
})

describe('cemsFeatures (Copernicus EMS Rapid Mapping)', () => {
  // shaped like the public list on Nov 21, 2026
  const list = { count: 268, next: null, results: [
    { code: 'EMSR935', name: 'Flood in Alicante-Valencia Regions, Spain', countries: ['Spain'], eventTime: '2026-10-19T03:10:00', activationTime: '2026-10-19T16:03:00', category: 'Flood', centroid: 'POINT (0.022993090259437 38.81628901353977)', lastUpdate: '2026-10-28T08:51:30.454061', closed: true, gdacsId: null, n_aois: 2, n_products: 2 },
    { code: 'EMSR934', name: 'Earthquake in Los Santos, Panama', countries: [{ name: 'Panama' }], eventTime: '2026-10-09T17:56:00', activationTime: '2026-10-09T23:19:00', category: 'Earthquake', centroid: 'POINT (-80.67084785156305 8.006692455305458)', closed: false, n_products: 13 },
    { code: 'EMSR100', name: 'Old flood', countries: ['X'], activationTime: '2024-01-01T00:00:00', category: 'Flood', centroid: 'POINT (1 1)' },
    { code: '<b>', name: 'bad', activationTime: '2026-10-01T00:00:00', centroid: 'POINT (1 1)' },
    { code: 'EMSR933', name: 'No place', activationTime: '2026-10-01T00:00:00', centroid: 'POLYGON ((1 1, 2 2))' },
  ] }

  it("the last 12 months' activations at their middle, with a link to their maps", () => {
    const f = cemsFeatures(list, Date.parse('2026-11-22T00:00:00Z'))
    expect(f.map(x => x.properties.code)).toEqual(['EMSR935', 'EMSR934'])
    expect(f[0]).toMatchObject({ geometry: { coordinates: [0.023, 38.8163] }, properties: { name: 'Flood in Alicante-Valencia Regions, Spain', category: 'Flood', countries: 'Spain', closed: true, maps: 2, link: 'https://rapidmapping.emergency.copernicus.eu/EMSR935', activated_at: '2026-10-19T16:03:00.000Z', event_at: '2026-10-19T03:10:00.000Z' } })
    expect(f[1]!.properties).toMatchObject({ countries: 'Panama', closed: false })
    expect(cemsFeatures(null)).toEqual([])
  })

  it('the route asks the public list and answers GeoJSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const app = Fastify()
    await app.register(registerSatelliteMapRoute, { prefix: '/api/v1/map' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/map/satellite-maps' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, source: 'Copernicus Emergency Management Service (© European Union)', type: 'FeatureCollection' })
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(CEMS_URL)
    vi.unstubAllGlobals()
    await app.close()
  })
})
