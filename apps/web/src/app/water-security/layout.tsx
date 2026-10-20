import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/water-security',
  title: 'Water security by country',
  description: 'Water stress by country and region: the countries most at risk, those improving, and the recent reports that mention each.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
