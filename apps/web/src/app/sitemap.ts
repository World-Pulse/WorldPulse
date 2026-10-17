import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/page-metadata'
import { entityPath } from '@/lib/entity-links'

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
  { path: '/knowledge-graph', changeFrequency: 'hourly', priority: 0.6 },
  { path: '/entities', changeFrequency: 'hourly', priority: 0.7 },
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

interface SitemapCountry { code: string; name?: string; latest_signal_at?: string | null }

/** Codes the API counts signals under that are not a country of their own: UK repeats GB, ZZ and the rest are placeholders */
const NOT_A_COUNTRY = new Set(['UK', 'ZZ', 'EU', 'UN'])
/** A real country: a two-letter code the API knows by name (it falls back to the code itself for strays like PO, SF, EI) */
function isListedCountry(c: SitemapCountry): boolean {
  const code = c.code.toUpperCase()
  return !NOT_A_COUNTRY.has(code) && typeof c.name === 'string' && c.name.length > 0 && c.name.toUpperCase() !== code
}

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
    ...stories.map(s => ({ url: `${SITE_URL}/signals/${s.id}`, lastModified: new Date(s.updatedAt), changeFrequency: 'hourly' as const, priority: 0.6 })),
    ...countries.map(c => {
      const latest = c.latest_signal_at ? new Date(c.latest_signal_at) : now
      return { url: `${SITE_URL}/countries/${c.code.toUpperCase()}`, lastModified: Number.isNaN(latest.getTime()) ? now : latest, changeFrequency: 'daily' as const, priority: 0.6 }
    }),
    ...entities.map(e => ({ url: `${SITE_URL}${entityPath(e.id, e.name)}`, lastModified: new Date(e.lastReport), changeFrequency: 'daily' as const, priority: 0.5 })),
  ]
}
