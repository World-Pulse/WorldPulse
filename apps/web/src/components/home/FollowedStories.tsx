'use client'

/**
 * "Stories you follow" on the home page, for signed-in readers who follow
 * one (plan 8; Devon, Oct 21, 2026: "Yes, add it"): each story's newest
 * headline and how many reports came in since the reader last opened it.
 * Nothing shows for readers who follow none.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { authHeaders } from '@/lib/story-follow'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const SHOWN = 5

interface Followed { storyId: string; title: string; leadId: string; newReports: number }

export function FollowedStories() {
  const [stories, setStories] = useState<Followed[]>([])

  useEffect(() => {
    let headers: Record<string, string> | null = null
    try { headers = authHeaders(localStorage) } catch { headers = null }
    if (!headers) return
    let cancelled = false
    fetch(`${API_URL}/api/v1/stories/following`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then((json: { data?: { stories?: Followed[] } } | null) => {
        if (!cancelled && Array.isArray(json?.data?.stories)) setStories(json!.data!.stories!.slice(0, SHOWN))
      })
      .catch(() => { /* nothing to show */ })
    return () => { cancelled = true }
  }, [])

  if (stories.length === 0) return null
  return (
    <section className="px-4 pt-4" aria-labelledby="followed-stories">
      <h2 id="followed-stories" className="font-mono text-[11px] uppercase tracking-[1px] text-wp-text2 mb-2">Stories you follow</h2>
      <ul className="space-y-1.5">
        {stories.map(s => (
          <li key={s.storyId}>
            <Link
              href={`/signals/${s.leadId}`}
              className="flex items-center gap-2 min-w-0 rounded-lg border border-[rgba(255,255,255,0.07)] px-3 py-2 hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.03)] transition-all"
            >
              <span className="truncate text-[13px] text-wp-text min-w-0 flex-1">{s.title}</span>
              {s.newReports > 0 && (
                <span className="flex-shrink-0 font-mono text-[10px] px-2 py-[2px] rounded-full bg-wp-cyan/10 text-wp-cyan border border-wp-cyan/30">
                  {s.newReports} new
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
