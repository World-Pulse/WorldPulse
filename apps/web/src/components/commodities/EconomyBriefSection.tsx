'use client'

/**
 * The economy part of the map's country brief (Oct 23, 2026; Devon: "Add ... CME like data and the
 * Lloyd's bank like data and layers to the map too"): the country's main figures (World Bank), its
 * trade in all goods with its main partners and products (CEPII BACI), how commodity prices moved its
 * exports this month (World Bank prices), and Lloyd's List's latest headlines about it. Fetched when
 * the brief opens; nothing shows for a country none of them covers.
 */

import { useEffect, useState } from 'react'
import { baciCredit, dollarsK } from '@/lib/commodities'
import { formatEcon, signed, movesText, type EconomyProfile, type ShippingHeadline } from '@/lib/trade-layers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** The figures shown first, in this order */
const FIRST = ['growth', 'inflation', 'unemployment', 'gdp_per_person', 'gdp', 'trade', 'current_account', 'population']

function ago(iso: string): string {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000))
  return h < 1 ? 'just now' : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const LABEL = 'font-mono text-[9px] tracking-[2px] uppercase text-wp-text3'

export function EconomyBriefSection({ iso }: { iso: string | null }) {
  const [data, setData] = useState<EconomyProfile | null>(null)
  const [news, setNews] = useState<ShippingHeadline[]>([])
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading')
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (!iso) { setState('none'); return }
    let alive = true
    setState('loading'); setMore(false); setNews([])
    const code = encodeURIComponent(iso.toLowerCase())
    Promise.all([
      fetch(`${API_URL}/api/v1/economy/${code}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_URL}/api/v1/maritime/headlines?country=${code}&limit=4`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([e, h]: [{ success?: boolean; data?: EconomyProfile & { available?: boolean } } | null, { success?: boolean; data?: { available?: boolean; items?: ShippingHeadline[] } } | null]) => {
      if (!alive) return
      const items = h?.success && h.data?.available ? h.data.items ?? [] : []
      setNews(items)
      if (e?.success && e.data?.available && e.data.iso) { setData(e.data); setState('ready') } else setState(items.length ? 'ready' : 'none')
    })
    return () => { alive = false }
  }, [iso])

  if (state === 'none' || !iso) return null
  if (state === 'loading') return <div className="font-mono text-[10px] tracking-[1px] uppercase text-wp-text3">Economy · loading…</div>

  const values = [...(data?.figures?.values ?? [])].sort((a, b) => FIRST.indexOf(a.key) - FIRST.indexOf(b.key))
  const shown = more ? values : values.slice(0, 4)
  const t = data?.trade, p = data?.prices
  const lines = (list: Array<{ name: string; share: number }>) => list.slice(0, 3).map(x => `${x.name} ${x.share >= 10 ? Math.round(x.share) : x.share}%`).join(', ')

  return (
    <section aria-label={`${data?.name ?? iso}: economy`} className="space-y-3">
      {values.length > 0 && (
        <div>
          <div className={`${LABEL} mb-1.5`}>Economy{data?.income ? ` · ${data.income}` : ''}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {shown.map(v => (
              <div key={v.key} className="min-w-0">
                <dt className="text-[10.5px] text-wp-text3 truncate">{v.name} <span className="tabular-nums">· {v.year}</span></dt>
                <dd className="text-[13px] text-wp-text tabular-nums">{formatEcon(v.unit, v.value)}</dd>
              </div>
            ))}
          </dl>
          {values.length > 4 && (
            <button type="button" onClick={() => setMore(m => !m)} className="mt-1 text-[11.5px] text-wp-text3 hover:text-wp-text2">{more ? 'Fewer figures' : `All ${values.length} figures`}</button>
          )}
        </div>
      )}

      {t && (t.exports > 0 || t.imports > 0) && (
        <div className="space-y-1">
          <div className={LABEL}>Trade in goods · {t.year}</div>
          <p className="text-[12px] leading-snug text-wp-text2">
            Exports <span className="text-wp-text tabular-nums">{dollarsK(t.exports)}</span>, imports <span className="text-wp-text tabular-nums">{dollarsK(t.imports)}</span>
          </p>
          {t.buyers.length > 0 && <p className="text-[12px] leading-snug text-wp-text2"><span className="text-wp-text3">Buyers:</span> {lines(t.buyers)}</p>}
          {t.suppliers.length > 0 && <p className="text-[12px] leading-snug text-wp-text2"><span className="text-wp-text3">Suppliers:</span> {lines(t.suppliers)}</p>}
          {t.exports_by.length > 0 && <p className="text-[12px] leading-snug text-wp-text2"><span className="text-wp-text3">Sells:</span> {lines(t.exports_by)}</p>}
        </div>
      )}

      {p && p.month_pct !== null && (
        <div className="space-y-1">
          <div className={LABEL}>Prices of its commodity exports</div>
          <p className="text-[12px] leading-snug text-wp-text2">
            <span className={`tabular-nums font-semibold ${p.month_pct > 0 ? 'text-emerald-300' : p.month_pct < 0 ? 'text-red-300' : 'text-wp-text'}`}>{signed(p.month_pct)}</span> on the month,
            {' '}<span className="tabular-nums text-wp-text">{signed(p.year_pct)}</span> on the year{p.exposed_pct !== null ? ` (${Math.round(p.exposed_pct)}% of its exports)` : ''}: {movesText(p.items)}
          </p>
        </div>
      )}

      {news.length > 0 && (
        <div className="space-y-1">
          <div className={LABEL}>Shipping news</div>
          <ul className="space-y-1">
            {news.slice(0, 3).map(n => (
              <li key={n.id} className="text-[12px] leading-snug">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-wp-text2 hover:text-wp-text hover:underline">{n.title} ↗</a>
                <span className="text-wp-text3"> · {ago(n.published)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10.5px] text-wp-text3">Headlines: Lloyd&apos;s List (lloydslist.com)</p>
        </div>
      )}

      {(values.length > 0 || t || p) && (
        <p className="text-[10.5px] text-wp-text3">
          {[values.length ? 'World Bank (CC BY 4.0)' : null, t ? `${baciCredit(t)}, ${t.year} figures (Etalab Open Licence 2.0)` : null, p ? 'World Bank prices' : null].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  )
}
