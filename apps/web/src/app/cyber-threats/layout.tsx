import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/cyber-threats',
  title: 'Cyber threats: attacks and exploited vulnerabilities',
  description: 'Recent cyber attacks, ransomware and actively exploited vulnerabilities, from CISA and open threat feeds, by severity.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
