'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ONBOARDING_KEY = 'wp_onboarded_v2'

interface Step {
  icon: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: '📡',
    title: 'Real-time verified signals',
    body: 'WorldPulse aggregates breaking events from 40+ wire services, government agencies, and open-source feeds — verified and scored before they reach your feed.',
  },
  {
    icon: '🔬',
    title: 'Reliability scoring',
    body: 'Every signal gets a live cross-check score. We show you how many sources confirmed an event, flag disputed claims, and surface community corrections in real time.',
  },
  {
    icon: '🌍',
    title: 'Community intelligence layer',
    body: 'Follow journalists, analysts, and regional experts. Boost signals you trust. Flag misinformation. The community makes WorldPulse sharper over time.',
  },
  {
    icon: '🔓',
    title: '100% open source',
    body: 'WorldPulse is open source and self-hostable. Full transparency on our algorithms, sources, and data pipeline — no black box editorial decisions.',
  },
]

export function OnboardingModal() {
  const [open, setOpen]   = useState(false)
  const [step, setStep]   = useState(0)
  const [exiting, setExiting] = useState(false)
  const router = useRouter()

  // Show once per browser session unless user has seen it before
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) {
        // Small delay so the page renders first
        const t = setTimeout(() => setOpen(true), 800)
        return () => clearTimeout(t)
      }
    } catch { /* SSR / private browsing */ }
  }, [])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  function dismiss() {
    setExiting(true)
    setTimeout(() => {
      setOpen(false)
      setExiting(false)
      try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* ignore */ }
    }, 220)
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      dismiss()
    }
  }

  if (!open) return null

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  return (
    <div
      className={`fixed inset-0 z-[2000] flex items-center justify-center p-4 transition-opacity duration-200
        ${exiting ? 'opacity-0' : 'opacity-100'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to WorldPulse"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md glass border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 shadow-2xl animate-fade-in">

        {/* Close button */}
        <button
          onClick={dismiss}
          aria-label="Close welcome screen"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[16px]"
        >
          ✕
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-wp-red shadow-[0_0_10px_#ff3b5c] animate-live-pulse" aria-hidden="true" />
            <span className="font-display text-[20px] tracking-[3px] text-wp-text">
              WORLD<span className="text-wp-amber">PULSE</span>
            </span>
          </div>
          <span className="font-mono text-[10px] border border-wp-amber/40 text-wp-amber px-2 py-0.5 rounded tracking-widest">
            MISSION BRIEFING
          </span>
        </div>

        {/* Step content */}
        <div
          className="mb-6 min-h-[120px]"
          key={step}
          style={{ animation: 'fadeIn 0.25s ease' }}
        >
          <div className="text-[40px] mb-3" aria-hidden="true">{current.icon}</div>
          <h2 className="font-display text-[22px] tracking-wider text-wp-text mb-2">
            {current.title}
          </h2>
          <p className="text-[14px] text-wp-text2 leading-relaxed">{current.body}</p>
        </div>

        {/* Step dots */}
        <div className="flex items-center gap-2 mb-5" role="tablist" aria-label="Onboarding steps">
          {STEPS.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}`}
              onClick={() => setStep(i)}
              className={`rounded-full transition-all ${
                i === step
                  ? 'w-6 h-[6px] bg-wp-amber'
                  : 'w-[6px] h-[6px] bg-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.4)]'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {isLast ? (
            <>
              <button
                onClick={dismiss}
                className="flex-1 py-3 rounded-xl border border-[rgba(255,255,255,0.15)] text-wp-text2 text-[13px] font-medium hover:border-wp-amber hover:text-wp-amber transition-all"
              >
                Explore Feed
              </button>
              <Link
                href="/auth/register"
                onClick={dismiss}
                className="flex-1 py-3 rounded-xl bg-wp-amber text-black text-[13px] font-bold text-center hover:bg-[#ffb84d] transition-all"
              >
                Join Free →
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={dismiss}
                className="px-4 py-3 rounded-xl border border-[rgba(255,255,255,0.1)] text-wp-text3 text-[13px] hover:text-wp-text2 transition-all"
              >
                Skip
              </button>
              <button
                onClick={next}
                className="flex-1 py-3 rounded-xl bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all"
              >
                Next →
              </button>
            </>
          )}
        </div>

        {/* Trust signal */}
        <p className="text-center text-[11px] text-wp-text3 mt-4">
          Free forever · No ads · Open source
        </p>
      </div>
    </div>
  )
}
