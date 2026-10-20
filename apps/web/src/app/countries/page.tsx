import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'
import { cachedFetch } from '@/lib/server-fetch'
import { isListedCountry } from '@/lib/country-list'
import CountriesIndex from './CountriesIndex'

// The index itself is a client component, so its title, description and
// address for search engines live here, with every country that has verified
// stories this week as plain links: a crawler that doesn't run scripts can
// follow them to the country pages (H-0023, Oct 20, 2026). Kept on this page,
// not in a layout, so the pages under /countries keep their own.

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export const metadata: Metadata = pageMetadata({
  path: '/countries',
  title: 'Countries: verified news by country',
  description: 'Every country in the news this week, ranked by how serious its verified stories are, each with a page of the latest stories confirmed by independent outlets.',
})

/** The countries with verified stories this week; empty when the API doesn't answer */
async function listedCountries(): Promise<Array<{ code: string; name: string }>> {
  try {
    // (kept 5 minutes in this process: crawlers fetch in bursts)
    const res = await cachedFetch(`${API_BASE}/api/v1/countries?window=7d&limit=200`, 300_000)
    if (!res.ok) return []
    const json = await res.json() as { countries?: Array<{ code: string; name?: string }> }
    return (Array.isArray(json.countries) ? json.countries : [])
      .filter(isListedCountry)
      .map(c => ({ code: c.code.toUpperCase(), name: String(c.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export default async function Page() {
  const countries = await listedCountries()
  return (
    <>
      <CountriesIndex />
      {countries.length > 0 && (
        // For search engines and readers without JavaScript; kept out of the visual layout
        <nav aria-label="Countries with verified stories this week" className="sr-only">
          <h2>Countries in the news</h2>
          <ul>
            {countries.map(c => (
              <li key={c.code}><Link href={`/countries/${c.code}`}>{c.name} news today</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </>
  )
}
