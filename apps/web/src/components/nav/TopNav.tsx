'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

const TICKER_ITEMS = [
  { type: 'red',   label: 'BREAKING',  text: 'Seismic activity near Manila — M5.8 confirmed' },
  { type: 'amber', label: 'MARKETS',   text: 'S&P 500 +0.84% · BTC $82,340 +2.1% · Gold $2,941 ▲' },
  { type: 'cyan',  label: 'CLIMATE',   text: 'Arctic sea ice at 43-year record low for March' },
  { type: 'green', label: 'SCIENCE',   text: 'WHO confirms H5N9 cluster contained — Hanoi' },
  { type: 'red',   label: 'CONFLICT',  text: 'Sudan peace talks stalling — Day 3 ceasefire negotiations' },
  { type: 'amber', label: 'TECH',      text: 'EU AI safety directive — 24h compliance window' },
  { type: 'cyan',  label: 'ELECTIONS', text: 'South Korea snap election — 68.2% turnout, 23% counted' },
]

const DOT_COLORS: Record<string, string> = {
  red:   'bg-wp-red shadow-[0_0_6px_#ff3b5c]',
  amber: 'bg-wp-amber shadow-[0_0_6px_#f5a623]',
  cyan:  'bg-wp-cyan shadow-[0_0_6px_#00d4ff]',
  green: 'bg-wp-green shadow-[0_0_6px_#00e676]',
}

export function TopNav() {
  const [signalCount, setSignalCount] = useState(2847)
  const pathname = usePathname()
  const t = useTranslations('nav')
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS]  // seamless loop

  useEffect(() => {
    const id = setInterval(() => {
      setSignalCount(n => n + Math.floor(Math.random() * 3))
    }, 3500)
    return () => clearInterval(id)
  }, [])

  return (
    <nav aria-label="WorldPulse top navigation" className="fixed top-0 left-0 right-0 h-[52px] glass border-b border-[rgba(255,255,255,0.07)] flex items-center px-5 z-[1000] gap-0">

      {/* LOGO */}
      <Link href="/" aria-label="WorldPulse — go to home feed" className="flex items-center gap-2 flex-shrink-0 no-underline">
        <span className="w-2 h-2 rounded-full bg-wp-red shadow-[0_0_12px_#ff3b5c] animate-live-pulse" aria-hidden="true" />
        <span className="font-display text-[26px] tracking-[3px] text-wp-text" aria-hidden="true">
          WORLD<span className="text-wp-amber">PULSE</span>
        </span>
      </Link>

      {/* TICKER — decorative, hidden from screen readers */}
      <div
        className="flex-1 overflow-hidden h-[52px] flex items-center mx-6 relative"
        aria-hidden="true"
      >
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-14 bg-gradient-to-r from-wp-bg to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-14 bg-gradient-to-l from-wp-bg to-transparent z-10 pointer-events-none" />

        <div className="flex animate-ticker whitespace-nowrap">
          {doubled.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-2 px-7 font-mono text-[11px] text-wp-text2 cursor-pointer hover:text-wp-text transition-colors">
              <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${DOT_COLORS[item.type]}`} />
              <span className="font-semibold text-wp-text">{item.label}</span>
              {item.text}
            </span>
          ))}
        </div>
      </div>

      {/* RIGHT CONTROLS */}
      <div className="flex items-center gap-3 flex-shrink-0">

        {/* LIVE badge */}
        <div
          role="status"
          aria-label="Live — real-time updates active"
          className="flex items-center gap-[6px] bg-[rgba(255,59,92,0.12)] border border-[rgba(255,59,92,0.3)] rounded px-[10px] py-1 font-mono text-[10px] text-wp-red font-bold tracking-widest"
        >
          <span className="w-[6px] h-[6px] rounded-full bg-wp-red animate-live-pulse" aria-hidden="true" />
          {t('live')}
        </div>

        {/* Signal count */}
        <div
          className="font-mono text-[11px] text-wp-text2 hidden sm:block"
          aria-live="polite"
          aria-label={`${t('tracking')} ${signalCount.toLocaleString()} ${t('signals')}`}
          aria-atomic="true"
        >
          {t('tracking')} <span className="text-wp-amber font-bold" aria-hidden="true">{signalCount.toLocaleString()}</span> {t('signals')}
        </div>

        {/* Search */}
        <Link
          href="/search"
          aria-label="Search WorldPulse"
          className="hidden md:flex items-center gap-2 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-lg px-3 py-[6px] text-wp-text3 hover:text-wp-text hover:border-[rgba(255,255,255,0.15)] transition-all text-[13px] w-44"
        >
          <span aria-hidden="true">🔍</span>
          <span aria-hidden="true">{t('searchSignals')}</span>
        </Link>

        {/* Language switcher */}
        <LanguageSwitcher />

        <Link href="/auth/login" className="px-4 py-[7px] rounded-lg border border-[rgba(255,255,255,0.15)] bg-transparent text-wp-text2 text-[13px] font-medium hover:border-wp-amber hover:text-wp-amber transition-all">
          {t('signIn')}
        </Link>

        <Link href="/auth/register" className="px-4 py-[7px] rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all">
          {t('joinFree')}
        </Link>
      </div>
    </nav>
  )
}
