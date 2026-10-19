/**
 * GET /api/v1/cameras — live public cameras (lib/ip-cameras.ts)
 * GET /api/v1/cameras/:id/image — a camera's current picture
 *
 * Oct 19, 2026: the cameras come from public road-camera services (London,
 * New York, Los Angeles, the Bay Area, Finland, Hong Kong, New Zealand), and
 * their pictures come through this API, so a camera that fails is hidden
 * instead of sending readers to a page that shows nothing. The map asks for
 * every camera at once (limit up to 6,000) and groups them by city.
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import {
  CAMERA_ID,
  CAMERA_REGIONS,
  PICTURE_CACHE_S,
  cameraPicture,
  cameraSources,
  fetchPublicCameras,
  type CameraType,
} from '../lib/ip-cameras'

export const CAMERAS_RATE_LIMIT_RPM = 30
export const CAMERAS_CACHE_TTL = 60   // seconds
export const CAMERAS_MAX_LIMIT = 6000
export const CAMERAS_DEFAULT_LIMIT = 20
/** Pictures: the cameras page shows up to 50, refreshed every 30 seconds */
export const CAMERA_PICTURE_RATE_LIMIT_RPM = 240

const VALID_TYPES = new Set<string>(['traffic', 'weather', 'city', 'nature'])

interface CamerasQuery {
  region?: string
  limit?: number
  type?: string
}

export function camerasCacheKey(region: string, type: string | undefined, limit: number): string {
  return `cameras:v2:${region}:${type ?? 'all'}:${limit}`
}

export const registerCameraRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/v1/cameras ────────────────────────────────────────────────────
  app.get<{ Querystring: CamerasQuery }>('/', {
    config: {
      rateLimit: {
        max: CAMERAS_RATE_LIMIT_RPM,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags: ['cameras'],
      summary: 'List public live cameras',
      description: [
        'Live road and weather cameras from public services (Transport for London, NYC DOT, Caltrans,',
        'Fintraffic, the Hong Kong Transport Department and the NZ Transport Agency).',
        'Each camera\'s current picture is at snapshotUrl (GET /api/v1/cameras/:id/image).',
        'Cameras whose source marks them offline, or whose picture failed lately, are left out.',
        'Responses are cached for 60 seconds.',
      ].join('\n'),
      querystring: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            enum: ['global', 'americas', 'europe', 'mena', 'asia', 'africa', 'oceania', 'easteurope'],
            default: 'global',
            description: 'Geographic region filter, by where the camera is. "global" returns all cameras.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: CAMERAS_MAX_LIMIT,
            default: CAMERAS_DEFAULT_LIMIT,
            description: `Max cameras to return (1–${CAMERAS_MAX_LIMIT}), one city after another.`,
          },
          type: {
            type: 'string',
            enum: ['traffic', 'weather', 'city', 'nature'],
            description: 'Camera type filter. Omit to return all types.',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            cameras: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'region', 'country', 'countryCode', 'lat', 'lng', 'snapshotUrl', 'embedUrl', 'type', 'isLive'],
                properties: {
                  id:          { type: 'string' },
                  name:        { type: 'string' },
                  region:      { type: 'string' },
                  country:     { type: 'string' },
                  countryCode: { type: 'string' },
                  city:        { type: 'string' },
                  lat:         { type: 'number' },
                  lng:         { type: 'number' },
                  snapshotUrl: { type: 'string' },
                  embedUrl:    { type: 'string' },
                  sourceName:  { type: 'string' },
                  type:        { type: 'string', enum: ['traffic', 'weather', 'city', 'nature'] },
                  isLive:      { type: 'boolean' },
                },
              },
            },
            total:   { type: 'integer' },
            region:  { type: 'string' },
            regions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:    { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key:   { type: 'string' },
                  name:  { type: 'string' },
                  page:  { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
        429: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const region = req.query.region ?? 'global'
    try {
      const limit = Math.min(Number(req.query.limit ?? CAMERAS_DEFAULT_LIMIT), CAMERAS_MAX_LIMIT)
      const type  = (req.query.type && VALID_TYPES.has(req.query.type))
        ? (req.query.type as CameraType)
        : undefined

      const cacheKey = camerasCacheKey(region, type, limit)

      // ── Cache hit ─────────────────────────────────────────────────────────────
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) {
        void reply.header('X-Cache', 'HIT')
        return reply.send(JSON.parse(cached) as unknown)
      }

      // ── Fetch + filter ────────────────────────────────────────────────────────
      const [cameras, sources] = await Promise.all([fetchPublicCameras(region, limit, type), cameraSources()])

      const payload = {
        cameras,
        total:   cameras.length,
        region,
        regions: CAMERA_REGIONS.map(r => ({ id: r.id, label: r.label })),
        sources,
      }

      // (an empty answer isn't kept: the sources may just be slow on a cold start)
      if (cameras.length > 0) await redis.setex(cacheKey, CAMERAS_CACHE_TTL, JSON.stringify(payload)).catch(() => {})
      void reply.header('X-Cache', 'MISS')
      return reply.send(payload)
    } catch (err) {
      req.log.error({ err }, '[cameras] Handler error')
      return reply.send({
        cameras: [],
        total: 0,
        region,
        regions: CAMERA_REGIONS.map(r => ({ id: r.id, label: r.label })),
        sources: [],
      })
    }
  })

  // ── GET /api/v1/cameras/:id/image ──────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/image', {
    config: {
      rateLimit: {
        max: CAMERA_PICTURE_RATE_LIMIT_RPM,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags: ['cameras'],
      summary: "A live camera's current picture",
      description: 'The JPEG (or PNG) the camera\'s source published last, kept for a minute. X-Picture-Time says when the source took it, when it says. 404 when the camera has no picture right now.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', maxLength: 100 } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params
    const pic = CAMERA_ID.test(id) ? await cameraPicture(id).catch(() => null) : null
    if (!pic) {
      return reply.code(404).header('Cache-Control', 'public, max-age=60').send({
        success: false, error: 'NOT_FOUND', message: 'This camera has no picture right now',
      })
    }
    void reply
      .header('Content-Type', pic.type)
      .header('Cache-Control', `public, max-age=${PICTURE_CACHE_S}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Access-Control-Expose-Headers', 'X-Picture-Time')
    if (pic.at) void reply.header('X-Picture-Time', pic.at).header('Last-Modified', new Date(pic.at).toUTCString())
    return reply.send(pic.body)
  })
}
