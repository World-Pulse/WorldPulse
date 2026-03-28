/**
 * GET /api/v1/cameras — Public IP camera / webcam feed listing
 *
 * Live public CCTV/webcam viewer with region & type filtering.
 * Redis cache: 60 s TTL.  Rate limit: 30 rpm.
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { fetchPublicCameras, CAMERA_REGIONS, type CameraType } from '../lib/ip-cameras'

export const CAMERAS_RATE_LIMIT_RPM = 30
export const CAMERAS_CACHE_TTL = 60   // seconds
export const CAMERAS_MAX_LIMIT = 50
export const CAMERAS_DEFAULT_LIMIT = 20

const VALID_TYPES = new Set<string>(['traffic', 'weather', 'city', 'nature'])

interface CamerasQuery {
  region?: string
  limit?: number
  type?: string
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
        'Returns a curated list of publicly accessible webcam/CCTV embed URLs.',
        'Sources include EarthCam, Windy.com webcams, and public traffic department feeds.',
        'No API key required.  Responses are cached for 60 seconds.',
      ].join('\n'),
      querystring: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            enum: ['global', 'americas', 'europe', 'mena', 'asia', 'africa', 'oceania', 'easteurope'],
            default: 'global',
            description: 'Geographic region filter.  "global" returns all cameras.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: CAMERAS_MAX_LIMIT,
            default: CAMERAS_DEFAULT_LIMIT,
            description: `Max cameras to return (1–${CAMERAS_MAX_LIMIT}).`,
          },
          type: {
            type: 'string',
            enum: ['traffic', 'weather', 'city', 'nature'],
            description: 'Camera type filter.  Omit to return all types.',
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
                required: ['id', 'name', 'region', 'country', 'countryCode', 'lat', 'lng', 'embedUrl', 'type', 'isLive'],
                properties: {
                  id:          { type: 'string' },
                  name:        { type: 'string' },
                  region:      { type: 'string' },
                  country:     { type: 'string' },
                  countryCode: { type: 'string' },
                  lat:         { type: 'number' },
                  lng:         { type: 'number' },
                  embedUrl:    { type: 'string' },
                  snapshotUrl: { type: ['string', 'null'] },
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
    const limit  = Math.min(Number(req.query.limit ?? CAMERAS_DEFAULT_LIMIT), CAMERAS_MAX_LIMIT)
    const type   = (req.query.type && VALID_TYPES.has(req.query.type))
      ? (req.query.type as CameraType)
      : undefined

    const cacheKey = `cameras:${region}:${type ?? 'all'}:${limit}`

    // ── Cache hit ─────────────────────────────────────────────────────────────
    const cached = await redis.get(cacheKey)
    if (cached) {
      void reply.header('X-Cache', 'HIT')
      return reply.send(JSON.parse(cached) as unknown)
    }

    // ── Fetch + filter ────────────────────────────────────────────────────────
    let cameras = await fetchPublicCameras(region, CAMERAS_MAX_LIMIT)
    if (type) cameras = cameras.filter(c => c.type === type)
    const page = cameras.slice(0, limit)

    const payload = {
      cameras: page,
      total:   page.length,
      region,
      regions: CAMERA_REGIONS.map(r => ({ id: r.id, label: r.label })),
    }

    await redis.setex(cacheKey, CAMERAS_CACHE_TTL, JSON.stringify(payload))
    void reply.header('X-Cache', 'MISS')
    return reply.send(payload)
  })
}
