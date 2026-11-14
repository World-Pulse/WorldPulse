'use client'

/**
 * The breaking banner, under the top menu (Nov 9, 2026: back on, Devon: "Yes", after "the banner should always be
 * accurate"). It shows the API's breaking list (news only, each story once with its outlet count) for the last few
 * hours, the stories two outlets or more report, newest first, rotating every 8 seconds. A reader closes it for
 * themselves only, for the rest of the visit. It asks the API every 90 seconds (the API keeps its answer 15
 * seconds), so it opens no connection of its own.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { alertHref, bannerAlerts, bannerHiddenOn, proofText, timeAgo, type BannerAlert } from '@/lib/breaking-banner'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const POLL_MS = 90_000
const ROTATE_MS = 8_000
const CLOSED_KEY = 'wp-breaking-closed'
/** The banner's height before it is measured: a phone's two-line banner, and the one line of wider screens */
const BANNER_ROOM = 'h-[49px] sm:h-[35px]'

const SEVERITY_STYLES: Record<string, { bg: string; border: string; dot: string }> = {
  critical: { bg: 'bg-red-950/95', border: 'border-b border-red-500', dot: 'bg-red-500' },
  high: { bg: 'bg-orange-950/95', border: 'border-b border-orange-500', dot: 'bg-orange-500' },
}

function readClosed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(CLOSED_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveClosed(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(CLOSED_KEY, JSON.stringify([...ids].slice(-100)))
  } catch {
    // private windows: closed for this page only
  }
}

export function BreakingAlertBanner() {
  const pathname = usePathname()
  const [alerts, setAlerts] = useState<BannerAlert[]>([])
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const [index, setIndex] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/breaking/alerts`)
      if (!res.ok) return
      const body = (await res.json()) as { success?: boolean; data?: { alerts?: BannerAlert[] } }
      if (body.success && Array.isArray(body.data?.alerts)) setAlerts(body.data.alerts)
      setNow(Date.now())
    } catch {
      // the banner simply stays as it was
    }
  }, [])

  useEffect(() => {
    setClosed(readClosed())
    void load()
    const poll = setInterval(() => { void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const shown = useMemo(() => bannerAlerts(alerts, now, closed), [alerts, now, closed])

  useEffect(() => {
    setIndex(0)
    if (shown.length <= 1) return
    const rotate = setInterval(() => setIndex(i => (i + 1) % shown.length), ROTATE_MS)
    return () => clearInterval(rotate)
  }, [shown.length])

  const close = useCallback(() => {
    setClosed(prev => {
      // closing the banner closes what it holds now; a new alert brings it back
      const next = new Set(prev)
      for (const a of shown) next.add(a.alertId)
      saveClosed(next)
      return next
    })
  }, [shown])

  // The banner is fixed under the top menu, so it used to lie over the first lines of every page (the home
  // page's "stories verified" line sat hidden beneath it). A spacer of its own height now moves the page down
  // while it shows (Nov 12, 2026).
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!bar) { setHeight(0); return }
    const measure = () => setHeight(bar.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(bar)
    return () => watch.disconnect()
  }, [bar])

  if (bannerHiddenOn(pathname)) return null
  const alert = shown.length > 0 ? shown[index % shown.length] : undefined
  // The banner's room is kept from the first paint, banner or not: the alerts arrive a second after the page,
  // and the room they then took pushed the whole page down (on a phone a layout shift of 0.29, Nov 13, 2026).
  if (!alert) return <div aria-hidden="true" className={BANNER_ROOM} />
  const styles = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.high!
  const proof = proofText(alert.story)

  return (
    <>
    <div aria-hidden="true" className={BANNER_ROOM} style={height > 0 ? { height } : undefined} />
    <div
      ref={setBar}
      className={`fixed top-[52px] left-0 right-0 z-[999] ${styles.bg} ${styles.border} backdrop-blur-sm shadow-lg`}
      role="region"
      aria-label="Breaking news"
    >
      <div className="mx-auto max-w-7xl px-3 py-0.5 sm:py-1.5 flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${styles.dot} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${styles.dot}`} />
          </span>
          {/* a phone keeps the pulsing dot and gives the word's room to the headline */}
          <span className="sr-only sm:not-sr-only sm:text-[11px] sm:font-bold sm:tracking-wider sm:text-white sm:uppercase">Breaking</span>
        </div>

        {/* a flex box: on phones every link is at least 44 px tall (globals.css), so the headline sits in its middle */}
        <Link href={alertHref(alert)} className="flex-1 min-w-0 flex items-center text-left text-[13px] font-medium text-white hover:underline" title={alert.title}>
          {/* a phone shows the headline on two lines (one line cut it off after five words); the banner keeps one height */}
          <span className="sm:hidden line-clamp-2 text-[12.5px] leading-[1.25]">{alert.title}</span>
          <span className="hidden sm:block truncate">{alert.title}</span>
        </Link>

        {proof && (
          <span
            className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${alert.story?.verified ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/80'}`}
            title={proof}
          >
            <span className="hidden sm:inline">{proof}</span>
            <span className="sm:hidden" aria-label={`${alert.story?.outlets ?? 2} outlets`}>{alert.story?.verified ? `✓ ${alert.story.outlets}` : `${alert.story?.outlets ?? 2}`}</span>
          </span>
        )}

        <span className="hidden md:inline shrink-0 text-[10px] text-white/50">{timeAgo(alert.timestamp, now)}</span>

        {shown.length > 1 && (
          <span className="hidden sm:flex items-center gap-1 shrink-0" aria-hidden="true">
            {shown.map((a, i) => (
              <span key={a.alertId} className={`w-1.5 h-1.5 rounded-full ${i === index % shown.length ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </span>
        )}

        <button
          type="button"
          onClick={close}
          className="shrink-0 p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          aria-label="Close breaking news"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    </>
  )
}
