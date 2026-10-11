import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
export const metadata: Metadata = pageMetadata({
  path: '/briefing',
  title: 'Daily Briefing',
  description: 'The day’s world news on one page, written each morning from stories confirmed by independent outlets.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
