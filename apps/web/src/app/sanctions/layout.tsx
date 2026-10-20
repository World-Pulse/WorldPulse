import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/sanctions',
    title: 'Sanctions search',
    description: 'Search people, companies and vessels on international sanctions lists.',
  }),
  // Kept out of search until it loads: it needs an OpenSanctions key (plan P16)
  robots: { index: false, follow: true },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
