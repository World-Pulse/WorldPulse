import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (Oct 13, 2026: it had the
// site's generic title)
export const metadata: Metadata = pageMetadata({
  path: '/knowledge-graph',
  title: 'Knowledge graph: who is named with whom in the news',
  description: 'The people, places and organizations in the news, how often each is named, what is trending in the last 24 hours, and who they are named with, from the reports WorldPulse follows.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
