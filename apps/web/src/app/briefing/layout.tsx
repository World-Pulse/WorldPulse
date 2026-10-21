import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata, storyListJsonLd, jsonLdText } from '@/lib/page-metadata'
import { cachedFetch } from '@/lib/server-fetch'
import { storiesOf } from '@/lib/country-stories'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/briefing',
  title: 'Daily Briefing',
  description: 'The day’s world news on one page, written each morning from stories confirmed by independent outlets.',
})

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** The day's top stories (GET /api/v1/stories, the last 24 hours), kept 2 minutes; [] when the API doesn't answer */
async function topStories(): Promise<Array<{ id: string; title: string }>> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories?hours=24&limit=10`, 120_000, 8_000)
    if (!res.ok) return []
    const json = await res.json() as { data?: { stories?: unknown[] } }
    return storiesOf(json.data?.stories).map(s => ({ id: s.leadId, title: s.title }))
  } catch {
    return []
  }
}

// The briefing's stories load in the browser, so a crawler saw a page with no
// story links (K2's check, Oct 21, 2026): the day's top stories are here as
// plain links and as structured data, kept out of the visual layout (K2a)
export default async function Layout({ children }: { children: React.ReactNode }) {
  const stories = await topStories()
  return (
    <>
      {stories.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(storyListJsonLd({
          path: '/briefing',
          name: 'Daily Briefing: the day’s world news',
          description: 'The stories the most independent outlets reported in the last 24 hours.',
          stories,
          trail: [{ name: 'Daily Briefing', path: '/briefing' }],
        })) }} />
      )}
      {children}
      {stories.length > 0 && (
        <nav aria-label="Today’s top stories" className="sr-only">
          <h2>Today’s top stories</h2>
          <ul>
            {stories.map(s => (
              <li key={s.id}><Link href={`/signals/${s.id}`}>{s.title}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </>
  )
}
