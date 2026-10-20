import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/ai-infrastructure',
  title: 'AI infrastructure tracker',
  description: 'AI data centers around the world: where they are, who operates them, and which are operational, under construction or planned.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
