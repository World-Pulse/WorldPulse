'use client'

/**
 * "Follow story" on a story's page (plan 8; Devon, Oct 21, 2026: "Yes, add
 * it"). Signed-in readers follow; when they come back, the page says what
 * changed since their last visit (new reports, new outlets), then counts the
 * story as seen. Signed-out readers get a link to sign in and come back here.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { authHeaders, sinceLine, type StoryChanges } from '@/lib/story-follow'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type View =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; following: boolean; since: string | null }
  | { kind: 'unavailable' }

interface FollowAnswer { following?: boolean; lastSeenAt?: string | null; since?: StoryChanges | null }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function FollowStory({ signalId }: { signalId: string }) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `${API_URL}/api/v1/stories/${encodeURIComponent(signalId)}/follow`

  useEffect(() => {
    const headers = authHeaders(storage())
    if (!headers) { setView({ kind: 'signed-out' }); return }
    let cancelled = false
    fetch(url, { headers })
      .then(async r => {
        if (cancelled) return
        if (r.status === 401) { setView({ kind: 'signed-out' }); return }
        if (!r.ok) { setView({ kind: 'unavailable' }); return }
        const data = ((await r.json()) as { data?: FollowAnswer }).data ?? {}
        const line = data.following ? sinceLine(data.since, data.lastSeenAt) : null
        setView({ kind: 'ready', following: Boolean(data.following), since: line })
        // what's new has been shown: the next visit counts from now
        if (data.following) void fetch(`${url}/seen`, { method: 'POST', headers }).catch(() => {})
      })
      .catch(() => { if (!cancelled) setView({ kind: 'unavailable' }) })
    return () => { cancelled = true }
  }, [url])

  const toggle = useCallback(async () => {
    if (view.kind !== 'ready' || busy) return
    const headers = authHeaders(storage())
    if (!headers) { setView({ kind: 'signed-out' }); return }
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(url, { method: view.following ? 'DELETE' : 'PUT', headers })
      const body = await r.json().catch(() => null) as { data?: FollowAnswer; error?: string } | null
      if (r.status === 401) { setView({ kind: 'signed-out' }); return }
      if (!r.ok) { setError(body?.error ?? 'Couldn’t change that just now. Please try again.'); return }
      setView({ kind: 'ready', following: Boolean(body?.data?.following), since: null })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, url, view])

  if (view.kind === 'loading' || view.kind === 'unavailable') return null

  const star = (filled: boolean) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
  const button = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-full border font-mono text-[11px] transition-all min-h-[40px]'

  if (view.kind === 'signed-out') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/auth/login?next=${encodeURIComponent(`/signals/${signalId}`)}`}
          className={`${button} border-white/10 text-wp-text2 hover:border-wp-cyan/40 hover:text-wp-cyan`}
        >
          {star(false)} Follow story
        </Link>
        <span className="text-[11px] text-wp-text3">Sign in to follow it and see what changed when you come back.</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {view.since && (
        <p role="status" className="text-[12px] text-wp-cyan bg-wp-cyan/10 border border-wp-cyan/25 rounded-lg px-3 py-2">
          {view.since}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={view.following}
          className={`${button} ${view.following ? 'border-wp-cyan/50 text-wp-cyan bg-wp-cyan/10' : 'border-white/10 text-wp-text2 hover:border-wp-cyan/40 hover:text-wp-cyan'} disabled:opacity-60`}
        >
          {star(view.following)} {view.following ? 'Following' : 'Follow story'}
        </button>
        <span className="text-[11px] text-wp-text3">
          {view.following ? 'Come back any time to see what changed.' : 'See what changed each time you come back.'}
        </span>
      </div>
      {error && <p role="alert" className="text-[11px] text-wp-red">{error}</p>}
    </div>
  )
}
