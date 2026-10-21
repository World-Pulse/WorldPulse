import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata, metaDescription, storyListJsonLd, jsonLdText } from '@/lib/page-metadata'
import { cachedFetch } from '@/lib/server-fetch'

// The page itself is a client component, so its HTML used to carry no
// headlines and every country had the site's default title. This server
// layout gives each country a title, a description and the newest verified
// stories as plain links (plan G15, Oct 15, 2026).

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface CountryStory {
  id:    string
  title: string
}

interface CountrySummary {
  name:          string
  total_signals: number
  stories:       CountryStory[]
}

/** A country with its newest verified stories, null when it has none, 'unavailable' when the API didn't answer */
async function fetchCountry(code: string): Promise<CountrySummary | null | 'unavailable'> {
  try {
    // (kept 5 minutes in this process: crawlers and previews fetch in bursts)
    const res = await cachedFetch(`${API_BASE}/api/v1/countries/${code}?window=7d&limit=10`, 300_000)
    if (res.status === 404 || res.status === 400) return null
    if (!res.ok) return 'unavailable'
    const json = await res.json() as {
      name?: string
      total_signals?: number
      recent_signals?: Array<{ id?: string; title?: string }>
    }
    const stories = (json.recent_signals ?? [])
      .filter((s): s is CountryStory => typeof s.id === 'string' && typeof s.title === 'string' && s.title.length > 0)
    return {
      name:          json.name || code,
      total_signals: Number(json.total_signals) || stories.length,
      stories,
    }
  } catch {
    return 'unavailable'
  }
}

function validCode(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code)
}

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params
  if (!validCode(code)) return { title: 'Country Intelligence — WorldPulse', robots: { index: false } }
  const upper = code.toUpperCase()
  const country = await fetchCountry(upper)
  // The API being down says nothing about the country: keep the site's defaults
  if (country === 'unavailable') return { title: 'Country Intelligence — WorldPulse' }
  if (!country) return { title: 'Country Intelligence — WorldPulse', robots: { index: false } }

  const lead = country.stories[0]?.title
  const meta = pageMetadata({
    path: `/countries/${upper}`,
    title: `${country.name} news today: verified stories`,
    description: metaDescription(
      `${country.total_signals} verified stories about ${country.name} in the last 7 days from independent outlets, each with a reliability score.` +
      (lead ? ` Latest: ${lead}` : ''),
      200,
    ),
  })
  // The picture is the country's own card (opengraph-image.tsx and
  // twitter-image.tsx next to this layout), so not the site's default one
  return {
    ...meta,
    openGraph: { ...meta.openGraph, images: undefined },
    twitter: { ...meta.twitter, images: undefined },
  }
}

export default async function Layout(
  { children, params }: { children: React.ReactNode; params: Promise<{ code: string }> },
) {
  const { code } = await params
  const country = validCode(code) ? await fetchCountry(code.toUpperCase()) : null
  const stories = country && country !== 'unavailable' ? country.stories : []

  const upper = code.toUpperCase()
  // For search engines: the page as a list of its stories, under Home › Countries (K2a)
  const jsonLd = stories.length > 0 && country && country !== 'unavailable'
    ? storyListJsonLd({
        path: `/countries/${upper}`,
        name: `${country.name} news today: verified stories`,
        description: `Verified stories about ${country.name} from independent outlets, each with how many outlets reported it.`,
        stories,
        trail: [{ name: 'Countries', path: '/countries' }, { name: country.name, path: `/countries/${upper}` }],
      })
    : null

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />}
      {children}
      {stories.length > 0 && country && country !== 'unavailable' && (
        // The same stories the page lists, as plain links for search engines
        // and readers without JavaScript; kept out of the visual layout
        <nav aria-label={`Latest verified stories about ${country.name}`} className="sr-only">
          <h2>{country.name} news today</h2>
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
