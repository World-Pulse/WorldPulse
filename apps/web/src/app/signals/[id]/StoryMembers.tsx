'use client'

/**
 * "Also reported by" (plan item 12c): the other reports of this signal's
 * story — signals the scraper's same-story rule linked — oldest first, each
 * with its outlet, link and time. Read from GET /api/v1/stories/:id, which
 * takes any member's signal id. Hidden when the story has only this signal.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface StoryMember {
  id: string
  title: string
  status: string
  outlet: string
  url: string | null
  createdAt: string | null
  verifiedAt: string | null
}

export interface StoryDetail {
  storyId: string
  size: number
  verifiedAt: string | null
  signals: StoryMember[]
}

/** The story's other reports, oldest first (the current signal left out) */
export function otherMembers(story: StoryDetail | null, signalId: string): StoryMember[] {
  if (!story || !Array.isArray(story.signals)) return []
  return story.signals.filter(m => m && m.id !== signalId)
}

function timeAgo(d: string | null | undefined): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

export function StoryMembers({ signalId }: { signalId: string }) {
  const [story, setStory] = useState<StoryDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/v1/stories/${encodeURIComponent(signalId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((body: { success?: boolean; data?: StoryDetail } | null) => {
        if (!cancelled && body?.success && body.data) setStory(body.data)
      })
      .catch(() => { /* non-fatal: the section stays hidden */ })
    return () => { cancelled = true }
  }, [signalId])

  const others = otherMembers(story, signalId)
  if (others.length === 0) return null

  return (
    <section className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3" aria-label="Also reported by">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          Also reported by {others.length} {others.length === 1 ? 'report' : 'reports'}
        </span>
        {story?.verifiedAt && (
          <span className="ml-auto font-mono text-[10px] text-wp-green">
            ✓ Verified {timeAgo(story.verifiedAt)}
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {others.map(m => (
          <li key={m.id} className="flex items-start gap-2">
            <span className="mt-[3px] font-mono text-[10px] text-wp-text3 w-[64px] shrink-0">{timeAgo(m.createdAt)}</span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/signals/${m.id}`}
                className="block text-[13px] text-wp-text2 hover:text-wp-text leading-[1.45] line-clamp-2 transition-colors"
              >
                {m.title}
              </Link>
              {m.outlet && (
                m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] text-wp-text3 hover:text-wp-text2 transition-colors"
                  >
                    {m.outlet} ↗
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-wp-text3">{m.outlet}</span>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
