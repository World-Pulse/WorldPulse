import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/patents',
    title: 'Patent intelligence',
    description: 'Patent filings in strategic and defense technologies, by category, assignee and severity.',
  }),
  // Kept out of search while its source (PatentsView) is paused: no new filings since March 2026
  robots: { index: false, follow: true },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
