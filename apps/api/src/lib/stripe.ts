import Stripe from 'stripe'

// Conditional init — STRIPE_SECRET_KEY will be undefined in dev/test
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion })
  : null

export function getStripe(): Stripe {
  if (!stripe) {
    throw Object.assign(new Error('Billing not configured'), { statusCode: 503 })
  }
  return stripe
}

export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? ''
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''

export type Plan = 'free' | 'pro'

export interface PlanLimits {
  requestsPerMinute: number
  historyDays: number
  maxAlerts: number   // -1 = unlimited
  maxWebhooks: number
}

export function getPlanLimits(plan: Plan): PlanLimits {
  if (plan === 'pro') {
    return { requestsPerMinute: 600, historyDays: 90, maxAlerts: -1, maxWebhooks: 5 }
  }
  return { requestsPerMinute: 60, historyDays: 7, maxAlerts: 3, maxWebhooks: 0 }
}

export { stripe as stripeInstance }
