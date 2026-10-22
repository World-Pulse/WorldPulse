'use client'

/**
 * Pricing (Devon, Oct 21, 2026, 8:10 PM: Pro at $12 a month, monthly only;
 * it adds a Pro API key's own budget, commercial use and priority support;
 * reselling the data is an upsell, a data license; checkout opens in Stripe's
 * test mode first). Earlier the same day: webhooks "Free, 10 each", the
 * hosted API "Free with credit; companies ask", alerts free for everyone.
 *
 * What each plan lists is what the code does (lib/pro-plan.ts; the API's
 * GET /billing/plans; Pro keys: apps/api/src/lib/api-plan.ts). The Pro card
 * asks the API whether checkout is open: live (anyone signed in), test mode
 * (only the team: the waitlist for everyone else) or off.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ProWaitlist } from '@/components/ProWaitlist'
import { authHref } from '@/lib/auth-next'
import { proAction, checkoutNotice, endsOn, PRO_ADDS, PRO_PRICE_TEXT, type CheckoutMode, type Subscription } from '@/lib/pro-plan'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// ─── What's free ─────────────────────────────────────────────────────────────

const FREE_TODAY = [
  'The live feed, the World Map and all its layers',
  'Verified stories with how many outlets reported each',
  'The public API, RSS feeds and the MCP server, with no key',
  'Up to 200 API requests a minute (some endpoints allow fewer)',
  'Alerts on the people, places and topics you follow',
  'Up to 10 webhooks for your own apps (free account)',
  'Personal, research, education and non-profit use, with a link back',
]

function faqItems(open: boolean) {
  return [
    {
      q: 'Is WorldPulse free?',
      a: 'Yes. Everything on the site and the public API is free, with no card and no trial clock. Some layers and alerts need a free account. What is free stays free.',
    },
    {
      q: 'What does Pro cost, and what does it add?',
      a: `${PRO_PRICE_TEXT} a month, billed monthly; cancel any time. Pro adds a Pro API key with its own budget (600 requests a minute and 50,000 a day; free keys and no key share 200 a minute per address), commercial use of the API and data with a link back, and priority support by email.` +
        (open ? '' : ' Pro is being tested and opens soon: join the waitlist and we\'ll email you once, when it does.'),
    },
    {
      q: 'Can I use WorldPulse\'s data?',
      a: 'Free: personal, research, education and non-profit use, with a link back to world-pulse.io. Pro: also commercial use in your own work and products, with a link back. Reselling or redistributing the data, for example as a feed inside a product you sell, needs a data license: email support@world-pulse.io. The code itself is open source under the MIT license.',
    },
    {
      q: 'How do I cancel?',
      a: 'On this page: Manage subscription opens Stripe\'s page, where you can cancel, change your card or download invoices. Pro stays on until the end of the month you paid for.',
    },
    {
      q: 'How do I contact you?',
      a: 'Email support@world-pulse.io. Pro members are answered first.',
    },
  ]
}

// ─── FAQ accordion item ──────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/5 transition-colors"
        aria-expanded={open}
      >
        <span className="font-medium text-wp-text">{q}</span>
        <svg
          className={`w-5 h-5 text-wp-text/50 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-5 text-wp-text/70 text-sm leading-relaxed border-t border-white/10 pt-4">
          {a}
        </div>
      )}
    </div>
  )
}

function Tick({ muted = false }: { muted?: boolean }) {
  return (
    <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${muted ? 'text-wp-text/40' : 'text-wp-cyan'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [mode, setMode] = useState<CheckoutMode | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [sub, setSub] = useState<Subscription | null>(null)
  const [notice, setNotice] = useState<'done' | 'cancelled' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setNotice(checkoutNotice(window.location.search))
    let t: string | null = null
    try { t = localStorage.getItem('wp_access_token') } catch { /* private mode */ }
    setToken(t)
    fetch(`${API_URL}/api/v1/billing/plans`)
      .then(r => (r.ok ? r.json() : null))
      .then((b: { checkout?: CheckoutMode } | null) => setMode(b?.checkout ?? 'off'))
      .catch(() => setMode('off'))
    if (t) {
      fetch(`${API_URL}/api/v1/billing/subscription`, { headers: { Authorization: `Bearer ${t}` } })
        .then(r => (r.ok ? r.json() : null))
        .then((b: Subscription | null) => { if (b) setSub(b) })
        .catch(() => { /* the card shows the waitlist */ })
    }
  }, [])

  // Off to Stripe: checkout, or the page to manage the subscription
  async function goTo(path: 'checkout' | 'portal') {
    if (!token || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/v1/billing/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(path === 'checkout' ? { plan: 'pro' } : {}),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (res.ok && data?.url) {
        window.location.href = data.url
        return
      }
      setError(data?.error || 'Something went wrong. Please try again, or email support@world-pulse.io.')
    } catch {
      setError('Network error. Please check your connection and try again.')
    }
    setBusy(false)
  }

  const action = proAction(mode, !!token, sub)
  const open = mode === 'live'
  const ends = sub?.plan === 'pro' && sub.cancelAtPeriodEnd ? endsOn(sub.currentPeriodEnd) : null

  return (
    <div className="min-h-screen bg-wp-bg">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative pt-20 pb-16 px-4 text-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="w-[600px] max-w-full h-[400px] bg-wp-cyan/5 rounded-full blur-3xl -translate-y-1/4" />
        </div>
        <div className="relative max-w-2xl mx-auto">
          <span className="inline-block mb-4 px-3 py-1 rounded-full bg-wp-cyan/10 border border-wp-cyan/20 text-wp-cyan text-xs font-semibold tracking-widest uppercase">
            Pricing
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-wp-text mb-4 leading-tight">
            Free for everyone. Pro at {PRO_PRICE_TEXT} a month.
          </h1>
          <p className="text-lg text-wp-text/60 max-w-xl mx-auto">
            Everything on WorldPulse is free to use. Pro is for using it at work: a bigger API budget, commercial use and priority support.
            {!open && ' It opens soon: join the waitlist to hear when.'}
          </p>
        </div>
      </section>

      {notice && (
        <div role="status" className={`mx-auto mb-8 max-w-2xl px-4`}>
          <p className={`rounded-xl px-4 py-3 text-sm ${notice === 'done' ? 'bg-emerald-400/10 border border-emerald-400/20 text-emerald-300' : 'bg-white/5 border border-white/10 text-wp-text/70'}`}>
            {notice === 'done'
              ? 'Thank you! Your Pro plan is starting; it can take a minute to show here. Your API keys get Pro limits within a minute after that.'
              : 'Checkout cancelled: nothing was charged.'}
          </p>
        </div>
      )}

      {/* ── Plan cards ────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Free */}
          <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 flex flex-col">
            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-text/50 uppercase tracking-widest mb-2">Free</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-wp-text">$0</span>
              </div>
              <p className="mt-2 text-sm text-wp-text/60">No card. No trial clock.</p>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {FREE_TODAY.map(f => (
                <li key={f} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <Tick />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/register"
              className="block w-full text-center rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-wp-text font-semibold py-3 transition-colors"
            >
              Create a free account
            </Link>
          </div>

          {/* Pro */}
          <div id="pro" className="relative rounded-2xl border-2 border-wp-cyan/50 bg-wp-cyan/5 p-8 flex flex-col shadow-[0_0_40px_rgba(0,212,255,0.08)]">
            {!open && action.kind === 'waitlist' && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-4 py-1 rounded-full bg-wp-cyan text-wp-bg text-xs font-bold tracking-widest uppercase shadow-lg whitespace-nowrap">
                  Opening soon
                </span>
              </div>
            )}
            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-cyan/80 uppercase tracking-widest mb-2">Pro</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-wp-text">{PRO_PRICE_TEXT}</span>
                <span className="mb-1.5 text-sm text-wp-text/60">a month</span>
              </div>
              <p className="mt-2 text-sm text-wp-text/60">For analysts, newsrooms and builders using WorldPulse at work. Everything in Free, plus:</p>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {PRO_ADDS.map(f => (
                <li key={f} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <Tick />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {action.kind === 'manage' && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-300">
                  You&apos;re on Pro{ends ? `, until ${ends}` : ''}.
                </p>
                <button type="button" onClick={() => goTo('portal')} disabled={busy}
                  className="block w-full rounded-xl border border-wp-cyan/50 bg-wp-cyan/10 hover:bg-wp-cyan/20 text-wp-text font-semibold py-3 transition-colors disabled:opacity-60">
                  {busy ? 'Opening…' : 'Manage subscription'}
                </button>
                <p className="text-xs text-wp-text/40">Cancel, change your card or download invoices on Stripe&apos;s page.</p>
              </div>
            )}
            {action.kind === 'upgrade' && (
              <div className="space-y-2">
                <button type="button" onClick={() => goTo('checkout')} disabled={busy}
                  className="block w-full rounded-xl bg-wp-cyan hover:bg-wp-cyan/90 text-wp-bg font-bold py-3 transition-colors disabled:opacity-60">
                  {busy ? 'Opening checkout…' : action.test ? 'Test checkout (Stripe test mode)' : `Upgrade to Pro, ${PRO_PRICE_TEXT} a month`}
                </button>
                <p className="text-xs text-wp-text/40">
                  {action.test
                    ? 'Test mode: pay with card 4242 4242 4242 4242, any future date and any CVC. Nothing is charged.'
                    : 'Payment by Stripe. Cancel any time.'}
                </p>
              </div>
            )}
            {action.kind === 'sign-in' && (
              <Link href={authHref('login', '/pricing')}
                className="block w-full text-center rounded-xl bg-wp-cyan hover:bg-wp-cyan/90 text-wp-bg font-bold py-3 transition-colors">
                Sign in to upgrade
              </Link>
            )}
            {action.kind === 'waitlist' && <ProWaitlist source="/pricing" />}
            {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
          </div>

          {/* Data license: reselling the data (Devon: "Upsell it") */}
          <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 flex flex-col">
            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-text/50 uppercase tracking-widest mb-2">Data license</p>
              <p className="text-3xl font-bold text-wp-text">Let&apos;s talk</p>
              <p className="mt-2 text-sm text-wp-text/60">For companies that resell or redistribute WorldPulse data.</p>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {[
                'Everything in Pro',
                'Resell or redistribute the data, for example as a feed inside a product you sell',
                'Limits set for your product',
              ].map(f => (
                <li key={f} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <Tick />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-wp-text/70">
              Email <span className="text-wp-cyan select-all">support@world-pulse.io</span> with what you&apos;re building.
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="px-4 pb-24 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-wp-text text-center mb-8">
          Frequently asked questions
        </h2>
        <div className="space-y-3">
          {faqItems(open).map(item => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
        <p className="text-center text-sm text-wp-text/40 mt-8">
          More questions? Email <span className="text-wp-cyan select-all">support@world-pulse.io</span>
        </p>
      </section>
    </div>
  )
}
