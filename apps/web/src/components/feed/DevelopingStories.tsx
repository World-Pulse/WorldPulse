'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  toDevelopingStories, sinceLabel, outletBadge, namedOutlets, outletsTitle, LOUD_SEVERITIES,
  type DevelopingStory,
} from '@/lib/developing-stories'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Stories shown (on phones, fewer), and the hours they must have been reported in */
const SHOWN = 5
const PHONE_SHOWN = 3
const WINDOW_HOURS = 12
const REFRESH_MS = 5 * 60_000

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-wp-red',
  high:     'text-wp-amber',
}

/**
 * Developing Stories on the home page: the stories most outlets are reporting
 * in the last 12 hours, ranked by how many outlets and how serious, freshest
 * first among equals; each opens its signal page, which lists every outlet.
 */
export function DevelopingStories() {
  const [stories, setStories] = useState<DevelopingStory[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (document.visibilityState === 'hidden') return
      try {
        const res = await fetch(`${API_URL}/api/v1/stories?hours=${WINDOW_HOURS}&limit=${SHOWN}`)
        if (!res.ok) return
        const list = toDevelopingStories(await res.json())
        if (!cancelled) { setStories(list); setNow(Date.now()) }
      } catch {
        // the home page shouldn't break if the stories API is down
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  if (stories.length === 0) return null
  const [lead, ...rest] = stories

  return (
    <section aria-labelledby="developing-stories" className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.2)]">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-wp-red animate-pulse" aria-hidden />
            <h2 id="developing-stories" className="text-[13px] font-semibold text-wp-text tracking-wide uppercase">
              Developing Stories
            </h2>
          </div>
          {/* A story here was reported in the last 12 hours; it may have started earlier */}
          <span className="text-[11px] text-wp-text2 font-mono">
            <span className="hidden sm:inline">most reported · </span>updated in the last {WINDOW_HOURS}h
          </span>
        </div>

        <ol className="space-y-2">
          <li><StoryRow story={lead!} now={now} lead /></li>
          {rest.map((story, i) => (
            // phones show the first three, so the feed starts on the first screen
            <li key={story.id} className={i >= PHONE_SHOWN - 1 ? 'hidden sm:block' : undefined}>
              <StoryRow story={story} now={now} />
            </li>
          ))}
        </ol>
        {/* The week's biggest stories (plan G11): the page was reachable only by its address */}
        <Link href="/week" className="mt-3 inline-block text-[12px] font-mono text-wp-cyan hover:underline">
          This week&rsquo;s top stories &rarr;
        </Link>
      </div>
    </section>
  )
}

function StoryRow({ story, now, lead = false }: { story: DevelopingStory; now: number; lead?: boolean }) {
  const badge = outletBadge(story)
  const { names, more } = namedOutlets(story, lead ? 4 : 3)
  const updated = sinceLabel(story.updatedAt, now)
  const since = sinceLabel(story.firstSeenAt, now)
  return (
    <Link
      href={`/signals/${story.leadId}`}
      className={`block rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] ${lead ? 'p-3.5' : 'px-3 py-2.5'} hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.04)] transition-all group`}
      data-story-id={story.id}
    >
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <span
          className={`flex-shrink-0 inline-flex items-center px-2 py-[2px] rounded-full font-mono text-[10px] tracking-[0.3px] ${
            badge.verified
              ? 'bg-[rgba(0,230,118,0.12)] text-wp-green border border-[rgba(0,230,118,0.35)]'
              : 'bg-[rgba(0,212,255,0.10)] text-wp-cyan border border-[rgba(0,212,255,0.3)]'
          }`}
        >
          {badge.label}
        </span>
        {LOUD_SEVERITIES.has(story.severity) && (
          <span className={`flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.5px] ${SEVERITY_TEXT[story.severity] ?? ''}`}>
            {story.severity}
          </span>
        )}
        {story.place && (
          <span className="text-[11px] text-wp-text2 truncate">{story.place}</span>
        )}
        {updated && (
          <span className="ml-auto flex-shrink-0 pl-1 font-mono text-[10px] text-wp-text2" title={since ? `First reported ${since}` : undefined}>
            {updated}
          </span>
        )}
      </div>

      <p className={`${lead ? 'text-[15px] font-semibold' : 'text-[13px]'} text-wp-text leading-snug line-clamp-2 group-hover:text-wp-cyan transition-colors`}>
        {story.title}
      </p>

      <p className="mt-1 text-[11px] text-wp-text2 font-mono truncate" title={outletsTitle(story)}>
        {names.join(' · ')}
        {more > 0 && <> +{more} more</>}
      </p>
    </Link>
  )
}
