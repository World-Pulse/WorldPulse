import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/space-weather',
  title: 'Space weather: solar storms and alerts',
  description: "Solar flares, geomagnetic storms and radio blackouts from NOAA's Space Weather Prediction Center, and what they can disrupt on Earth.",
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
