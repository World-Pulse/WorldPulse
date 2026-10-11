import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/map',
  title: 'Live World Map',
  description: 'Every verified event on one live map: conflicts, disasters, protests and breaking news, each with the outlets that confirm it.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
