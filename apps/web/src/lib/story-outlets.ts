import { cachedFetch } from '@/lib/server-fetch'

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * How many outlets carried the story a report belongs to (GET
 * /api/v1/stories/outlets, the count the home page and the story timeline
 * use), or null when the API can't say: then the story page shows the
 * report's own outlets. Asked on the server, so the page's first HTML, which
 * search engines and link previews read, has the story's count (Oct 20, 2026:
 * a story of 87 outlets showed "Reported by 9 outlets" until the browser asked).
 */
export async function fetchStoryOutlets(id: string): Promise<number | null> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories/outlets?ids=${encodeURIComponent(id)}`, 60_000)
    if (!res.ok) return null
    const json = await res.json() as { data?: { stories?: Record<string, { outlets?: unknown }> } }
    const n = Number(json.data?.stories?.[id]?.outlets)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
