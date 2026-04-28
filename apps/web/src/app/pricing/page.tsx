'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Feature lists ──────────────────────────────────────────────────────────

const FREE_FEATURES = [
  { label: '60 API requests / minute',   included: true },
  { label: '7-day signal history',       included: true },
  { label: 'Up to 3 alert subscriptions', included: true },
  { label: 'Global live feed',           included: true },
  { label: 'World map access',           included: true },
  { label: 'Community access',           included: true },
  { label: 'Webhook endpoints',          included: false },
  { label: '90-day history',             included: false },
  { label: 'Priority support',           included: false },
]

const PRO_FEATURES = [
  { label: '600 API requests / minute',      included: true },
  { label: '90-day signal history',          included: true },
  { label: 'Unlimited alert subscriptions',  included: true },
  { label: '5 webhook endpoints',            included: true },
  { label: 'Advanced analytics',             included: true },
  { label: 'RSS & OPML export',              included: true },
  { label: 'Priority support',               included: true },
  { label: 'Early access to beta features',  included: true },
]

const FAQ_ITEMS = [
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. You can cancel your Pro subscription at any time from your account settings. Your access continues until the end of the current billing period — you won\'t be charged again.',
  },
  {
    q: 'Do you offer refunds?',
    a: 'We offer a full refund within 7 days of your first charge if you\'re not satisfied. Contact support@worldpulse.io with your account email and we\'ll process it within 2 business days.',
  },
  {
    q: 'Is there a free trial?',
    a: 'WorldPulse Free gives you full access to core features forever with no credit card required. The Pro tier adds higher limits and advanced features — upgrade when you need more.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit and debit cards (Visa, Mastercard, Amex, Discover) via Stripe. All transactions are encrypted and PCI-DSS compliant.',
  },
]

// ─── Check icon ─────────────────────────────────────────────────────────────

function CheckIcon({ included }: { included: boolean }) {
  if (included) {
    return (
      <svg
        className="w-4 h-4 text-wp-cyan flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  return (
    <svg
      className="w-4 h-4 text-wp-text/30 flex-shrink-0 mt-0.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const router  = useRouter()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleUpgrade() {
    setLoading(true)
    setError(null)
    try {
      const token = typeof window !== 'undefined'
        ? localStorage.getItem('wp_access_token') ?? sessionStorage.getItem('wp_access_token')
        : null

      if (!token) {
        router.push('/auth/login?next=/pricing')
        return
      }

      const res = await fetch(`${API_URL}/api/v1/billing/checkout`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan:       'pro',
          successUrl: `${window.location.origin}/settings?billing=success`,
          cancelUrl:  `${window.location.origin}/pricing`,
        }),
      })

      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to start checkout. Please try again.')
        return
      }

      window.location.href = data.url
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-wp-bg">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative pt-20 pb-16 px-4 text-center overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="w-[600px] h-[400px] bg-wp-cyan/5 rounded-full blur-3xl -translate-y-1/4" />
        </div>

        <div className="relative max-w-2xl mx-auto">
          <span className="inline-block mb-4 px-3 py-1 rounded-full bg-wp-cyan/10 border border-wp-cyan/20 text-wp-cyan text-xs font-semibold tracking-widest uppercase">
            Pricing
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-wp-text mb-4 leading-tight">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-wp-text/60 max-w-xl mx-auto">
            Start free. Upgrade when you need more. No hidden fees, no lock-in.
          </p>
        </div>
      </section>

      {/* ── Plan cards ────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Free plan */}
          <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 flex flex-col">
            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-text/50 uppercase tracking-widest mb-2">Free</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-wp-text">$0</span>
                <span className="text-wp-text/50 mb-1">/ month</span>
              </div>
              <p className="mt-2 text-sm text-wp-text/60">
                Full core access. No credit card required.
              </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {FREE_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <CheckIcon included={f.included} />
                  <span className={f.included ? '' : 'text-wp-text/40'}>{f.label}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/auth/register"
              className="block w-full text-center rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-wp-text font-semibold py-3 transition-colors"
            >
              Get Started — Free
            </Link>
          </div>

          {/* Pro plan */}
          <div className="relative rounded-2xl border-2 border-wp-cyan/50 bg-wp-cyan/5 p-8 flex flex-col shadow-[0_0_40px_rgba(0,212,255,0.08)]">
            {/* Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="px-4 py-1 rounded-full bg-wp-cyan text-wp-bg text-xs font-bold tracking-widest uppercase shadow-lg">
                Most Popular
              </span>
            </div>

            <div className="mb-6">
              <p className="text-xs font-semibold text-wp-cyan/80 uppercase tracking-widest mb-2">Pro</p>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-wp-text">$12</span>
                <span className="text-wp-text/50 mb-1">/ month</span>
              </div>
              <p className="mt-2 text-sm text-wp-text/60">
                Higher limits, webhooks, and early access.
              </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {PRO_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-3 text-sm text-wp-text/80">
                  <CheckIcon included={f.included} />
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>

            {error && (
              <p className="mb-3 text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2 border border-red-400/20">
                {error}
              </p>
            )}

            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="block w-full text-center rounded-xl bg-wp-cyan hover:bg-wp-cyan/90 active:bg-wp-cyan/80 text-wp-bg font-bold py-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Redirecting to Stripe…' : 'Upgrade to Pro'}
            </button>
            <p className="text-center text-xs text-wp-text/40 mt-3">
              Secure checkout via Stripe. Cancel anytime.
            </p>
          </div>
        </div>

        {/* Compare table callout */}
        <p className="text-center text-sm text-wp-text/40 mt-8">
          All plans include the full WorldPulse open-source feature set.
          Pro adds higher quotas, webhooks, and dedicated support.
        </p>
      </section>

      {/* ── Comparison table ──────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-wp-text text-center mb-8">Compare plans</h2>
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-6 py-4 text-wp-text/50 font-medium">Feature</th>
                <th className="px-6 py-4 text-wp-text/70 font-semibold text-center">Free</th>
                <th className="px-6 py-4 text-wp-cyan font-bold text-center">Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[
                ['API requests / minute', '60', '600'],
                ['Signal history',        '7 days', '90 days'],
                ['Alert subscriptions',   '3', 'Unlimited'],
                ['Webhook endpoints',     '—', '5'],
                ['RSS / OPML export',     '—', 'Included'],
                ['Advanced analytics',    '—', 'Included'],
                ['Support',               'Community', 'Priority email'],
                ['Beta access',           '—', 'Early access'],
                ['Price',                 '$0 / mo', '$12 / mo'],
              ].map(([feature, free, pro]) => (
                <tr key={feature} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-3.5 text-wp-text/80">{feature}</td>
                  <td className="px-6 py-3.5 text-center text-wp-text/60">{free}</td>
                  <td className="px-6 py-3.5 text-center text-wp-cyan font-medium">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Guarantee strip ───────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-3xl mx-auto">
        <div className="rounded-2xl bg-wp-cyan/5 border border-wp-cyan/20 px-8 py-6 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="text-3xl flex-shrink-0">🔒</div>
          <div>
            <p className="font-semibold text-wp-text">7-day money-back guarantee</p>
            <p className="text-sm text-wp-text/60 mt-1">
              Not satisfied within the first 7 days? Email{' '}
              <span className="text-wp-cyan">support@worldpulse.io</span>{' '}
              and we'll issue a full refund — no questions asked.
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
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>

        <p className="text-center text-sm text-wp-text/40 mt-8">
          Have more questions?{' '}
          <a
            href="mailto:support@worldpulse.io"
            className="text-wp-cyan hover:underline"
          >
            Contact us
          </a>
        </p>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="px-4 pb-24 text-center max-w-xl mx-auto">
        <h2 className="text-2xl font-bold text-wp-text mb-3">
          Ready to get started?
        </h2>
        <p className="text-wp-text/60 mb-6 text-sm">
          Join thousands of analysts, journalists, and developers using WorldPulse
          to track real-time global signals.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/auth/register"
            className="rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-wp-text font-semibold px-6 py-3 transition-colors"
          >
            Start for free
          </Link>
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="rounded-xl bg-wp-cyan hover:bg-wp-cyan/90 text-wp-bg font-bold px-6 py-3 transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Upgrade to Pro — $12/mo'}
          </button>
        </div>
      </section>
    </div>
  )
}
