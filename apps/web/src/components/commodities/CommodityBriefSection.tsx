'use client'

/**
 * The commodities part of the map's country brief (Oct 23, 2026; Devon: "Clicking a country shows
 * its crops, exports, what it buys from the US, its trade partners, its weather risk and its
 * news"): the country's commodity cards, most at risk first, and its US purchases in USDA's latest
 * week. Fetched when the brief opens; nothing shows for a country the watch has no readings for.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CommodityCardView } from './CommodityCardView'
import { baciCredit, dollarsK, partnersText, type CountryCommodities } from '@/lib/commodities'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** "2,178,641 t", "1.2 million t" */
function tons(n: number, unit: string): string {
  const word = unit === 'bales' ? 'bales' : 't'
  return Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)} million ${word}` : `${Math.round(n).toLocaleString('en-US')} ${word}`
}

export function CommodityBriefSection({ iso, highlight }: { iso: string | null; highlight?: string }) {
  const [data, setData] = useState<CountryCommodities | null>(null)
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading')
  const [all, setAll] = useState(false)

  useEffect(() => {
    if (!iso) { setState('none'); return }
    let alive = true
    setState('loading'); setAll(false)
    fetch(`${API_URL}/api/v1/commodities/country/${encodeURIComponent(iso.toLowerCase())}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: { success?: boolean; data?: CountryCommodities & { available?: boolean } } | null) => {
        if (!alive) return
        if (j?.success && j.data?.available && j.data.cards) { setData(j.data); setState('ready') } else setState('none')
      })
      .catch(() => { if (alive) setState('none') })
    return () => { alive = false }
  }, [iso])

  if (state === 'none' || !iso) return null
  if (state === 'loading' || !data) {
    return <div className="font-mono text-[10px] tracking-[1px] uppercase text-wp-text3">Commodities · loading…</div>
  }
  // The commodity picked on the map first, then the most at risk
  const cards = [...data.cards].sort((a, b) => Number(b.commodity === highlight) - Number(a.commodity === highlight) || b.score - a.score)
  const shown = all ? cards : cards.slice(0, 3)
  const purchases = data.us?.purchases.filter(p => p.net_sales !== 0).slice(0, 5) ?? []
  const week = data.us ? new Date(`${data.us.week_ending}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

  return (
    <section aria-label={`${data.country}: commodities`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-mono text-[9px] tracking-[2px] uppercase text-wp-text3">Commodities</div>
        {data.flags > 0 && <div className="font-mono text-[10px] text-red-300">{data.flags} supply risk{data.flags === 1 ? '' : 's'} not in the news</div>}
      </div>
      <div className="space-y-2">
        {shown.map(c => <CommodityCardView key={c.commodity} card={c} compact />)}
      </div>
      {cards.length > 3 && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-2 text-[12px] text-wp-text3 hover:text-wp-text2">
          {all ? 'Show fewer' : `Show all ${cards.length} commodities`}
        </button>
      )}
      {purchases.length > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[9px] tracking-[2px] uppercase text-wp-text3 mb-1.5">Bought from the US · week to {week}</div>
          <ul className="space-y-1">
            {purchases.map(p => (
              <li key={p.commodity} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-wp-text2 capitalize">{p.name}</span>
                <span className={`tabular-nums ${p.net_sales < 0 ? 'text-red-300' : 'text-wp-text'}`}>{p.net_sales < 0 ? 'cancelled ' : ''}{tons(Math.abs(p.net_sales), p.unit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.partners && (data.partners.exports.length > 0 || data.partners.imports.length > 0) && (
        <div className="mt-3 space-y-2">
          {([['Main buyers', data.partners.exports], ['Main suppliers', data.partners.imports]] as const).map(([title, lines]) => lines.length > 0 && (
            <div key={title}>
              <div className="font-mono text-[9px] tracking-[2px] uppercase text-wp-text3 mb-1">{title} · {data.partners!.year}</div>
              <ul className="space-y-1">
                {lines.slice(0, 3).map(l => (
                  <li key={l.commodity} className="text-[12px] leading-snug text-wp-text2">
                    <span className="text-wp-text">{l.name}</span> <span className="text-wp-text3 tabular-nums">{dollarsK(l.value)}</span>{l.top.length ? `: ${partnersText(l)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[10.5px] text-wp-text3">Trade: {baciCredit(data.partners)}, Etalab Open Licence 2.0</p>
        </div>
      )}
      <Link href={`/commodities?country=${iso.toUpperCase()}`} className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-wp-amber hover:underline">
        {data.country}&apos;s commodities in full <ArrowRight size={12} />
      </Link>
    </section>
  )
}
