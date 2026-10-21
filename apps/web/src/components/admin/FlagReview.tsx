'use client'

/**
 * The review list on /admin (plan C5; Devon, Oct 21, 2026: "Show it + review
 * list"): reports three or more readers flagged in the last 30 days, the
 * most flagged first, with why and the newest notes
 * (GET /api/v1/admin/flags, admins only).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { flagLine } from '@/lib/story-follow'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface ReviewItem {
  id: string
  title: string
  status: string
  flags: number
  reasons: Record<string, number>
  lastFlagAt: string | null
  notes: string[]
}

export function FlagReview({ token }: { token: string | null }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${API_URL}/api/v1/admin/flags`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as { data?: { items?: ReviewItem[] } }
        if (!cancelled) setItems(json.data?.items ?? [])
      })
      .catch(err => { if (!cancelled) setError(`Couldn't load the review list (${String(err instanceof Error ? err.message : err)})`) })
    return () => { cancelled = true }
  }, [token])

  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl px-5 py-4">
      <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Flagged by readers · 3+ in 30 days</h2>
      {error ? (
        <p className="text-[13px] text-wp-red">{error}</p>
      ) : items === null ? (
        <p className="text-[13px] text-wp-text3">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-wp-text2">Nothing to review: no report has three or more readers&rsquo; flags.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(it => (
            <li key={it.id} className="border-t border-white/5 pt-3 first:border-0 first:pt-0">
              <Link href={`/signals/${it.id}`} className="text-[13px] text-wp-text hover:text-wp-cyan">{it.title || it.id}</Link>
              <p className="text-[12px] text-wp-amber mt-0.5">
                {flagLine(it.flags, it.reasons)} · {it.status}
                {it.lastFlagAt ? ` · last ${new Date(it.lastFlagAt).toLocaleString()}` : ''}
              </p>
              {it.notes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {it.notes.map((n, i) => <li key={i} className="text-[12px] text-wp-text2">&ldquo;{n}&rdquo;</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
