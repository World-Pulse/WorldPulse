import { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { logger } from '../lib/logger'

// ── Constants ────────────────────────────────────────────────────────────────

const WIND_CACHE_KEY = 'wind:grid:latest'
const WIND_CACHE_TTL = 6 * 60 * 60 // 6 hours in seconds
const GRID_WIDTH = 256
const GRID_HEIGHT = 128

// GFS 1° wind data from NOAA — we use the GFS analysis (0-hour forecast)
// The NOMADS JSON API provides GRIB2 data; we fetch pre-processed wind vectors
const GFS_BASE_URL = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl'

// ── Types ────────────────────────────────────────────────────────────────────

interface WindGridResponse {
  width: number
  height: number
  uMin: number
  uMax: number
  vMin: number
  vMax: number
  /** Base64-encoded Float32Array of interleaved [u, v] pairs, row-major, top-to-bottom */
  data: string
  fetchedAt: string
  source: 'noaa_gfs' | 'fallback'
}

// ── Fallback Wind Grid Generator ─────────────────────────────────────────────
// Produces a realistic-looking synthetic wind field when NOAA is unavailable.
// Uses simplified atmospheric circulation patterns (trade winds, westerlies, etc.)

function generateFallbackGrid(): { data: Float32Array; uMin: number; uMax: number; vMin: number; vMax: number } {
  const size = GRID_WIDTH * GRID_HEIGHT * 2 // interleaved u, v
  const data = new Float32Array(size)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity

  for (let y = 0; y < GRID_HEIGHT; y++) {
    // Latitude: +90 (top) to -90 (bottom)
    const lat = 90 - (y / GRID_HEIGHT) * 180
    const latRad = (lat * Math.PI) / 180

    for (let x = 0; x < GRID_WIDTH; x++) {
      // Longitude: -180 (left) to +180 (right)
      const lon = -180 + (x / GRID_WIDTH) * 360
      const lonRad = (lon * Math.PI) / 180
      const idx = (y * GRID_WIDTH + x) * 2

      // Simplified atmospheric circulation model
      let u = 0, v = 0

      // Trade winds (0-30° both hemispheres): easterly
      if (Math.abs(lat) < 30) {
        u = -8 * Math.cos(latRad * 3) // easterly trade winds
        v = -3 * Math.sin(latRad * 6) * (lat > 0 ? 1 : -1) // slight poleward flow
      }
      // Westerlies (30-60°): strong westerly
      else if (Math.abs(lat) < 60) {
        const factor = Math.sin(((Math.abs(lat) - 30) / 30) * Math.PI)
        u = 12 * factor // westerly
        v = 4 * Math.sin(lonRad * 3 + latRad * 2) // meandering jet stream pattern
      }
      // Polar easterlies (60-90°)
      else {
        u = -5 * Math.cos(latRad) // weak easterly
        v = -2 * Math.sin(lonRad * 2) // slight equatorward
      }

      // Add mesoscale variability (wave patterns)
      u += 3 * Math.sin(lonRad * 5 + latRad * 3) * Math.cos(latRad * 2)
      v += 2 * Math.cos(lonRad * 4 - latRad * 2) * Math.sin(latRad * 3)

      // Add monsoon-like patterns over continents
      // South/SE Asia monsoon region (60-120E, 0-30N)
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

// ── Fetch Real Wind Data ─────────────────────────────────────────────────────

async function fetchWindGrid(): Promise<WindGridResponse> {
  // Check Redis cache first
  try {
    const cached = await redis.get(WIND_CACHE_KEY)
    if (cached) {
      return JSON.parse(cached)
    }
  } catch (e) {
    logger.warn({ err: e }, 'Wind grid cache read failed')
  }

  // Try fetching from NOAA GFS
  let response: WindGridResponse
  try {
    // Get latest GFS run timestamp
    const now = new Date()
    const utcHour = now.getUTCHours()
    // GFS runs at 00, 06, 12, 18 UTC — use most recent completed run (~4h delay)
    const runHour = Math.floor((utcHour - 4) / 6) * 6
    const adjustedRunHour = runHour < 0 ? runHour + 24 : runHour
    const runDate = new Date(now)
    if (runHour < 0) runDate.setUTCDate(runDate.getUTCDate() - 1)
    const dateStr = runDate.toISOString().slice(0, 10).replace(/-/g, '')
    const hourStr = String(adjustedRunHour).padStart(2, '0')

    const url = `${GFS_BASE_URL}?file=gfs.t${hourStr}z.pgrb2.1p00.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&subregion=&leftlon=0&rightlon=360&toplat=90&bottomlat=-90&dir=%2Fgfs.${dateStr}%2F${hourStr}%2Fatmos`

    logger.info({ url: url.slice(0, 120) }, 'Fetching GFS wind data')

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'WorldPulse/1.0 (wind-grid; contact@world-pulse.io)' },
    })

    if (!res.ok) {
      throw new Error(`NOAA GFS HTTP ${res.status}`)
    }

    // NOAA returns GRIB2 binary — for simplicity, we'll use the fallback grid
    // and cache it. A production implementation would parse GRIB2 with a library.
    // TODO: Add GRIB2 parsing when wgrib2 or eccodes is available in Docker image
    logger.info('NOAA GFS responded but GRIB2 parsing not yet implemented — using enhanced fallback')
    throw new Error('GRIB2_PARSE_NOT_IMPLEMENTED')
  } catch (err) {
    logger.warn({ err }, 'NOAA fetch failed, generating fallback wind grid')

    // Generate realistic fallback
    const { data, uMin, uMax, vMin, vMax } = generateFallbackGrid()

    // Encode as base64 for JSON transport
    const buffer = Buffer.from(data.buffer)
    const b64 = buffer.toString('base64')

    response = {
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      uMin, uMax, vMin, vMax,
      data: b64,
      fetchedAt: new Date().toISOString(),
      source: 'fallback',
    }
  }

  // Cache in Redis
  try {
    await redis.set(WIND_CACHE_KEY, JSON.stringify(response), 'EX', WIND_CACHE_TTL)
  } catch (e) {
    logger.warn({ err: e }, 'Wind grid cache write failed')
  }

  return response
}

// ── Route Registration ───────────────────────────────────────────────────────

export const registerWindRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/v1/wind/grid — returns wind vector field for particle animation
  app.get('/api/v1/wind/grid', {
    schema: {
      description: 'Get global wind vector grid (256×128) for particle flow animation',
      tags: ['wind'],
      response: {
        200: {
          type: 'object',
          properties: {
            width:     { type: 'number' },
            height:    { type: 'number' },
            uMin:      { type: 'number' },
            uMax:      { type: 'number' },
            vMin:      { type: 'number' },
            vMax:      { type: 'number' },
            data:      { type: 'string' },
            fetchedAt: { type: 'string' },
            source:    { type: 'string' },
          },
        },
      },
    },
  }, async (_req, reply) => {
    try {
      const grid = await fetchWindGrid()
      reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200')
      return grid
    } catch (err) {
      logger.error({ err }, 'Wind grid endpoint error')
      reply.status(500).send({ error: 'Failed to fetch wind data' })
    }
  })
}
