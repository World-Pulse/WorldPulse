import { cachedFetch } from '@/lib/server-fetch'
import type { CountryStory } from '@/components/countries/CountryTopStories'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** How many of a country's stories its page shows, and over how many hours */
export const COUNTRY_STORIES = { limit: 8, hours: 72 }

/**
 * A country's top stories from GET /api/v1/stories?country= (plan 14), or
 * null when the API didn't answer; kept 2 minutes in this process.
 */
export async function fetchCountryStories(code: string): Promise<CountryStory[] | null> {
  if (!/^[A-Za-z]{2}$/.test(code)) return null
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories?country=${code.toUpperCase()}&hours=${COUNTRY_STORIES.hours}&limit=${COUNTRY_STORIES.limit}`, 120_000, 8_000)
    if (!res.ok) return null
    const json = await res.json() as { data?: { stories?: unknown[] } }
    const stories = Array.isArray(json.data?.stories) ? json.data.stories : []
    return stories.flatMap(raw => {
      const s = raw as Partial<CountryStory>
      return typeof s.id === 'string' && typeof s.leadId === 'string' && typeof s.title === 'string' && s.title
        ? [{
            id: s.id, leadId: s.leadId, title: s.title,
            place: typeof s.place === 'string' ? s.place : null,
            category: typeof s.category === 'string' ? s.category : null,
            severity: typeof s.severity === 'string' ? s.severity : 'info',
            outletCount: Number(s.outletCount) || 0,
            verifiedAt: typeof s.verifiedAt === 'string' ? s.verifiedAt : null,
          }]
        : []
    })
  } catch {
    return null
  }
}
