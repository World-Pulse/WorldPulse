'use client'

/**
 * "Since you last looked" (plan M8): a small bar at the top of the World Map
 * for readers coming back — how many signals came in since their last visit,
 * how many are serious, and a button that rings them on the map (the Latest
 * list marks them NEW).
 */

import { X } from 'lucide-react'
import { SEVERITY_COLOR } from '@/lib/map-style'

export function SinceLastVisit({
  count, more, serious, away, capped, windowLabel, ringCount, showing, onToggle, onDismiss, className = '',
}: {
  count: number
  /** The map holds only its newest signals and all of them are new: "500+" */
  more: boolean
  serious: number
  /** "3h ago" */
  away: string
  /** The last visit was before the map's time window: the count is the window's */
  capped: boolean
  windowLabel: string
  /** How many get a ring on "Show" (the critical, high and verified ones); 0 hides the button */
  ringCount: number
  showing: boolean
  onToggle: () => void
  onDismiss: () => void
  className?: string
}) {
  return (
    <div role="status" className={`absolute left-1/2 -translate-x-1/2 top-[62px] md:top-3 z-20 max-w-[calc(100%-120px)] md:max-w-[calc(100%-24px)] ${className}`}>
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(8,12,20,0.92)] backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)] pl-3 pr-1.5 py-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#e0f2fe] shadow-[0_0_8px_#e0f2fe]" aria-hidden="true" />
        <span className="text-[12px] text-wp-text whitespace-nowrap truncate">
          <b className="tabular-nums">{count.toLocaleString('en-US')}{more ? '+' : ''}</b> new {capped ? `in the ${windowLabel}` : 'since your last visit'}
          <span className="hidden sm:inline text-wp-text3"> · {capped ? `last here ${away}` : away}</span>
        </span>
        {serious > 0 && (
          <span className="hidden sm:inline font-mono text-[10px] whitespace-nowrap" style={{ color: SEVERITY_COLOR.high }}>
            {serious} critical/high
          </span>
        )}
        {ringCount > 0 && (
          <button type="button" onClick={onToggle} aria-pressed={showing}
            title={ringCount < count ? `Ring the ${ringCount} critical, high or verified ones on the map` : 'Ring them on the map'}
            className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${showing ? 'bg-[#e0f2fe] text-[#0b1220]' : 'bg-white/[0.07] text-wp-text hover:bg-white/[0.12]'}`}>
            {showing ? 'Hide' : 'Show'}
          </button>
        )}
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-wp-text3 hover:text-wp-text hover:bg-white/[0.06]">
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
