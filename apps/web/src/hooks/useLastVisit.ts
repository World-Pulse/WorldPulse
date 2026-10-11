'use client'

/**
 * When this reader last looked at the World Map (plan M8). The time read when
 * the page opens stays fixed for the visit; the page notes "seen now" every
 * few minutes and when it's hidden or closed, so the next visit compares
 * against the end of this one.
 */

import { useEffect, useState } from 'react'
import { readLastVisit, writeLastVisit, SEEN_EVERY_MS } from '@/lib/last-visit'

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

// Read once per page load: the map remounting (or React running effects
// twice in development) must not read back the "seen now" it just wrote
let readAtLoad: number | null | undefined

export function useLastVisit(): number | null {
  const [lastVisit, setLastVisit] = useState<number | null>(null)
  useEffect(() => {
    // Read after the first render (the server has no localStorage)
    if (readAtLoad === undefined) readAtLoad = readLastVisit(storage())
    setLastVisit(readAtLoad)
    const seen = () => writeLastVisit(storage())
    const onHide = () => { if (document.visibilityState === 'hidden') seen() }
    // Not right away: a reload a minute later should still see the old time
    const timer = setInterval(seen, SEEN_EVERY_MS)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', seen)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', seen)
      seen()
    }
  }, [])
  return lastVisit
}
