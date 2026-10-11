import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Signal, Post } from '@worldpulse/types'
import { SignalDetailClient } from './SignalDetailClient'
import { displaySummary } from '@/lib/signal-text'
import { SITE_NAME, SITE_URL, newsArticleJsonLd, jsonLdText, metaDescription } from '@/lib/page-metadata'

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

async function fetchSignal(id: string): Promise<SignalDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/signals/${id}`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return null
    const json = await res.json() as { success: boolean; data?: SignalDetail }
    return json.success ? (json.data ?? null) : null
  } catch {
    return null
  }
}

async function fetchRelated(category: string, excludeId: string): Promise<Signal[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/signals?category=${category}&limit=6&status=verified`,
      { next: { revalidate: 60 } },
    )
    if (!res.ok) return []
    const json = await res.json() as { data?: { items: Signal[] } }
    return (json.data?.items ?? []).filter(s => s.id !== excludeId).slice(0, 5)
  } catch {
    return []
  }
}

async function fetchSignalPosts(id: string): Promise<{ items: Post[]; total: number }> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/signals/${id}/posts?limit=20&sort=recent`,
      { next: { revalidate: 10 } },
    )
    if (!res.ok) return { items: [], total: 0 }
    const json = await res.json() as {
      success: boolean
      data?: { items: Post[]; total: number }
    }
    return json.success ? (json.data ?? { items: [], total: 0 }) : { items: [], total: 0 }
  } catch {
    return { items: [], total: 0 }
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params
  const signal = await fetchSignal(id)
  if (!signal) return { title: 'Signal Not Found — WorldPulse' }
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
  if (!signal) notFound()

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
