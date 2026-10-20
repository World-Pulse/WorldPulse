import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/labor-rights',
  title: 'Labor rights by country',
  description: "Workers' rights by country: the countries most at risk, a regional breakdown and those improving.",
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
