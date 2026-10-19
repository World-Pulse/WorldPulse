/**
 * GET /api/v1/aircraft/live — military aircraft and emergency squawks now,
 * from adsb.lol (ODbL 1.0), for the map's Aircraft layer (Oct 19, 2026;
 * lib/aircraft.ts).
 */

import type { FastifyPluginAsync } from 'fastify'
import { liveAircraft } from '../lib/aircraft'

export const AIRCRAFT_RATE_LIMIT_RPM = 60

export const registerAircraftRoutes: FastifyPluginAsync = async (app) => {
  app.get('/live', {
    config: { rateLimit: { max: AIRCRAFT_RATE_LIMIT_RPM, timeWindow: '1 minute' } },
    schema: {
      tags: ['aircraft'],
      summary: 'Military aircraft and emergency squawks now',
      description: 'Positions from adsb.lol (data under the ODbL 1.0: credit "adsb.lol"), read at most every 3 minutes. Aircraft in privacy programmes (PIA, LADD) are left out.',
    },
  }, async (req, reply) => {
    const snap = await liveAircraft().catch(err => { req.log.warn({ err }, '[aircraft] read failed'); return null })
    void reply.header('Cache-Control', 'public, max-age=60')
    if (!snap) {
      return reply.send({ at: null, source: 'adsb.lol', license: 'ODbL 1.0', aircraft: [], counts: { military: 0, emergency: 0 }, failed: ['all'] })
    }
    return reply.send(snap)
  })
}
