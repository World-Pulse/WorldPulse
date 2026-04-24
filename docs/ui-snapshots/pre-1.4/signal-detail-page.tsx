import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Signal, Post } from '@worldpulse/types'
import { SignalDetailClient } from './SignalDetailClient'

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
  return {
    title:       `${signal.title} — WorldPulse`,
    description: signal.summary ?? signal.title,
    openGraph: {
      title:         signal.title,
      description:   signal.summary ?? signal.title,
      type:          'article',
      publishedTime: signal.firstReported ?? undefined,
      modifiedTime:  signal.lastUpdated   ?? undefined,
      tags:          signal.tags,
    },
    twitter: {
      card:        'summary_large_image',
      title:       signal.title,
      description: signal.summary ?? signal.title,
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

  return (
    <SignalDetailClient
      signal={signal}
      related={related}
      initialPosts={postsData.items}
      postsTotal={postsData.total}
    />
  )
}
