'use client'

/**
 * The story's figures and the outlets that report each one (plan 14, Oct 21,
 * 2026: "next to each claim inside a story, its outlets"): people killed,
 * injured, missing, displaced, evacuated, abducted, arrested or rescued, read
 * by the API from the headlines of the story's reports in its last two days
 * (GET /api/v1/stories/:id/figures, lib/story-figures.ts). A reader sees which
 * outlets say 153 and which say 220, when each was last reported, and the
 * newest headline behind each number. Hidden for a story of one report (its
 * headline already says it) and for a story without figures.
 */

import { useEffect, useState } from 'react'
import { STORY_COUNT_DAYS } from '@/lib/story-count'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface FigureValue {
  value: number
  text: string
  outlets: number
  outletNames: string[]
  reports: number
  firstAt: string | null
  lastAt: string | null
  headline: string
  url: string | null
}

export interface StoryFigure {
  kind: string
  label: string
  values: FigureValue[]
}

export interface StoryFiguresData {
  storyId: string
  reports: number
  countedHours?: number
  figures: StoryFigure[]
}

/** Figures shown per kind before "N more" */
const SHOWN = 3

function timeAgo(d: string | null | undefined, now = Date.now()): string {
  if (!d) return ''
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return ''
  const m = Math.floor((now - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

/** "3 outlets: aljazeera.com, apnews.com +1" */
export function outletsLine(v: Pick<FigureValue, 'outlets' | 'outletNames'>): string {
  const names = Array.isArray(v.outletNames) ? v.outletNames.filter(n => typeof n === 'string' && n) : []
  const count = Math.max(v.outlets || 0, names.length)
  const word = `${count} ${count === 1 ? 'outlet' : 'outlets'}`
  if (names.length === 0) return word
  const shown = names.slice(0, 2)
  const rest = count - shown.length
  return `${word}: ${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
}

/** Whether the block has anything to add: figures, and more than one report behind them */
export function hasFigures(data: StoryFiguresData | null): data is StoryFiguresData {
  return !!data && data.reports > 1 && Array.isArray(data.figures) && data.figures.some(f => Array.isArray(f.values) && f.values.length > 0)
}

export function FiguresView({ data, bare = false, now }: { data: StoryFiguresData; bare?: boolean; now?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!hasFigures(data)) return null
  const days = Math.round((data.countedHours || STORY_COUNT_DAYS * 24) / 24)

  return (
    <section aria-label="Figures in this story"
      className={bare ? 'pt-3 border-t border-white/[0.06] space-y-2.5' : 'p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-2.5'}>
      <div className="space-y-0.5">
        <span className="block font-mono text-[10px] tracking-widest uppercase text-wp-text3">Figures in this story</span>
        <p className="text-[11px] text-wp-text3 leading-snug">
          From the headlines of its reports in its last {days} days, each with the outlets that report it.
        </p>
      </div>
      <dl className="space-y-2.5">
        {data.figures.filter(f => f.values?.length).map(f => {
          const all = f.values
          const shown = open[f.kind] ? all : all.slice(0, SHOWN)
          return (
            <div key={f.kind} className="space-y-1">
              <dt className="font-mono text-[10px] tracking-wider uppercase text-wp-text2">
                {f.label}
                {all.length > 1 && <span className="normal-case tracking-normal text-wp-text3"> · {all.length} figures, newest first</span>}
              </dt>
              {shown.map(v => (
                <dd key={v.value} className="pl-3 border-l border-white/10">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[14px] font-semibold text-wp-text tabular-nums">{v.text}</span>
                    <span className="font-mono text-[10px] text-wp-text3" title={(v.outletNames || []).join(', ')}>
                      {outletsLine(v)}
                    </span>
                    {v.lastAt && <span className="font-mono text-[10px] text-wp-text3">· latest {timeAgo(v.lastAt, now)}</span>}
                  </div>
                  {v.headline && (
                    v.url ? (
                      <a href={v.url} target="_blank" rel="noopener noreferrer"
                        className="block text-[12px] text-wp-text3 hover:text-wp-text2 leading-[1.4] truncate transition-colors">
                        {v.headline} ↗
                      </a>
                    ) : (
                      <span className="block text-[12px] text-wp-text3 leading-[1.4] truncate">{v.headline}</span>
                    )
                  )}
                </dd>
              ))}
              {all.length > SHOWN && !open[f.kind] && (
                <dd className="pl-3">
                  <button type="button" onClick={() => setOpen(o => ({ ...o, [f.kind]: true }))}
                    className="font-mono text-[10px] text-wp-text3 hover:text-wp-text2 transition-colors">
                    {all.length - SHOWN} more ▾
                  </button>
                </dd>
              )}
            </div>
          )
        })}
      </dl>
    </section>
  )
}

/** Asks the API in the browser, like the story so far; nothing shows until it answers */
export function StoryFigures({ signalId, bare = false }: { signalId: string; bare?: boolean }) {
  const [data, setData] = useState<StoryFiguresData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/v1/stories/${encodeURIComponent(signalId)}/figures`)
      .then(r => (r.ok ? r.json() : null))
      .then((body: { success?: boolean; data?: StoryFiguresData } | null) => {
        if (!cancelled && body?.success && body.data) setData(body.data)
      })
      .catch(() => { /* non-fatal: the section stays hidden */ })
    return () => { cancelled = true }
  }, [signalId])

  return data ? <FiguresView data={data} bare={bare} /> : null
}
