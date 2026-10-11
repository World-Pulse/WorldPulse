'use client'

/**
 * The World Map's legend (map redesign slice 2): severity colours with how
 * many of each are loaded, what the white ring means, the kinds of event
 * once the map is zoomed in far enough to show them, and a swatch for every
 * layer that is switched on. Collapses to a single line on request.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, Swords, Landmark, Vote, HeartPulse, TriangleAlert, CloudLightning, TrendingUp, Trophy, Zap, Newspaper } from 'lucide-react'
import { SEVERITY_COLOR } from '@/lib/map-style'
import type { MapLayerGroup } from './LayersPanel'

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

/** The kinds of event the zoomed-in map marks (the same Lucide glyphs as lib/map-signal-icons.ts) */
const KINDS = [
  { Icon: Swords,         label: 'Conflict' },
  { Icon: Landmark,       label: 'Politics' },
  { Icon: Vote,           label: 'Elections' },
  { Icon: HeartPulse,     label: 'Health' },
  { Icon: TriangleAlert,  label: 'Disaster' },
  { Icon: CloudLightning, label: 'Weather' },
  { Icon: TrendingUp,     label: 'Economy' },
  { Icon: Trophy,         label: 'Sports' },
  { Icon: Zap,            label: 'Breaking' },
  { Icon: Newspaper,      label: 'Other news' },
] as const

export function MapLegend({ counts, groups, showKinds = false, className = '' }: {
  counts: Record<string, number>
  groups: MapLayerGroup[]
  /** Zoomed in, signals are icons of their kind: say which is which */
  showKinds?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(true)
  // Phones start with the legend folded: it would cover a third of the map
  useEffect(() => { if (window.innerWidth < 768) setOpen(false) }, [])
  const activeLayers = groups.flatMap(g => g.items).filter(i => i.on)
  return (
    <div className={`rounded-xl border border-white/[0.09] bg-[rgba(8,12,20,0.85)] backdrop-blur-xl shadow-lg ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-6 px-3 pt-2.5 pb-2 font-mono text-[9px] tracking-[2px] uppercase text-wp-text3 hover:text-wp-text2"
      >
        Legend
        <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {SEVERITIES.map(sev => (
            <div key={sev} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_COLOR[sev], boxShadow: `0 0 6px ${SEVERITY_COLOR[sev]}` }} />
                <span className="font-mono text-[10px] text-wp-text2 capitalize">{sev}</span>
              </span>
              <span className="font-mono text-[10px] text-wp-text3 tabular-nums">{counts[sev] ?? 0}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-white" style={{ background: SEVERITY_COLOR.medium }} />
            <span className="font-mono text-[10px] text-wp-text2">Verified (2+ outlets)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 bg-[#0b1220]" style={{ borderColor: SEVERITY_COLOR.high }} />
            <span className="font-mono text-[10px] text-wp-text2">Group · most serious</span>
          </div>
          {showKinds && (
            <div className="pt-1 border-t border-white/[0.06] grid grid-cols-2 gap-x-3 gap-y-1">
              {KINDS.map(({ Icon, label }) => (
                <span key={label} className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2">
                  <Icon size={11} className="text-wp-text3 flex-shrink-0" aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className="pt-1 border-t border-white/[0.06] font-mono text-[9px] text-wp-text3">Click a country for its brief</div>
          {activeLayers.length > 0 && (
            <div className="pt-1 border-t border-white/[0.06] space-y-1.5">
              {activeLayers.map(l => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                  <span className="font-mono text-[10px] text-wp-text2">{l.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
