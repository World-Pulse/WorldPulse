'use client'

/**
 * The story's timeline (plan items 12c and 12d): every report of this
 * signal's story — signals the scraper's same-story rule linked — from the
 * first, with its outlet, link and time; the moment it turned verified; when a
 * report raised the severity; and the reports new since your last look (kept
 * in this browser). Read from GET /api/v1/stories/:id, which takes any
 * member's signal id. Hidden when the story has only this signal.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { storyTimeline, foldTimeline, clockLabel, sinceFirst } from '@/lib/story-timeline'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface StoryMember {
  id: string
  title: string
  status: string
  outlet: string
  url: string | null
  createdAt: string | null
  verifiedAt: string | null
  severity?: string | null
  position?: number | null
}

export interface StoryDetail {
  storyId: string
  /** Reports in the story; a big story's middle is left out of `signals` */
  size: number
  /** Outlets that reported it, all of them */
  outlets?: number
  /** Their websites, A to Z (an outlet whose article was merged into another report included) */
  outletNames?: string[]
  verifiedAt: string | null
  signals: StoryMember[]
}

/** The story's other reports, oldest first (the current signal left out) */
export function otherMembers(story: StoryDetail | null, signalId: string): StoryMember[] {
  if (!story || !Array.isArray(story.signals)) return []
  return story.signals.filter(m => m && m.id !== signalId)
}

function timeAgo(d: string | number | null | undefined): string {
  if (d == null) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

/** When you last looked at a story (this browser), to mark the reports since */
const SEEN_PREFIX = 'wp_story_seen:'
function readSeen(storyId: string): number | null {
  try {
    const v = Number(localStorage.getItem(SEEN_PREFIX + storyId))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch { return null }
}
function writeSeen(storyId: string): void {
  try { localStorage.setItem(SEEN_PREFIX + storyId, String(Date.now())) } catch { /* private mode */ }
}

/** Reports shown before "Show all" on a long story: the first few and the latest */
const HEAD = 3
const TAIL = 4

const SEVERITY_TEXT: Record<string, string> = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-amber-300' }

export function StoryMembers({ signalId }: { signalId: string }) {
  const [story, setStory] = useState<StoryDetail | null>(null)
  const [seenAt, setSeenAt] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showOutlets, setShowOutlets] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/v1/stories/${encodeURIComponent(signalId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((body: { success?: boolean; data?: StoryDetail } | null) => {
        if (cancelled || !body?.success || !body.data) return
        // The last look first, then this one counts as seen
        setSeenAt(readSeen(body.data.storyId))
        writeSeen(body.data.storyId)
        setStory(body.data)
      })
      .catch(() => { /* non-fatal: the section stays hidden */ })
    return () => { cancelled = true }
  }, [signalId])

  const others = otherMembers(story, signalId)
  if (!story || others.length === 0) return null

  const { entries, reports, outlets, newCount } = storyTimeline(story.signals, story.verifiedAt, signalId, seenAt)
  const firstAt = entries.find(e => e.kind === 'report')?.at ?? 0
  // The whole story's counts (the API sends the start and the latest of a big one)
  const totalReports = Math.max(reports, story.size || 0)
  // Every outlet that carried it, so the count can be checked against the names
  const outletNames = Array.isArray(story.outletNames) ? story.outletNames.filter(n => typeof n === 'string' && n !== '') : []
  const totalOutlets = Math.max(outlets, story.outlets || 0, outletNames.length)
  const outletWord = `${totalOutlets} ${totalOutlets === 1 ? 'outlet' : 'outlets'}`
  // Long stories: the start and the latest, the middle behind "Show all"
  const folds = expanded ? new Map<number, number>() : foldTimeline(entries, HEAD, TAIL)

  return (
    <section className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3" aria-label="Story timeline">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          Story timeline · {totalReports} reports ·{' '}
          {outletNames.length > 0 ? (
            <button type="button" onClick={() => setShowOutlets(v => !v)} aria-expanded={showOutlets}
              className="uppercase tracking-widest underline decoration-dotted underline-offset-2 hover:text-wp-text2 transition-colors">
              {outletWord} {showOutlets ? '▴' : '▾'}
            </button>
          ) : outletWord}
        </span>
        {newCount > 0 && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[rgba(245,166,35,0.12)] text-wp-amber">
            {newCount} new since your last look
          </span>
        )}
        {story.verifiedAt && (
          <span className="ml-auto font-mono text-[10px] text-wp-green">✓ Verified {timeAgo(story.verifiedAt)}</span>
        )}
      </div>

      {showOutlets && outletNames.length > 0 && (
        <p className="font-mono text-[11px] leading-relaxed text-wp-text2 break-words" aria-label="Outlets that carried this story">
          {outletNames.join(' · ')}
        </p>
      )}

      <ol className="relative ml-1.5 border-l border-white/10">
        {entries.map((e, i) => {
          if (folds.has(i)) {
            // A folded run of reports starts here, in one line; the rest of the run is skipped
            const count = folds.get(i)!
            if (count === 0) return null
            return (
              <li key={`more-${i}`} className="relative pl-4 py-1.5">
                <span className="absolute -left-[3px] top-[11px] w-[5px] h-[5px] rounded-full bg-white/25" aria-hidden="true" />
                <button type="button" onClick={() => setExpanded(true)}
                  className="font-mono text-[11px] text-wp-text3 hover:text-wp-text2 transition-colors">
                  … {count} more {count === 1 ? 'report' : 'reports'} · show all
                </button>
              </li>
            )
          }
          if (e.kind === 'verified') {
            return (
              <li key={`v-${i}`} className="relative pl-4 py-1.5">
                <span className="absolute -left-[7px] top-[7px] w-[13px] h-[13px] rounded-full bg-wp-green text-[9px] leading-[13px] text-center text-black font-bold" aria-hidden="true">✓</span>
                <span className="text-[12px] text-wp-green">Verified: a second independent outlet reported it</span>
                <span className="ml-2 font-mono text-[10px] text-wp-text3">{clockLabel(e.at)} · {sinceFirst(e.at, firstAt)}</span>
              </li>
            )
          }
          if (e.kind === 'severity') {
            return (
              <li key={`s-${i}`} className="relative pl-4 py-1">
                <span className="absolute -left-[4px] top-[10px] w-[7px] h-[7px] rotate-45 bg-orange-400" aria-hidden="true" />
                <span className={`text-[12px] ${SEVERITY_TEXT[e.severity] ?? 'text-wp-text2'}`}>Severity rose to {e.severity}</span>
              </li>
            )
          }
          const { member: m } = e
          return (
            <li key={m.id} className={`relative pl-4 py-1.5 ${e.current ? 'bg-white/[0.03] rounded-r-lg' : ''}`}>
              <span className={`absolute -left-[5px] top-[11px] w-[9px] h-[9px] rounded-full ${e.first ? 'bg-wp-amber' : m.status === 'verified' ? 'bg-wp-green' : 'bg-white/40'} ${e.current ? 'ring-2 ring-white/60' : ''}`} aria-hidden="true" />
              <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-wp-text3">
                <span>{clockLabel(e.at)}</span>
                {e.first ? <span className="text-wp-amber">First report</span> : <span>{sinceFirst(e.at, firstAt)}</span>}
                {e.isNew && <span className="px-1 rounded bg-[rgba(245,166,35,0.15)] text-wp-amber">NEW</span>}
                {e.current && <span className="text-wp-text2">· you’re reading this</span>}
              </div>
              {e.current ? (
                <span className="block text-[13px] text-wp-text leading-[1.45] line-clamp-2">{m.title}</span>
              ) : (
                <Link href={`/signals/${m.id}`}
                  className="block text-[13px] text-wp-text2 hover:text-wp-text leading-[1.45] line-clamp-2 transition-colors">
                  {m.title}
                </Link>
              )}
              {m.outlet && (
                m.url ? (
                  <a href={m.url} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[10px] text-wp-text3 hover:text-wp-text2 transition-colors">
                    {m.outlet}{e.newOutlet ? '' : ' (again)'} ↗
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-wp-text3">{m.outlet}{e.newOutlet ? '' : ' (again)'}</span>
                )
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
