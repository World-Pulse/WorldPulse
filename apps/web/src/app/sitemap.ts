import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/sitemap.xml (plan G2, Oct 11, 2026): the main pages and one
 * page per verified story of the last 7 days (GET /api/v1/stories/sitemap,
 * which the API keeps for 30 minutes). Built when asked, so it is never older
 * than the API's copy; if the API can't answer, the main pages still go out.
 */
export const dynamic = 'force-dynamic'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

/** Public pages worth finding, most important first */
const PAGES: Array<{ path: string; changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly'; priority: number }> = [
  { path: '/', changeFrequency: 'always', priority: 1 },
  { path: '/map', changeFrequency: 'always', priority: 0.9 },
  { path: '/briefing', changeFrequency: 'daily', priority: 0.9 },
  { path: '/briefings', changeFrequency: 'daily', priority: 0.7 },
  { path: '/claims', changeFrequency: 'hourly', priority: 0.6 },
  { path: '/developers', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.5 },
]

interface SitemapStory { id: string; updatedAt: string }

async function verifiedStories(): Promise<SitemapStory[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/stories/sitemap`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = await res.json() as { data?: { stories?: SitemapStory[] } }
    return Array.isArray(json.data?.stories) ? json.data.stories : []
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const stories = await verifiedStories()
  return [
    ...PAGES.map(p => ({ url: `${SITE_URL}${p.path === '/' ? '' : p.path}`, lastModified: now, changeFrequency: p.changeFrequency, priority: p.priority })),
    ...stories.map(s => ({ url: `${SITE_URL}/signals/${s.id}`, lastModified: new Date(s.updatedAt), changeFrequency: 'hourly' as const, priority: 0.6 })),
  ]
}
