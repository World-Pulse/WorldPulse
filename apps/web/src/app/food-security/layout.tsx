import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/food-security',
  title: 'Food security by region',
  description: 'Hunger and food-crisis levels by region, with food prices and crisis alerts drawn from FAO, FEWS NET, WFP and IFPRI data.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
