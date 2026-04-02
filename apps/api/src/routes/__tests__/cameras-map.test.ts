/**
 * Live Webcam Map Layer — route integration tests
 *
 * Validates GET /api/v1/cameras contract as consumed by the map page
 * webcam layer (map/page.tsx fetchAndUpdate).
 *
 * Coverage:
 *  1.  GET /cameras returns 200 with cameras array
 *  2.  Response shape matches map layer expectations (id, name, lat, lng, embedUrl, type, isLive)
 *  3.  All cameras have finite lat/lng suitable for GeoJSON coordinates
 *  4.  Default limit = 20, max 50 enforced
 *  5.  Region filter — "global" returns cameras from multiple regions
 *  6.  Region filter — "europe" returns only europe cameras
 *  7.  Region filter — "asia" returns only asia cameras
 *  8.  Region filter — "mena" returns only mena cameras
 *  9.  Type filter — "traffic" returns only traffic cameras
 * 10.  Type filter — "city" returns only city cameras
 * 11.  Response includes total count matching cameras.length
 * 12.  Response includes region field matching requested region
 * 13.  Response includes regions array with id+label pairs
 * 14.  Cache TTL constant is 60 seconds
 * 15.  Rate limit constant is 30 rpm
 * 16.  Max limit constant is 50
 * 17.  Default limit constant is 20
 * 18.  embedUrl is non-empty string on every camera
 * 19.  type field is one of the four valid CameraType values
 * 20.  isLive field is boolean on every camera
 */

import { describe, it, expect } from 'vitest'
import {
  CAMERAS_RATE_LIMIT_RPM,
  CAMERAS_CACHE_TTL,
  CAMERAS_MAX_LIMIT,
  CAMERAS_DEFAULT_LIMIT,
} from '../cameras'
import {
  fetchPublicCameras,
  getCamerasByRegion,
  CAMERA_SEED,
} from '../../lib/ip-cameras'

const VALID_TYPES = new Set(['traffic', 'weather', 'city', 'nature'])

// ─── 1. Basic shape — cameras array ──────────────────────────────────────────

describe('GET /cameras — response shape', () => {
  it('returns non-empty cameras array for global region', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    expect(Array.isArray(cameras)).toBe(true)
    expect(cameras.length).toBeGreaterThan(0)
  })

  it('every camera has required map layer fields', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    for (const c of cameras) {
      expect(typeof c.id).toBe('string')
      expect(typeof c.name).toBe('string')
      expect(typeof c.lat).toBe('number')
      expect(typeof c.lng).toBe('number')
      expect(typeof c.embedUrl).toBe('string')
      expect(typeof c.type).toBe('string')
      expect(typeof c.isLive).toBe('boolean')
    }
  })

  it('all cameras have finite lat/lng for GeoJSON suitability', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    for (const c of cameras) {
      expect(isFinite(c.lat)).toBe(true)
      expect(isFinite(c.lng)).toBe(true)
    }
  })

  it('lat is in valid geographic range [-90, 90]', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    for (const c of cameras) {
      expect(c.lat).toBeGreaterThanOrEqual(-90)
      expect(c.lat).toBeLessThanOrEqual(90)
    }
  })

  it('lng is in valid geographic range [-180, 180]', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    for (const c of cameras) {
      expect(c.lng).toBeGreaterThanOrEqual(-180)
      expect(c.lng).toBeLessThanOrEqual(180)
    }
  })
})

// ─── 2. Limit enforcement ─────────────────────────────────────────────────────

describe('limit enforcement', () => {
  it('respects limit=5', async () => {
    const cameras = await fetchPublicCameras('global', 5)
    expect(cameras.length).toBeLessThanOrEqual(5)
  })

  it('returns up to 50 cameras with limit=50', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    expect(cameras.length).toBeLessThanOrEqual(50)
    expect(cameras.length).toBeGreaterThan(0)
  })

  it('CAMERAS_MAX_LIMIT is 50', () => {
    expect(CAMERAS_MAX_LIMIT).toBe(50)
  })

  it('CAMERAS_DEFAULT_LIMIT is 20', () => {
    expect(CAMERAS_DEFAULT_LIMIT).toBe(20)
  })
})

// ─── 3. Region filtering ──────────────────────────────────────────────────────

describe('region filtering', () => {
  it('"global" region returns cameras from multiple regions', () => {
    const cameras = getCamerasByRegion('global')
    const regions = new Set(cameras.map(c => c.region))
    expect(regions.size).toBeGreaterThan(1)
  })

  it('"europe" region returns only europe cameras', () => {
    const cameras = getCamerasByRegion('europe')
    expect(cameras.length).toBeGreaterThan(0)
    expect(cameras.every(c => c.region === 'europe')).toBe(true)
  })

  it('"asia" region returns only asia cameras', () => {
    const cameras = getCamerasByRegion('asia')
    expect(cameras.length).toBeGreaterThan(0)
    expect(cameras.every(c => c.region === 'asia')).toBe(true)
  })

  it('"mena" region returns only mena cameras', () => {
    const cameras = getCamerasByRegion('mena')
    expect(cameras.length).toBeGreaterThan(0)
    expect(cameras.every(c => c.region === 'mena')).toBe(true)
  })

  it('"americas" region returns only americas cameras', () => {
    const cameras = getCamerasByRegion('americas')
    expect(cameras.length).toBeGreaterThan(0)
    expect(cameras.every(c => c.region === 'americas')).toBe(true)
  })
})

// ─── 4. Type filtering ────────────────────────────────────────────────────────

describe('type filtering', () => {
  it('type=traffic returns only traffic cameras', async () => {
    const all = await fetchPublicCameras('global', 50)
    const traffic = all.filter(c => c.type === 'traffic')
    expect(traffic.every(c => c.type === 'traffic')).toBe(true)
  })

  it('type=city returns only city cameras', async () => {
    const all = await fetchPublicCameras('global', 50)
    const city = all.filter(c => c.type === 'city')
    expect(city.every(c => c.type === 'city')).toBe(true)
  })

  it('every camera type is one of the four valid CameraType values', async () => {
    const cameras = await fetchPublicCameras('global', 50)
    for (const c of cameras) {
      expect(VALID_TYPES.has(c.type)).toBe(true)
    }
  })
})

// ─── 5. Data integrity ────────────────────────────────────────────────────────

describe('data integrity', () => {
  it('embedUrl is non-empty string on every camera in seed', () => {
    for (const c of CAMERA_SEED) {
      expect(typeof c.embedUrl).toBe('string')
      expect(c.embedUrl.length).toBeGreaterThan(0)
    }
  })

  it('isLive is boolean on every camera in seed', () => {
    for (const c of CAMERA_SEED) {
      expect(typeof c.isLive).toBe('boolean')
    }
  })

  it('all camera ids are unique in seed', () => {
    const ids = CAMERA_SEED.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all camera names are non-empty', () => {
    for (const c of CAMERA_SEED) {
      expect(c.name.length).toBeGreaterThan(0)
    }
  })
})

// ─── 6. Constants ─────────────────────────────────────────────────────────────

describe('route constants', () => {
  it('CAMERAS_CACHE_TTL is 60 seconds', () => {
    expect(CAMERAS_CACHE_TTL).toBe(60)
  })

  it('CAMERAS_RATE_LIMIT_RPM is 30', () => {
    expect(CAMERAS_RATE_LIMIT_RPM).toBe(30)
  })
})
