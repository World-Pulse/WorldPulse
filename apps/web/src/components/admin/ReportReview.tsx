'use client'

/**
 * Reported posts and communities on /admin (plan C6; Devon, Oct 21, 2026:
 * "Yes, add the table"): those three or more readers reported in the last
 * 30 days, the most reported first, with why and the newest notes
 * (GET /api/v1/admin/reports, admins only). Nothing is hidden automatically.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface ReportItem {
  type: 'post' | 'community'
  id: string
  preview: string
  by: string | null
  path: string
  reports: number
  reasons: Record<string, number>
  lastReportAt: string | null
  notes: string[]
}

/** "4 readers: spam 3, abuse 1" */
export function reportLine(reports: number, reasons: Record<string, number>): string {
  const why = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
  return `${reports} reader${reports === 1 ? '' : 's'}${why ? `: ${why}` : ''}`
}

export function ReportReview({ token }: { token: string | null }) {
  const [items, setItems] = useState<ReportItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${API_URL}/api/v1/admin/reports`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as { data?: { items?: ReportItem[] } }
        if (!cancelled) setItems(json.data?.items ?? [])
      })
      .catch(err => { if (!cancelled) setError(`Couldn't load the reported posts (${String(err instanceof Error ? err.message : err)})`) })
    return () => { cancelled = true }
  }, [token])

  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl px-5 py-4">
      <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Reported posts and communities · 3+ in 30 days</h2>
      {error ? (
        <p className="text-[13px] text-wp-red">{error}</p>
      ) : items === null ? (
        <p className="text-[13px] text-wp-text3">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-wp-text2">Nothing to review: no post or community has three or more readers&rsquo; reports.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(it => (
            <li key={`${it.type}:${it.id}`} className="border-t border-white/5 pt-3 first:border-0 first:pt-0">
              <span className="font-mono text-[10px] uppercase text-wp-text3 mr-2">{it.type}</span>
              <Link href={it.path.startsWith('/') ? it.path : '/'} className="text-[13px] text-wp-text hover:text-wp-cyan">{it.preview || it.id}</Link>
              <p className="text-[12px] text-wp-amber mt-0.5">
                {reportLine(it.reports, it.reasons)}{it.by ? ` · by @${it.by}` : ''}
                {it.lastReportAt ? ` · last ${new Date(it.lastReportAt).toLocaleString()}` : ''}
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
