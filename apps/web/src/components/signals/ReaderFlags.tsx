'use client'

/**
 * "Flagged by N readers" on a signal's page (plan C5; Devon, Oct 21, 2026:
 * "Show it + review list"): how many readers flagged the report and why,
 * never who or their notes. Asked only when the report has flags.
 */

import { useEffect, useState } from 'react'
import { flagLine } from '@/lib/story-follow'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function ReaderFlags({ signalId, count }: { signalId: string; count: number }) {
  const [reasons, setReasons] = useState<Record<string, number> | null>(null)
  const [total, setTotal] = useState(count)

  useEffect(() => {
    if (!(count > 0)) return
    let cancelled = false
    fetch(`${API_URL}/api/v1/signals/${encodeURIComponent(signalId)}/flags`)
      .then(r => (r.ok ? r.json() : null))
      .then((json: { data?: { count?: number; reasons?: Record<string, number> } } | null) => {
        if (cancelled || !json?.data) return
        setReasons(json.data.reasons ?? {})
        if (typeof json.data.count === 'number') setTotal(json.data.count)
      })
      .catch(() => { /* the count alone */ })
    return () => { cancelled = true }
  }, [signalId, count])

  const line = flagLine(total, reasons)
  if (!line) return null
  return (
    <div className="flex items-start gap-2 text-[12px] text-wp-amber bg-wp-amber/10 border border-wp-amber/25 rounded-lg px-3 py-2">
      <svg className="flex-shrink-0 mt-[2px]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
      </svg>
      <p>
        <span className="font-semibold">{line}.</span>{' '}
        <span className="text-wp-text2">
          A flag is a reader&rsquo;s report, not a ruling; reports that three or more readers flag go to WorldPulse&rsquo;s review list.
        </span>
      </p>
    </div>
  )
}
