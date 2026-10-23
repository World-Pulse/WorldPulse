import type { Metadata } from 'next'
import Link from 'next/link'
import { HomeFeed } from '@/components/home/HomeFeed'
import { SITE_URL, metaDescription } from '@/lib/page-metadata'
import { X_HANDLE } from '@/lib/share-links'
import { cachedFetch } from '@/lib/server-fetch'
import { fetchHomeTotals } from '@/lib/home-totals'

// The feed is a client component, so the home page's HTML used to carry no
// stories, no structured data and no feed address: a crawler saw an empty
// front page. This server page renders the stories most outlets report as
// plain links (visually hidden, as on country pages), adds Organization and
// WebSite data and points to the Atom feed (plan G16 slice 2, Oct 18, 2026).

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const FEED_URL = 'https://api.world-pulse.io/api/v1/rss/signals.xml'

export const metadata: Metadata = {
  alternates: {
    canonical: `${SITE_URL}/`,
    types: { 'application/atom+xml': [{ url: FEED_URL, title: 'WorldPulse — verified stories' }] },
  },
}

interface HomeStory { id: string; title: string; outletCount: number }

/** The stories most outlets reported in the last day; empty when the API doesn't answer */
async function fetchStories(): Promise<HomeStory[]> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories?hours=24&limit=${STORY_LIMIT}`, 120_000)
    if (!res.ok) return []
    const json = await res.json() as { data?: { stories?: Array<{ id?: string; leadId?: string; title?: string; outletCount?: number }> } }
    const list = Array.isArray(json.data?.stories) ? json.data.stories : []
    const out: HomeStory[] = []
    for (const s of list) {
      const id = s.leadId || s.id
      if (typeof id !== 'string' || typeof s.title !== 'string' || !s.title) continue
      out.push({ id, title: s.title, outletCount: Number(s.outletCount) || 0 })
    }
    return out
  } catch {
    return []
  }
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** Page size of the stories call: a full list means "at least" this many */
const STORY_LIMIT = 20

const DESCRIPTION = metaDescription(
  "World news with how many independent outlets reported each story, and which ones. Live map, the week's top stories, open data and a free API.",
)

const STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'WorldPulse',
    url: SITE_URL,
    logo: `${SITE_URL}/og-image.png`,
    description: DESCRIPTION,
    sameAs: [`https://x.com/${X_HANDLE}`, 'https://github.com/World-Pulse/WorldPulse-v2'],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'WorldPulse',
    url: SITE_URL,
    description: DESCRIPTION,
  },
]

export default async function HomePage() {
  const [stories, totals] = await Promise.all([fetchStories(), fetchHomeTotals()])
  const verified = stories.filter(s => s.outletCount >= 2)
  const widest = verified.reduce((m, s) => Math.max(m, s.outletCount), 0)
  const verifiedLabel = `${verified.length}${stories.length >= STORY_LIMIT ? '+' : ''}`
  return (
    <>
      <script
        type="application/ld+json"
        // Fixed data from this file; "<" escaped so nothing can close the tag
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
      />
      {(totals.verified24h || verified.length > 0) && (
        // The day's verified stories and sources from the status file; when
        // it doesn't answer, the stories list's own count ("20+": at least)
        <p className="border-b border-[rgba(255,255,255,0.07)] bg-wp-bg px-4 py-2 text-center text-xs text-wp-text">
          {totals.verified24h
            ? <><span className="text-wp-cyan">{fmt(totals.verified24h)} stories</span> verified in the last 24 hours</>
            : <><span className="text-wp-cyan">{verifiedLabel} stories</span> reported by 2 or more independent outlets in the last 24 hours</>}
          {widest >= 2 && <> · the widest by {fmt(widest)} outlets</>}
          {totals.sources && <> · {fmt(totals.sources)} sources read</>}
          {' · '}
          <Link href="/how-we-count" className="underline underline-offset-2 hover:text-wp-cyan">How we count</Link>
        </p>
      )}
      <HomeFeed />
      {stories.length > 0 && (
        // The stories most outlets report, as plain links for search engines
        // and readers without JavaScript; kept out of the visual layout
        <nav aria-label="Top verified stories today" className="sr-only">
          <h2>Top stories today, reported by independent outlets</h2>
          <ul>
            {stories.map(s => (
              <li key={s.id}>
                <Link href={`/signals/${s.id}`}>{s.title}</Link>
                {s.outletCount > 1 ? ` (${s.outletCount} outlets)` : ''}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  )
}
