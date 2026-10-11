'use client'

/**
 * "Latest in view" (map redesign slice 3, plan item M14): the newest signals
 * inside the part of the world on screen, beside the map — a column on
 * desktop, a sheet on phones. Hovering an item lights up its dot; clicking
 * flies there and opens the signal's panel. Like Liveuamap's News Live list,
 * with WorldPulse's verified mark on each item.
 */

import { X, BadgeCheck } from 'lucide-react'
import { SEVERITY_COLOR } from '@/lib/map-style'

export interface LiveListItem {
  id: string
  title: string
  severity: string
  status: string
  location_name: string | null
  created_at: string
  original_urls: string | string[] | null
}

/** The website a signal's first article is on ("" when there's none) */
export function outletOf(urls: LiveListItem['original_urls']): string {
  let list: unknown = urls
  if (typeof urls === 'string') {
    try { list = JSON.parse(urls) } catch { list = [urls] }
  }
  const first = Array.isArray(list) ? list.find(u => typeof u === 'string') : null
  if (typeof first !== 'string') return ''
  try { return new URL(first).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Newest first, at most `max` */
export function latestFirst<T extends { created_at: string }>(items: T[], max = 60): T[] {
  return [...items]
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .slice(0, max)
}

/** "now", "5m", "3h", "2d" */
export function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(m)) return ''
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export function LiveList({ items, total, open, selectedId, onClose, onSelect, onHover }: {
  items: LiveListItem[]
  /** Signals in view (the list shows the newest of them) */
  total: number
  open: boolean
  selectedId: string | null
  onClose: () => void
  onSelect: (item: LiveListItem) => void
  onHover: (item: LiveListItem | null) => void
}) {
  if (!open) return null
  return (
    <>
      <div className="md:hidden fixed inset-0 z-[940] bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        aria-label="Latest signals in view"
        className="fixed md:absolute z-[950] md:z-20 bottom-0 left-0 right-0 md:right-auto md:top-0 md:bottom-0 md:w-[320px]
                   max-h-[75vh] md:max-h-none flex flex-col
                   rounded-t-2xl md:rounded-none border-t md:border-t-0 md:border-r border-white/[0.08]
                   bg-[rgba(8,12,20,0.95)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
          <div>
            <div className="font-mono text-[10px] tracking-[2px] uppercase text-wp-text2">Latest in view</div>
            <div className="font-mono text-[10px] text-wp-text3 tabular-nums">
              {items.length < total ? `newest ${items.length} of ${total.toLocaleString('en-US')}` : `${total.toLocaleString('en-US')} signals`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the list" className="text-wp-text3 hover:text-wp-text p-1 rounded">
            <X size={16} />
          </button>
        </div>
        <ol className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <li className="px-4 py-6 text-[12px] text-wp-text3">No signals here. Zoom out or change the filters.</li>
          )}
          {items.map(item => {
            const color = SEVERITY_COLOR[item.severity] ?? SEVERITY_COLOR.low
            const outlet = outletOf(item.original_urls)
            const verified = item.status === 'verified'
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => onHover(item)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(item)}
                  onBlur={() => onHover(null)}
                  aria-current={selectedId === item.id ? 'true' : undefined}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-b border-white/[0.05] transition-colors
                    ${selectedId === item.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                >
                  <span
                    className="mt-[5px] w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: color, boxShadow: verified ? '0 0 0 1.5px #fff' : `0 0 6px ${color}` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug text-wp-text line-clamp-2">{item.title}</span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-wp-text3 min-w-0">
                      {verified && (
                        <span className="inline-flex items-center gap-0.5 text-wp-green flex-shrink-0">
                          <BadgeCheck size={11} /> Verified
                        </span>
                      )}
                      {item.location_name && <span className="truncate">{item.location_name}</span>}
                      {outlet && <span className="truncate text-wp-text3/80">· {outlet}</span>}
                      <span className="ml-auto flex-shrink-0 tabular-nums">{ago(item.created_at)}</span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>
    </>
  )
}
