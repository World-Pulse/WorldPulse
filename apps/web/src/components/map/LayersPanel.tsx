'use client'

/**
 * The World Map's Layers panel (map redesign slice 2, plan item M11): every
 * overlay in one place, grouped by theme, each with an icon, a colour swatch,
 * a one-line description and a switch. A dropdown under the toolbar on
 * desktop, a bottom sheet on phones. Replaces the strip of 32 chips.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'

export interface MapLayerItem {
  key: string
  label: string
  description: string
  icon: LucideIcon
  /** The colour the layer draws in (swatch and switch) */
  color: string
  on: boolean
  loading?: boolean
  /** What the layer shows right now (e.g. 37 aircraft), when on */
  count?: number | null
  toggle: () => void
  /** Extra settings shown under the row while the layer is on */
  extra?: ReactNode
}

export interface MapLayerGroup {
  title: string
  items: MapLayerItem[]
}

/** How many layers are switched on (for the Layers button's badge) */
export function activeLayerCount(groups: MapLayerGroup[]): number {
  return groups.reduce((n, g) => n + g.items.filter(i => i.on).length, 0)
}

function Switch({ on, color }: { on: boolean; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-[18px] w-[32px] flex-shrink-0 rounded-full transition-colors"
      style={{ background: on ? color : 'rgba(255,255,255,0.12)' }}
    >
      <span
        className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all"
        style={{ left: on ? 16 : 2 }}
      />
    </span>
  )
}

function LayerRow({ item }: { item: MapLayerItem }) {
  const Icon = item.icon
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={item.on}
        onClick={item.toggle}
        disabled={item.loading}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors disabled:cursor-wait"
      >
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${item.color}1f`, color: item.color }}
        >
          {item.loading
            ? <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <Icon size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-wp-text">{item.label}</span>
            {item.on && item.count != null && item.count > 0 && (
              <span className="font-mono text-[10px] px-1.5 rounded" style={{ color: item.color, background: `${item.color}1f` }}>
                {item.count.toLocaleString('en-US')}
              </span>
            )}
          </span>
          <span className="block text-[11px] leading-snug text-wp-text3">{item.description}</span>
        </span>
        <Switch on={item.on} color={item.color} />
      </button>
      {item.on && item.extra && <div className="pl-14 pr-3 pb-2">{item.extra}</div>}
    </div>
  )
}

export function LayersPanel({ groups, open, onClose }: { groups: MapLayerGroup[]; open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <>
      {/* Phone: dim the map behind the sheet (above the bottom tab bar, z-900); tap to close */}
      <div className="md:hidden fixed inset-0 z-[940] bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Map layers"
        className="fixed md:absolute z-[950] md:z-40 bottom-0 left-0 right-0 md:bottom-auto md:left-auto md:right-3 md:top-3
                   md:w-[360px] max-h-[75vh] md:max-h-[calc(100dvh-140px)] overflow-y-auto
                   rounded-t-2xl md:rounded-2xl border border-white/10 bg-[rgba(8,12,20,0.97)] backdrop-blur-xl
                   shadow-[0_18px_60px_rgba(0,0,0,0.6)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/[0.07] bg-[rgba(8,12,20,0.97)]">
          <span className="font-mono text-[10px] tracking-[2px] uppercase text-wp-text2">Map layers</span>
          <button type="button" onClick={onClose} aria-label="Close layers" className="text-wp-text3 hover:text-wp-text p-1 rounded">
            <X size={16} />
          </button>
        </div>
        <div className="p-2">
          {groups.map(group => (
            <div key={group.title} className="mb-1">
              <div className="px-3 pt-2 pb-1 font-mono text-[9px] tracking-[2px] uppercase text-wp-text3">{group.title}</div>
              {group.items.map(item => <LayerRow key={item.key} item={item} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
