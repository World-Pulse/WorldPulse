import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchHomeTotals } from '@/lib/home-totals'
import { COUNTRIES_COVERED } from '@/lib/coverage-count'
import SourcesList from './SourcesList'

// The list is a client component, so its title, description and address for
// search engines live here (H-0023, Oct 20, 2026). On this page, not in a
// layout, so /sources/suggest keeps its own.
export const metadata: Metadata = pageMetadata({
  path: '/sources',
  title: 'Sources: the outlets and feeds we read',
  description: `The news outlets, wire services, government feeds and open data WorldPulse reads in ${COUNTRIES_COVERED} countries and territories.`,
})

// The sources read come from the server's status file, as on the home page and How we count, and are in
// the page as sent, so a crawler or an AI assistant reads them too (Nov 25, 2026: the page said
// "19 verified sources", the curated list's length, against 1,442 sources read)
export default async function Page() {
  const totals = await fetchHomeTotals()
  return <SourcesList sourcesRead={totals.sources} />
}
