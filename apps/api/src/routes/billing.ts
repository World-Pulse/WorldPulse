import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { getStripe, WEBHOOK_SECRET, getPlanLimits, billingMode, mayCheckout, proLineItem, planOf, PRO_PRICE } from '../lib/stripe'
import type { Plan } from '../lib/stripe'
import { sendError } from '../lib/errors'

// ─── Plan catalogue (Devon, Oct 21, 2026, 8:10 PM) ───────────────────────────
// What each plan gets, as the code does it. Until Oct 21 Pro listed 90-day
// history, unlimited alerts, analytics and exports that nothing enforced or
// built (departments/revenue/pricing-review-2026-10-20.md).

const FREE_FEATURES = [
  'The live feed, the World Map and all its layers',
  'Verified stories with how many outlets reported each',
  'The public API, RSS feeds and the MCP server, with no key',
  'Up to 200 API requests a minute (some endpoints allow fewer)',
  'Alerts on the people, places and topics you follow',
  'Up to 10 webhooks',
  'Personal, research, education and non-profit use, with a link back',
]

const PRO_FEATURES = [
  'Everything in Free',
  'A Pro API key with its own budget: 600 requests a minute, 50,000 a day',
  'Commercial use of the API and data, with a link back',
  'Priority support by email',
]

/** Where Stripe sends the reader back: the site's pricing page */
const SITE_URL = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

/** A return address on this site only (Stripe sends the reader there after paying) */
function onSite(url: string | undefined, fallback: string): string {
  if (!url) return fallback
  try {
    return new URL(url).origin === new URL(SITE_URL).origin ? url : fallback
  } catch {
    return fallback
  }
}

/** Statuses of a subscription that is still running: a second checkout would charge twice */
const RUNNING = new Set(['active', 'trialing', 'past_due', 'incomplete'])

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const CheckoutBody = z.object({
  plan:       z.literal('pro'),
  successUrl: z.string().url().optional(),
  cancelUrl:  z.string().url().optional(),
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
      description: 'Free and Pro ($12 a month), what each includes, and whether checkout is open: "live", "test" (Stripe test mode: the team only) or "off".',
      response: {
        200: {
          type: 'object',
          properties: {
            checkout: { type: 'string', enum: ['live', 'test', 'off'] },
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
                      requestsPerDay:    { type: 'number', nullable: true },
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
      checkout: billingMode(),
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
          price:    PRO_PRICE.cents,
          currency: PRO_PRICE.currency,
          interval: PRO_PRICE.interval,
          features: PRO_FEATURES,
          limits:   getPlanLimits('pro'),
        },
      ],
    })
  })

  // ── POST /checkout ─────────────────────────────────────────────────────────
  // $12 a month (lib/stripe.ts). In Stripe's test mode only admins and
  // BILLING_TEST_EMAILS may check out. The reader comes back to /pricing.
  app.post('/checkout', {
    preHandler: [authenticate],
    schema: {
      tags: ['billing'],
      summary: 'Create Stripe checkout session for Pro upgrade',
      description: 'Pro at $12 a month. Answers { url } to send the reader to Stripe; 409 when the account already has Pro; 403 while checkout is in test mode.',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const body = CheckoutBody.safeParse(req.body)
    if (!body.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid request body')
    }

    let stripe
    try {
      stripe = getStripe()
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Billing not configured')
    }

    const userId = req.user.id
    const user   = await db('users').where('id', userId).first(['id', 'email', 'display_name', 'account_type'])
    if (!user) return sendError(reply, 401, 'UNAUTHORIZED', 'User not found')
    if (!mayCheckout({ accountType: user.account_type as string, email: user.email as string })) {
      return sendError(reply, 403, 'FORBIDDEN', 'Pro checkout is being tested and is not open yet. Join the waitlist on world-pulse.io/pricing to hear when it opens.')
    }

    // Look up or create Stripe customer
    const existingSub = await db('subscriptions').where('user_id', userId).first()
    if (existingSub?.plan === 'pro' && RUNNING.has(String(existingSub.status))) {
      return sendError(reply, 409, 'CONFLICT', "You're already on Pro: manage it from world-pulse.io/pricing.")
    }

    // A customer saved in another mode (a test customer once the live key is in) or deleted: make a new one
    let customerId: string | null = (existingSub?.stripe_customer_id as string | undefined) ?? null
    if (customerId) {
      try {
        const found = await stripe.customers.retrieve(customerId)
        if ((found as { deleted?: boolean }).deleted) customerId = null
      } catch {
        customerId = null
      }
    }

    if (!customerId) {
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

    const session = await stripe.checkout.sessions.create({
      mode:                  'subscription',
      customer:              customerId,
      client_reference_id:   userId,
      line_items:            [proLineItem()],
      subscription_data:     { metadata: { worldpulse_plan: 'pro', worldpulse_user_id: userId } },
      metadata:              { worldpulse_plan: 'pro', worldpulse_user_id: userId },
      success_url:           onSite(body.data.successUrl, `${SITE_URL}/pricing?checkout=done`),
      cancel_url:            onSite(body.data.cancelUrl, `${SITE_URL}/pricing?checkout=cancelled`),
      allow_promotion_codes: true,
    })

    return reply.send({ url: session.url })
  })

  // ── POST /portal: "Manage subscription" ────────────────────────────────────
  // Stripe's own page for the subscriber: change the card, see invoices,
  // cancel. It must be switched on once in Stripe (Settings → Billing →
  // Customer portal).
  app.post('/portal', {
    preHandler: [authenticate],
    schema: {
      tags: ['billing'],
      summary: 'Open Stripe\'s page to manage the subscription',
      description: 'Answers { url }: Stripe\'s customer portal (card, invoices, cancel), back to /pricing after.',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    let stripe
    try {
      stripe = getStripe()
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Billing not configured')
    }
    const row = await db('subscriptions').where('user_id', req.user.id).first()
    if (!row?.stripe_customer_id) {
      return sendError(reply, 404, 'NOT_FOUND', 'No subscription to manage')
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer:   row.stripe_customer_id as string,
        return_url: `${SITE_URL}/pricing`,
      })
      return reply.send({ url: session.url })
    } catch (err) {
      req.log.warn({ err }, 'billing portal: Stripe refused')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Managing a subscription online is not switched on yet: write to support@world-pulse.io.')
    }
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
    // Whether this account may start a checkout now (in test mode only the team may), for /pricing's button
    const user = await db('users').where('id', req.user.id).first(['email', 'account_type']) as { email?: string; account_type?: string } | undefined
    return reply.send({
      ...formatSubscription(row),
      checkout:    billingMode(),
      canCheckout: mayCheckout({ accountType: user?.account_type ?? req.user.accountType, email: user?.email ?? null }),
    })
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
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Billing not configured')
    }

    const row = await db('subscriptions').where('user_id', req.user.id).first()
    if (!row?.stripe_subscription_id) {
      return sendError(reply, 404, 'NOT_FOUND', 'No active subscription found')
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
  // Raw body captured by @fastify/raw-body (registered in index.ts) for Stripe
  // signature verification via stripe.webhooks.constructEvent.
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
        return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Billing not configured')
      }
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)
      } catch {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid signature')
      }
    } else {
      // Only Stripe-signed events change a plan on the live server: without the
      // signing secret anyone could post "subscription created" and get Pro
      if (!WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
        app.log.warn('Stripe webhook refused: STRIPE_WEBHOOK_SECRET is not set')
        return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Billing webhook not configured')
      }
      // rawBody not available — parse body as event directly (dev/no-secret mode)
      if (WEBHOOK_SECRET) {
        // Secret configured but no signature, or no rawBody to check it against — reject
        if (sig) app.log.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET is set but rawBody is unavailable — install @fastify/raw-body')
        return sendError(reply, 400, 'VALIDATION_ERROR', sig ? 'Webhook signature verification unavailable' : 'Missing Stripe signature')
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
        const plan = planOf(sub as unknown as Parameters<typeof planOf>[0])
        await db('subscriptions')
          .where('stripe_customer_id', sub.customer as string)
          .update({
            stripe_subscription_id: sub.id,
            stripe_price_id:        sub.items.data[0]?.price.id ?? null,
            plan,
            status:                 sub.status,
            current_period_start:   new Date(((sub as unknown as { current_period_start?: number }).current_period_start ?? 0) * 1000),
            current_period_end:     new Date(((sub as unknown as { current_period_end?: number }).current_period_end   ?? 0) * 1000),
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
