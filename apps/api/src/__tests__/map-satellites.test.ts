/**
 * The Satellites layer's API (plan M53, Oct 21, 2026): CelesTrak's
 * three-line element sets read, each satellite once, a group that doesn't
 * answer left out without failing the others.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/redis', () => ({ redis: {} }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: (_k: string, _o: unknown, make: () => Promise<unknown>) => make() }))

import Fastify from 'fastify'
import { parseTle, mergeGroups, registerMapSatelliteRoutes, SATELLITE_GROUPS } from '../routes/map/satellites'

const ISS = [
  'ISS (ZARYA)             ',
  '1 25544U 98067A   26294.04791053  .00009575  00000+0  18188-3 0  9996',
  '2 25544  51.6327  37.2623 0006759 289.5321  70.4938 15.48967427591263',
]
const GPS = [
  'GPS BIIR-5  (PRN 22)    ',
  '1 26407U 00040A   26294.05710803 -.00000015  00000+0  00000+0 0  9995',
  '2 26407  54.8302 210.1681 0116263 304.6186 141.5204  2.00558710192477',
]

describe('parseTle', () => {
  it('reads name and two lines per satellite', () => {
    const list = parseTle([...ISS, ...GPS].join('\r\n') + '\r\n', 'gnss')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ name: 'ISS (ZARYA)', norad: 25544, group: 'gnss' })
    expect(list[1].tle2.startsWith('2 26407')).toBe(true)
  })

  it('skips what isn\'t an element set and keeps reading', () => {
    expect(parseTle(['<html>busy</html>', ...ISS].join('\n'), 'stations').map(s => s.norad)).toEqual([25544])
    expect(parseTle('', 'stations')).toEqual([])
    expect(parseTle('No GP data found', 'stations')).toEqual([])
  })
})

describe('mergeGroups', () => {
  it('lists each satellite once, in the first group that has it', () => {
    const a = parseTle(ISS.join('\n'), 'stations')
    const b = parseTle([...ISS, ...GPS].join('\n'), 'gnss')
    expect(mergeGroups([a, b]).map(s => `${s.norad}:${s.group}`)).toEqual(['25544:stations', '26407:gnss'])
  })
})

describe('GET /api/v1/map/satellites', () => {
  it('answers every group that answered, and says how many each has', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const group = new URL(url).searchParams.get('GROUP')
      if (group === 'military') return new Response('busy', { status: 503 })
      if (group === 'stations') return new Response(ISS.join('\n'))
      if (group === 'gnss') return new Response(GPS.join('\n'))
      return new Response('')
    })
    vi.stubGlobal('fetch', fetchMock)
    const app = Fastify()
    await app.register(registerMapSatelliteRoutes, { prefix: '/api/v1/map' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/map/satellites' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.count).toBe(2)
    expect(body.groups).toEqual({ stations: 1, gnss: 1, weather: 0, resource: 0, military: 0 })
    expect(body.satellites.map((s: { norad: number }) => s.norad)).toEqual([25544, 26407])
    expect(fetchMock).toHaveBeenCalledTimes(SATELLITE_GROUPS.length)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    vi.unstubAllGlobals()
  })
})
