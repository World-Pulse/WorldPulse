import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/news-sitemap.xml (plan G16 slice 3, Oct 18, 2026): the
 * verified stories of the last 48 hours in Google News sitemap form
 * (publication, language, publication date, title), so a news crawler finds a
 * story within the hour. The stories come from GET /api/v1/stories/sitemap
 * (one per story, newest first, kept by the API for 30 minutes). If the API
 * can't answer, an empty (valid) file goes out for a minute.
 */
export const dynamic = 'force-dynamic'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'
/** Google reads only stories from the last two days, at most 1,000 per file */
const WINDOW_MS = 48 * 3_600_000
const MAX_URLS = 1_000

interface NewsStory { id?: string; title?: string; publishedAt?: string }

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
}

async function recentStories(): Promise<NewsStory[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/stories/sitemap`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = await res.json() as { data?: { stories?: NewsStory[] } }
    return Array.isArray(json.data?.stories) ? json.data.stories : []
  } catch {
    return []
  }
}

export async function GET(): Promise<Response> {
  const stories = await recentStories()
  const since = Date.now() - WINDOW_MS
  const entries: string[] = []
  for (const s of stories) {
    if (entries.length >= MAX_URLS) break
    const title = typeof s.title === 'string' ? s.title.trim() : ''
    const at = new Date(s.publishedAt ?? '')
    if (typeof s.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(s.id) || !title || Number.isNaN(at.getTime()) || at.getTime() < since) continue
    entries.push(
      `<url><loc>${SITE_URL}/signals/${s.id}</loc><news:news><news:publication><news:name>WorldPulse</news:name><news:language>en</news:language></news:publication>`
      + `<news:publication_date>${at.toISOString()}</news:publication_date><news:title>${escapeXml(title)}</news:title></news:news></url>`,
    )
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${entries.join('')}</urlset>\n`
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': entries.length > 0 ? 'public, max-age=300' : 'public, max-age=60',
    },
  })
}
