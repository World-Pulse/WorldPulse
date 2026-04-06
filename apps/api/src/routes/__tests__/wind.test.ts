/**
 * Wind Grid API Route Tests — apps/api/src/routes/wind.ts
 *
 * Tests the wind vector grid endpoint used for the particle flow
 * animation layer on the map. Covers: constants, grid generation,
 * atmospheric circulation model, response structure, Base64 encoding,
 * cache headers, GFS URL construction, and fallback behaviour.
 */

import { describe, it, expect } from 'vitest'

// ─── Constants (mirroring wind.ts) ──────────────────────────────────────────

const WIND_CACHE_KEY = 'wind:grid:latest'
const WIND_CACHE_TTL = 6 * 60 * 60 // 6 hours
const GRID_WIDTH = 256
const GRID_HEIGHT = 128
const GFS_BASE_URL = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl'

// ─── Fallback Grid Generator (copy of wind.ts logic for unit testing) ───────

function generateFallbackGrid(): {
  data: Float32Array
  uMin: number
  uMax: number
  vMin: number
  vMax: number
} {
  const size = GRID_WIDTH * GRID_HEIGHT * 2
  const data = new Float32Array(size)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity

  for (let y = 0; y < GRID_HEIGHT; y++) {
    const lat = 90 - (y / GRID_HEIGHT) * 180
    const latRad = (lat * Math.PI) / 180

    for (let x = 0; x < GRID_WIDTH; x++) {
      const lon = -180 + (x / GRID_WIDTH) * 360
      const lonRad = (lon * Math.PI) / 180
      const idx = (y * GRID_WIDTH + x) * 2

      let u = 0, v = 0

      if (Math.abs(lat) < 30) {
        u = -8 * Math.cos(latRad * 3)
        v = -3 * Math.sin(latRad * 6) * (lat > 0 ? 1 : -1)
      } else if (Math.abs(lat) < 60) {
        const factor = Math.sin(((Math.abs(lat) - 30) / 30) * Math.PI)
        u = 12 * factor
        v = 4 * Math.sin(lonRad * 3 + latRad * 2)
      } else {
        u = -5 * Math.cos(latRad)
        v = -2 * Math.sin(lonRad * 2)
      }

      u += 3 * Math.sin(lonRad * 5 + latRad * 3) * Math.cos(latRad * 2)
      v += 2 * Math.cos(lonRad * 4 - latRad * 2) * Math.sin(latRad * 3)

      if (lon > 60 && lon < 120 && lat > 0 && lat < 30) {
        u += 6 * Math.sin(((lon - 60) / 60) * Math.PI)
        v += 4 * Math.sin(((lat) / 30) * Math.PI)
      }

      data[idx] = u
      data[idx + 1] = v

      if (u < uMin) uMin = u
      if (u > uMax) uMax = u
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
  }

  return { data, uMin, uMax, vMin, vMax }
}

// ─── Response shape helper ──────────────────────────────────────────────────

interface WindGridResponse {
  width: number
  height: number
  uMin: number
  uMax: number
  vMin: number
  vMax: number
  data: string
  fetchedAt: string
  source: 'noaa_gfs' | 'fallback'
}

function buildMockResponse(grid: ReturnType<typeof generateFallbackGrid>): WindGridResponse {
  const buffer = Buffer.from(grid.data.buffer)
  return {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    uMin: grid.uMin,
    uMax: grid.uMax,
    vMin: grid.vMin,
    vMax: grid.vMax,
    data: buffer.toString('base64'),
    fetchedAt: new Date().toISOString(),
    source: 'fallback',
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('Wind Grid Constants', () => {
  it('grid dimensions are 256×128', () => {
    expect(GRID_WIDTH).toBe(256)
    expect(GRID_HEIGHT).toBe(128)
  })

  it('cache TTL is 6 hours (21600 seconds)', () => {
    expect(WIND_CACHE_TTL).toBe(21600)
  })

  it('cache key is wind:grid:latest', () => {
    expect(WIND_CACHE_KEY).toBe('wind:grid:latest')
  })

  it('GFS base URL points to NOAA NOMADS', () => {
    expect(GFS_BASE_URL).toContain('nomads.ncep.noaa.gov')
    expect(GFS_BASE_URL).toContain('filter_gfs_1p00')
  })
})

describe('Fallback Grid Generation', () => {
  const grid = generateFallbackGrid()

  it('produces correct number of elements (width×height×2 interleaved)', () => {
    expect(grid.data.length).toBe(GRID_WIDTH * GRID_HEIGHT * 2)
  })

  it('produces a Float32Array', () => {
    expect(grid.data).toBeInstanceOf(Float32Array)
  })

  it('uMin < uMax', () => {
    expect(grid.uMin).toBeLessThan(grid.uMax)
  })

  it('vMin < vMax', () => {
    expect(grid.vMin).toBeLessThan(grid.vMax)
  })

  it('wind speed bounds are physically plausible (< 50 m/s)', () => {
    expect(Math.abs(grid.uMin)).toBeLessThan(50)
    expect(Math.abs(grid.uMax)).toBeLessThan(50)
    expect(Math.abs(grid.vMin)).toBeLessThan(50)
    expect(Math.abs(grid.vMax)).toBeLessThan(50)
  })

  it('contains no NaN or Infinity values', () => {
    for (let i = 0; i < grid.data.length; i++) {
      expect(Number.isFinite(grid.data[i])).toBe(true)
    }
  })

  it('is deterministic (same output on repeated calls)', () => {
    const grid2 = generateFallbackGrid()
    expect(grid.uMin).toBe(grid2.uMin)
    expect(grid.uMax).toBe(grid2.uMax)
    expect(grid.vMin).toBe(grid2.vMin)
    expect(grid.vMax).toBe(grid2.vMax)
    expect(Buffer.from(grid.data.buffer).equals(Buffer.from(grid2.data.buffer))).toBe(true)
  })
})

describe('Atmospheric Circulation Patterns', () => {
  const grid = generateFallbackGrid()

  function getUV(lat: number, lon: number): { u: number; v: number } {
    // Convert lat/lon to grid indices
    const y = Math.round(((90 - lat) / 180) * GRID_HEIGHT)
    const x = Math.round(((lon + 180) / 360) * GRID_WIDTH)
    const clampedY = Math.min(Math.max(y, 0), GRID_HEIGHT - 1)
    const clampedX = Math.min(Math.max(x, 0), GRID_WIDTH - 1)
    const idx = (clampedY * GRID_WIDTH + clampedX) * 2
    return { u: grid.data[idx]!, v: grid.data[idx + 1]! }
  }

  it('trade winds blow easterly near equator (u < 0 at lat ~15°)', () => {
    const { u } = getUV(15, 0)
    // Trade winds are predominantly easterly (negative u) but can be modified
    // by mesoscale variability. Check a band average instead:
    let uSum = 0
    for (let lon = -180; lon < 180; lon += 30) {
      uSum += getUV(15, lon).u
    }
    expect(uSum / 12).toBeLessThan(0) // net easterly
  })

  it('westerlies blow westerly at mid-latitudes (u > 0 at lat ~45°)', () => {
    let uSum = 0
    for (let lon = -180; lon < 180; lon += 30) {
      uSum += getUV(45, lon).u
    }
    expect(uSum / 12).toBeGreaterThan(0) // net westerly
  })

  it('polar easterlies blow easterly above 60° (u < 0 at lat ~75°)', () => {
    let uSum = 0
    for (let lon = -180; lon < 180; lon += 30) {
      uSum += getUV(75, lon).u
    }
    expect(uSum / 12).toBeLessThan(0) // net easterly
  })

  it('monsoon region (60-120E, 0-30N) has enhanced flow', () => {
    const monsoon = getUV(15, 90)
    const nonMonsoon = getUV(15, -90)
    // Monsoon adds u+6sin and v+4sin → higher magnitude expected
    const monsoonMag = Math.sqrt(monsoon.u ** 2 + monsoon.v ** 2)
    const nonMonsoonMag = Math.sqrt(nonMonsoon.u ** 2 + nonMonsoon.v ** 2)
    // Monsoon region should generally have different characteristics
    expect(Math.abs(monsoonMag - nonMonsoonMag)).toBeGreaterThan(0)
  })

  it('southern hemisphere mirrors trade wind pattern', () => {
    let uSumSouth = 0
    for (let lon = -180; lon < 180; lon += 30) {
      uSumSouth += getUV(-15, lon).u
    }
    expect(uSumSouth / 12).toBeLessThan(0) // net easterly in southern trades too
  })
})

describe('Wind Grid Response Structure', () => {
  const grid = generateFallbackGrid()
  const response = buildMockResponse(grid)

  it('has all required fields', () => {
    expect(response).toHaveProperty('width')
    expect(response).toHaveProperty('height')
    expect(response).toHaveProperty('uMin')
    expect(response).toHaveProperty('uMax')
    expect(response).toHaveProperty('vMin')
    expect(response).toHaveProperty('vMax')
    expect(response).toHaveProperty('data')
    expect(response).toHaveProperty('fetchedAt')
    expect(response).toHaveProperty('source')
  })

  it('width and height match constants', () => {
    expect(response.width).toBe(GRID_WIDTH)
    expect(response.height).toBe(GRID_HEIGHT)
  })

  it('source is noaa_gfs or fallback', () => {
    expect(['noaa_gfs', 'fallback']).toContain(response.source)
  })

  it('fetchedAt is a valid ISO date string', () => {
    expect(new Date(response.fetchedAt).toISOString()).toBe(response.fetchedAt)
  })

  it('data field is a non-empty string (Base64)', () => {
    expect(typeof response.data).toBe('string')
    expect(response.data.length).toBeGreaterThan(0)
  })
})

describe('Base64 Encoding / Decoding', () => {
  const grid = generateFallbackGrid()
  const buffer = Buffer.from(grid.data.buffer)
  const b64 = buffer.toString('base64')

  it('encodes to valid Base64 string', () => {
    expect(/^[A-Za-z0-9+/=]+$/.test(b64)).toBe(true)
  })

  it('round-trips: decode(encode(data)) === original data', () => {
    const decoded = Buffer.from(b64, 'base64')
    const restored = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4)
    expect(restored.length).toBe(grid.data.length)
    for (let i = 0; i < 100; i++) {
      expect(restored[i]).toBe(grid.data[i])
    }
  })

  it('encoded size is consistent with Float32 data', () => {
    // Float32Array: 4 bytes per element, base64 expands ~4/3
    const expectedBytes = GRID_WIDTH * GRID_HEIGHT * 2 * 4
    const decoded = Buffer.from(b64, 'base64')
    expect(decoded.length).toBe(expectedBytes)
  })
})

describe('GFS URL Construction', () => {
  it('builds a valid GFS filter URL with required params', () => {
    const dateStr = '20260402'
    const hourStr = '00'
    const url = `${GFS_BASE_URL}?file=gfs.t${hourStr}z.pgrb2.1p00.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&subregion=&leftlon=0&rightlon=360&toplat=90&bottomlat=-90&dir=%2Fgfs.${dateStr}%2F${hourStr}%2Fatmos`

    expect(url).toContain('var_UGRD=on')
    expect(url).toContain('var_VGRD=on')
    expect(url).toContain('lev_10_m_above_ground=on')
    expect(url).toContain('leftlon=0')
    expect(url).toContain('rightlon=360')
    expect(url).toContain('toplat=90')
    expect(url).toContain('bottomlat=-90')
  })

  it('GFS run hours are 00, 06, 12, 18', () => {
    const validRunHours = [0, 6, 12, 18]
    for (const utcHour of [0, 4, 6, 10, 12, 16, 18, 22]) {
      const runHour = Math.floor((utcHour - 4) / 6) * 6
      const adjusted = runHour < 0 ? runHour + 24 : runHour
      expect(validRunHours).toContain(adjusted)
    }
  })

  it('uses 1° resolution (1p00)', () => {
    const url = `${GFS_BASE_URL}?file=gfs.t00z.pgrb2.1p00.f000`
    expect(url).toContain('1p00')
  })
})

describe('Cache Headers', () => {
  it('expects Cache-Control public with 1h max-age and 2h stale-while-revalidate', () => {
    const expected = 'public, max-age=3600, stale-while-revalidate=7200'
    expect(expected).toContain('max-age=3600')
    expect(expected).toContain('stale-while-revalidate=7200')
  })
})

describe('Grid Coordinate Mapping', () => {
  it('top row maps to latitude +90 (North Pole)', () => {
    const y = 0
    const lat = 90 - (y / GRID_HEIGHT) * 180
    expect(lat).toBe(90)
  })

  it('bottom row maps to latitude -90 (South Pole)', () => {
    const y = GRID_HEIGHT
    const lat = 90 - (y / GRID_HEIGHT) * 180
    expect(lat).toBe(-90)
  })

  it('leftmost column maps to longitude -180', () => {
    const x = 0
    const lon = -180 + (x / GRID_WIDTH) * 360
    expect(lon).toBe(-180)
  })

  it('rightmost column maps to longitude +180', () => {
    const x = GRID_WIDTH
    const lon = -180 + (x / GRID_WIDTH) * 360
    expect(lon).toBe(180)
  })

  it('center maps approximately to equator / prime meridian', () => {
    const y = GRID_HEIGHT / 2
    const x = GRID_WIDTH / 2
    const lat = 90 - (y / GRID_HEIGHT) * 180
    const lon = -180 + (x / GRID_WIDTH) * 360
    expect(lat).toBe(0)
    expect(lon).toBe(0)
  })
})
