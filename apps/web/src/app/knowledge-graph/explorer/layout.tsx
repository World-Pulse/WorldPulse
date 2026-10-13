import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// (its own address and title, not the knowledge graph page's, Oct 13, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/knowledge-graph/explorer',
  title: 'Knowledge graph explorer',
  description: 'Explore the WorldPulse knowledge graph: search a person, place or organization and follow who they are named with in the news.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
