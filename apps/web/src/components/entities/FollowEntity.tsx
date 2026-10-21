'use client'

/**
 * "Follow" on a person's, place's or organisation's page (plan K6; Devon,
 * Oct 21, 2026: alerts "Free for everyone"). Following makes an alert named
 * "Follow: <name>" that matches the name as a whole word, sent once a day
 * (GET/POST/DELETE /api/v1/alerts, channels.digest "daily"). Signed-out
 * readers get a link to sign in and come back here.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { authHeaders } from '@/lib/story-follow'
import { followAlertBody, followAlertName } from '@/lib/follow-entity'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type View =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; alertId: string | null; emailReady: boolean }
  | { kind: 'unavailable' }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function FollowEntity({ name, path }: { name: string; path: string }) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const headers = authHeaders(storage())
    if (!headers) { setView({ kind: 'signed-out' }); return }
    let cancelled = false
    fetch(`${API_URL}/api/v1/alerts`, { headers })
      .then(async r => {
        if (cancelled) return
        if (r.status === 401) { setView({ kind: 'signed-out' }); return }
        if (!r.ok) { setView({ kind: 'unavailable' }); return }
        const json = await r.json() as { data?: Array<{ id: string; name: string }>; emailReady?: boolean }
        const mine = (json.data ?? []).find(a => a.name === followAlertName(name))
        setView({ kind: 'ready', alertId: mine?.id ?? null, emailReady: json.emailReady === true })
      })
      .catch(() => { if (!cancelled) setView({ kind: 'unavailable' }) })
    return () => { cancelled = true }
  }, [name])

  const toggle = useCallback(async () => {
    if (view.kind !== 'ready' || busy) return
    const headers = authHeaders(storage())
    if (!headers) { setView({ kind: 'signed-out' }); return }
    setBusy(true)
    setError(null)
    try {
      if (view.alertId) {
        const r = await fetch(`${API_URL}/api/v1/alerts/${encodeURIComponent(view.alertId)}`, { method: 'DELETE', headers })
        if (!r.ok) { setError('Couldn’t stop following just now. Please try again.'); return }
        setView({ ...view, alertId: null })
      } else {
        const r = await fetch(`${API_URL}/api/v1/alerts`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(followAlertBody(name)),
        })
        if (r.status === 429) { setError('You have 20 alerts already: remove one on the Alerts page first.'); return }
        if (!r.ok) { setError('Couldn’t follow just now. Please try again.'); return }
        const json = await r.json() as { data?: { id?: string } }
        setView({ ...view, alertId: json.data?.id ?? 'new' })
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, name, view])

  if (view.kind === 'loading' || view.kind === 'unavailable') return null

  const button = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-full border font-mono text-[11px] transition-all min-h-[40px]'
  if (view.kind === 'signed-out') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/auth/login?next=${encodeURIComponent(path)}`} className={`${button} border-white/10 text-wp-text2 hover:border-wp-cyan/40 hover:text-wp-cyan`}>
          + Follow {name}
        </Link>
        <span className="text-[11px] text-wp-text3">Sign in to get the new reports naming {name}, once a day.</span>
      </div>
    )
  }

  const following = Boolean(view.alertId)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={following}
          className={`${button} ${following ? 'border-wp-cyan/50 text-wp-cyan bg-wp-cyan/10' : 'border-white/10 text-wp-text2 hover:border-wp-cyan/40 hover:text-wp-cyan'} disabled:opacity-60`}
        >
          {following ? `✓ Following ${name}` : `+ Follow ${name}`}
        </button>
        <span className="text-[11px] text-wp-text3">
          {view.emailReady
            ? `One email a day with the new reports naming ${name}.`
            : `One email a day with the new reports naming ${name}, once WorldPulse's email is switched on.`}
          {' '}<Link href="/alerts" className="underline hover:text-wp-text2">Your alerts</Link>
        </span>
      </div>
      {error && <p role="alert" className="text-[11px] text-wp-red">{error}</p>}
    </div>
  )
}
