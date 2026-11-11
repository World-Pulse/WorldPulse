import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Signal, Post } from '@worldpulse/types'
import { SignalDetailClient } from './SignalDetailClient'
import { displaySummary } from '@/lib/signal-text'
import { storyPageTitle, storyIndexable, storyCanonicalPath, storyFactLine, topFigure, type StoryOutletCounts, type StoryFactExtras } from '@/lib/story-count'
import { SITE_NAME, SITE_URL, newsArticleJsonLd, jsonLdText, metaDescription } from '@/lib/page-metadata'
import { cachedFetch } from '@/lib/server-fetch'
import Link from 'next/link'
import { FollowBox } from '@/components/FollowBox'
import { countryLink, entityLinks, weekLink, type StoryLink } from '@/lib/story-links'
import { fetchCountryStories } from '@/lib/country-stories'
import { fetchTopStories, rankRelatedStories } from '@/lib/related-stories'
import type { CountryStory } from '@/components/countries/CountryTopStories'
import { fetchStoryOutletCounts } from '@/lib/story-outlets'
import type { SecondReadInfo } from '@/lib/second-read'
import type { OutletInfo } from '@/lib/outlet-kinds'
import type { StoryFiguresData } from './StoryFigures'
import type { StoryDetail } from './StoryMembers'

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface Verification {
  check_type: string
  result:     string
  confidence: number
  notes:      string | null
  created_at: string
}

export interface SignalDetail extends Signal {
  verifications: Verification[]
  /** What each linked website is: name, kind, home country, state media (plan 15, Oct 22, 2026) */
  outletInfo?: OutletInfo[]
  /** The second read of a high or critical report few outlets carry (plan 11) */
  secondRead?: SecondReadInfo | null
}

/**
 * The API couldn't answer for a story (down, overloaded or rate limited).
 * Not the same as a story that doesn't exist: on Oct 12, 2026, while the
 * server's disk was full, every story page said "Signal Not Found" and was
 * marked noindex, and link previews kept that.
 */
class StoryUnavailableError extends Error {
  constructor() {
    super('The story could not be loaded: the API did not answer')
    this.name = 'StoryUnavailableError'
  }
}

/** The story, 'missing' (the API says there's no such story) or 'unavailable' */
async function fetchSignal(id: string): Promise<SignalDetail | 'missing' | 'unavailable'> {
  try {
    // (kept 30 s in this process: every view used to call the API, lib/server-fetch.ts)
    const res = await cachedFetch(`${API_BASE}/api/v1/signals/${id}`, 30_000)
    if (res.status === 404 || res.status === 400) return 'missing'
    if (!res.ok) return 'unavailable'
    const json = await res.json() as { success: boolean; data?: SignalDetail }
    return json.success && json.data ? json.data : 'missing'
  } catch {
    return 'unavailable'
  }
}

/** What "Related" picks from: the country's top stories and the day's most-reported (lib/related-stories.ts) */
async function fetchRelatedLists(countryCode: string | null | undefined): Promise<{ country: CountryStory[]; top: CountryStory[] }> {
  const code = countryLink(countryCode) ? String(countryCode).toUpperCase() : null
  const [country, top] = await Promise.all([
    code ? fetchCountryStories(code) : Promise.resolve(null),
    fetchTopStories(),
  ])
  return { country: country ?? [], top }
}

/**
 * The people, places and organisations the story names (an extra: [] when the
 * API can't say). Asked without the connections search since Oct 20, 2026:
 * that search answered 500 for the biggest stories, so their pages had no
 * "In this story" links (G21).
 */
async function fetchEntityLinks(id: string): Promise<StoryLink[]> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/signals/${encodeURIComponent(id)}/connections?only=entities`, 120_000)
    if (!res.ok) return []
    const json = await res.json() as { success?: boolean; data?: { entities?: Array<{ id?: unknown; name?: unknown }> } }
    return json.success ? entityLinks(json.data?.entities) : []
  } catch {
    return []
  }
}

/** One part of a story from the API, or null when it doesn't answer in 4 seconds (the browser asks then) */
async function fetchStoryPart<T>(path: string): Promise<T | null> {
  try {
    const res = await cachedFetch(`${API_BASE}${path}`, 60_000, 4_000)
    if (!res.ok) return null
    const json = await res.json() as { success?: boolean; data?: T }
    return json.success && json.data ? json.data : null
  } catch {
    return null
  }
}

/**
 * A story's figures and its reports so far, in the page's own HTML (Nov 11, 2026; G28, Devon: "Proceed" to full
 * pages for verified stories): the browser used to ask for them after the page loaded, so search engines and AI
 * assistants that read the page without running it saw neither, nor the story's other outlets. Asked for a story
 * two or more outlets carry (one report has neither); kept a minute, shared by the page and its description.
 */
async function fetchStoryParts(id: string, counts: StoryOutletCounts | null): Promise<{ figures: StoryFiguresData | null; story: StoryDetail | null }> {
  if (!counts || counts.outlets < 2) return { figures: null, story: null }
  const key = encodeURIComponent(id)
  const [figures, story] = await Promise.all([
    fetchStoryPart<StoryFiguresData>(`/api/v1/stories/${key}/figures`),
    fetchStoryPart<StoryDetail>(`/api/v1/stories/${key}`),
  ])
  return { figures, story }
}

/** What the fact line adds from those parts: the story's own country's newsrooms and its most-reported figure */
function factExtras(parts: { figures: StoryFiguresData | null; story: StoryDetail | null }): StoryFactExtras {
  return { local: parts.story?.localOutlets, country: parts.story?.country, figure: topFigure(parts.figures) }
}

/** The outlets' own articles in the story, for its structured data: one per outlet, newest first */
function storyCitations(story: StoryDetail | null): Array<{ url: string; outlet: string }> {
  if (!story || !Array.isArray(story.signals)) return []
  return [...story.signals]
    .filter(m => m && typeof m.url === 'string' && typeof m.outlet === 'string' && m.outlet)
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
    .map(m => ({ url: m.url as string, outlet: m.outlet }))
}

async function fetchSignalPosts(id: string): Promise<{ items: Post[]; total: number }> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/signals/${id}/posts?limit=20&sort=recent`, 10_000)
    if (!res.ok) return { items: [], total: 0 }
    const json = await res.json() as {
      success: boolean
      data?: { items?: Post[]; total?: number }
    }
    const items = json.success && Array.isArray(json.data?.items) ? json.data.items : []
    // The API pages with a cursor and sends no total: the heading read
    // "Discussion (NaN)" (Oct 12, 2026). Count what arrived instead.
    const total = typeof json.data?.total === 'number' ? json.data.total : items.length
    return { items, total }
  } catch {
    return { items: [], total: 0 }
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params
  const signal = await fetchSignal(id)
  // Link previews (X, LinkedIn, Slack…) and Bing wait for this before the page
  // is sent, so an outage reaches them as an error to retry later rather
  // than as a card for a missing story
  if (signal === 'unavailable') throw new StoryUnavailableError()
  if (signal === 'missing') return { title: 'Signal Not Found — WorldPulse', robots: { index: false } }
  // (a summary that only repeats the headline, or the old outlet note, isn't a
  // description; search results and share cards show about 160 characters)
  const path = `/signals/${signal.id}`
  // (the same count the page shows; kept 60 s, so the page's own call reuses it)
  const counts = await fetchStoryOutletCounts(signal.id)
  const title = storyPageTitle(signal.title, counts)
  // The story's facts first (Nov 8, 2026): what a search result or an AI assistant quotes; with its own country's
  // newsrooms and its most-reported figure since Nov 11 (the same parts the page shows, kept a minute)
  const fact = storyFactLine({
    verified: counts?.verified === true || signal.status === 'verified',
    outlets: counts?.outlets ?? 0,
    countries: counts?.countries,
    firstReportAt: counts?.firstReportAt ?? signal.firstReported,
    ...factExtras(await fetchStoryParts(signal.id, counts)),
  })
  const description = metaDescription([fact, displaySummary(signal.summary, signal.title) || signal.title].filter(Boolean).join(' '))
  // The page's own address and the site name: this openGraph replaces the
  // root layout's whole one. The picture is the story's own card
  // (opengraph-image.tsx and twitter-image.tsx next to this page, plan G3)
  return {
    title:       `${title} — WorldPulse`,
    description,
    // One page per story for search engines, and only verified stories in their results (Nov 8, 2026)
    alternates:  { canonical: storyCanonicalPath(signal.id, counts) },
    ...(storyIndexable(signal.status, counts) ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title:         signal.title,
      description,
      type:          'article',
      url:           path,
      siteName:      SITE_NAME,
      publishedTime: signal.firstReported ?? undefined,
      modifiedTime:  signal.lastUpdated   ?? undefined,
      tags:          signal.tags,
    },
    twitter: {
      card:        'summary_large_image',
      title:       signal.title,
      description,
    },
  }
}

export default async function SignalDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const signal = await fetchSignal(id)
  if (signal === 'missing') notFound()
  // error.tsx says the story is briefly unavailable and offers to try again
  if (signal === 'unavailable') throw new StoryUnavailableError()

  const [relatedLists, postsData, entities, storyCounts] = await Promise.all([
    fetchRelatedLists(signal.countryCode),
    fetchSignalPosts(signal.id),
    fetchEntityLinks(signal.id),
    fetchStoryOutletCounts(signal.id),
  ])
  const parts = await fetchStoryParts(signal.id, storyCounts)
  const related = rankRelatedStories(
    { storyId: storyCounts?.storyId, signalId: signal.id, category: signal.category },
    relatedLists.country,
    relatedLists.top,
  )
  const country = countryLink(signal.countryCode)
  const week = weekLink(signal.firstReported ?? signal.createdAt)

  // What search engines read about the story (schema.org NewsArticle, plan G2): its facts first, as on the page,
  // and the outlets' own articles as citations (Nov 11, 2026)
  const fact = storyFactLine({
    verified: storyCounts?.verified === true || signal.status === 'verified',
    outlets: storyCounts?.outlets ?? 0,
    countries: storyCounts?.countries,
    firstReportAt: storyCounts?.firstReportAt ?? signal.firstReported,
    ...factExtras(parts),
  })
  const jsonLd = newsArticleJsonLd({
    id:          signal.id,
    title:       signal.title,
    description: metaDescription([fact, displaySummary(signal.summary, signal.title) || signal.title].filter(Boolean).join(' '), 300),
    published:   signal.firstReported ?? signal.createdAt,
    modified:    signal.lastUpdated,
    place:       signal.locationName,
    image:       `${SITE_URL}/signals/${signal.id}/opengraph-image`,
    citations:   storyCitations(parts.story),
  })

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <SignalDetailClient
        signal={signal}
        related={related}
        initialPosts={postsData.items}
        postsTotal={postsData.total}
        initialStoryCounts={storyCounts}
        initialFigures={parts.figures}
        initialStory={parts.story}
      />
      {(country || entities.length > 0 || week) && (
        <nav aria-label="About this story" className="mx-auto max-w-5xl px-4 pb-8 text-[12px] text-wp-text3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {country && (
            <span>Country: <Link href={country.href} className="text-wp-text2 hover:text-wp-amber">{country.label}</Link></span>
          )}
          {entities.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2">
              In this story:
              {entities.map(e => (
                <Link key={e.href} href={e.href} className="text-wp-text2 hover:text-wp-amber">{e.label}</Link>
              ))}
            </span>
          )}
          {week && (
            <span>WorldPulse Week: <Link href={week.href} className="text-wp-text2 hover:text-wp-amber">{week.label}</Link></span>
          )}
        </nav>
      )}
      <FollowBox className="mx-auto max-w-5xl px-4 pb-8" />
    </>
  )
}
