'use client'

/**
 * Pricing (Oct 21, 2026; Devon, in chat: Pro "Waitlist now, price later",
 * webhooks "Free, 10 each", the hosted API "Free with credit; companies
 * ask"). Everything is free today; Pro is a waitlist, with no price and no
 * checkout until Devon sets them. What the free plan lists is what the code
 * does: the API's limits (lib/rate-limit-options.ts: 200 a minute per user or
 * address, many routes fewer) and webhooks (10 per account,
 * routes/developer.ts). The old page sold Pro at $12 with Stripe checkout,
 * "600 requests a minute" and "90-day history", none of which the code
 * enforced (departments/revenue/pricing-review-2026-10-20.md).
 */

import { useState } from 'react'
import Link from 'next/link'
import { ProWaitlist } from '@/components/ProWaitlist'

// ─── What's free today, and what Pro is planned to add ────────────────────────

const FREE_TODAY = [
  'The live feed, the World Map and all its layers',
  'Verified stories with how many outlets reported each',
  'The public API, RSS feeds and the MCP server, with no key',
  'Up to 200 API requests a minute (some endpoints allow fewer)',
  'Alerts on the people, places and topics you follow',
  'Up to 10 webhooks for your own apps (free account)',
  'Communities and the weekly digest',
]

const PRO_PLANNED = [
  'Higher API limits',
  'Longer history and exports',
  'Priority support',
  'Early access to new features',
]

const FAQ_ITEMS = [
  {
    q: 'Is WorldPulse free?',
    a: 'Yes. Everything on the site and the public API is free today, with no card and no trial clock. Some layers and alerts need a free account.',
  },
  {
    q: 'When will Pro open, and what will it cost?',
    a: 'Pro is not on sale yet and has no price. Join the waitlist and we\'ll email you once, when it opens. What\'s free today stays free.',
  },
  {
    q: 'Can I use WorldPulse\'s data?',
    a: 'Personal, research, education and non-profit use of the hosted API is free, with a link back to world-pulse.io. Companies: email support@world-pulse.io first. The code itself is open source under the MIT license.',
  },
  {
    q: 'How do I contact you?',
    a: 'Email support@world-pulse.io.',
  },
]

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
            Free today. Pro is coming.
          </h1>
          <p className="text-lg text-wp-text/60 max-w-xl mx-auto">
            Everything on WorldPulse is free to use. A Pro plan is on the way; join the waitlist to hear when it opens.
          </p>
        </div>
      </section>

      {/* ── Plan cards ────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Free, today */}
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

          {/* Pro, coming soon */}
          <div id="pro" className="relative rounded-2xl border-2 border-wp-cyan/50 bg-wp-cyan/5 p-8 flex flex-col shadow-[0_0_40px_rgba(0,212,255,0.08)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="px-4 py-1 rounded-full bg-wp-cyan text-wp-bg text-xs font-bold tracking-widest uppercase shadow-lg">
                Coming soon
              </span>
            </div>
            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-cyan/80 uppercase tracking-widest mb-2">Pro</p>
              <p className="text-2xl font-bold text-wp-text">Not on sale yet</p>
              <p className="mt-2 text-sm text-wp-text/60">For analysts, newsrooms and builders who need more. Planned:</p>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {PRO_PLANNED.map(f => (
                <li key={f} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <Tick muted />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <ProWaitlist source="/pricing" />
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="px-4 pb-24 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-wp-text text-center mb-8">
          Frequently asked questions
        </h2>
        <div className="space-y-3">
          {FAQ_ITEMS.map(item => (
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
