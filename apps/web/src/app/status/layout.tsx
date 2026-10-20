import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/status',
    title: 'System status',
    description: "Whether WorldPulse's site, API and data pipeline are up, and when they were last checked.",
  }),
  // An operations page, not one to find in search
  robots: { index: false, follow: true },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
