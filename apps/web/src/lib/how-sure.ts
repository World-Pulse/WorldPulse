/**
 * "How sure are we" (plan P2, step 1): what a story's outlet count says, in
 * the same words on its page and on world-pulse.io/check. WorldPulse marks a
 * story verified when two or more independent outlets report it and its
 * reliability score reaches 65% (/how-we-count): more than one outlet says
 * so, which is not the same as proven true.
 */

import { countLine } from '@/lib/embed-card'
import { sinceText, STORY_COUNT_DAYS } from '@/lib/story-count'

export type HowSureTone = 'verified' | 'multi' | 'single'

export interface HowSure {
  tone: HowSureTone
  /** "✓ Verified · 48 outlets", "3 outlets", "1 outlet" */
  count: string
  /** "in its last 2 days · 143 since Oct 10" for a story that has run longer, else '' */
  since: string
  /** What the count means, in a sentence or two */
  verdict: string
}

export interface HowSureInput {
  verified: boolean
  /** Outlets in the story's last two days (lib/story-count.ts) */
  outlets: number
  /** Outlets since it began, when known */
  outletsAll?: number | null
  firstReportAt?: string | null
}

/**
 * The verdict goes by every outlet that has reported the story since it
 * began: one that ran on for days is not "only one outlet so far" because
 * one outlet reported it in its last two days.
 */
export function howSure(input: HowSureInput): HowSure {
  const outlets = Math.max(Math.floor(Number(input.outlets)) || 0, 1)
  const outletsAll = Math.max(Math.floor(Number(input.outletsAll)) || 0, outlets)
  const since = sinceText(outlets, outletsAll, input.firstReportAt)
  const tone: HowSureTone = input.verified ? 'verified' : outletsAll > 1 ? 'multi' : 'single'
  const verdict = tone === 'verified'
    ? 'Two or more outlets reported this story and its reliability score reached 65%, so WorldPulse marks it verified. That means more than one outlet says so, not that it is proven true.'
    : tone === 'multi'
      ? `${outletsAll} outlets reported this story, but it isn’t verified yet: that takes two or more independent outlets and a reliability score of 65%.`
      : 'Only one outlet so far: treat it as unconfirmed. That doesn’t make it false; it may be new, or an exclusive.'
  return {
    tone,
    count: countLine({ outlets, verified: input.verified }),
    since: since ? `in its last ${STORY_COUNT_DAYS} days · ${since}` : '',
    verdict,
  }
}
