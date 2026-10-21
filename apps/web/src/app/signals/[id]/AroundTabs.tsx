'use client'

/**
 * Around this story: the sidebar's two "what else is there" lists as two tabs
 * of one block (plan P2, step 4, Oct 21, 2026): More stories (the list that
 * was headed Related: other stories, one row each, the same country first,
 * then the topic, then the day's most reported (lib/related-stories.ts); from
 * the server, so their links are in the page's first HTML for search
 * engines) and the Intelligence Web (stories naming the same people,
 * places and organisations), which asks the API only when its tab is opened.
 * Without related stories, the Intelligence Web alone, as before.
 */

import { useState, type ReactNode } from 'react'
import { ConnectionWeb } from './ConnectionWeb'

type Tab = 'related' | 'web'

export function AroundTabs({ signalId, related }: { signalId: string; related: ReactNode | null }) {
  const [tab, setTab] = useState<Tab>('related')
  if (!related) return <ConnectionWeb signalId={signalId} />

  const tabClass = (t: Tab) =>
    `flex-1 px-2 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase transition-colors ${
      tab === t ? 'bg-white/[0.08] text-wp-text' : 'text-wp-text3 hover:text-wp-text2'
    }`

  return (
    <section aria-label="Around this story" className="space-y-2">
      <div role="tablist" aria-label="Around this story" className="flex gap-1 p-1 rounded-lg border border-white/[0.07] bg-white/[0.02]">
        <button type="button" role="tab" id="around-tab-related" aria-controls="around-related" aria-selected={tab === 'related'}
          onClick={() => setTab('related')} className={tabClass('related')}>
          More stories
        </button>
        <button type="button" role="tab" id="around-tab-web" aria-controls="around-web" aria-selected={tab === 'web'}
          onClick={() => setTab('web')} className={tabClass('web')}>
          Intelligence Web
        </button>
      </div>
      <div role="tabpanel" id="around-related" aria-labelledby="around-tab-related" hidden={tab !== 'related'} className="space-y-2">
        {related}
      </div>
      {tab === 'web' && (
        <div role="tabpanel" id="around-web" aria-labelledby="around-tab-web">
          <ConnectionWeb signalId={signalId} />
        </div>
      )}
    </section>
  )
}
