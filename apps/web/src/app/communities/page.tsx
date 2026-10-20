import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'
import CommunitiesList from './CommunitiesList'

// The list is a client component, so its title, description and address for
// search engines live here (H-0023, Oct 20, 2026). On this page, not in a
// layout, so each community's page keeps its own.
export const metadata: Metadata = pageMetadata({
  path: '/communities',
  title: 'Communities',
  description: 'Groups of readers discussing the topics and regions they follow on WorldPulse.',
})

export default function Page() {
  return <CommunitiesList />
}
