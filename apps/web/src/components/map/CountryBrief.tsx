'use client'

/**
 * Country brief (map redesign slice 5, plan M9): click a country on the World
 * Map to see what's happening there in the chosen time window — how many
 * signals, how serious, which topics, and the latest ones — without leaving
 * the map. A side panel on desktop, a sheet on phones. Built from the signals
 * the map has loaded (lib/country-brief.ts), so it opens at once.
 */

import Link from 'next/link'
import { X, BadgeCheck, Maximize2, ArrowRight } from 'lucide-react'
import { SEVERITY_COLOR } from '@/lib/map-style'
import { flagEmoji } from '@/lib/country-shapes'
import { BRIEF_SEVERITIES, type BriefSignal, type CountryBriefData } from '@/lib/country-brief'
import { ago } from './LiveList'

export interface BriefListItem extends BriefSignal {
  title: string
  location_name: string | null
}

export interface CountryRisk {
  score: number
  label: string
  trend?: string
}

export function CountryBrief<T extends BriefListItem>({
  country, brief, windowLabel, risk, categoryIcon, onClose, onSelect, onZoom,
}: {
  country: { code: string | null; name: string }
  brief: CountryBriefData<T>
  /** e.g. "last 24 hours" */
  windowLabel: string
  /** From the country-risk layer, when it's on */
  risk?: CountryRisk | null
  categoryIcon: Record<string, string>
  onClose: () => void
  onSelect: (item: T) => void
  onZoom: () => void
}) {
  const flag = flagEmoji(country.code)
  const serious = brief.bySeverity.critical + brief.bySeverity.high
  return (
    <>
      {/* Phone: dim the map behind the sheet; tap to close */}
      <div className="md:hidden absolute inset-0 bg-black/40 z-10" onClick={onClose} aria-hidden="true" />
      <aside
        aria-label={`${country.name}: what's happening`}
        className="absolute bottom-0 left-0 right-0 max-h-[72vh] rounded-t-2xl overflow-hidden
                   md:top-0 md:right-0 md:bottom-auto md:left-auto md:max-h-none md:h-full md:w-[340px] md:rounded-none
                   bg-[rgba(6,7,13,0.97)] border-t md:border-t-0 md:border-l border-white/[0.09]
                   backdrop-blur-xl z-20 flex flex-col"
      >
        <div className="md:hidden flex justify-center pt-3 pb-1 flex-shrink-0" aria-hidden="true">
          <div className="w-10 h-[3px] rounded-full bg-white/25" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 md:py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {flag && <span className="text-[28px] leading-none" aria-hidden="true">{flag}</span>}
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold text-wp-text leading-tight truncate">{country.name}</h2>
              <div className="font-mono text-[10px] tracking-[1px] uppercase text-wp-text3 mt-1 whitespace-nowrap">Brief · {windowLabel}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the country brief"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-white/[0.06] transition-all flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
          {/* The numbers */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Signals', value: brief.total, color: 'text-wp-text' },
              { label: 'Verified', value: brief.verified, color: 'text-wp-green' },
              { label: 'Critical/high', value: serious, color: serious > 0 ? '' : 'text-wp-text' },
            ].map(tile => (
              <div key={tile.label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
                <div className={`text-[20px] font-bold tabular-nums leading-none ${tile.color}`}
                  style={tile.label === 'Critical/high' && serious > 0 ? { color: SEVERITY_COLOR.high } : undefined}>
                  {tile.value.toLocaleString('en-US')}
                </div>
                <div className="font-mono text-[9px] tracking-[0.5px] uppercase text-wp-text3 mt-1.5 whitespace-nowrap">{tile.label}</div>
              </div>
            ))}
          </div>

          {risk && (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <span className="font-mono text-[10px] tracking-[1px] uppercase text-wp-text3">Risk (24h)</span>
              <span className="font-mono text-[12px] text-wp-text">
                <b className="tabular-nums">{risk.score}</b> · {risk.label}{risk.trend && risk.trend !== 'stable' ? ` · ${risk.trend}` : ''}
              </span>
            </div>
          )}

          {brief.total > 0 && (
            <>
              {/* How serious: one bar, a segment per severity */}
              <div>
                <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.06]" aria-hidden="true">
                  {BRIEF_SEVERITIES.map(sev => brief.bySeverity[sev] > 0 && (
                    <div key={sev} style={{ width: `${(brief.bySeverity[sev] / brief.total) * 100}%`, background: SEVERITY_COLOR[sev] }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                  {BRIEF_SEVERITIES.map(sev => (
                    <span key={sev} className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2">
                      <span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_COLOR[sev] }} />
                      <span className="capitalize">{sev}</span>
                      <span className="text-wp-text3 tabular-nums">{brief.bySeverity[sev]}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Topics */}
              <div>
                <div className="font-mono text-[9px] tracking-[2px] uppercase text-wp-text3 mb-2">Topics</div>
                <div className="flex flex-wrap gap-1.5">
                  {brief.categories.map(c => (
                    <span key={c.category} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] text-wp-text2">
                      <span aria-hidden="true">{categoryIcon[c.category] ?? '•'}</span>
                      <span className="capitalize">{c.category}</span>
                      <span className="font-mono text-wp-text3 tabular-nums">{c.count}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Latest */}
              <div>
                <div className="font-mono text-[9px] tracking-[2px] uppercase text-wp-text3 mb-1">Latest</div>
                <ol className="-mx-2">
                  {brief.latest.map(item => {
                    const color = SEVERITY_COLOR[item.severity] ?? SEVERITY_COLOR.low
                    const verified = item.status === 'verified'
                    return (
                      <li key={item.id}>
                        <button type="button" onClick={() => onSelect(item)}
                          className="w-full text-left flex gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                          <span className="mt-[5px] w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: color, boxShadow: verified ? '0 0 0 1.5px #fff' : `0 0 6px ${color}` }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] leading-snug text-wp-text line-clamp-2">{item.title}</span>
                            <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-wp-text3 min-w-0">
                              {verified && (
                                <span className="inline-flex items-center gap-0.5 text-wp-green flex-shrink-0"><BadgeCheck size={11} /> Verified</span>
                              )}
                              {item.location_name && <span className="truncate">{item.location_name}</span>}
                              <span className="ml-auto flex-shrink-0 tabular-nums">{ago(item.created_at)}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </>
          )}

          {brief.total === 0 && (
            <p className="text-[13px] text-wp-text3 leading-relaxed">
              No signals from {country.name} on the map in the {windowLabel}. Try a longer time window (7D) or other filters.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.07] flex gap-2 flex-shrink-0"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
          <button type="button" onClick={onZoom}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] text-wp-text2 hover:bg-white/[0.07] hover:text-wp-text transition-all">
            <Maximize2 size={13} /> Zoom to country
          </button>
          {country.code && (
            <Link href={`/countries/${encodeURIComponent(country.code.toLowerCase())}`}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[rgba(245,166,35,0.10)] border border-[rgba(245,166,35,0.35)] text-[13px] text-wp-amber hover:bg-[rgba(245,166,35,0.16)] transition-all">
              Country page <ArrowRight size={13} />
            </Link>
          )}
        </div>
      </aside>
    </>
  )
}
