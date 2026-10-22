/**
 * WorldPulse Pro and Stripe (Devon, Oct 21, 2026, 8:10 PM: Pro at $12 a
 * month, monthly only; it adds higher API limits, commercial use and
 * priority support; checkout opens in Stripe's test mode first).
 *
 * The price lives here, not in the Stripe dashboard: checkout sends it with
 * each session (an inline price), so the only Stripe settings the server
 * needs are the secret key and the webhook's signing secret. A dashboard
 * price (STRIPE_PRO_PRICE_ID) is still used when one is set.
 *
 * Test mode (a secret key starting sk_test_ or rk_test_): only admins and
 * the addresses in BILLING_TEST_EMAILS may check out, so nobody gets Pro
 * with a test card while Devon makes his test purchase.
 */

import Stripe from 'stripe'

// `||`: compose passes an unset variable as "" (lib/email.ts says why)
const SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''

// Conditional init — STRIPE_SECRET_KEY will be undefined in dev/test
const stripe = SECRET_KEY
  ? new Stripe(SECRET_KEY, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion })
  : null

export function getStripe(): Stripe {
  if (!stripe) {
    throw Object.assign(new Error('Billing not configured'), { statusCode: 503 })
  }
  return stripe
}

export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || ''
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''

/** Pro's price: $12 a month (Devon, Oct 21, 2026) */
export const PRO_PRICE = { cents: 1200, currency: 'usd', interval: 'month' } as const

export type Plan = 'free' | 'pro'

/** Whether people can pay: live (real cards), test (Stripe's test mode: the team only) or off (no key on the server) */
export type BillingMode = 'live' | 'test' | 'off'

export function billingMode(key: string = SECRET_KEY): BillingMode {
  if (!key) return 'off'
  return /^(sk|rk)_test_/.test(key) ? 'test' : 'live'
}

/** The addresses allowed to check out in test mode (BILLING_TEST_EMAILS, comma-separated), lower-case */
export function testBuyers(raw: string = process.env.BILLING_TEST_EMAILS || ''): string[] {
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
}

/** Whether this account may start a checkout now */
export function mayCheckout(user: { accountType?: string | null; email?: string | null }, mode: BillingMode = billingMode()): boolean {
  if (mode === 'live') return true
  if (mode === 'off') return false
  if (user.accountType === 'admin') return true
  const email = (user.email || '').trim().toLowerCase()
  return email !== '' && testBuyers().includes(email)
}

/** What checkout sells: the dashboard's price when one is set, else $12 a month sent with the session */
export function proLineItem(priceId: string = PRO_PRICE_ID): Stripe.Checkout.SessionCreateParams.LineItem {
  if (priceId) return { price: priceId, quantity: 1 }
  return {
    quantity: 1,
    price_data: {
      currency: PRO_PRICE.currency,
      unit_amount: PRO_PRICE.cents,
      recurring: { interval: PRO_PRICE.interval },
      product_data: {
        name: 'WorldPulse Pro',
        description: 'A Pro API key with its own budget (600 requests a minute, 50,000 a day), commercial use of the API and data, and priority support.',
      },
    },
  }
}

/** A subscription's statuses that keep Pro: paid, in a trial, or a failed renewal Stripe is still retrying */
const KEEPS_PRO = new Set(['active', 'trialing', 'past_due'])

/**
 * The plan a Stripe subscription gives. Pro only while it is paid (or being
 * retried): a subscription that is still "incomplete" (its first payment
 * not made), unpaid or canceled gives Free. A Pro subscription is one
 * checkout marked (metadata worldpulse_plan "pro"), or one on the
 * dashboard's Pro price.
 */
export function planOf(sub: {
  status?: string | null
  metadata?: Record<string, string> | null
  items?: { data?: Array<{ price?: { id?: string | null; nickname?: string | null } | null }> } | null
}, priceId: string = PRO_PRICE_ID): Plan {
  if (!KEEPS_PRO.has(String(sub.status ?? ''))) return 'free'
  if (sub.metadata?.worldpulse_plan === 'pro') return 'pro'
  const price = sub.items?.data?.[0]?.price
  if (priceId && price?.id === priceId) return 'pro'
  return (price?.nickname ?? '').toLowerCase().includes('pro') ? 'pro' : 'free'
}

export interface PlanLimits {
  /** Across the API, a minute; free: per user or address, and many endpoints allow fewer */
  requestsPerMinute: number
  /** A day, per key; null = no daily cap */
  requestsPerDay: number | null
  /** -1 = no plan limit (history and alerts are free for everyone) */
  historyDays: number
  maxAlerts: number
  maxWebhooks: number
}

/**
 * What each plan gets, as the code enforces it: free as the API counts it
 * (lib/rate-limit-options.ts: 200 a minute per user or address, endpoints
 * 30–60), Pro as lib/api-plan.ts counts a Pro key. Alerts and 10 webhooks
 * are free for everyone (Devon, Oct 21), and no plan limits history.
 */
export function getPlanLimits(plan: Plan): PlanLimits {
  if (plan === 'pro') {
    return { requestsPerMinute: 600, requestsPerDay: 50_000, historyDays: -1, maxAlerts: -1, maxWebhooks: 10 }
  }
  return { requestsPerMinute: 200, requestsPerDay: null, historyDays: -1, maxAlerts: -1, maxWebhooks: 10 }
}

export { stripe as stripeInstance }
