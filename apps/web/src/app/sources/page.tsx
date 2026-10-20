import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'
import SourcesList from './SourcesList'

// The list is a client component, so its title, description and address for
// search engines live here (H-0023, Oct 20, 2026). On this page, not in a
// layout, so /sources/suggest keeps its own.
export const metadata: Metadata = pageMetadata({
  path: '/sources',
  title: 'Sources: the outlets and feeds we read',
  description: 'The news outlets, wire services, government feeds and open-source data WorldPulse reads, each with its trust score.',
})

export default function Page() {
  return <SourcesList />
}
