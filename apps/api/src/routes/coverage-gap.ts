/**
 * GET /api/v1/coverage-gap: the under-reported crises (lib/coverage-gap.ts).
 * Without week, the last 7 days; with week, a finished ISO week (2026-W42),
 * Monday to Monday, UTC. Public, like the stories: no sign-in or key.
 */
import type { FastifyPluginAsync } from 'fastify'
import { sendError } from '../lib/errors'
import { isoWeekOf, parseWeek, weekBounds, weekName, type IsoWeek } from '../lib/week'
import { keptCoverageGap, MIN_DISPLACED } from '../lib/coverage-gap'

export const registerCoverageGapRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    schema: {
      tags: ['stories'],
      summary: 'Under-reported crises (the coverage gap)',
      description: `The countries UNHCR counts at least ${MIN_DISPLACED.toLocaleString('en-US')} people displaced from, inside the country or abroad, each with the news outlets (websites) WorldPulse placed in it, ranked by people displaced per outlet: the most people for the fewest outlets first, after any crisis no outlet covered. Without week, the last 7 days; or a finished ISO week such as 2026-W42. Displacement figures: UNHCR Refugee Data Finder, CC BY 4.0.`,
      querystring: {
        type: 'object',
        properties: { week: { type: 'string', description: 'A finished ISO week, e.g. 2026-W42' } },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const asked = (req.query as { week?: string }).week
    let week: IsoWeek | null = null
    if (asked) {
      week = parseWeek(asked)
      if (!week) return sendError(reply, 400, 'VALIDATION_ERROR', 'week must be an ISO week like 2026-W42')
      const now = new Date()
      if (weekBounds(week).start.getTime() > now.getTime()) return sendError(reply, 404, 'NOT_FOUND', 'That week has not started yet')
      if (weekName(week) === weekName(isoWeekOf(now))) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'That week is not over yet: leave out week for the last 7 days')
      }
    }
    const data = await keptCoverageGap(week)
    if (!data) {
      // A finished week nobody has asked for yet: being made in the background
      reply.header('retry-after', '120')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'This week is being put together; try again in a couple of minutes')
    }
    return reply.send({ success: true, data })
  })
}
