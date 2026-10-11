/**
 * One story, all outlets (plan item 12c). The feed asks the API for one row
 * per story (`?group=story`); each row says how many signals the story has,
 * which websites reported it and when it turned verified. This shows that on
 * the feed card: a badge ("Verified · 5 outlets", "2 outlets",
 * "1 outlet so far") and the outlets' names.
 */

import type { ReactNode } from 'react'

export interface StoryInfo {
  /** The story's id (the id of its first signal) */
  id: string
  /** How many signals the story has */
  size: number
  /** Websites that reported it, each once, in the order they were first seen */
  outlets: string[]
  /** When the story first turned verified */
  verifiedAt: string | null
  /** The story's newest signal */
  updatedAt: string | null
}

/** The story fields of a feed row from `?group=story`, or undefined when it has none */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function storyOf(raw: any): StoryInfo | undefined {
  if (!raw || typeof raw.storyId !== 'string' || raw.storyId === '') return undefined
  const outlets = Array.isArray(raw.storyOutlets)
    ? raw.storyOutlets.filter((o: unknown): o is string => typeof o === 'string' && o !== '')
    : []
  const size = Number(raw.storySize)
  return {
    id:         raw.storyId,
    size:       Number.isFinite(size) && size > 0 ? size : 1,
    outlets,
    verifiedAt: typeof raw.storyVerifiedAt === 'string' ? raw.storyVerifiedAt : null,
    updatedAt:  typeof raw.storyUpdatedAt === 'string' ? raw.storyUpdatedAt : null,
  }
}

export type StoryTone = 'verified' | 'multi' | 'single'

/**
 * The badge for a story: verified with its outlet count, several outlets
 * not (yet) verified, or a single outlet. Null when it has no known outlet.
 */
export function storyBadge(story: StoryInfo, status?: string | null): { label: string; tone: StoryTone } | null {
  const n = story.outlets.length
  if (story.verifiedAt || status === 'verified') {
    return { label: n >= 2 ? `Verified · ${n} outlets` : 'Verified', tone: 'verified' }
  }
  if (n >= 2) return { label: `${n} outlets`, tone: 'multi' }
  if (n === 1) return { label: '1 outlet so far', tone: 'single' }
  return null
}

const TONE_CLASS: Record<StoryTone, string> = {
  verified: 'bg-[rgba(0,230,118,0.12)] text-wp-green border border-[rgba(0,230,118,0.35)]',
  multi:    'bg-[rgba(0,212,255,0.10)] text-wp-cyan border border-[rgba(0,212,255,0.3)]',
  single:   'text-wp-text3 border border-[rgba(255,255,255,0.08)]',
}

/** How many outlet names fit on a card before "+N more" */
export const OUTLETS_SHOWN = 3

export function StoryOutlets({ story, status, extra }: { story: StoryInfo; status?: string | null; extra?: ReactNode }) {
  const badge = storyBadge(story, status)
  if (!badge) return null
  const shown = story.outlets.slice(0, OUTLETS_SHOWN)
  const more  = story.outlets.length - shown.length
  return (
    <div className="flex items-center gap-1 flex-wrap mb-2" data-story-id={story.id}>
      <span
        className={`inline-flex items-center px-2 py-[2px] rounded-full font-mono text-[10px] tracking-[0.5px] ${TONE_CLASS[badge.tone]}`}
        title={story.size > 1 ? `${story.size} reports of this story` : undefined}
      >
        {badge.tone === 'verified' ? '✓ ' : ''}{badge.label}
      </span>
      {shown.map(host => (
        <span
          key={host}
          className="inline-flex items-center px-2 py-[2px] rounded-full font-mono text-[10px] text-wp-text2 border border-[rgba(255,255,255,0.1)]"
        >
          {host}
        </span>
      ))}
      {more > 0 && (
        <span className="font-mono text-[10px] text-wp-text3">+{more} more</span>
      )}
      {extra}
    </div>
  )
}
