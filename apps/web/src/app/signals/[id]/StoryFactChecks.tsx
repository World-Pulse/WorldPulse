'use client'

/**
 * Fact-checks of claims about the story (Nov 11, 2026; Devon, Nov 10: "Set this up"): fact-checkers' own
 * headlines, the claim each checked and its rating where it gives one, credited and linked to the check
 * (GET /api/v1/stories/:id/fact-checks; the API's lib/fact-checks.ts finds them by meaning and by headline
 * words). WorldPulse doesn't rule on claims, so ratings are shown as the checker writes them, all in one
 * colour. Hidden when no check is about the story. A verified story's page brings them in its own HTML.
 */

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface StoryFactCheck {
  checker: string
  checkerUrl: string | null
  title: string
  url: string
  published: string
  claim: string | null
  rating: string | null
  summary: string | null
}

export interface StoryFactChecksData {
  storyId: string
  available?: boolean
  checks: StoryFactCheck[]
}

/** Whether there is a check to show */
export function hasFactChecks(data: StoryFactChecksData | null | undefined): data is StoryFactChecksData {
  return !!data && Array.isArray(data.checks) && data.checks.some(c => c && typeof c.url === 'string' && /^https:\/\//.test(c.url) && !!c.title)
}

/** "Nov 4", in UTC: the same in the page's HTML and in the browser */
export function checkDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

export function FactChecksView({ data }: { data: StoryFactChecksData }) {
  if (!hasFactChecks(data)) return null
  const checks = data.checks.filter(c => c && /^https:\/\//.test(c.url) && c.title)
  return (
    <section aria-label="Fact-checks" className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-2.5">
      <div className="space-y-0.5">
        <h2 className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 font-normal">Fact-checks</h2>
        <p className="text-[11px] text-wp-text3 leading-snug">
          Fact-checkers looked at claims about this story. Their findings are in their own words, linked to their checks.
          WorldPulse doesn&rsquo;t rule on claims.
        </p>
      </div>
      <ul className="space-y-3">
        {checks.map(c => (
          <li key={c.url} className="pl-3 border-l border-white/10 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-wp-text3">
              {c.checkerUrl
                ? <a href={c.checkerUrl} target="_blank" rel="noopener noreferrer" className="text-wp-text2 hover:text-wp-amber transition-colors">{c.checker}</a>
                : <span className="text-wp-text2">{c.checker}</span>}
              {c.rating && <span>· rated it <span className="text-wp-text2">{c.rating}</span></span>}
              {checkDay(c.published) && <span>· {checkDay(c.published)}</span>}
            </div>
            <a href={c.url} target="_blank" rel="noopener noreferrer"
              className="block text-[13px] text-wp-text hover:text-wp-amber leading-[1.4] transition-colors">
              {c.title} ↗
            </a>
            {c.claim
              ? <p className="text-[12px] text-wp-text3 leading-[1.4]">The claim it checked: {c.claim}</p>
              : c.summary && <p className="text-[12px] text-wp-text3 leading-[1.4]">{c.summary}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Shows the checks the page brought (`initial`); when it brought none for a story two or more outlets carry
 * (the API was slow), the browser asks. Nothing shows until there is a check.
 */
export function StoryFactChecks({ storyKey, initial = null, ask = false }: { storyKey: string; initial?: StoryFactChecksData | null; ask?: boolean }) {
  const [data, setData] = useState<StoryFactChecksData | null>(initial)

  useEffect(() => {
    if (initial || !ask) return
    let cancelled = false
    fetch(`${API_URL}/api/v1/stories/${encodeURIComponent(storyKey)}/fact-checks`)
      .then(r => (r.ok ? r.json() : null))
      .then((body: { success?: boolean; data?: StoryFactChecksData } | null) => {
        if (!cancelled && body?.success && body.data) setData(body.data)
      })
      .catch(() => { /* non-fatal: the section stays hidden */ })
    return () => { cancelled = true }
  }, [storyKey, initial, ask])

  return data ? <FactChecksView data={data} /> : null
}
