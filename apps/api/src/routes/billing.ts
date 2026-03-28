import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { getStripe, PRO_PRICE_ID, WEBHOOK_SECRET, getPlanLimits } from '../lib/stripe'
import type { Plan } from '../lib/stripe'

// ─── Plan catalogue ──────────────────────────────────────────────────────────

const FREE_FEATURES = [
  '60 API requests / minute',
  '7-day signal history',
  'Up to 3 alert subscriptions',
  'Global live feed',
  'Public map access',
  'Community access',
]

const PRO_FEATURES = [
  '600 API requests / minute',
  '90-day signal history',
  'Unlimited alert subscriptions',
  '5 webhook endpoints',
  'Priority support',
  'Early access to beta features',
  'Advanced analytics',
  'RSS & OPML export',
]

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const CheckoutBody = z.object({
  plan:       z.literal('pro'),
  successUrl: z.string().url(),
  cancelUrl:  z.string().url(),
})

// ─── Helper: subscription row → API shape ────────────────────────────────────

function formatSubscription(row: Record<string, unknown> | undefined) {
  if (!row) return { plan: 'free' as Plan, status: 'active' }
  return {
    plan:               row.plan as Plan,
    status:             row.status as string,
    currentPeriodEnd:   row.current_period_end ?? null,
    cancelAtPeriodEnd:  row.cancel_at_period_end ?? false,
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const registerBillingRoutes: FastifyPluginAsync = async (app) => {

  // ── GET /plans ─────────────────────────────────────────────────────────────
  app.get('/plans', {
    schema: {
      tags: ['billing'],
      summary: 'List available plans',
      response: {
        200: {
          type: 'object',
          properties: {
            plans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:       { type: 'string' },
                  name:     { type: 'string' },
                  price:    { type: 'number' },
                  currency: { type: 'string' },
                  interval: { type: 'string', nullable: true },
                  features: { type: 'array', items: { type: 'string' } },
                  limits: {
                    type: 'object',
                    properties: {
                      requestsPerMinute: { type: 'number' },
                      historyDays:       { type: 'number' },
                      maxAlerts:         { type: 'number' },
                      maxWebhooks:       { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    return reply.send({
      plans: [
        {
          id:       'free',
          name:     'Free',
          price:    0,
          currency: 'usd',
          interval: null,
          features: FREE_FEATURES,
          limits:   getPlanLimits('free'),
        },
        {
          id:       'pro',
          name:     'Pro',
          price:    1200,
          currency: 'usd',
          interval: 'month',
          features: PRO_FEATURES,
          limits:   getPlanLimits('pro'),
        },
      ],
    })
  })

  // ── POST /checkout ─────────────────────────────────────────────────────────
  app.post('/checkout', {
    preHandler: [authenticate],
    schema: {
      tags: ['billing'],
      summary: 'Create Stripe checkout session for Pro upgrade',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const body = CheckoutBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body' })
    }

    let stripe
    try {
      stripe = getStripe()
    } catch {
      return reply.status(503).send({ error: 'Billing not configured' })
    }

    const userId = req.user.id
    const user   = await db('users').where('id', userId).first(['id', 'email', 'display_name'])
    if (!user) return reply.status(401).send({ error: 'User not found' })

    // Look up or create Stripe customer
    let existingSub = await db('subscriptions').where('user_id', userId).first()
    let customerId: string

    if (existingSub?.stripe_customer_id) {
      customerId = existingSub.stripe_customer_id
    } else {
      const customer = await stripe.customers.create({
        email: user.email as string,
        name:  user.display_name as string | undefined,
        metadata: { worldpulse_user_id: userId },
      })
      customerId = customer.id

      // Upsert subscription row with customer id
      if (existingSub) {
        await db('subscriptions').where('user_id', userId).update({
          stripe_customer_id: customerId,
          updated_at:         new Date(),
        })
      } else {
        await db('subscriptions').insert({
          user_id:            userId,
          stripe_customer_id: customerId,
          plan:               'free',
          status:             'active',
        })
      }
    }

    if (!PRO_PRICE_ID) {
      return reply.status(503).send({ error: 'Billing not configured — price ID missing' })
    }

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer:             customerId,
      line_items:           [{ price: PRO_PRICE_ID, quantity: 1 }],
      success_url:          body.data.successUrl,
      cancel_url:           body.data.cancelUrl,
      allow_promotion_codes: true,
    })

    return reply.send({ url: session.url })
  })

  // ── GET /subscription ──────────────────────────────────────────────────────
  app.get('/subscription', {
    preHandler: [authenticate],
    schema: {
      tags: ['billing'],
      summary: 'Get current subscription status',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const row = await db('subscriptions').where('user_id', req.user.id).first()
    return reply.send(formatSubscription(row))
  })

  // ── POST /cancel ───────────────────────────────────────────────────────────
  app.post('/cancel', {
    preHandler: [authenticate],
    schema: {
      tags: ['billing'],
      summary: 'Cancel Pro subscription at period end',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    let stripe
    try {
      stripe = getStripe()
    } catch {
      return reply.status(503).send({ error: 'Billing not configured' })
    }

    const row = await db('subscriptions').where('user_id', req.user.id).first()
    if (!row?.stripe_subscription_id) {
      return reply.status(404).send({ error: 'No active subscription found' })
    }

    await stripe.subscriptions.update(row.stripe_subscription_id as string, {
      cancel_at_period_end: true,
    })

    await db('subscriptions').where('user_id', req.user.id).update({
      cancel_at_period_end: true,
      updated_at:           new Date(),
    })

    return reply.send({ success: true, cancelAtPeriodEnd: true })
  })

  // ── POST /webhook ──────────────────────────────────────────────────────────
  // Raw body required for Stripe signature verification.
  // TODO: register @fastify/raw-body in index.ts to enable signature verification.
  app.post('/webhook', {
    config: { rawBody: true },
    schema: {
      tags: ['billing'],
      summary: 'Stripe webhook receiver',
    },
  }, async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string | undefined

    // Attempt signature verification when rawBody is available
    const rawBodyReq = req as FastifyRequest & { rawBody?: string | Buffer }
    const rawBody    = rawBodyReq.rawBody

    let event: import('stripe').default.Event

    if (rawBody && sig && WEBHOOK_SECRET) {
      let stripe
      try {
        stripe = getStripe()
      } catch {
        return reply.status(503).send({ error: 'Billing not configured' })
      }
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)
      } catch {
        return reply.status(400).send({ error: 'Invalid signature' })
      }
    } else {
      // rawBody not available — parse body as event directly (dev/no-secret mode)
      if (WEBHOOK_SECRET && sig) {
        // Secret configured but rawBody unavailable — reject for safety
        app.log.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET is set but rawBody is unavailable — install @fastify/raw-body')
        return reply.status(400).send({ error: 'Webhook signature verification unavailable' })
      }
      event = req.body as import('stripe').default.Event
    }

    await handleWebhookEvent(event, app.log)

    return reply.send({ received: true })
  })
}

// ─── Webhook event handler ───────────────────────────────────────────────────

async function handleWebhookEvent(
  event: import('stripe').default.Event,
  log: { info: (msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub  = event.data.object as import('stripe').default.Subscription
        const plan = resolvePlan(sub)
        await db('subscriptions')
          .where('stripe_customer_id', sub.customer as string)
          .update({
            stripe_subscription_id: sub.id,
            stripe_price_id:        sub.items.data[0]?.price.id ?? null,
            plan,
            status:                 sub.status,
            current_period_start:   new Date((sub.items.data[0]?.current_period_start ?? 0) * 1000),
            current_period_end:     new Date((sub.items.data[0]?.current_period_end   ?? 0) * 1000),
            cancel_at_period_end:   sub.cancel_at_period_end,
            updated_at:             new Date(),
          })
        // Sync plan on users table
        await db('subscriptions')
          .where('stripe_customer_id', sub.customer as string)
          .first(['user_id'])
          .then(async (row: { user_id: string } | undefined) => {
            if (row?.user_id) {
              await db('users').where('id', row.user_id).update({ subscription_plan: plan })
            }
          })
        log.info(`Stripe webhook: ${event.type} — plan=${plan}`)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as import('stripe').default.Subscription
        await db('subscriptions')
          .where('stripe_customer_id', sub.customer as string)
          .update({ plan: 'free', status: 'canceled', updated_at: new Date() })
        await db('subscriptions')
          .where('stripe_customer_id', sub.customer as string)
          .first(['user_id'])
          .then(async (row: { user_id: string } | undefined) => {
            if (row?.user_id) {
              await db('users').where('id', row.user_id).update({ subscription_plan: 'free' })
            }
          })
        log.info('Stripe webhook: subscription deleted — reverted to free')
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as import('stripe').default.Invoice
        await db('subscriptions')
          .where('stripe_customer_id', inv.customer as string)
          .update({ status: 'past_due', updated_at: new Date() })
        log.info('Stripe webhook: invoice.payment_failed — status=past_due')
        break
      }

      default:
        // Unhandled events are safe to ignore
        break
    }
  } catch (err) {
    log.warn({ err }, 'Stripe webhook handler error')
  }
}

// Derive 'free' | 'pro' from a Stripe Subscription object
function resolvePlan(sub: import('stripe').default.Subscription): 'free' | 'pro' {
  const priceId = sub.items.data[0]?.price.id ?? ''
  if (priceId === PRO_PRICE_ID && PRO_PRICE_ID !== '') return 'pro'
  // Also check metadata or nickname as fallback
  const nickname = (sub.items.data[0]?.price.nickname ?? '').toLowerCase()
  return nickname.includes('pro') ? 'pro' : 'free'
}
