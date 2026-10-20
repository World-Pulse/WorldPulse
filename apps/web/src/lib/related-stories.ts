/**
 * "Related" on a story's page (plan G18 (1); Oct 20, 2026): up to five other
 * stories, one row each, with their outlet counts: the same country's top
 * stories (the same topic first among them), then the day's most-reported of
 * the same topic, then the day's most-reported. Until Oct 20 it listed single
 * reports of the same country or topic, so a story's page could list its own
 * story's other reports and the same headline twice (the Kenyan cult verdict's
 * page: "Kenya cult leader's children still being starved weeks before trial"
 * twice, and another report of the verdict itself).
 */

import { cachedFetch } from '@/lib/server-fetch'
import { storiesOf } from '@/lib/country-stories'
import type { CountryStory } from '@/components/countries/CountryTopStories'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** The day's most-reported stories, asked as the home page asks (so one kept answer serves both) */
export async function fetchTopStories(): Promise<CountryStory[]> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories?hours=24&limit=12`, 120_000)
    if (!res.ok) return []
    const json = await res.json() as { data?: { stories?: unknown[] } }
    return storiesOf(json.data?.stories)
  } catch {
    return []
  }
}

/** A headline reduced to its words, to tell two stories with the same headline apart from two stories */
function headlineKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * The stories to show: never the page's own story (by its story id or its
 * lead report), each story once, one headline once, at most `max`.
 */
export function rankRelatedStories(
  current: { storyId?: string | null; signalId: string; category?: string | null },
  sameCountry: CountryStory[],
  top: CountryStory[],
  max = 5,
): CountryStory[] {
  const sameTopic = (s: CountryStory) => Boolean(current.category) && s.category === current.category
  // within the country, the same topic first (the sort is stable)
  const country = sameCountry.map((s, i) => ({ s, i }))
    .sort((a, b) => Number(sameTopic(b.s)) - Number(sameTopic(a.s)) || a.i - b.i)
    .map(x => x.s)
  const stories = new Set<string>(current.storyId ? [current.storyId] : [])
  const headlines = new Set<string>()
  const out: CountryStory[] = []
  for (const s of [...country, ...top.filter(sameTopic), ...top]) {
    const key = headlineKey(s.title)
    if (stories.has(s.id) || s.leadId === current.signalId || headlines.has(key)) continue
    stories.add(s.id)
    headlines.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}
