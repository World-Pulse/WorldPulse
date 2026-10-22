/**
 * WorldPulse Pro on /pricing (Devon, Oct 21, 2026, 8:10 PM: $12 a month,
 * monthly only; it adds a Pro API key's own budget, commercial use and
 * priority support; checkout opens in Stripe's test mode first). What the
 * Pro card offers, from the API's answers: GET /api/v1/billing/plans says
 * whether checkout is live, in test mode (the team only) or off, and GET
 * /api/v1/billing/subscription what this account has and may do.
 */

export type CheckoutMode = 'live' | 'test' | 'off'

export interface Subscription {
  plan: 'free' | 'pro'
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  checkout?: CheckoutMode
  canCheckout?: boolean
}

export type ProAction =
  | { kind: 'manage' }
  | { kind: 'upgrade'; test: boolean }
  | { kind: 'sign-in' }
  | { kind: 'waitlist' }

export const PRO_PRICE_TEXT = '$12'

/** What Pro adds to everything free (the API's GET /billing/plans says the same) */
export const PRO_ADDS = [
  'A Pro API key with its own budget: 600 requests a minute and 50,000 a day (free keys and no key share 200 a minute per address)',
  'Commercial use of the API and data in your own work and products, with a link back',
  'Priority support: your emails to support@world-pulse.io are answered first',
]

/**
 * The Pro card's button: manage a running Pro plan; upgrade when checkout is
 * open to this account (live: anyone signed in; test: the team); sign in
 * first when it's live; otherwise the waitlist.
 */
export function proAction(mode: CheckoutMode | null, signedIn: boolean, sub: Subscription | null): ProAction {
  if (sub?.plan === 'pro') return { kind: 'manage' }
  if (mode === 'live') {
    if (!signedIn) return { kind: 'sign-in' }
    return sub?.canCheckout === false ? { kind: 'waitlist' } : { kind: 'upgrade', test: false }
  }
  if (mode === 'test' && signedIn && sub?.canCheckout) return { kind: 'upgrade', test: true }
  return { kind: 'waitlist' }
}

/** The note after Stripe sends the reader back: ?checkout=done or ?checkout=cancelled */
export function checkoutNotice(search: string): 'done' | 'cancelled' | null {
  const v = new URLSearchParams(search).get('checkout')
  return v === 'done' || v === 'cancelled' ? v : null
}

/** "Ends on Nov 21, 2026" for a plan cancelled at its period's end */
export function endsOn(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null
}

/**
 * The one Pro pitch for the pages' "Upgrade to Pro" boxes (plan G14): until
 * Oct 21, 2026 they sold food-security alerts, video monitoring, "deep
 * analysis" and 72-hour briefings that Pro never included
 */
export const PRO_PITCH = `WorldPulse Pro, ${PRO_PRICE_TEXT} a month: a Pro API key with its own budget (600 requests a minute, 50,000 a day), commercial use of the data with a link back, and priority support. Everything on this page stays free.`
