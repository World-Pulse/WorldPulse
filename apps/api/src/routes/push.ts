/**
 * Push alerts on readers' own devices (lib/web-push.ts, lib/push-scan.ts;
 * Devon, Oct 31, 2026, 11:11 PM: "Yes"). No account: a browser that turns
 * alerts on sends its push subscription, and its push address is how it
 * finds, changes or ends that subscription again (only that browser knows it,
 * so it is always sent in a POST body, never in an address).
 *
 *   GET  /api/v1/push/key          the server's public key (applicationServerKey)
 *   POST /api/v1/push/subscribe    { subscription, breaking, countries } → what it now gets
 *   POST /api/v1/push/status       { endpoint } → whether it is on, and for what
 *   POST /api/v1/push/unsubscribe  { endpoint }
 */

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { logger } from '../lib/logger'
import { sendError } from '../lib/errors'
import { isPushEndpoint, validKeys, vapidKeys, sendPush } from '../lib/web-push'
import { welcomeMessage, pushReady, PUSHES_A_DAY } from '../lib/push-scan'

/** Countries a browser may follow at most */
export const MAX_PUSH_COUNTRIES = 30

const Endpoint = z.string().max(1024).refine(isPushEndpoint, 'not a push service address')

const SubscribeSchema = z.object({
  subscription: z.object({
    endpoint: Endpoint,
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  }),
  breaking: z.boolean().default(true),
  countries: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(MAX_PUSH_COUNTRIES).default([]),
})

const EndpointSchema = z.object({ endpoint: Endpoint })

const LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } }

/** Until the subscriptions table is known to exist (lib/push-scan.ts ensurePushTable, at start) */
const NOT_READY = 'Alerts are being switched on. Please try again in a minute.'

/** A country's name for the welcome message, in English */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export const registerPushRoutes: FastifyPluginAsync = async (app) => {
  app.get('/key', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600')
    return reply.send({ success: true, data: { publicKey: vapidKeys().publicKeyB64, perDay: PUSHES_A_DAY } })
  })

  app.post('/subscribe', { config: LIMIT }, async (req, reply) => {
    if (!pushReady()) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', NOT_READY)
    const parsed = SubscribeSchema.safeParse(req.body)
    if (!parsed.success || !validKeys(parsed.data.subscription.keys.p256dh, parsed.data.subscription.keys.auth)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'This browser’s subscription isn’t one we can send to')
    }
    const { subscription, breaking } = parsed.data
    const countries = [...new Set(parsed.data.countries.map(c => c.toUpperCase()))].sort()
    const { endpoint, keys } = subscription

    // Nothing asked for: the same as turning alerts off
    if (!breaking && countries.length === 0) {
      await db('web_push_subscriptions').where('endpoint', endpoint).delete()
      return reply.send({ success: true, data: { subscribed: false, breaking: false, countries: [] } })
    }

    const existing = await db('web_push_subscriptions').where('endpoint', endpoint).first()
    if (existing) {
      await db('web_push_subscriptions').where('id', existing.id).update({
        p256dh: keys.p256dh, auth: keys.auth, breaking, countries, fail_count: 0, updated_at: db.fn.now(),
      })
    } else {
      await db('web_push_subscriptions').insert({ endpoint, p256dh: keys.p256dh, auth: keys.auth, breaking, countries })
      // A first message right away, so the reader sees alerts work (not waited on)
      void sendPush({ endpoint, p256dh: keys.p256dh, auth: keys.auth },
        welcomeMessage(breaking, countries.map(countryName)), { ttl: 3600, urgency: 'normal' })
        .then(({ result, status }) => { if (result !== 'sent') logger.info({ result, status }, 'Push: welcome not delivered') })
        .catch(err => logger.warn({ err }, 'Push: welcome failed'))
    }
    return reply.status(existing ? 200 : 201).send({ success: true, data: { subscribed: true, breaking, countries } })
  })

  app.post('/status', { config: LIMIT }, async (req, reply) => {
    if (!pushReady()) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', NOT_READY)
    const parsed = EndpointSchema.safeParse(req.body)
    if (!parsed.success) return reply.send({ success: true, data: { subscribed: false, breaking: false, countries: [] } })
    const row = await db('web_push_subscriptions').where('endpoint', parsed.data.endpoint).select('breaking', 'countries').first()
    return reply.send({
      success: true,
      data: row
        ? { subscribed: true, breaking: !!row.breaking, countries: Array.isArray(row.countries) ? row.countries : [] }
        : { subscribed: false, breaking: false, countries: [] },
    })
  })

  app.post('/unsubscribe', { config: LIMIT }, async (req, reply) => {
    if (!pushReady()) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', NOT_READY)
    const parsed = EndpointSchema.safeParse(req.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Not a push subscription')
    await db('web_push_subscriptions').where('endpoint', parsed.data.endpoint).delete()
    return reply.send({ success: true, data: { subscribed: false, breaking: false, countries: [] } })
  })
}
