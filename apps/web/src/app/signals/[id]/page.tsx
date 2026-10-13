import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Signal, Post } from '@worldpulse/types'
import { SignalDetailClient } from './SignalDetailClient'
import { displaySummary } from '@/lib/signal-text'
import { SITE_NAME, SITE_URL, newsArticleJsonLd, jsonLdText, metaDescription } from '@/lib/page-metadata'
import { cachedFetch } from '@/lib/server-fetch'

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

async function fetchRelated(category: string, excludeId: string): Promise<Signal[]> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/signals?category=${encodeURIComponent(category)}&limit=6&status=verified`, 60_000)
    if (!res.ok) return []
    const json = await res.json() as { data?: { items: Signal[] } }
    return (json.data?.items ?? []).filter(s => s.id !== excludeId).slice(0, 5)
  } catch {
    return []
  }
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
  const description = metaDescription(displaySummary(signal.summary, signal.title) || signal.title)
  const path = `/signals/${signal.id}`
  // The page's own address and the site name: this openGraph replaces the
  // root layout's whole one. The picture is the story's own card
  // (opengraph-image.tsx and twitter-image.tsx next to this page, plan G3)
  return {
    title:       `${signal.title} — WorldPulse`,
    description,
    alternates:  { canonical: path },
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

  const [related, postsData] = await Promise.all([
    fetchRelated(signal.category, signal.id),
    fetchSignalPosts(signal.id),
  ])

  // What search engines read about the story (schema.org NewsArticle, plan G2)
  const jsonLd = newsArticleJsonLd({
    id:          signal.id,
    title:       signal.title,
    description: metaDescription(displaySummary(signal.summary, signal.title) || signal.title, 300),
    published:   signal.firstReported ?? signal.createdAt,
    modified:    signal.lastUpdated,
    place:       signal.locationName,
    image:       `${SITE_URL}/signals/${signal.id}/opengraph-image`,
  })

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <SignalDetailClient
        signal={signal}
        related={related}
        initialPosts={postsData.items}
        postsTotal={postsData.total}
      />
    </>
  )
}
