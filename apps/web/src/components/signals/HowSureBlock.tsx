/**
 * "How sure are we" on a story's page (plan P2, step 1): the story's outlet
 * count, what it means, and where the counting is explained. The words come
 * from lib/how-sure.ts, as on world-pulse.io/check.
 */

import Link from 'next/link'
import type { HowSure, HowSureTone } from '@/lib/how-sure'

const TONE_CLASS: Record<HowSureTone, string> = {
  verified: 'border-[rgba(0,230,118,0.35)] bg-[rgba(0,230,118,0.12)] text-wp-green',
  multi:    'border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.12)] text-wp-amber',
  single:   'border-white/10 text-wp-text2',
}

export function HowSureBlock({ sure }: { sure: HowSure }) {
  return (
    <section className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-2" aria-label="How sure are we">
      <h2 className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 font-normal">How sure are we</h2>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`inline-block rounded-full border px-3 py-1 font-mono text-[12px] font-bold ${TONE_CLASS[sure.tone]}`}>
          {sure.count}
        </span>
        {sure.since && <span className="font-mono text-[11px] text-wp-text3">{sure.since}</span>}
      </div>
      <p className="text-[13px] text-wp-text2 leading-relaxed">{sure.verdict}</p>
      <p className="font-mono text-[11px] text-wp-text3">
        <Link href="/how-we-count" className="text-wp-amber hover:underline">How we count</Link>
        {' · '}
        <Link href="/check" className="text-wp-amber hover:underline">Check a link someone shared</Link>
      </p>
    </section>
  )
}
