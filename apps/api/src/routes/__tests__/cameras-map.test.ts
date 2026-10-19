/**
 * GET /api/v1/cameras as the map uses it (Oct 19, 2026): every camera at
 * once, by where it is, without the ones whose picture failed lately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const kept = vi.hoisted(() => ({ dir: null as string | null, dead: {} as Record<string, string> }))

vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => (key === 'cameras:directory:v2' ? kept.dir : null)),
    set: vi.fn(async () => 'OK'),
    hgetall: vi.fn(async () => kept.dead),
    hdel: vi.fn(async () => 1),
  },
}))

import { CAMERAS_CACHE_TTL, CAMERAS_DEFAULT_LIMIT, CAMERAS_MAX_LIMIT, CAMERAS_RATE_LIMIT_RPM, camerasCacheKey } from '../cameras'
import { fetchPublicCameras, cameraSources, resetCameraMemo, type CameraEntry } from '../../lib/ip-cameras'

const cam = (id: string, lat: number, lng: number): CameraEntry => ({
  id, name: id, region: 'x', country: 'X', countryCode: 'XX', city: 'Somewhere', lat, lng,
  snapshotUrl: `https://api.world-pulse.io/api/v1/cameras/${encodeURIComponent(id)}/image`, embedUrl: 'https://example.org/',
  sourceName: 'Source', type: 'traffic', isLive: true, image: `https://example.org/${id}.jpg`,
})

describe('GET /cameras for the map', () => {
  beforeEach(() => {
    resetCameraMemo()
    kept.dir = JSON.stringify({ at: Date.now(), cameras: [
      cam('tfl:1', 51.5, -0.12), cam('tfl:2', 51.6, -0.1), cam('nyc:1', 40.78, -73.97), cam('hk:1', 22.25, 114.15), cam('nz:1', -43.9, 171.7),
    ] })
    kept.dead = {}
  })

  it('global: every camera, one city after another', async () => {
    const cams = await fetchPublicCameras('global', 5000)
    expect(cams.map(c => c.id)).toEqual(['tfl:1', 'nyc:1', 'hk:1', 'nz:1', 'tfl:2'])
    expect(cams.every(c => !('image' in c))).toBe(true)
  })

  it('a region is where the cameras are', async () => {
    expect((await fetchPublicCameras('europe', 50)).map(c => c.id)).toEqual(['tfl:1', 'tfl:2'])
    expect((await fetchPublicCameras('asia', 50)).map(c => c.id)).toEqual(['hk:1'])
    expect((await fetchPublicCameras('oceania', 50)).map(c => c.id)).toEqual(['nz:1'])
    expect(await fetchPublicCameras('atlantis', 50)).toEqual([])
  })

  it('a camera whose picture failed lately is left out until its hour is up', async () => {
    kept.dead = { 'tfl:1': String(Date.now() + 60_000), 'nyc:1': String(Date.now() - 60_000) }
    expect((await fetchPublicCameras('global', 50)).map(c => c.id)).toEqual(['tfl:2', 'nyc:1', 'hk:1', 'nz:1'])
  })

  it('respects the limit', async () => {
    expect(await fetchPublicCameras('global', 2)).toHaveLength(2)
  })

  it('counts each source\'s cameras for the credits', async () => {
    const sources = await cameraSources()
    expect(Object.fromEntries(sources.map(s => [s.key, s.count]))).toEqual({ tfl: 2, nyc: 1, hk: 1, nz: 1 })
  })

  it('route constants', () => {
    expect(CAMERAS_CACHE_TTL).toBe(60)
    expect(CAMERAS_RATE_LIMIT_RPM).toBe(30)
    expect(CAMERAS_DEFAULT_LIMIT).toBe(20)
    expect(CAMERAS_MAX_LIMIT).toBe(6000)
    expect(camerasCacheKey('global', undefined, 6000)).toBe('cameras:v2:global:all:6000')
  })
})
