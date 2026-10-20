import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/audio-claims',
    title: 'Audio and podcast claims',
    description: 'Claims made in podcasts and audio, checked against what independent outlets report.',
  }),
  // Kept out of search until its data loads (plan P15)
  robots: { index: false, follow: true },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
