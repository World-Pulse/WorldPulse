'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTheme } from '@/components/providers'

const FALLBACK_TICKER_ITEMS = [
  { id: '', type: 'red',   label: 'BREAKING',  text: 'Loading live headlines…' },
  { id: '', type: 'amber', label: 'MARKETS',   text: 'Connecting to signal feed…' },
  { id: '', type: 'cyan',  label: 'CLIMATE',   text: 'Fetching latest intelligence…' },
]

const DOT_COLORS: Record<string, string> = {
  red:   'bg-wp-red shadow-[0_0_6px_#ff3b5c]',
  amber: 'bg-wp-amber shadow-[0_0_6px_#f5a623]',
  cyan:  'bg-wp-cyan shadow-[0_0_6px_#00d4ff]',
  green: 'bg-wp-green shadow-[0_0_6px_#00e676]',
}

const NAV_LINKS = [
  { href: '/',            icon: '⚡', label: 'Live Feed'    },
  { href: '/map',         icon: '🌍', label: 'World Map'    },
  { href: '/alerts',      icon: '🔔', label: 'Alerts'       },
  { href: '/analytics',   icon: '📊', label: 'Analytics'    },
  { href: '/explore',     icon: '🔭', label: 'Explore'      },
  { href: '/communities', icon: '🤝', label: 'Communities'  },
  { href: '/sources',     icon: '📡', label: 'Sources'      },
  { href: '/settings',    icon: '⚙️', label: 'Settings'     },
]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface TickerItem {
  id: string
  type: string
  label: string
  text: string
}

interface AuthUser {
  id: string
  handle: string
  displayName: string
  avatarUrl: string | null
  accountType: string
}

export function TopNav() {
  const [signalCount, setSignalCount] = useState(0)
  const [tickerItems, setTickerItems] = useState<TickerItem[]>(FALLBACK_TICKER_ITEMS)
  const [tickerPaused, setTickerPaused] = useState(false)
  const [user, setUser]               = useState<AuthUser | null>(null)
  const [mobileOpen, setMobileOpen]   = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const t        = useTranslations('nav')
  const { theme, toggle } = useTheme()
  const doubled  = [...tickerItems, ...tickerItems]  // seamless loop

  // Read auth state from localStorage on mount + sync across tabs
  useEffect(() => {
    const raw = localStorage.getItem('wp_user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { /* ignore malformed */ }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'wp_user') {
        setUser(e.newValue ? JSON.parse(e.newValue) : null)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Fetch real signal count from API + poll every 30s
  useEffect(() => {
    let mounted = true
    async function fetchCount() {
      try {
        const res = await fetch(`${API_URL}/api/v1/signals/count`)
        if (res.ok) {
          const json = await res.json()
          if (mounted && json.success) setSignalCount(json.data.total)
        }
      } catch { /* API unavailable — keep last known value */ }
    }
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Fetch real headlines for ticker from API + refresh every 60s
  useEffect(() => {
    let mounted = true
    async function fetchHeadlines() {
      try {
        const res = await fetch(`${API_URL}/api/v1/signals/headlines`)
        if (res.ok) {
          const json = await res.json()
          if (mounted && json.success && json.data.length > 0) {
            setTickerItems(json.data)
          }
        }
      } catch { /* API unavailable — keep fallback items */ }
    }
    fetchHeadlines()
    const id = setInterval(fetchHeadlines, 60_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function logout() {
    localStorage.removeItem('wp_access_token')
    localStorage.removeItem('wp_refresh_token')
    localStorage.removeItem('wp_user')
    setUser(null)
    setMobileOpen(false)
    router.push('/')
    router.refresh()
  }

  return (
    <>
      <nav
        aria-label="WorldPulse top navigation"
        className="fixed top-0 left-0 right-0 h-[52px] glass border-b border-[rgba(255,255,255,0.07)] flex items-center px-4 z-[1000] gap-0"
      >

        {/* LOGO */}
        <Link href="/" aria-label="WorldPulse — go to home feed" className="flex items-center gap-2 flex-shrink-0 no-underline">
          <span className="w-2 h-2 rounded-full bg-wp-red shadow-[0_0_12px_#ff3b5c] animate-live-pulse" aria-hidden="true" />
          <span className="font-display text-[22px] sm:text-[26px] tracking-[3px] text-wp-text" aria-hidden="true">
            WORLD<span className="text-wp-amber">PULSE</span>
          </span>
        </Link>

        {/* HAMBURGER (mobile only) */}
        <button
          onClick={() => setMobileOpen(v => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-drawer"
          className="md:hidden ml-2 w-8 h-8 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[18px] flex-shrink-0"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>

        {/* TICKER — desktop only, live headlines */}
        <div
          className="hidden md:flex flex-1 overflow-hidden h-[52px] items-center mx-6 relative"
          aria-label="Live news headlines ticker"
          onMouseEnter={() => setTickerPaused(true)}
          onMouseLeave={() => setTickerPaused(false)}
        >
          {/* Fade edges */}
          <div className="absolute left-0 top-0 bottom-0 w-14 bg-gradient-to-r from-wp-bg to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-14 bg-gradient-to-l from-wp-bg to-transparent z-10 pointer-events-none" />

          <div
            className="flex whitespace-nowrap"
            style={{
              animation: 'ticker 45s linear infinite',
              animationPlayState: tickerPaused ? 'paused' : 'running',
            }}
          >
            {doubled.map((item, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 px-7 font-mono text-[11px] text-wp-text2 cursor-pointer hover:text-wp-text transition-colors"
                role={item.id ? 'link' : undefined}
                onClick={() => item.id && router.push(`/signals/${item.id}`)}
              >
                <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${DOT_COLORS[item.type]}`} />
                <span className="font-semibold text-wp-text">{item.label}</span>
                {item.text}
              </span>
            ))}
          </div>
        </div>

        {/* Spacer on mobile (pushes controls right) */}
        <div className="flex-1 md:hidden" />

        {/* RIGHT CONTROLS */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* LIVE badge */}
          <div
            role="status"
            aria-label="Live — real-time updates active"
            className="hidden sm:flex items-center gap-[6px] bg-[rgba(255,59,92,0.12)] border border-[rgba(255,59,92,0.3)] rounded px-[10px] py-1 font-mono text-[10px] text-wp-red font-bold tracking-widest"
          >
            <span className="w-[6px] h-[6px] rounded-full bg-wp-red animate-live-pulse" aria-hidden="true" />
            {t('live')}
          </div>

          {/* Signal count — md+ only */}
          <div
            className="font-mono text-[11px] text-wp-text2 hidden md:block"
            aria-live="polite"
            aria-label={`${t('tracking')} ${signalCount.toLocaleString()} ${t('signals')}`}
            aria-atomic="true"
          >
            {t('tracking')} <span className="text-wp-amber font-bold" aria-hidden="true">{signalCount.toLocaleString()}</span> {t('signals')}
          </div>

          {/* Search — md+ only */}
          <Link
            href="/search"
            aria-label="Search WorldPulse — or press ⌘K"
            className="hidden md:flex items-center gap-2 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-lg px-3 py-[6px] text-wp-text3 hover:text-wp-text hover:border-[rgba(255,255,255,0.15)] transition-all text-[13px] w-44"
          >
            <span aria-hidden="true">🔍</span>
            <span aria-hidden="true" className="flex-1">{t('searchSignals')}</span>
            <kbd className="font-mono text-[10px] border border-[rgba(255,255,255,0.1)] rounded px-1 py-px ml-auto" aria-hidden="true">⌘K</kbd>
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[15px]"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          {/* Language switcher — sm+ only */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>

          {/* Auth controls */}
          {user ? (
            <div className="relative group">
              <button
                className="flex items-center gap-2 px-2 py-[5px] rounded-lg hover:bg-[rgba(255,255,255,0.06)] transition-all"
                aria-label="Account menu"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[12px] text-black flex-shrink-0">
                  {(user.displayName || user.handle).charAt(0).toUpperCase()}
                </div>
                <span className="text-[13px] text-wp-text2 font-medium hidden sm:block max-w-[100px] truncate">
                  @{user.handle}
                </span>
              </button>

              {/* Dropdown */}
              <div className="absolute right-0 top-full mt-1 w-44 glass border border-[rgba(255,255,255,0.1)] rounded-xl py-1 shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-50">
                <Link
                  href={`/users/${user.handle}`}
                  className="block px-4 py-[9px] text-[13px] text-wp-text2 hover:text-wp-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                >
                  Your Profile
                </Link>
                <Link
                  href="/analytics"
                  className="block px-4 py-[9px] text-[13px] text-wp-text2 hover:text-wp-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                >
                  Analytics
                </Link>
                <div className="border-t border-[rgba(255,255,255,0.07)] my-1" />
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-[9px] text-[13px] text-wp-red hover:bg-[rgba(255,59,92,0.08)] transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden sm:flex px-3 py-[7px] rounded-lg border border-[rgba(255,255,255,0.15)] bg-transparent text-wp-text2 text-[13px] font-medium hover:border-wp-amber hover:text-wp-amber transition-all"
              >
                {t('signIn')}
              </Link>
              <Link
                href="/auth/register"
                className="px-3 py-[7px] rounded-lg bg-wp-amber text-black text-[12px] sm:text-[13px] font-bold hover:bg-[#ffb84d] transition-all"
              >
                {t('joinFree')}
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* MOBILE DRAWER */}
      {mobileOpen && (
        <div
          id="mobile-nav-drawer"
          className="fixed inset-0 z-[1100] md:hidden"
          aria-modal="true"
          role="dialog"
          aria-label="Navigation menu"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-wp-surface border-r border-[rgba(255,255,255,0.1)] flex flex-col overflow-y-auto animate-slide-in-left">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)] flex-shrink-0">
              <span className="font-display text-[22px] tracking-[3px] text-wp-text">
                WORLD<span className="text-wp-amber">PULSE</span>
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text transition-all"
              >
                ✕
              </button>
            </div>

            {/* Nav links */}
            <nav aria-label="Primary navigation" className="flex-1 px-3 py-4 space-y-0.5">
              {NAV_LINKS.map(({ href, icon, label }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 py-[10px] rounded-lg text-[15px] transition-all
                      ${active
                        ? 'bg-[rgba(245,166,35,0.12)] text-wp-amber'
                        : 'text-wp-text2 hover:bg-wp-s2 hover:text-wp-text'
                      }`}
                  >
                    <span className="text-[18px] w-6 text-center flex-shrink-0" aria-hidden="true">{icon}</span>
                    <span>{label}</span>
                  </Link>
                )
              })}
            </nav>

            {/* Footer — auth */}
            {user ? (
              <div className="px-3 pb-4 border-t border-[rgba(255,255,255,0.07)] pt-3 space-y-0.5 flex-shrink-0">
                <Link
                  href={`/users/${user.handle}`}
                  className="flex items-center gap-3 px-3 py-[10px] rounded-lg text-[15px] text-wp-text2 hover:bg-wp-s2 hover:text-wp-text transition-all"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[12px] text-black flex-shrink-0">
                    {(user.displayName || user.handle).charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium">@{user.handle}</span>
                </Link>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-3 py-[10px] rounded-lg text-[15px] text-wp-red hover:bg-[rgba(255,59,92,0.08)] transition-all text-left"
                >
                  <span className="text-[18px] w-6 text-center flex-shrink-0" aria-hidden="true">🚪</span>
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="px-4 pb-5 pt-4 border-t border-[rgba(255,255,255,0.07)] space-y-2 flex-shrink-0">
                <Link
                  href="/auth/login"
                  className="flex items-center justify-center py-3 rounded-xl border border-[rgba(255,255,255,0.15)] text-wp-text2 text-[14px] font-medium hover:border-wp-amber hover:text-wp-amber transition-all"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/register"
                  className="flex items-center justify-center py-3 rounded-xl bg-wp-amber text-black text-[14px] font-bold hover:bg-[#ffb84d] transition-all"
                >
                  Join Free
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
