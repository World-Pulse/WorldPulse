import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/page-metadata'
import { entityPath } from '@/lib/entity-links'
import { isListedCountry, type ListedCountry } from '@/lib/country-list'
import { finishedWeeks } from '@/lib/week'

/**
 * world-pulse.io/sitemap.xml (plan G2, Oct 11, 2026): the main pages and one
 * page per verified story of the last 7 days (GET /api/v1/stories/sitemap,
 * which the API keeps for 30 minutes), and since Oct 13 a page per person,
 * place or organisation named in 3+ reports in the last 14 days
 * (GET /api/v1/knowledge-graph/sitemap, kept for an hour), and since Oct 15 a
 * page per country with verified stories in the last 7 days (GET
 * /api/v1/countries, plan G15). Built when asked, so it is never older
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
  { path: '/help', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/how-we-count', changeFrequency: 'monthly', priority: 0.5 },
  // "Has more than one newsroom reported this?": paste a link, get the count (Oct 20, 2026)
  { path: '/check', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/knowledge-graph', changeFrequency: 'hourly', priority: 0.6 },
  { path: '/entities', changeFrequency: 'hourly', priority: 0.7 },
  // The index and topic pages, each with its own title since H-0023 (Oct 20, 2026)
  { path: '/countries', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/maritime', changeFrequency: 'hourly', priority: 0.6 },
  // The camera wall, back Oct 21, 2026 (plan M45)
  { path: '/cameras', changeFrequency: 'daily', priority: 0.4 },
  { path: '/explore', changeFrequency: 'hourly', priority: 0.6 },
  { path: '/sources', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/cyber-threats', changeFrequency: 'hourly', priority: 0.5 },
  { path: '/internet-outages', changeFrequency: 'hourly', priority: 0.5 },
  { path: '/space-weather', changeFrequency: 'hourly', priority: 0.4 },
  { path: '/undersea-cables', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/finance', changeFrequency: 'hourly', priority: 0.5 },
  { path: '/food-security', changeFrequency: 'daily', priority: 0.4 },
  { path: '/water-security', changeFrequency: 'daily', priority: 0.4 },
  { path: '/governance', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/digital-rights', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/labor-rights', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/ai-infrastructure', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/clusters', changeFrequency: 'hourly', priority: 0.4 },
  { path: '/communities', changeFrequency: 'daily', priority: 0.3 },
  // "WorldPulse Week" (plan G11): the week under way; the finished weeks are added below
  { path: '/week', changeFrequency: 'daily', priority: 0.8 },
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

interface SitemapEntity { id: string; name: string; lastReport: string }

async function namedEntities(): Promise<SitemapEntity[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/knowledge-graph/sitemap`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = await res.json() as { data?: { entities?: SitemapEntity[] } }
    return Array.isArray(json.data?.entities) ? json.data.entities.filter(e => e && typeof e.id === 'string' && typeof e.name === 'string') : []
  } catch {
    return []
  }
}

type SitemapCountry = ListedCountry

async function activeCountries(): Promise<SitemapCountry[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/countries?window=7d&limit=200`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = await res.json() as { countries?: SitemapCountry[] }
    return Array.isArray(json.countries) ? json.countries.filter(c => c && typeof c.code === 'string' && /^[A-Za-z]{2}$/.test(c.code) && isListedCountry(c)) : []
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const [stories, entities, countries] = await Promise.all([verifiedStories(), namedEntities(), activeCountries()])
  return [
    ...PAGES.map(p => ({ url: `${SITE_URL}${p.path === '/' ? '' : p.path}`, lastModified: now, changeFrequency: p.changeFrequency, priority: p.priority })),
    ...finishedWeeks(now, 4).map(w => ({ url: `${SITE_URL}/week/${w.name}`, lastModified: w.end, changeFrequency: 'monthly' as const, priority: 0.5 })),
    ...stories.map(s => ({ url: `${SITE_URL}/signals/${s.id}`, lastModified: new Date(s.updatedAt), changeFrequency: 'hourly' as const, priority: 0.6 })),
    ...countries.map(c => {
      const latest = c.latest_signal_at ? new Date(c.latest_signal_at) : now
      return { url: `${SITE_URL}/countries/${c.code.toUpperCase()}`, lastModified: Number.isNaN(latest.getTime()) ? now : latest, changeFrequency: 'daily' as const, priority: 0.6 }
    }),
    ...entities.map(e => ({ url: `${SITE_URL}${entityPath(e.id, e.name)}`, lastModified: new Date(e.lastReport), changeFrequency: 'daily' as const, priority: 0.5 })),
  ]
}
