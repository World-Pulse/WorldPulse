'use client'

/**
 * "In the news" on the home page (Oct 13, 2026): the people, places and
 * organisations named in the most reports in the last 24 hours, rising ones
 * first (GET /api/v1/knowledge-graph/trending), each opening its entity page.
 * One scrollable row under Developing Stories. Its height is kept while it
 * loads so the feed below doesn't jump; if it can't load, the row goes away.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { entityPath, entityTypeIcon } from '@/lib/entity-links'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const SHOWN = 10

interface Trending {
  entity: { id: string; type: string; canonical_name: string }
  recent_mentions: number
  spike_ratio: number | null
  is_new?: boolean
}

export function InTheNews() {
  const [items, setItems] = useState<Trending[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/v1/knowledge-graph/trending?limit=${SHOWN}&window_hours=24&lean=1`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { trending?: Trending[] } | null) => {
        if (!cancelled) setItems(Array.isArray(d?.trending) ? d.trending.filter(t => t.entity?.id && t.entity.canonical_name) : [])
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])

  if (items !== null && items.length === 0) return null

  return (
    <section aria-labelledby="in-the-news" className="border-b border-[rgba(255,255,255,0.07)] min-h-[52px]">
      <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto scrollbar-none">
        <h2 id="in-the-news" className="flex-shrink-0 font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          In the news
        </h2>
        {(items ?? []).map(t => (
          <Link
            key={t.entity.id}
            href={entityPath(t.entity.id, t.entity.canonical_name)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-[12px] text-wp-text2 hover:text-wp-text hover:border-wp-amber/40 transition-colors"
            title={`${t.recent_mentions} reports in the last 24 hours`}
          >
            <span aria-hidden="true">{entityTypeIcon(t.entity.type)}</span>
            <span className="whitespace-nowrap">{t.entity.canonical_name}</span>
            {t.is_new
              ? <span className="font-mono text-[9px] text-wp-amber">NEW</span>
              : t.spike_ratio != null && t.spike_ratio >= 1.5
                ? <span className="font-mono text-[9px] text-wp-red">↑{t.spike_ratio.toFixed(1)}×</span>
                : null}
          </Link>
        ))}
      </div>
    </section>
  )
}
