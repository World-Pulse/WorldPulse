'use client'

/**
 * "A person is reading" (Nov 16, 2026): once a visitor has had a page open and
 * in view for 8 seconds AND has scrolled, tapped, clicked or typed, the page
 * asks the API one empty question (/api/v1/public/seen), once per visit.
 * scripts/readers.py counts a reader only when that question shows up, so
 * automated browsers that load a page and leave are no longer counted as people.
 * Nothing is stored or sent about the reader: no cookie, no identifier, no body.
 */

import { useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'
export const SEEN_SECONDS = 8
const SENT_KEY = 'wp-seen-sent'

export function ReaderSeen() {
  useEffect(() => {
    try { if (sessionStorage.getItem(SENT_KEY)) return } catch { /* still count */ }
    let shown = 0
    let moved = false
    let done = false
    const onMove = () => { moved = true }
    const events = ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const
    events.forEach(e => window.addEventListener(e, onMove, { passive: true, capture: true }))
    const stop = () => {
      clearInterval(timer)
      events.forEach(e => window.removeEventListener(e, onMove, { capture: true }))
    }
    const timer = setInterval(() => {
      if (done) return
      if (document.visibilityState === 'visible') shown += 1
      if (shown >= SEEN_SECONDS && moved) {
        done = true
        stop()
        try { sessionStorage.setItem(SENT_KEY, '1') } catch { /* ignore */ }
        fetch(`${API}/api/v1/public/seen`, { method: 'GET', cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => {})
      }
    }, 1000)
    return stop
  }, [])
  return null
}
