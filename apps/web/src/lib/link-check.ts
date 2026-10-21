/**
 * world-pulse.io/check, "Has more than one newsroom reported this?" (paste a
 * link, get the count, version 1; Devon, Oct 20, 2026: "ok to start with 1").
 * Version 2 (Oct 21; Devon: "Yes, with safeguards"): for a link WorldPulse
 * hasn't collected, the API opens the page once to read its headline and
 * looks for a story telling the same event (match "similar").
 * The visitor's own browser asks GET /api/v1/stories/by-link, so each visitor
 * has their own rate limit (the website's server shares one). What the answer
 * says is worked out here, so it can be tested without a browser.
 */

import { outletsLine } from '@/lib/embed-card'
import { howSure } from '@/lib/how-sure'

export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io').replace(/\/+$/, '')

/** GET /api/v1/stories/by-link's data */
export interface LinkAnswer {
  found: boolean
  reason?: 'not_seen' | 'pending' | 'not_an_article' | 'busy' | string
  /** Version 2: "similar" when WorldPulse hasn't collected this article and found a story telling the same event */
  match?: 'exact' | 'similar'
  /** Version 2: whether the page was opened, its headline and site, and why it couldn't be read */
  opened?: boolean
  page?: { title?: string | null; site?: string | null } | null
  why?: string
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
      /** Version 2: the pasted page's own headline, when the story was found by it */
      similarTo: string | null
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
  busy: 'Many links are being checked just now. Try again in a few minutes.',
}

/** Why a page couldn't be opened (version 2), in words */
const UNREADABLE: Record<string, string> = {
  not_public: 'That address isn’t a public web page.',
  not_a_page: 'That link isn’t a web page (a file or a PDF?).',
  no_headline: 'WorldPulse opened the page but found no headline on it.',
}

/** What the page says when nothing was found */
export function missingMessage(answer: LinkAnswer): string {
  const reason = answer.reason ?? 'not_seen'
  if (reason === 'not_seen' && answer.opened && answer.page?.title) {
    return `WorldPulse read this page’s headline, “${answer.page.title}”, and has no story telling the same event in the last week. It may be very new, local, or from a site WorldPulse doesn’t read.`
  }
  if (reason === 'not_seen' && answer.opened === false && answer.why) {
    const why = UNREADABLE[answer.why] ?? 'WorldPulse couldn’t open that page: the site didn’t answer in time, or the page needs a sign-in.'
    return `${why} ${MISSING.not_seen}`
  }
  return MISSING[reason] ?? MISSING.not_seen!
}

/** What the page shows for an answer */
export function checkView(answer: LinkAnswer): CheckView {
  if (!answer.found) return { kind: 'missing', message: missingMessage(answer) }
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
  // the same words as the story's page (lib/how-sure.ts)
  const sure = howSure({ verified, outlets, outletsAll, firstReportAt: answer.story?.firstReportAt })
  const id = answer.report?.id ?? ''
  return {
    kind: 'found',
    title: (answer.report?.title ?? '').trim() || 'This article',
    outlet: own,
    count: sure.count,
    since: sure.since,
    verified,
    outlets: outletsLine({ outlets, named }),
    verdict: sure.verdict,
    href: `/signals/${encodeURIComponent(id)}?utm_source=check&utm_medium=web&utm_campaign=link-check`,
    similarTo: answer.match === 'similar' ? ((answer.page?.title ?? '').trim() || 'this article') : null,
  }
}

/** What the page says when the API couldn't answer */
export function failureMessage(status: number | null): string {
  if (status === 429) return 'Too many checks from you just now. Try again in a minute.'
  if (status === 400) return 'That isn’t a link WorldPulse can read. Paste the full address of a news article.'
  return 'WorldPulse couldn’t check that just now. Try again in a minute.'
}
