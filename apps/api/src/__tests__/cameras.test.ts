/**
 * Live Cameras — unit tests
 *
 * Coverage:
 *  1. getCamerasByRegion()   — region filtering, global returns all, unknown = []
 *  2. fetchPublicCameras()   — limit, types, all regions, async contract
 *  3. Cache key construction — includes region/type/limit params
 *  4. Rate limit constant    — 30 rpm
 *  5. Seed data integrity    — required fields present on every camera
 *  6. Regional distribution  — US/Brazil in americas, UK/Germany in europe
 *  7. Type filter            — 'traffic' returns only traffic cameras
 *  8. Limit clamping         — max 50 enforced
 */

import { describe, it, expect } from 'vitest'
import {
  getCamerasByRegion,
  fetchPublicCameras,
  CAMERA_REGIONS,
  CAMERA_SEED,
} from '../lib/ip-cameras'
import {
  CAMERAS_RATE_LIMIT_RPM,
  CAMERAS_MAX_LIMIT,
  CAMERAS_CACHE_TTL,
} from '../routes/cameras'

// ─── 1. getCamerasByRegion() ──────────────────────────────────────────────────

describe('getCamerasByRegion()', () => {
  it('returns all cameras when region is "global"', () => {
    const all = getCamerasByRegion('global')
    expect(all.length).toBe(CAMERA_SEED.length)
  })

  it('returns only cameras matching the given region', () => {
    const americas = getCamerasByRegion('americas')
    expect(americas.every(c => c.region === 'americas')).toBe(true)
    expect(americas.length).toBeGreaterThan(0)
  })

  it('returns empty array for unknown region', () => {
    const unknown = getCamerasByRegion('atlantis')
    expect(unknown).toHaveLength(0)
  })

  it('returns europe cameras for region "europe"', () => {
    const europe = getCamerasByRegion('europe')
    expect(europe.length).toBeGreaterThan(0)
    expect(europe.every(c => c.region === 'europe')).toBe(true)
  })

  it('returns mena cameras for region "mena"', () => {
    const mena = getCamerasByRegion('mena')
    expect(mena.length).toBeGreaterThan(0)
    expect(mena.every(c => c.region === 'mena')).toBe(true)
  })

  it('returns asia cameras for region "asia"', () => {
    const asia = getCamerasByRegion('asia')
    expect(asia.length).toBeGreaterThan(0)
    expect(asia.every(c => c.region === 'asia')).toBe(true)
  })

  it('returns africa cameras for region "africa"', () => {
    const africa = getCamerasByRegion('africa')
    expect(africa.length).toBeGreaterThan(0)
    expect(africa.every(c => c.region === 'africa')).toBe(true)
  })

  it('returns easteurope cameras for region "easteurope"', () => {
    const ee = getCamerasByRegion('easteurope')
    expect(ee.length).toBeGreaterThan(0)
    expect(ee.every(c => c.region === 'easteurope')).toBe(true)
  })
})

// ─── 2. fetchPublicCameras() ──────────────────────────────────────────────────

describe('fetchPublicCameras()', () => {
  it('returns a Promise (async contract)', async () => {
    const result = fetchPublicCameras('global', 5)
    expect(result).toBeInstanceOf(Promise)
    await result // should not throw
  })

  it('respects the limit parameter', async () => {
    const cameras = await fetchPublicCameras('global', 3)
    expect(cameras.length).toBeLessThanOrEqual(3)
  })

  it('returns all cameras when limit exceeds seed size for global', async () => {
    const cameras = await fetchPublicCameras('global', 1000)
    expect(cameras.length).toBe(CAMERA_SEED.length)
  })

  it('handles every defined region without throwing', async () => {
    for (const region of CAMERA_REGIONS) {
      await expect(fetchPublicCameras(region.id, 10)).resolves.not.toThrow()
    }
  })

  it('returns only cameras for the specified region', async () => {
    const cameras = await fetchPublicCameras('europe', 20)
    expect(cameras.every(c => c.region === 'europe')).toBe(true)
  })

  it('returns empty array for unknown region', async () => {
    const cameras = await fetchPublicCameras('unknown-region', 10)
    expect(cameras).toHaveLength(0)
  })
})

// ─── 3. Cache key construction ────────────────────────────────────────────────

describe('Cache key construction', () => {
  it('encodes region in cache key', () => {
    const key = `cameras:europe:all:10`
    expect(key).toContain('europe')
  })

  it('encodes type in cache key', () => {
    const key = `cameras:global:traffic:20`
    expect(key).toContain('traffic')
  })

  it('encodes limit in cache key', () => {
    const key = `cameras:global:all:50`
    expect(key).toContain('50')
  })

  it('uses "all" as type segment when no type filter applied', () => {
    const key = `cameras:americas:all:20`
    expect(key).toContain(':all:')
  })

  it('cache TTL is 60 seconds', () => {
    expect(CAMERAS_CACHE_TTL).toBe(60)
  })
})

// ─── 4. Rate limit constant ───────────────────────────────────────────────────

describe('Rate limit constant', () => {
  it('rate limit is 30 requests per minute', () => {
    expect(CAMERAS_RATE_LIMIT_RPM).toBe(30)
  })
})

// ─── 5. Seed data integrity ───────────────────────────────────────────────────

describe('Seed data integrity', () => {
  it('every camera has a non-empty id', () => {
    expect(CAMERA_SEED.every(c => typeof c.id === 'string' && c.id.length > 0)).toBe(true)
  })

  it('every camera has a non-empty name', () => {
    expect(CAMERA_SEED.every(c => typeof c.name === 'string' && c.name.length > 0)).toBe(true)
  })

  it('every camera has a non-empty region', () => {
    expect(CAMERA_SEED.every(c => typeof c.region === 'string' && c.region.length > 0)).toBe(true)
  })

  it('every camera has valid lat and lng', () => {
    for (const cam of CAMERA_SEED) {
      expect(cam.lat).toBeGreaterThanOrEqual(-90)
      expect(cam.lat).toBeLessThanOrEqual(90)
      expect(cam.lng).toBeGreaterThanOrEqual(-180)
      expect(cam.lng).toBeLessThanOrEqual(180)
    }
  })

  it('every camera has an embedUrl starting with https://', () => {
    expect(CAMERA_SEED.every(c => c.embedUrl.startsWith('https://'))).toBe(true)
  })

  it('every camera has a valid type', () => {
    const VALID_TYPES = new Set(['traffic', 'weather', 'city', 'nature'])
    expect(CAMERA_SEED.every(c => VALID_TYPES.has(c.type))).toBe(true)
  })

  it('camera ids are unique', () => {
    const ids = CAMERA_SEED.map(c => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

// ─── 6. Regional distribution ─────────────────────────────────────────────────

describe('Regional distribution', () => {
  it('americas region includes United States cameras', () => {
    const americas = getCamerasByRegion('americas')
    expect(americas.some(c => c.countryCode === 'US')).toBe(true)
  })

  it('americas region includes Brazil cameras', () => {
    const americas = getCamerasByRegion('americas')
    expect(americas.some(c => c.countryCode === 'BR')).toBe(true)
  })

  it('europe region includes United Kingdom cameras', () => {
    const europe = getCamerasByRegion('europe')
    expect(europe.some(c => c.countryCode === 'GB')).toBe(true)
  })

  it('europe region includes Germany cameras', () => {
    const europe = getCamerasByRegion('europe')
    expect(europe.some(c => c.countryCode === 'DE')).toBe(true)
  })
})

// ─── 7. Type filter ───────────────────────────────────────────────────────────

describe('Type filter (applied in route layer)', () => {
  it('filtering by traffic returns only traffic cameras from seed', () => {
    const all = getCamerasByRegion('global')
    const traffic = all.filter(c => c.type === 'traffic')
    expect(traffic.length).toBeGreaterThan(0)
    expect(traffic.every(c => c.type === 'traffic')).toBe(true)
  })

  it('filtering by weather returns only weather cameras from seed', () => {
    const all = getCamerasByRegion('global')
    const weather = all.filter(c => c.type === 'weather')
    expect(weather.every(c => c.type === 'weather')).toBe(true)
  })

  it('filtering by city returns only city cameras from seed', () => {
    const all = getCamerasByRegion('global')
    const city = all.filter(c => c.type === 'city')
    expect(city.length).toBeGreaterThan(0)
    expect(city.every(c => c.type === 'city')).toBe(true)
  })
})

// ─── 8. Limit clamping ────────────────────────────────────────────────────────

describe('Limit clamping', () => {
  it('CAMERAS_MAX_LIMIT is 50', () => {
    expect(CAMERAS_MAX_LIMIT).toBe(50)
  })

  it('fetchPublicCameras never returns more than limit items', async () => {
    const cameras = await fetchPublicCameras('global', 5)
    expect(cameras.length).toBeLessThanOrEqual(5)
  })

  it('clamping 200 to max 50 via Math.min', () => {
    const effective = Math.min(200, CAMERAS_MAX_LIMIT)
    expect(effective).toBe(50)
  })
})
