import { cachedFetch } from '@/lib/server-fetch'
import { storyCountsOf, type StoryOutletCounts } from '@/lib/story-count'

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * How many outlets carried the story a report belongs to (GET
 * /api/v1/stories/outlets, the count the home page and the story timeline
 * use): in its last two days, since it began, and when it began (Oct 20,
 * 2026; lib/story-count.ts). Null when the API can't say: then the story page
 * shows the report's own outlets. Asked on the server, so the page's first
 * HTML, which search engines and link previews read, has the story's count (a
 * story of 87 outlets showed "Reported by 9 outlets" until the browser asked).
 */
export async function fetchStoryOutletCounts(id: string): Promise<StoryOutletCounts | null> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories/outlets?ids=${encodeURIComponent(id)}`, 60_000)
    if (!res.ok) return null
    const json = await res.json() as { data?: { stories?: Record<string, unknown> } }
    return storyCountsOf(json.data?.stories?.[id])
  } catch {
    return null
  }
}
