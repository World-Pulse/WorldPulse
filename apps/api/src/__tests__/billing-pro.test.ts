/**
 * WorldPulse Pro (Devon, Oct 21, 2026, 8:10 PM): $12 a month, monthly only,
 * checkout in Stripe's test mode first (lib/stripe.ts, routes/billing.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
  process.env.BILLING_TEST_EMAILS = 'Devon@Example.com, other@example.com'
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_PRO_PRICE_ID
  return {
    user: { id: 'u1', email: 'reader@example.com', display_name: 'Reader', account_type: 'community' } as Record<string, unknown>,
    sub: undefined as Record<string, unknown> | undefined,
    updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    sessions: [] as Array<Record<string, unknown>>,
    customers: [] as Array<Record<string, unknown>>,
    retrieveFails: false,
    portalFails: false,
  }
})

vi.mock('stripe', () => {
  const MockStripe = vi.fn(() => ({
    customers: {
      create: vi.fn(async (p: Record<string, unknown>) => { h.customers.push(p); return { id: 'cus_new' } }),
      retrieve: vi.fn(async (id: string) => { if (h.retrieveFails) throw new Error('No such customer'); return { id } }),
    },
    checkout: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { h.sessions.push(p); return { url: 'https://checkout.stripe.com/c/test' } }) } },
    billingPortal: { sessions: { create: vi.fn(async () => { if (h.portalFails) throw new Error('portal off'); return { url: 'https://billing.stripe.com/p/test' } }) } },
    subscriptions: { update: vi.fn(async () => ({})) },
    webhooks: { constructEvent: vi.fn() },
  }))
  return { default: MockStripe }
})

vi.mock('../db/postgres', () => {
  const table = (name: string) => {
    const q = {
      where: () => q,
      first: async () => (name === 'users' ? { ...h.user } : h.sub ? { ...h.sub } : undefined),
      update: async (patch: Record<string, unknown>) => { h.updates.push({ table: name, patch }); return 1 },
      insert: async (row: Record<string, unknown>) => { h.inserts.push({ table: name, row }); return [1] },
    }
    return q
  }
  return { db: vi.fn(table) }
})

vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn(async (req: { user?: unknown }) => {
    ;(req as { user: unknown }).user = { id: 'u1', handle: 'reader', accountType: String(h.user.account_type), trustScore: 50 }
  }),
}))

const lib = await import('../lib/stripe')
const { registerBillingRoutes } = await import('../routes/billing')

async function app() {
  const a = Fastify({ logger: false })
  a.decorateRequest('user', null)
  await a.register(registerBillingRoutes, { prefix: '/api/v1/billing' })
  return a
}

beforeEach(() => {
  h.user = { id: 'u1', email: 'reader@example.com', display_name: 'Reader', account_type: 'community' }
  h.sub = undefined
  h.updates = []; h.inserts = []; h.sessions = []; h.customers = []
  h.retrieveFails = false; h.portalFails = false
})

describe('lib/stripe', () => {
  it('knows test mode, closed, live and off from the key and PRO_CHECKOUT', () => {
    expect(lib.billingMode('sk_test_abc')).toBe('test')
    expect(lib.billingMode('rk_test_abc')).toBe('test')
    // a live key alone keeps checkout closed: real cards only once PRO_CHECKOUT=open
    expect(lib.billingMode('sk_live_abc', '')).toBe('closed')
    expect(lib.billingMode('sk_live_abc', 'open')).toBe('live')
    expect(lib.billingMode('sk_live_abc', ' Open ')).toBe('live')
    expect(lib.billingMode('sk_live_abc', 'yes')).toBe('closed')
    expect(lib.billingMode('', 'open')).toBe('off')
    expect(lib.billingMode()).toBe('test')
  })

  it('a test key beside the live one wins, with its own webhook secret; without it, the live key, closed', async () => {
    const saved = { ...process.env }
    try {
      vi.resetModules()
      Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_live_server', STRIPE_TEST_SECRET_KEY: 'sk_test_devon', STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRO_PRICE_ID: 'price_live' })
      const t = await import('../lib/stripe')
      expect(t.billingMode()).toBe('test')
      expect(t.WEBHOOK_SECRET).toBe('whsec_test')
      expect(t.PRO_PRICE_ID).toBe('') // the live price doesn't exist in test mode: the inline $12
      vi.resetModules()
      delete process.env.STRIPE_TEST_SECRET_KEY
      const l = await import('../lib/stripe')
      expect(l.billingMode()).toBe('closed')
      expect(l.WEBHOOK_SECRET).toBe('whsec_live')
      expect(l.mayCheckout({ accountType: 'admin', email: 'devon@example.com' })).toBe(false)
      vi.resetModules()
      process.env.PRO_CHECKOUT = 'open'
      expect((await import('../lib/stripe')).billingMode()).toBe('live')
    } finally {
      for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_TEST_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TEST_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID', 'PRO_CHECKOUT']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
      }
      vi.resetModules()
    }
  })

  it('in test mode only admins and the listed addresses may check out; live, anyone signed in; off, nobody', () => {
    expect(lib.testBuyers()).toEqual(['devon@example.com', 'other@example.com'])
    expect(lib.mayCheckout({ accountType: 'community', email: 'reader@example.com' }, 'test')).toBe(false)
    expect(lib.mayCheckout({ accountType: 'community', email: ' DEVON@example.com ' }, 'test')).toBe(true)
    expect(lib.mayCheckout({ accountType: 'admin', email: null }, 'test')).toBe(true)
    expect(lib.mayCheckout({ accountType: 'community', email: 'reader@example.com' }, 'live')).toBe(true)
    expect(lib.mayCheckout({ accountType: 'admin', email: 'devon@example.com' }, 'off')).toBe(false)
    expect(lib.mayCheckout({ accountType: 'admin', email: 'devon@example.com' }, 'closed')).toBe(false)
  })

  it('sells $12 a month without a dashboard price, or the dashboard price when one is set', () => {
    const inline = lib.proLineItem('')
    expect(inline.price_data).toMatchObject({ currency: 'usd', unit_amount: 1200, recurring: { interval: 'month' }, product_data: { name: 'WorldPulse Pro' } })
    expect(lib.proLineItem('price_123')).toEqual({ price: 'price_123', quantity: 1 })
  })

  it('gives Pro only while the subscription is paid (or a renewal is being retried)', () => {
    const pro = { metadata: { worldpulse_plan: 'pro' } }
    expect(lib.planOf({ ...pro, status: 'active' })).toBe('pro')
    expect(lib.planOf({ ...pro, status: 'trialing' })).toBe('pro')
    expect(lib.planOf({ ...pro, status: 'past_due' })).toBe('pro')
    expect(lib.planOf({ ...pro, status: 'incomplete' })).toBe('free')
    expect(lib.planOf({ ...pro, status: 'canceled' })).toBe('free')
    expect(lib.planOf({ ...pro, status: 'unpaid' })).toBe('free')
    expect(lib.planOf({ status: 'active', metadata: {} })).toBe('free')
    expect(lib.planOf({ status: 'active', items: { data: [{ price: { id: 'price_9' } }] } }, 'price_9')).toBe('pro')
  })
})

describe('POST /api/v1/billing/checkout', () => {
  const checkout = async (payload: Record<string, unknown> = { plan: 'pro' }) =>
    (await app()).inject({ method: 'POST', url: '/api/v1/billing/checkout', payload })

  it('is closed to the public while Stripe is in test mode', async () => {
    const res = await checkout()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/waitlist/)
    expect(h.sessions).toHaveLength(0)
  })

  it('a listed tester gets a $12-a-month session, back to the pricing page', async () => {
    h.user.email = 'devon@example.com'
    const res = await checkout({ plan: 'pro', successUrl: 'https://evil.example/x', cancelUrl: 'https://world-pulse.io/pricing?checkout=cancelled' })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://checkout.stripe.com/c/test')
    const s = h.sessions[0]!
    expect(s.mode).toBe('subscription')
    expect(s.customer).toBe('cus_new')
    expect((s.line_items as Array<{ price_data: { unit_amount: number } }>)[0]!.price_data.unit_amount).toBe(1200)
    expect(s.subscription_data).toEqual({ metadata: { worldpulse_plan: 'pro', worldpulse_user_id: 'u1' } })
    expect(s.success_url).toBe('https://world-pulse.io/pricing?checkout=done') // another site's address isn't used
    expect(s.cancel_url).toBe('https://world-pulse.io/pricing?checkout=cancelled')
    expect(h.inserts[0]).toMatchObject({ table: 'subscriptions', row: { user_id: 'u1', stripe_customer_id: 'cus_new', plan: 'free' } })
  })

  it("won't sell Pro twice", async () => {
    h.user.account_type = 'admin'
    h.sub = { user_id: 'u1', stripe_customer_id: 'cus_old', plan: 'pro', status: 'active' }
    expect((await checkout()).statusCode).toBe(409)
  })

  it('makes a new customer when the saved one is gone (a test customer once the live key is in)', async () => {
    h.user.account_type = 'admin'
    h.sub = { user_id: 'u1', stripe_customer_id: 'cus_test_old', plan: 'free', status: 'active' }
    h.retrieveFails = true
    const res = await checkout()
    expect(res.statusCode).toBe(200)
    expect(h.sessions[0]!.customer).toBe('cus_new')
    expect(h.updates[0]).toMatchObject({ table: 'subscriptions', patch: { stripe_customer_id: 'cus_new' } })
  })
})

describe('POST /api/v1/billing/portal', () => {
  const portal = async () => (await app()).inject({ method: 'POST', url: '/api/v1/billing/portal' })

  it("opens Stripe's page for a subscriber", async () => {
    h.sub = { user_id: 'u1', stripe_customer_id: 'cus_1', plan: 'pro', status: 'active' }
    const res = await portal()
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://billing.stripe.com/p/test')
  })

  it('404 without a subscription; 503, with where to write, when Stripe refuses', async () => {
    expect((await portal()).statusCode).toBe(404)
    h.sub = { user_id: 'u1', stripe_customer_id: 'cus_1' }
    h.portalFails = true
    const res = await portal()
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toContain('support@world-pulse.io')
  })
})

describe('GET /api/v1/billing/plans', () => {
  it('says checkout is in test mode, and what Pro adds', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/billing/plans' })
    const body = res.json()
    expect(body.checkout).toBe('test')
    const pro = body.plans.find((p: { id: string }) => p.id === 'pro')
    expect(pro).toMatchObject({ price: 1200, interval: 'month', limits: { requestsPerMinute: 600, requestsPerDay: 50_000 } })
    expect(pro.features.join(' ')).toMatch(/Commercial use/)
    expect(pro.features.join(' ')).not.toMatch(/90-day|Advanced analytics|beta/)
  })
})

describe('POST /api/v1/billing/webhook', () => {
  const env = process.env.NODE_ENV
  afterEach(() => { process.env.NODE_ENV = env })
  const event = (status: string) => ({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', customer: 'cus_1', status, cancel_at_period_end: false, metadata: { worldpulse_plan: 'pro' }, items: { data: [{ price: { id: 'price_x' } }] } } },
  })

  it("on the live server, refuses events that aren't signed while no signing secret is set", async () => {
    process.env.NODE_ENV = 'production'
    const res = await (await app()).inject({ method: 'POST', url: '/api/v1/billing/webhook', payload: event('active') })
    expect(res.statusCode).toBe(503)
    expect(h.updates).toHaveLength(0)
  })

  it('a paid subscription gives Pro; one whose first payment is not made yet gives Free', async () => {
    const a = await app()
    await a.inject({ method: 'POST', url: '/api/v1/billing/webhook', payload: event('incomplete') })
    expect(h.updates[0]).toMatchObject({ table: 'subscriptions', patch: { plan: 'free', status: 'incomplete' } })
    await a.inject({ method: 'POST', url: '/api/v1/billing/webhook', payload: event('active') })
    expect(h.updates.find(u => u.table === 'subscriptions' && u.patch.status === 'active')!.patch.plan).toBe('pro')
  })

  it('with a signing secret set, an event without a signature is refused', async () => {
    vi.resetModules()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit'
    try {
      const { registerBillingRoutes: fresh } = await import('../routes/billing')
      const a = Fastify({ logger: false })
      await a.register(fresh, { prefix: '/api/v1/billing' })
      const res = await a.inject({ method: 'POST', url: '/api/v1/billing/webhook', payload: event('active') })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('Missing Stripe signature')
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET
    }
  })
})

describe('GET /api/v1/billing/subscription', () => {
  it("says whether this account may check out now (test mode: the team only)", async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/billing/subscription' })).json()).toMatchObject({ plan: 'free', checkout: 'test', canCheckout: false })
    h.user.email = 'devon@example.com'
    expect((await a.inject({ method: 'GET', url: '/api/v1/billing/subscription' })).json()).toMatchObject({ canCheckout: true })
  })
})
