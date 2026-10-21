import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/pricing',
  title: 'Pricing',
  description: 'Everything on WorldPulse is free today. Pro is coming: join the waitlist to hear when it opens.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
