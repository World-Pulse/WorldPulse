'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { COUNTRIES_COVERED } from '@/lib/coverage-count'
import { WELCOME_KEY, shouldWelcome } from '@/lib/welcome'

/**
 * One band at the top of the home page for a reader's first visit (Nov 12, 2026): what WorldPulse is, in a
 * headline and a sentence, and the two things to do next. Devon, reviewing the home page: "The welcome
 * band. A first-time visitor needs one sentence saying what this is." Nothing on the page said it; a
 * newcomer met a dense dashboard.
 *
 * Shown once per browser: not to a signed-in reader, nor to one who has seen it or the old first-scroll
 * pop-up (which it replaces: two greetings were one too many). It is in the page as sent, and hidden
 * before it is drawn for a reader who has been here (lib/welcome.ts), so nothing moves when it shows.
 */
export function WelcomeBand() {
  // (true as sent: the page marks itself before drawing for a reader who has been here, so they never see it)
  const [show, setShow] = useState(true)
  // (decided once: marking the band seen must not hide it from the reader it is greeting, when the effect runs again)
  const greeted = useRef(false)

  useEffect(() => {
    if (greeted.current) return
    if (!shouldWelcome(key => localStorage.getItem(key))) { setShow(false); return }
    greeted.current = true
    try { localStorage.setItem(WELCOME_KEY, new Date().toISOString()) } catch { /* ignore */ }
  }, [])

  if (!show) return null
  const close = () => setShow(false)

  return (
    <section aria-label="What WorldPulse is" className="wp-welcome relative border-b border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.07)] px-4 py-5 sm:py-6">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:pr-8">
        <div className="min-w-0 pr-8 lg:pr-0">
          <p className="font-mono text-[10.5px] tracking-[2px] text-wp-amber uppercase">New here?</p>
          <h2 className="mt-1 text-[20px] sm:text-[24px] font-bold leading-tight text-wp-text [text-wrap:balance]">
            World news, with the number of newsrooms behind each story.
          </h2>
          <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-wp-text2">
            WorldPulse reads news outlets in {COUNTRIES_COVERED} countries around the clock and counts how many reported each story.
            When two or more independent outlets report the same event, it is marked verified.{' '}
            <Link href="/how-we-count" className="underline underline-offset-2 hover:text-wp-cyan">How we count</Link>
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <a
            href="#developing-stories"
            onClick={close}
            className="rounded-lg bg-wp-amber px-3 sm:px-4 py-2 text-[13px] sm:text-[14px] font-semibold text-black hover:brightness-110"
          >
            See today’s top stories
          </a>
          <Link
            href="/briefing"
            className="rounded-lg border border-[rgba(245,166,35,0.5)] px-3 sm:px-4 py-2 text-[13px] sm:text-[14px] font-semibold text-wp-amber hover:bg-[rgba(245,166,35,0.12)]"
          >
            Get the 7 AM briefing
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute right-3 top-3 rounded p-1 text-[18px] leading-none text-wp-text3 hover:text-wp-text"
      >
        ×
      </button>
    </section>
  )
}
