/**
 * world-pulse.io/check, "Has more than one newsroom reported this?" (paste a
 * link, get the count, version 1; Devon, Oct 20, 2026: "ok to start with 1").
 * The visitor's own browser asks GET /api/v1/stories/by-link, so each visitor
 * has their own rate limit (the website's server shares one). What the answer
 * says is worked out here, so it can be tested without a browser.
 */

import { countLine, outletsLine } from '@/lib/embed-card'
import { sinceText, STORY_COUNT_DAYS } from '@/lib/story-count'

export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io').replace(/\/+$/, '')

/** GET /api/v1/stories/by-link's data */
export interface LinkAnswer {
  found: boolean
  reason?: 'not_seen' | 'pending' | 'not_an_article' | string
  link?: string
  report?: { id?: string; title?: string | null; outlet?: string | null; url?: string | null; createdAt?: string | null }
  story?: {
    id?: string
    /** Websites that carried it in its last two days, and their names (lib/story-count.ts) */
    outlets?: number
    outletNames?: string[]
    /** Websites that carried it since it began, and when that was */
    outletsAll?: number
    firstReportAt?: string | null
    verified?: boolean
    verifiedAt?: string | null
    size?: number
  }
}

export type CheckView =
  | {
      kind: 'found'
      title: string
      outlet: string | null
      count: string
      /** "in its last 2 days · 143 since Oct 10" for a story that has run longer, else '' */
      since: string
      verified: boolean
      outlets: string
      verdict: string
      href: string
    }
  | { kind: 'missing'; message: string }

/** The address the checker asks */
export function byLinkUrl(link: string): string {
  return `${API_ORIGIN}/api/v1/stories/by-link?url=${encodeURIComponent(link.trim())}`
}

const MISSING: Record<string, string> = {
  not_seen: 'WorldPulse hasn’t collected this article. It may be very new (the feeds are read every few minutes), from a site WorldPulse doesn’t read, or more than two weeks old.',
  pending: 'WorldPulse is adding this article right now. Try again in a minute.',
  not_an_article: 'That isn’t the address of an article. Paste the link of one news story, not a home page.',
}

/** What the page shows for an answer */
export function checkView(answer: LinkAnswer): CheckView {
  if (!answer.found) return { kind: 'missing', message: MISSING[answer.reason ?? 'not_seen'] ?? MISSING.not_seen! }
  // The story's count covers its last two days; the verdict goes by everyone
  // who has reported it since it began (an old article's outlets included)
  const outlets = Math.max(Number(answer.story?.outlets) || 0, 1)
  const outletsAll = Math.max(Number(answer.story?.outletsAll) || 0, outlets)
  const verified = Boolean(answer.story?.verified)
  const names = (answer.story?.outletNames ?? []).filter(n => typeof n === 'string' && n)
  // this report's own outlet first (when it's among the counted), then the rest A to Z
  const own = answer.report?.outlet ?? null
  const ownCounted = own !== null && (names.length === 0 || names.includes(own))
  const named = [...(own && ownCounted ? [own] : []), ...names.filter(n => n !== own)].slice(0, 3)
  const since = sinceText(outlets, outletsAll, answer.story?.firstReportAt)
  const verdict = verified
    ? 'Two or more outlets reported this story and its reliability score reached 65%, so WorldPulse marks it verified. That means more than one outlet says so, not that it is proven true.'
    : outletsAll > 1
      ? `${outletsAll} outlets reported this story, but it isn’t verified yet: its reliability score is under 65%.`
      : 'Only one outlet so far: treat it as unconfirmed. That doesn’t make it false; it may be new, or an exclusive.'
  const id = answer.report?.id ?? ''
  return {
    kind: 'found',
    title: (answer.report?.title ?? '').trim() || 'This article',
    outlet: own,
    count: countLine({ outlets, verified }),
    since: since ? `in its last ${STORY_COUNT_DAYS} days · ${since}` : '',
    verified,
    outlets: outletsLine({ outlets, named }),
    verdict,
    href: `/signals/${encodeURIComponent(id)}?utm_source=check&utm_medium=web&utm_campaign=link-check`,
  }
}

/** What the page says when the API couldn't answer */
export function failureMessage(status: number | null): string {
  if (status === 429) return 'Too many checks from you just now. Try again in a minute.'
  if (status === 400) return 'That isn’t a link WorldPulse can read. Paste the full address of a news article.'
  return 'WorldPulse couldn’t check that just now. Try again in a minute.'
}
