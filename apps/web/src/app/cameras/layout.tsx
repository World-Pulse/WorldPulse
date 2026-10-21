import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/cameras',
    title: 'Live cameras',
    description: 'Live road and city cameras in London, New York, California, Finland, Hong Kong and New Zealand, a new picture every minute.',
  }),
  // Hidden from search from Oct 13 while the camera feeds were down; back Oct 21, 2026 (plan M45)
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
