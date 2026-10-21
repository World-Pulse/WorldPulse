/**
 * POST /api/v1/pro/waitlist {email, source?} — "Pro coming soon": join the
 * list to hear once when Pro opens (plan 13; Devon, Oct 21, 2026: "Waitlist
 * now, price later"). The answer is the same whether or not the address was
 * already on the list, so nobody can learn who signed up.
 */

import type { FastifyPluginAsync } from 'fastify'
import { cleanEmail, cleanSource, joinWaitlist, waitlistReady } from '../lib/pro-waitlist'
import { sendError } from '../lib/errors'

export const registerProWaitlistRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email?: unknown; source?: unknown } }>('/waitlist', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['pro'],
      summary: 'Join the Pro waitlist: one email when Pro opens, nothing else',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', maxLength: 254 }, source: { type: 'string', maxLength: 80 } },
      },
    },
  }, async (req, reply) => {
    const email = cleanEmail(req.body?.email)
    if (!email) return sendError(reply, 400, 'VALIDATION_ERROR', 'That doesn\'t look like an email address.')
    if (!waitlistReady()) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The waitlist is starting up. Please try again in a minute.')
    try {
      await joinWaitlist(email, cleanSource(req.body?.source))
    } catch (err) {
      req.log.warn({ err }, 'pro waitlist insert failed')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Couldn\'t add you just now. Please try again in a minute.')
    }
    return reply.send({ success: true, message: 'You\'re on the list. We\'ll email you once, when Pro opens.' })
  })
}
