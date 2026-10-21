'use client'

/**
 * Who reported it: one block for the story page's outlets (plan P2, step 3,
 * Oct 21, 2026). The page named them in three places: "Source Intelligence"
 * (this report's links), the story timeline right under it, and the
 * sidebar's "Source chain", which repeated the first one's sources. Now one
 * card: this report (its source with the kind of outlet and trust bar when
 * it has one, its links, "View original source"), then the story so far
 * (every report, its outlet and time, the verified moment, new since your
 * last look). Nothing either showed is left out.
 */

import type { Source } from '@worldpulse/types'
import { SourceChain, computeSourceChainMode } from '@/components/signals/SourceChain'
import { StoryMembers } from './StoryMembers'

interface Props {
  signalId: string
  sources: Source[]
  sourceUrl: string | null
  originalUrls: string[]
  /** Outlets that carried the whole story, when known */
  storyOutlets: number | null
}

export function WhoReported({ signalId, sources, sourceUrl, originalUrls, storyOutlets }: Props) {
  // A report with no link of its own: the story so far alone, in its own card
  if (computeSourceChainMode(sources, sourceUrl) === 'hidden') return <StoryMembers signalId={signalId} />

  return (
    <section aria-label="Who reported it" className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-text2">Who reported it</h2>
      <SourceChain bare sources={sources} sourceUrl={sourceUrl} originalUrls={originalUrls} storyOutlets={storyOutlets} />
      <StoryMembers bare signalId={signalId} />
    </section>
  )
}
