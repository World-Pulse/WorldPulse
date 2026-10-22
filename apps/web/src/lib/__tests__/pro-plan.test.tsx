/**
 * WorldPulse Pro on the site (Devon, Oct 21, 2026, 8:10 PM: $12 a month,
 * monthly; a Pro key's own budget, commercial use, priority support;
 * checkout in Stripe's test mode first; reselling the data is a data license).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { proAction, checkoutNotice, endsOn, PRO_ADDS, PRO_PITCH, type Subscription } from '../pro-plan'
import { announceBlocked } from '@/components/admin/ProWaitlistAdmin'

const free: Subscription = { plan: 'free', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false }

describe("the Pro card's button", () => {
  it('a Pro account manages its subscription, whatever the mode', () => {
    expect(proAction('live', true, { ...free, plan: 'pro' })).toEqual({ kind: 'manage' })
    expect(proAction('test', true, { ...free, plan: 'pro' })).toEqual({ kind: 'manage' })
  })

  it('live: upgrade when signed in, sign in first otherwise', () => {
    expect(proAction('live', true, { ...free, canCheckout: true })).toEqual({ kind: 'upgrade', test: false })
    expect(proAction('live', true, null)).toEqual({ kind: 'upgrade', test: false })
    expect(proAction('live', false, null)).toEqual({ kind: 'sign-in' })
  })

  it('test mode: the test checkout for the team, the waitlist for everyone else', () => {
    expect(proAction('test', true, { ...free, canCheckout: true })).toEqual({ kind: 'upgrade', test: true })
    expect(proAction('test', true, { ...free, canCheckout: false })).toEqual({ kind: 'waitlist' })
    expect(proAction('test', false, null)).toEqual({ kind: 'waitlist' })
  })

  it('off, or the API not answering: the waitlist', () => {
    expect(proAction('off', true, free)).toEqual({ kind: 'waitlist' })
    expect(proAction(null, false, null)).toEqual({ kind: 'waitlist' })
  })

  it('reads ?checkout= after Stripe, and the end date of a cancelled plan', () => {
    expect(checkoutNotice('?checkout=done')).toBe('done')
    expect(checkoutNotice('?checkout=cancelled&x=1')).toBe('cancelled')
    expect(checkoutNotice('?checkout=other')).toBeNull()
    expect(endsOn('2026-11-21T00:00:00Z')).toBe('Nov 21, 2026')
    expect(endsOn(null)).toBeNull()
  })
})

describe('what Pro is said to be, everywhere', () => {
  const app = join(__dirname, '..', '..', 'app')
  const read = (p: string) => readFileSync(join(app, p), 'utf8')

  it('the three things Devon chose, and nothing Pro does not include', () => {
    const all = [PRO_ADDS.join(' '), PRO_PITCH, read('pricing/page.tsx'), read('developers/page.tsx')].join(' ')
    expect(PRO_ADDS.join(' ')).toMatch(/600 requests a minute and 50,000 a day/)
    expect(PRO_ADDS.join(' ')).toMatch(/Commercial use/)
    expect(PRO_ADDS.join(' ')).toMatch(/Priority support/)
    expect(PRO_PITCH).toMatch(/\$12 a month/)
    expect(all).not.toMatch(/90-day|Advanced analytics|Early access|Longer history|beta features/)
  })

  it("the pages' Upgrade to Pro boxes all say the same, and go to Pro on /pricing", () => {
    for (const p of ['knowledge-graph/page.tsx', 'food-security/page.tsx', 'governance/page.tsx', 'digital-rights/page.tsx', 'briefings/page.tsx', 'water-security/page.tsx', 'video-claims/VideoClaimsDashboard.tsx']) {
      const src = read(p)
      expect(src, p).toContain('{PRO_PITCH}')
      expect(src, p).toMatch(/href="\/pricing#pro"/)
      expect(src, p).not.toMatch(/video monitoring|IPC phase change alerts|Water Crisis Alerts|up to 72 hours|Full Graph API Access/)
    }
  })

  it('reselling the data is a data license', () => {
    expect(read('pricing/page.tsx')).toContain('Data license')
    expect(read('help/page.tsx')).toContain('Reselling or redistributing the data needs a data license')
  })
})

describe('the waitlist email on /admin', () => {
  it('only once Pro is live and email works, and someone is still waiting', () => {
    const ok = { waiting: 12, announced: 0, checkout: 'live' as const, emailReady: true }
    expect(announceBlocked(ok)).toBeNull()
    expect(announceBlocked({ ...ok, checkout: 'test' })).toMatch(/test mode/)
    expect(announceBlocked({ ...ok, emailReady: false })).toMatch(/Resend/)
    expect(announceBlocked({ ...ok, announced: 12 })).toMatch(/Everyone/)
  })
})
