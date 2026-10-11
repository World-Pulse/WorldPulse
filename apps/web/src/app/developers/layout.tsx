import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/developers',
  title: 'Developer API',
  description: 'Verified world events as data: signals with reliability scores, sources and coordinates, through a simple REST API and RSS.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
